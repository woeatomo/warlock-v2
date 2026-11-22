'use strict';
// Mini App display-only: real token logos (/logo/<mint>, cached, W fallback) and the Meteora-style position view (liquidity, claimable/claimed fees, PnL).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ov = require('./miniapp/onchain-view');
const MINT = '9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump';
let ok = 0; const t = async (name, fn) => { await fn(); ok++; console.log('ok', name); };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const DCTY = { pool: '4exs9btspvKHEYtuCFMXXV9snF99UvbFJKtDhAzmgYtz', position: 'D29ZVCx6pKZxiC7XGqe5AGVJa6XaGW1LEkjdMuHHxYXx', name: 'DCTY-SOL', mintX: MINT, decX: 6,
  depositSol: 0.9, feesCompoundedQuote: 0.000437198, feesCompoundedX: 27.949561, feesClaimedToPileSol: 0, walletTokenRaw: '0', lastPrice: 0.0000545,
  liveBins: { bins: [{ id: -400, sol: 0.5, token: 0 }, { id: -360, sol: 0, token: 7000 }], price: 0.00005, at: '2026-11-20T07:59:00.000Z' } };
(async () => {
  await t('meteora view: liquidity excl. fees, claimable split, claimed = compound + wallet, PnL = liq + unclaimed + wallet fees - deposit', async () => {
    const m = ov.meteoraView(DCTY, { x: 476, y: 0.873, fx: 10.76, fy: 0.0000437, price: 0.0000545, at: '2026-11-20T08:00:00.000Z' }, 72);
    const liq = 0.873 + 476 * 0.0000545, un = 0.0000437 + 10.76 * 0.0000545;
    assert.ok(Math.abs(m.liquidity.solEq - liq) < 1e-12); assert.ok(Math.abs(m.liquidity.usd - liq * 72) < 1e-9);
    assert.strictEqual(m.unclaimed.token, 10.76); assert.strictEqual(m.unclaimed.sol, 0.0000437); assert.ok(Math.abs(m.unclaimed.usd - un * 72) < 1e-9);
    assert.ok(Math.abs(m.claimed.compound.solEq - (0.000437198 + 27.949561 * 0.0000545)) < 1e-12); assert.strictEqual(m.claimed.wallet.sol, 0);
    assert.ok(Math.abs(m.pnl.sol - (liq + un - 0.9)) < 1e-12); assert.ok(Math.abs(m.pnl.pct - 100 * (liq + un - 0.9) / 0.9) < 1e-9);
    assert.ok(Math.abs(m.feesEarned.solEq - (un + m.claimed.solEq)) < 1e-12); assert.strictEqual(m.source, 'onchain'); assert.strictEqual(m.walletTokenOutside, null);
    const w = ov.meteoraView({ ...DCTY, feesClaimedToPileSol: 0.001 }, { x: 476, y: 0.873, fx: 10.76, fy: 0.0000437, price: 0.0000545 }, 72);
    assert.ok(Math.abs(w.pnl.sol - m.pnl.sol - 0.001) < 1e-12, 'claimed fees left in the wallet count in PnL'); assert.strictEqual(w.claimed.wallet.sol, 0.001);
  });
  await t('before the first on-chain read: liquidity from the bot snapshot, fees/PnL pending (no made-up numbers)', async () => {
    const m = ov.meteoraView(DCTY, null, 72);
    assert.strictEqual(m.source, 'bot-snapshot'); assert.ok(Math.abs(m.liquidity.solEq - (0.5 + 7000 * 0.00005)) < 1e-12);
    assert.strictEqual(m.unclaimed, null); assert.strictEqual(m.pnl, null); assert.strictEqual(m.feesEarned, null);
  });
  await t('position snapshot: background read, cached 30 s (one RPC read for many polls)', async () => {
    let calls = 0; ov.setPositionFetcher(async () => { calls++; return { x: 1, y: 2, fx: 0.1, fy: 0.01, price: 0.5, activeBin: -362 }; });
    assert.strictEqual(ov.positionSnapshot(DCTY), null); await tick();
    const s = ov.positionSnapshot(DCTY); assert.strictEqual(s.y, 2); assert.strictEqual(s.activeBin, -362);
    for (let i = 0; i < 5; i++) ov.positionSnapshot(DCTY);
    assert.strictEqual(calls, 1);
    ov.setPositionFetcher(async () => { throw new Error('rpc down'); });
    assert.strictEqual(ov.positionSnapshot(DCTY, 0), null); await tick(); assert.strictEqual(ov.positionSnapshot(DCTY, 1e9), null, 'a failed read is not a snapshot');
  });
  await t('token logo: fetched once and cached, bad mint / not found = null (W), image URLs https only', async () => {
    let calls = 0; ov.setLogoFetcher(async (m) => { calls++; return m === MINT ? { type: 'image/webp', buf: Buffer.from('RIFF') } : null; });
    const [a, b] = await Promise.all([ov.tokenLogo(MINT), ov.tokenLogo(MINT)]); assert.strictEqual(a.type, 'image/webp'); assert.strictEqual(a, b);
    assert.strictEqual(await ov.tokenLogo(MINT), a); assert.strictEqual(calls, 1);
    assert.strictEqual(await ov.tokenLogo('../../etc/passwd'), null); assert.strictEqual(await ov.tokenLogo('So11111111111111111111111111111111111111112'), null);
    assert.strictEqual(ov.safeImageUrl('http://x.example/a.png'), null); assert.strictEqual(ov.safeImageUrl('https://127.0.0.1/a.png'), null); assert.ok(ov.safeImageUrl('https://static.datapi.jup.ag/token-icons/a.webp'));
  });
  await t('/logo/<mint> route: real image from our origin, W svg (no-store) when unknown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-route-')); fs.mkdirSync(path.join(root, 'paper'));
    fs.writeFileSync(path.join(root, 'STOP'), '');
    const handle = require('./miniapp/server').createApp({ paperDir: path.join(root, 'paper') });
    const srv = http.createServer((q, r) => handle(q, r)); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => res({ r, body: Buffer.concat(c) })); }).on('error', rej));
    const a = await get('/logo/' + MINT); assert.strictEqual(a.r.headers['content-type'], 'image/webp'); assert.strictEqual(a.body.toString(), 'RIFF'); assert.ok(/max-age=86400/.test(a.r.headers['cache-control']));
    const b = await get('/logo/So11111111111111111111111111111111111111112'); assert.strictEqual(b.r.headers['content-type'], 'image/svg+xml'); assert.ok(/no-store/.test(b.r.headers['cache-control']));
    const c = await get('/logo/..%2F..%2Fstate.json'); assert.strictEqual(c.r.headers['content-type'], 'image/svg+xml');
    srv.close(); fs.rmSync(root, { recursive: true, force: true });
  });
  await t('card: Meteora tiles replace "Sedang open" / "Fees pool 24h"; real logo in card, screening, history, activity', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
    const body = src.slice(src.indexOf('  function tile(k,v'), src.indexOf('  function meteoraNote(')) + src.slice(src.indexOf('  function meteoraNote('), src.indexOf('\n', src.indexOf('  function meteoraNote(')));
    const ctx = { esc: (x) => String(x), numeric: (v) => v != null && Number.isFinite(+v), money: (n) => (n == null ? '—' : '$' + (+n).toFixed(2)), signed: (n) => (n == null ? '—' : (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2)), pnlClass: (n) => (n >= 0 ? 'positive' : 'negative'), wib: (x) => 'W' + x };
    require('vm').createContext(ctx); require('vm').runInContext(body + ';this.mt=meteoraTiles;this.logo=tokLogo;this.rm=rememberMint;this.mit=mintInText;this.note=meteoraNote;', ctx);
    const m = ov.meteoraView(DCTY, { x: 476, y: 0.873, fx: 10.76, fy: 0.0000437, price: 0.0000545, at: 'T' }, 72), html = ctx.mt(DCTY, m);
    for (const k of ['Liquidity · Meteora', 'Modal (deposit)', 'PnL · Meteora', 'Fees earned', 'Fees unclaimed', 'Fees claimed']) assert.ok(html.includes(k), k);
    assert.ok(/10\.76 DCTY \+ 0\.0000437 SOL/.test(html), html); assert.ok(/compound \$0\.14 \(27\.95 DCTY \+ 0\.000437 SOL\) · di wallet \$0\.00/.test(html), html);
    assert.ok(!/Fees pool/.test(html)); assert.ok(/Meteora/.test(ctx.note(m)));
    assert.ok(/fees\/PnL/.test(ctx.note(m)) || /PnL =/.test(ctx.note(m)));
    assert.ok(/<img class="tok-logo" src="\/logo\/9hjB/.test(ctx.logo(MINT))); assert.ok(/src="\/logo\.svg/.test(ctx.logo(null)));
    ctx.rm('DCTY-SOL', MINT); assert.strictEqual(ctx.mit('Pantau DCTY-SOL · 0.9 SOL'), MINT); assert.strictEqual(ctx.mit('scan: 120 pools'), null);
    assert.ok(src.includes("<div class=\"pool-icon\">${tokLogo(pos.mintX)}</div>") && src.includes("tokLogo(c.mintX,'tok-logo sm')") && src.includes("tokLogo(r.mintX||mintInText(r.name),'tok-logo sm')") && src.includes("tokLogo(mt,'tok-logo ev')"));
  });
  console.log(`PASS ${ok} checks`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
