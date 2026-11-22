'use strict';
// LIVE mode (root STOP absent): every Mini App view reads the live bot (root bot.log / state.json / status.json), never the dry run's paper/ files.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-live-src-')), paper = path.join(root, 'paper');
fs.mkdirSync(paper, { recursive: true });
const W = (f, v) => fs.writeFileSync(path.join(root, f), typeof v === 'string' ? v : JSON.stringify(v));
const PUB = '7XtKqPmTn4cWzRbVhGd2YsJaLfN8EuQe5Hk3MvBx9CpA', SIG = '5'.repeat(1) + 'Kq7N3x'.repeat(14), SECRET_RPC = 'https://rpc.example.invalid/?api-key=SEKRET123';
W('bot.log', [
  `[2026-11-20 14:50:00 WIB] start: wallet ${PUB} rpc=${SECRET_RPC} maxPositions=1`,
  '[2026-11-20 14:51:00 WIB] scan: 120 pools fetched, 7 pass basic filters; rejects={"tvl<":40,"fee/tvl":3}',
  '[2026-11-20 14:51:01 WIB] scan final: 1 pass all filters; rejects={}',
  '[2026-11-20 14:51:02 WIB] open plan DCTY-SOL: bins -10-59, USD 120',
  `[2026-11-20 14:51:09 WIB]   tx open-extended-empty confirmed ${SIG}`,
  '[2026-11-20 14:52:00 WIB] monitor DCTY-SOL: value=1.0100 SOL pnl=1.00% fees=0.0010 age=0.01h inRange=true',
  '[2026-11-20 14:53:00 WIB] monitor DCTY-SOL: value=1.0200 SOL pnl=2.00% fees=0.0020 age=0.03h inRange=true',
  `[2026-11-20 14:53:30 WIB] position cycle error DCTY-SOL (held, retry next cycle): fetch ${SECRET_RPC} failed`,
  '  "Program log: AnchorError thrown in programs/x"',
  '[2026-11-20 14:54:00 WIB] CLOSE DCTY-SOL reason=take_profit pnl=2.50% value=1.0250 SOL',
  '[2026-11-20 14:54:10 WIB]   closed. wallet 3.2100 SOL',
  '[2026-11-20 14:55:00 WIB] no candidate passes all filters',
].join('\n') + '\n');
fs.writeFileSync(path.join(paper, 'bot.log'), '[2026-11-20 09:00:00 WIB] [PAPER] PAPER OPEN [N5] OLD-SOL: spent 100 USDC\n');
const hist = [
  { name: 'AAA-SOL', pool: 'p1', closedAt: '2026-11-19T03:00:00.000Z', realizedSol: 0.05, solUsd: 200, reshapes: 2 },
  { name: 'BBB-SOL', pool: 'p2', closedAt: '2026-11-20T04:00:00.000Z', realizedSol: -0.02, pnlUsd: -4, reshapes: 1 },
];
W('state.json', { position: null, positions: [{ name: 'DCTY-SOL', pool: 'p3', reshapes: 3, rentRefundableSol: 0.06, lastSolUsd: 210 }], history: hist, lastScan: { at: '2026-11-20T07:55:00.000Z', fetched: 120, basic: 7 } });
W('status.json', { updated: '2026-11-20T07:55:00.000Z', updatedWib: '2026-11-20 14:55 WIB', rpc: SECRET_RPC, wallet: PUB, solBalance: 3.21, config: { maxPositions: 1 }, lastScan: { at: '2026-11-20T07:55:00.000Z', fetched: 120, basic: 7 }, lives: [{ valueSol: 1.02, pnlSol: 0.02, feesSol: 0.002 }] });
fs.writeFileSync(path.join(paper, 'summary.json'), JSON.stringify({ stats: { trades: 999, capitalAsset: 'USDC', virtualUsdc: 5000 }, closedRecent: [{ name: 'PAPER-SOL', closedAt: '2026-11-20T01:00:00.000Z', pnlUsd: 9 }] }));
fs.writeFileSync(path.join(paper, 'status.json'), JSON.stringify({ paper: true, lastScan: { at: '2026-11-20T02:00:00.000Z' } }));
fs.writeFileSync(path.join(paper, 'state.json'), JSON.stringify({ books: { N5: { history: [{ name: 'PAPER-SOL', closedAt: '2026-11-20T01:00:00.000Z', pnlUsd: 9 }] } } }));

const act = require('./miniapp/activity');
let ok = 0; const pending = []; const t = (name, fn) => { const r = fn(); const done = () => { ok++; console.log('ok', name); }; if (r && r.then) pending.push(r.then(done)); else done(); };
const noSecret = (s, where) => { for (const bad of ['SEKRET123', 'api-key', 'rpc.example', PUB, SIG]) assert.ok(!s.includes(bad), where + ' leaks ' + bad.slice(0, 8)); };

t('activity live reads root bot.log, newest first, live formats parsed', () => {
  const ev = act.events(paper, { live: true }), txt = ev.map((e) => e.text).join('\n');
  assert.ok(ev.length >= 8, txt);
  assert.strictEqual(ev[0].atWib, '2026-11-20 14:55:00 WIB'); assert.strictEqual(ev[0].kind, 'idle');
  assert.ok(ev.some((e) => e.kind === 'close' && /Tutup DCTY-SOL .*2\.50% .*1\.0250 SOL/.test(e.text)), txt);
  assert.ok(ev.some((e) => e.kind === 'open' && /Buka posisi live DCTY-SOL/.test(e.text)), txt);
  assert.ok(ev.some((e) => e.kind === 'scan' && /Scan 120 pool · 7 lolos awal/.test(e.text)), txt);
  assert.ok(ev.some((e) => e.kind === 'error' && /Gangguan siklus posisi DCTY-SOL/.test(e.text)), txt);
  assert.ok(ev.some((e) => /Bot live mulai/.test(e.text)), txt);
  assert.ok(ev.some((e) => /Transaksi open-extended-empty terkonfirmasi/.test(e.text)), txt);
  const mons = ev.filter((e) => e.kind === 'monitor'); assert.strictEqual(mons.length, 1); assert.ok(/1\.0200 SOL · PnL 2\.00%/.test(mons[0].text));
  assert.ok(!/OLD-SOL|PAPER/.test(txt), 'paper log must not appear in live');
  noSecret(JSON.stringify(ev), 'activity');
});
t('activity dry run still reads paper/bot.log', () => {
  const ev = act.events(paper); assert.strictEqual(ev.length, 1); assert.ok(/OLD-SOL/.test(ev[0].text));
});
t('activity tail is bounded on a big log', () => {
  const big = path.join(root, 'bot.log'), keep = fs.readFileSync(big);
  const fd = fs.openSync(big, 'w'); const filler = Buffer.from('[2026-11-20 10:00:00 WIB] scan timing: decision 1s\n'.repeat(20000)); for (let i = 0; i < 6; i++) fs.writeSync(fd, filler); fs.writeSync(fd, keep); fs.closeSync(fd);
  const t0 = Date.now(), ev = act.events(paper, { live: true }); assert.ok(Date.now() - t0 < 500); assert.strictEqual(ev[0].atWib, '2026-11-20 14:55:00 WIB');
  fs.writeFileSync(big, keep);
});
t('scrub shortens base58 ids and hides urls/rpc', () => {
  const s = act.scrub(`x ${PUB} rpc=${SECRET_RPC} ${SECRET_RPC}`); noSecret(s, 'scrub'); assert.ok(s.includes('7XtK…9CpA'));
});

const server = require('./miniapp/server');
t('publicStatus LIVE: stats/status/history/activity/window from live, dry-run panels empty, no secrets', () => {
  const out = server.publicStatus(paper), j = JSON.stringify(out);
  noSecret(j, 'publicStatus');
  assert.strictEqual(out.paper, false); assert.strictEqual(out.activitySource, 'live');
  assert.ok(out.status.live && out.status.lastScan && out.status.lastScan.fetched === 120 && out.status.rpc === undefined && out.status.wallet === undefined);
  const s = out.summary.stats; assert.ok(s.live && s.capitalAsset === 'SOL' && s.trades === 2 && s.wins === 1 && s.losses === 1 && s.winRate === 50, JSON.stringify(s));
  assert.ok(Math.abs(s.totalNetPnlSol - 0.03) < 1e-9 && Math.abs(s.totalNetPnlUsd - 6) < 1e-9, JSON.stringify(s));   // 0.05*200 - 4
  assert.strictEqual(s.reshapes, 6); assert.strictEqual(s.virtualUsdc, undefined);
  assert.deepStrictEqual(out.summary.closedRecent.map((r) => r.name), ['AAA-SOL', 'BBB-SOL']);
  assert.deepStrictEqual(out.runs.runs, []); assert.ok(out.capital.live && out.commands.live && out.window.live);
  assert.ok(out.activity.length && !/OLD-SOL/.test(JSON.stringify(out.activity)));
});
t('publicStatus DRY RUN (STOP present) keeps the paper sources', () => {
  W('STOP', ''); const out = server.publicStatus(paper); fs.unlinkSync(path.join(root, 'STOP'));
  assert.strictEqual(out.activitySource, 'paper'); assert.strictEqual(out.summary.stats.trades, 999); assert.ok(/OLD-SOL/.test(out.activity[0].text));
});
const cal = require('./paper-pnl-calendar');
t('calendar buildLive uses the live history (SOL from realizedSol)', () => {
  const c = cal.buildLive(root); assert.strictEqual(c.trades, 2); assert.ok(c.live);
  assert.ok(Math.abs(c.totalSol - 0.03) < 1e-9 && Math.abs(c.total - 6) < 1e-9, JSON.stringify(c).slice(0, 300));
  assert.ok(!JSON.stringify(c).includes('PAPER-SOL'));
});
t('dashboardData LIVE curve comes from the live history', () => {
  const save = { PAPER: process.env.PAPER, DRY_RUN: process.env.DRY_RUN, LIVE_CONFIRMED: process.env.LIVE_CONFIRMED };
  Object.assign(process.env, { PAPER: '0', DRY_RUN: '0', LIVE_CONFIRMED: '1' });
  const d = server.dashboardData(paper, path.join(root, 'STOP'));
  for (const [k, v] of Object.entries(save)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  assert.ok(d.mode.live, 'env forces live here');
  { assert.strictEqual(d.historySource, 'live'); assert.deepStrictEqual(d.historyCurve.map((p) => p.name), ['AAA-SOL', 'BBB-SOL']); }
  const d2 = server.dashboardData(paper, path.join(root, 'NO-SUCH-STOP-BUT-PAPER-ENV')); assert.ok(d2.historyCurve);
});
t('dashboard/calendar mode follows the live bot status when the Mini App env says dry run', () => {
  const save = { PAPER: process.env.PAPER, DRY_RUN: process.env.DRY_RUN, LIVE_CONFIRMED: process.env.LIVE_CONFIRMED };
  Object.assign(process.env, { PAPER: '1', DRY_RUN: '1' }); delete process.env.LIVE_CONFIRMED;
  const st = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
  W('status.json', { ...st, dryRun: false, paper: false }); let d = server.dashboardData(paper, path.join(root, 'STOP'));
  assert.ok(d.mode.live && d.mode.label === 'LIVE' && d.historySource === 'live', JSON.stringify(d.mode));
  W('STOP', ''); d = server.dashboardData(paper, path.join(root, 'STOP')); fs.unlinkSync(path.join(root, 'STOP'));
  assert.ok(!d.mode.live && d.historySource === 'paper');
  W('status.json', { ...st, dryRun: true, paper: true }); d = server.dashboardData(paper, path.join(root, 'STOP')); assert.ok(!d.mode.live);
  W('status.json', st);
  for (const [k, v] of Object.entries(save)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
t('activity live: API rate limits get a readable line', () => {
  const l = act.liveLine('http api.geckoterminal.com/api/v2/networks/so failed (1/2): 429 Too Many'); assert.ok(l && /API geckoterminal gagal \(429 rate limit\) · percobaan 1\/2/.test(l.text), l && l.text);
});
t('telegram menus open on the live data when live', () => {
  const hm = require('./history-menu'), ids = (m) => m.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(ids(hm.mainMenu('id', { src: 'l' })).includes('hs|l|0') && ids(hm.mainMenu('id', { src: 'l' })).includes('ps|l'));
  assert.ok(ids(hm.mainMenu('id')).includes('hs|d|0'));
});
t('position card shows Meteora-style range and shape (DCTY: 87 bins -441..-355, bin step 80)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
  const body = src.slice(src.indexOf('  function rangeInfo('), src.indexOf('  function renderStatus('));
  const ctx = {}; require('vm').createContext(ctx); require('vm').runInContext(body + ';this.r=rangeInfo;this.s=shapeInfo;', ctx);
  const pos = { minBinId: -441, maxBinId: -355, binStep: 80, decX: 6, spotSol: 0.44927923, bidaskSol: 0, depositPlanned: 0.9 };
  const r = ctx.r(pos); assert.ok(/^87 bin · bin step 80 · harga .* SOL · lebar 50\.0% di bawah batas atas$/.test(r), r);
  assert.strictEqual(ctx.s(pos), 'Bentuk: Spot 0.4493 SOL + Bid-Ask 0.0000 SOL · belum masuk 0.4507 SOL');
  assert.strictEqual(ctx.s({ ...pos, bidaskSol: 0.45072077 }), 'Bentuk: Spot 0.4493 SOL + Bid-Ask 0.4507 SOL');
  assert.ok(src.includes('${esc(rangeInfo(pos))}') && src.includes('${esc(shapeInfo(pos))}'));
});
t('bin chart: one bar per bin over the whole range (87 for DCTY), real shape label, active marker on its bin', () => {
  const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
  const body = src.slice(src.indexOf('  function shapeLabel('), src.indexOf('  function entryHistoryRows('));
  const ctx = { esc: (x) => String(x), numeric: (v) => v != null && Number.isFinite(+v) }; require('vm').createContext(ctx);
  require('vm').runInContext(body + ';this.chart=binChart;this.mc=mcapInfo;this.cu=compactUsd;', ctx);
  const bins = []; for (let id = -441; id <= -361; id++) bins.push({ id, sol: id <= -365 ? 0.0052 + (id < -400 ? 0.004 : 0) : 0, token: id > -365 ? 100 : 0 });
  const pos = { minBinId: -441, maxBinId: -355, binStep: 80, decX: 6, lastPrice: 0.0000563, quoteSymbol: 'SOL', spotSol: 0.449, bidaskSol: 0.4507, shape: 'M-double-bidask', binShape: { bins, activeBin: -361, price: 0.0000563 } };
  const svg = ctx.chart(pos);
  assert.ok(/Spot \+ Bid-Ask · M \(reshape\) · 87 bar · <b class="reshape-count">Reshape 0x</.test(svg), svg.slice(0, 260));
  assert.ok(/Reshape 8x</.test(ctx.chart({ ...pos, reshapes: 8 })), 'reshape count shown next to the bin chart');
  const hs = (fill) => [...svg.matchAll(new RegExp('height="([\\d.]+)"[^>]*fill="url\\(#' + fill + '\\)"', 'g'))].map((m) => +m[1]);
  const sol = hs('bnSol'), tok = hs('bnTok');
  assert.strictEqual(sol.length, 87); assert.strictEqual(tok.length, 87);   // fixed structure: two rects per bin, zero height when empty
  assert.strictEqual(sol.filter((h) => h > 0).length, 77); assert.strictEqual(tok.filter((h) => h > 0).length, 4);   // -441..-365 SOL, -364..-361 token, -360..-355 empty
  assert.ok(!/dua sisi/.test(svg)); assert.ok(!/-4\d\d|-3\d\d|BIN |ACTIVE/.test(svg), 'no bin numbers in the chart');
  assert.ok(/MCAP NOW n\/a/.test(svg) && /MCAP n\/a/.test(svg) && /Mcap now n\/a/.test(svg));   // supply not loaded yet
  const svg2 = ctx.chart({ ...pos, mcap: { ok: true, nowUsd: 3.7e6, lowerUsd: 2.02e6, upperUsd: 4.05e6 } });
  assert.ok(/MCAP NOW \$3\.70M/.test(svg2) && /MCAP \$2\.02M – \$4\.05M/.test(svg2) && /Mcap now \$3\.70M/.test(svg2), svg2.slice(0, 300));
  assert.ok(/mcap ≈ \$2\.02M/.test(svg2));   // first bin tooltip = lower-bound mcap
  // the active marker (triangle) sits over bin -361 = index 80 of 87
  const ax = +svg2.match(/<polygon points="([\d.]+),/)[1] + 5, step = (380 - 20) / 87; assert.ok(Math.abs(ax - (10 + 80.5 * step)) < .2, String(ax));
  assert.ok(/<span>Spot · 87 bar · <b class="reshape-count">Reshape 0x<\/b><\/span>/.test(ctx.chart({ ...pos, bidaskSol: 0, shape: 'open-mixed' })));
  assert.strictEqual(ctx.cu(1234567), '$1.23M'); assert.strictEqual(ctx.cu(850000), '$850K'); assert.strictEqual(ctx.cu(12345), '$12.3K'); assert.strictEqual(ctx.cu(null), 'n/a');
  assert.ok(/mcap n\/a/.test(ctx.mc({})));
});
t('poll re-render patches the chart in place (same DOM nodes, only heights change, no innerHTML rebuild)', () => {
  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch { console.log('skip (no jsdom here)'); return; }
  const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
  const body = src.slice(src.indexOf('  function morphNode('), src.indexOf('  const esc = '));
  const dom = new JSDOM('<div id="positions"></div>'); const ctx = { document: dom.window.document }; require('vm').createContext(ctx);
  require('vm').runInContext(body + ';this.patch=patchMarkup;', ctx);
  const el = dom.window.document.getElementById('positions');
  const html = (h) => `<article><svg viewBox="0 0 10 10"><g><title>a</title><rect class="bin-bar" y="${10 - h}" height="${h}"/></g></svg><b>pnl ${h}</b></article>`;
  ctx.patch(el, html(3)); const rect = el.querySelector('rect'), art = el.querySelector('article');
  let rebuilt = 0; new dom.window.MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList') rebuilt += m.addedNodes.length; }).observe(el, { childList: true, subtree: true });
  ctx.patch(el, html(5));
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    assert.strictEqual(el.querySelector('rect'), rect); assert.strictEqual(el.querySelector('article'), art);
    assert.strictEqual(rect.getAttribute('height'), '5'); assert.strictEqual(el.querySelector('b').textContent, 'pnl 5'); assert.strictEqual(rebuilt, 0);
  });
});
t('mcap now / at range bounds = supply x price x SOL/USD (supply cached, n/a until known)', async () => {
  const srv = require('./miniapp/server'); let calls = 0; srv.setSupplyFetcher(async () => { calls++; return 1e9; });
  const pos = { mintX: 'MintA', minBinId: -441, maxBinId: -355, binStep: 80, decX: 6, lastPrice: 0.0000563 };
  assert.strictEqual(srv.liveMcap(pos, 140).ok, false);   // first call starts the background read
  await new Promise((r) => setTimeout(r, 20));
  const m = srv.liveMcap(pos, 140); assert.ok(m.ok, JSON.stringify(m)); assert.strictEqual(calls, 1);
  assert.ok(Math.abs(m.nowUsd - 1e9 * 0.0000563 * 140) < 1e-6);
  assert.ok(m.lowerUsd < m.nowUsd && m.upperUsd > m.lowerUsd && Math.abs(m.upperUsd / m.lowerUsd - Math.pow(1.008, 87)) < 1e-9);
  srv.setSupplyFetcher(null);
});
Promise.all(pending).finally(() => fs.rmSync(root, { recursive: true, force: true }));
Promise.all(pending).then(() => console.log(`PASS ${ok} checks`)).catch((e) => { console.error(e); process.exit(1); });
