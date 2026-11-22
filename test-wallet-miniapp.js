'use strict';
// Mini App wallet form end to end (temp dirs, fake token, generated key): fresh session saves an encrypted key and shows only the PUBLIC address;
// a session older than 5 minutes is refused with a clear reason; the key never appears in any response.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const s = require('./paper-settings'), ws = require('./wallet-store');
const { startServer } = require('./miniapp/server');
const { Keypair } = require('@solana/web3.js'), bs58 = require('bs58').default || require('bs58');
const TOKEN = 'test-telegram-token-not-real', TUAN = 1000000001;
const signed = (extra = {}) => s.signInitData({ user: JSON.stringify({ id: TUAN, first_name: 'T' }), auth_date: String(extra.auth_date != null ? extra.auth_date : Math.floor(Date.now() / 1000)), query_id: 'AAE' }, TOKEN);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j, raw: b }); });
    }); r.on('error', reject); if (data) r.write(data); r.end();
  });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-app-')), secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-sec-')), stopPath = path.join(dir, 'LIVE_STOP_TEST');
  fs.writeFileSync(stopPath, 'x');
  const kp = Keypair.generate(), secret = bs58.encode(kp.secretKey), arr = JSON.stringify(Array.from(kp.secretKey));
  const { server, port } = await startServer({ host: '127.0.0.1', port: 0, paperDir: dir, token: TOKEN, rateLimitMs: 0, skipPm2: true, secretsDir, stopPath, notifyFn: () => Promise.resolve({ ok: true }) });
  const csrf = async (initData) => { await wait(20); return (await req(port, 'GET', '/api/wallet', null, { 'X-Telegram-Init-Data': initData })).json.csrf; };
  try {
    const fresh = signed();
    assert.strictEqual((await req(port, 'GET', '/api/wallet', null, { 'X-Telegram-Init-Data': fresh })).json.hasKey, false);
    // a stale session (10 min) is refused with the reason, and nothing is stored
    const old = signed({ auth_date: Math.floor(Date.now() / 1000) - 600 });
    const stale = await req(port, 'POST', '/api/wallet', { initData: old, csrf: await csrf(fresh), secret });
    assert.ok(stale.status === 401 || stale.status === 403); assert.ok(/expired/i.test(String(stale.json.reason)), stale.raw); assert.strictEqual(ws.hasKey(secretsDir), false);
    // garbage key: clear error, nothing stored
    const bad = await req(port, 'POST', '/api/wallet', { initData: fresh, csrf: await csrf(fresh), secret: 'not-a-key' });
    assert.strictEqual(bad.status, 400); assert.strictEqual(ws.hasKey(secretsDir), false);
    // base58 key saves; response carries the public address only
    const ok = await req(port, 'POST', '/api/wallet', { initData: fresh, csrf: await csrf(fresh), secret });
    assert.strictEqual(ok.status, 200, ok.raw); assert.strictEqual(ok.json.publicAddress, kp.publicKey.toBase58());
    assert.ok(!ok.raw.includes(secret) && !ok.raw.includes(arr));
    const got = await req(port, 'GET', '/api/wallet', null, { 'X-Telegram-Init-Data': fresh });
    assert.strictEqual(got.json.hasKey, true); assert.strictEqual(got.json.publicAddress, kp.publicKey.toBase58()); assert.strictEqual(got.json.source, 'encrypted'); assert.ok(!got.raw.includes(secret));
    const enc = fs.readFileSync(path.join(secretsDir, 'lp-bot-wallet.enc'), 'utf8'); assert.ok(!enc.includes(secret));
    assert.strictEqual(ws.loadKeypair(secretsDir).publicKey.toBase58(), kp.publicKey.toBase58());
    // JSON-array format also works and replaces the key
    const kp2 = Keypair.generate();
    const ok2 = await req(port, 'POST', '/api/wallet', { initData: fresh, csrf: await csrf(fresh), secret: JSON.stringify(Array.from(kp2.secretKey)) });
    assert.strictEqual(ok2.status, 200, ok2.raw); assert.strictEqual(ok2.json.publicAddress, kp2.publicKey.toBase58());
    console.log('test-wallet-miniapp: OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
