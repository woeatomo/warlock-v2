'use strict';
// t222u/t223u: Wallet > RPC 1/2/3 in the mini app. Owner + fresh auth + csrf + confirm; https only; stored in <secrets>/rpc.env (600, atomic, .bak);
// API/HTML/audit/console show at most the last 5 characters; slot 2/3 clear always, slot 1 only with another source; rpc-config hot-reloads the file.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
for (const k of ['SOLANA_RPC_URL', 'HELIUS_API_KEY', 'RPC_URL_1', 'RPC_URL_2', 'RPC_URL_3', 'HELIUS_API_KEY_2', 'HELIUS_API_KEY_3']) delete process.env[k];
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const s = require('./paper-settings'); const { startServer } = require('./miniapp/server'); const R = require('./rpc-config'), store = require('./rpc-store'), envc = require('./env-config');
const TOKEN = 'test-telegram-token-not-real', TUAN = 1000000001;
const signed = (extra = {}) => s.signInitData({ user: JSON.stringify({ id: TUAN, first_name: 'T' }), auth_date: String(extra.auth_date != null ? extra.auth_date : Math.floor(Date.now() / 1000)), query_id: 'AAE' }, TOKEN);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => { const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j, raw: b }); }); });
    r.on('error', reject); if (data) r.write(data); r.end(); });
}
const K1 = 'k1SECRET' + 'x'.repeat(24) + 'ab12c', K2 = 'k2SECRET' + 'y'.repeat(24) + 'cd34e', K3 = 'k3SECRET' + 'z'.repeat(24) + 'ef56g';
const U = (k) => 'https://mainnet.helius-rpc.com/?api-key=' + k;
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-app-')), secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-sec-')), stopPath = path.join(dir, 'STOP_TEST'); fs.writeFileSync(stopPath, 'x');
  process.env.LP_RPC_FILE = path.join(secretsDir, 'rpc.env'); R._reset();
  const logs = []; const ol = console.log, oe = console.error; console.error = (...a) => logs.push(a.join(' '));
  const { server, port } = await startServer({ host: '127.0.0.1', port: 0, paperDir: dir, token: TOKEN, rateLimitMs: 0, skipPm2: true, secretsDir, stopPath, notifyFn: () => Promise.resolve({ ok: true }) });
  const fresh = signed(), H = { 'X-Telegram-Init-Data': fresh };
  const csrf = async () => { await wait(15); return (await req(port, 'GET', '/api/wallet', null, H)).json.csrf; };
  const post = async (b, initData = fresh) => req(port, 'POST', '/api/wallet/rpc', { initData, csrf: await csrf(), ...b });
  const all = [];
  try {
    let g = await req(port, 'GET', '/api/wallet', null, H); all.push(g.raw); assert.deepEqual(g.json.rpc.map(x => x.configured), [false, false, false]);
    // guards: stale session, missing csrf, no confirm, bad URL (http, junk, spaces) -> refused, nothing stored, value never echoed
    const stale = await post({ slot: 1, url: U(K1), confirm: 'RPC' }, signed({ auth_date: Math.floor(Date.now() / 1000) - 600 })); all.push(stale.raw); assert.ok([401, 403].includes(stale.status));
    const noCsrf = await req(port, 'POST', '/api/wallet/rpc', { initData: fresh, slot: 1, url: U(K1), confirm: 'RPC' }); all.push(noCsrf.raw); assert.ok(noCsrf.status >= 400);
    const noConf = await post({ slot: 1, url: U(K1) }); all.push(noConf.raw); assert.equal(noConf.status, 400);
    for (const bad of ['http://mainnet.helius-rpc.com/?api-key=' + K1, 'not a url ' + K1, 'https://user:pw@x.com/' + K1, 'javascript:alert(1)']) { const r = await post({ slot: 2, url: bad, confirm: 'RPC' }); all.push(r.raw); assert.equal(r.status, 400, bad); assert.ok(!r.raw.includes(K1)); }
    assert.ok(!fs.existsSync(path.join(secretsDir, 'rpc.env')), 'nothing stored by refused requests');
    ok('guards: fresh auth, csrf, confirm, https-only validation; nothing stored on refusal');
    // save 1, 2, 3
    for (const [slot, k] of [[1, K1], [2, K2], [3, K3]]) { const r = await post({ slot, url: U(k), confirm: 'RPC' }); all.push(r.raw); assert.equal(r.status, 200, r.raw); assert.equal(r.json.rpc[slot - 1].mask, '•••••' + k.slice(-5)); assert.equal(r.json.applied, 'hot-reload'); }
    const f = path.join(secretsDir, 'rpc.env'); assert.equal(fs.statSync(f).mode & 0o777, 0o600); assert.equal(fs.statSync(secretsDir).mode & 0o777, 0o700); assert.ok(fs.existsSync(f + '.bak') && (fs.statSync(f + '.bak').mode & 0o777) === 0o600);
    assert.deepEqual(fs.readdirSync(secretsDir).filter(x => /\.tmp$/.test(x)), [], 'no tmp file left');
    R._reloadFile(); assert.deepEqual(R.slots().map(x => x.url), [U(K1), U(K2), U(K3)], 'the failover reads the saved slots');
    g = await req(port, 'GET', '/api/wallet', null, H); all.push(g.raw); assert.deepEqual(g.json.rpc.map(x => x.mask), ['•••••ab12c', '•••••cd34e', '•••••ef56g']);
    ok('save RPC 1/2/3: file 600 in a 700 dir, atomic (no tmp), .bak kept, masks show last 5 chars, failover uses them');
    // clear 2 and 3; slot 1 refused while it is the only source; allowed once the old HELIUS_API_KEY exists
    for (const slot of [2, 3]) { const r = await post({ slot, clear: true, confirm: 'RPC' }); all.push(r.raw); assert.equal(r.status, 200); assert.equal(r.json.rpc[slot - 1].configured, false); }
    R._reloadFile(); assert.deepEqual(R.slots().map(x => x.slot), [1]);
    let c1 = await post({ slot: 1, clear: true, confirm: 'RPC' }); all.push(c1.raw); assert.equal(c1.status, 400); assert.match(c1.json.error, /tidak bisa dikosongkan/);
    process.env.HELIUS_API_KEY = K2; c1 = await post({ slot: 1, clear: true, confirm: 'RPC' }); all.push(c1.raw); assert.equal(c1.status, 200);
    assert.equal(c1.json.rpc[0].source, 'env'); assert.equal(c1.json.rpc[0].mask, '•••••' + K2.slice(-5)); R._reloadFile(); assert.equal(R.slots()[0].url, U(K2), 'cleared slot 1 falls back to the old .env setting');
    delete process.env.HELIUS_API_KEY;
    ok('clear: RPC 2/3 any time; RPC 1 refused when no other RPC source, allowed when one exists');
    // 1 / 2 / 3 slots via the mini app file, hot reload without restart (mtime change picked up after RELOAD_MS)
    await post({ slot: 1, url: U(K1), confirm: 'RPC' }); R._reloadFile(); assert.equal(R.slots().length, 1);
    await post({ slot: 2, url: U(K2), confirm: 'RPC' }); R._reloadFile(); assert.equal(R.slots().length, 2);
    await post({ slot: 3, url: U(K3), confirm: 'RPC' }); R._reloadFile(); assert.equal(R.slots().length, 3);
    ok('1 / 2 / 3 configured slots all resolve; file changes are re-read (hot reload, ' + R.RELOAD_MS / 1000 + ' s)');
    // leaks: no full URL or key in any API answer, the HTML, the audit log, console output; redact() masks file-only values
    const html = (await req(port, 'GET', '/', null)).raw; all.push(html);
    assert.ok(html.includes('Isi 1 RPC aja nggak masalah. RPC 2 dan 3 hanya untuk cadangan.') && html.indexOf('id="rpc-form"') > html.indexOf('id="wallet-form"'));
    const auditTxt = fs.readdirSync(dir).filter(x => /audit|log/i.test(x)).map(x => { try { return fs.readFileSync(path.join(dir, x), 'utf8'); } catch { return ''; } }).join('\n');
    assert.ok(/action=rpc-slot-saved slot=1/.test(auditTxt), 'audit line written');
    const blob = all.join('\n') + auditTxt + logs.join('\n');
    for (const k of [K1, K2, K3]) { assert.ok(!blob.includes(k), 'leak ' + k.slice(0, 6)); assert.ok(!blob.includes(k.slice(0, 20))); }
    assert.ok(!envc.redact('x ' + U(K3) + ' y ' + K2).includes(K3) && !envc.redact(K2).includes(K2), 'redact masks mini-app-only values');
    ok('no full URL/key in API answers, HTML, audit log, console; redact() covers mini-app-saved slots');
  } finally { console.error = oe; console.log = ol; server.close(); delete process.env.LP_RPC_FILE; }
  // client: masks rendered, note under the slots, inputs write-only and cleared after save
  const appjs = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
  assert.ok(/renderRpc\(w && w\.rpc\)/.test(appjs) && /input\.value = ''/.test(appjs) && /askConfirm\('Simpan RPC '/.test(appjs) && /askConfirm\('Hapus RPC '/.test(appjs) && /confirm: 'RPC'/.test(appjs));
  ok('client: confirm before save/clear, input cleared after send, masks from the server');
  console.log(n + ' rpc slot checks passed'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
