// Wallet store + live-control HTTP tests. Uses throwaway keypairs and a TEMP stop file.
// Never prints the secret. Never touches /workspace/lp-bot/STOP or stores a real key.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user
process.env.MINIAPP_TEST = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const walletStore = require('./wallet-store');
const liveControl = require('./live-control');
const settings = require('./paper-settings');
const { startServer } = require('./miniapp/server');

const FAKE_TOKEN = 'test-telegram-token-not-real';
const TUAN = 1000000001;
const STRANGER = 999999999;
const REAL_STOP = liveControl.REAL_STOP;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function signed(userId, extra = {}) {
  const user = JSON.stringify({ id: userId, first_name: 'operator' });
  return settings.signInitData({
    user,
    auth_date: String(extra.auth_date != null ? extra.auth_date : Math.floor(Date.now() / 1000)),
    query_id: extra.query_id || 'AAE',
  }, extra.token || FAKE_TOKEN);
}

function throwaway() {
  const kp = Keypair.generate();
  return {
    kp,
    address: kp.publicKey.toBase58(),
    base58: bs58.encode(kp.secretKey),
    json: JSON.stringify(Array.from(kp.secretKey)),
  };
}

function assertNoLeak(hay, secret, label) {
  const text = typeof hay === 'string' ? hay : JSON.stringify(hay);
  if (walletStore.looksLikeSecretPayload(text, secret)) {
    assert.fail(label + ': secret leaked');
  }
}

function httpReq(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function liveStat() {
  return {
    exists: fs.existsSync(REAL_STOP),
    mtime: fs.existsSync(REAL_STOP) ? fs.statSync(REAL_STOP).mtimeMs : null,
    bytes: fs.existsSync(REAL_STOP) ? fs.readFileSync(REAL_STOP) : null,
  };
}

function assertRealStopUnchanged(before) {
  const after = liveStat();
  assert.strictEqual(after.exists, true, 'real live STOP must still exist');
  assert.strictEqual(after.mtime, before.mtime);
  assert.ok(after.bytes.equals(before.bytes));
}

async function run() {
  const beforeStop = liveStat();
  assert.strictEqual(beforeStop.exists, true, 'precondition: real STOP must exist');

  // --- store unit tests ---
  const secrets = tmpDir('lp-wallet-secrets-');
  const toy = throwaway();
  const saved = walletStore.saveKey(toy.base58, secrets);
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.publicAddress, toy.address);
  assert.strictEqual(walletStore.hasKey(secrets), true);
  const meta = walletStore.readEnvelopeMeta(secrets);
  assert.strictEqual(meta.publicAddress, toy.address);
  const loaded = walletStore.loadKeypair(secrets);
  assert.strictEqual(loaded.publicKey.toBase58(), toy.address);
  const envFile = fs.readFileSync(walletStore.paths(secrets).envelope, 'utf8');
  assertNoLeak(envFile, toy.base58, 'envelope file should be ciphertext, not raw key as plaintext path — still check raw form');
  // ciphertext must not equal the raw secret; raw base58 should not appear
  assert.ok(!envFile.includes(toy.base58));
  assert.ok(!envFile.includes(toy.json));
  const masterMode = fs.statSync(walletStore.paths(secrets).master).mode & 0o777;
  const encMode = fs.statSync(walletStore.paths(secrets).envelope).mode & 0o777;
  assert.strictEqual(masterMode, 0o600);
  assert.strictEqual(encMode, 0o600);
  // also accept JSON array form as replace
  const toy2 = throwaway();
  const saved2 = walletStore.saveKey(toy2.json, secrets);
  assert.strictEqual(saved2.publicAddress, toy2.address);
  walletStore.deleteKey(secrets);
  assert.strictEqual(walletStore.hasKey(secrets), false);
  // wipe leftovers
  try { walletStore.deleteKey(secrets); } catch { /* ignore */ }

  // invalid formats
  assert.throws(() => walletStore.parseSecretKey('not-a-key'), /invalid/);
  assert.throws(() => walletStore.parseSecretKey('[]'), /invalid/);

  // --- HTTP ---
  const paperDir = tmpDir('lp-paper-live-');
  const secretsHttp = tmpDir('lp-wallet-http-');
  const tmpStop = path.join(paperDir, 'LIVE_STOP');
  const tmpNoNew = path.join(paperDir, 'NO_NEW');
  fs.writeFileSync(tmpStop, 'test-stop\n');
  const events = [];
  const started = [];
  const toyH = throwaway();

  const { server, port } = await startServer({
    parityFn: () => [],   // the real gate (parity-check) is covered by test-parity-live-paper; here Go Live is exercised with the gate open
    host: '127.0.0.1',
    port: 0,
    paperDir,
    token: FAKE_TOKEN,
    secretsDir: secretsHttp,
    stopPath: tmpStop,
    noNewPath: tmpNoNew,
    rateLimitMs: 0,
    skipPm2: true,
    getBalances: async () => ({ sol: 0.2, usdc: 500 }),
    liveStatusFn: () => ({ running: false, status: 'stopped' }),
    startLiveFn: () => { started.push('start'); return { ok: true }; },
    stopLiveFn: () => { started.push('stop'); return { ok: true }; },
    stopPaperFn: () => { started.push('stop-paper'); return { ok: true }; },
    notifyFn: (payload) => { events.push(payload); return Promise.resolve({ ok: true }); },
  });

  const hdr = (id, extra = {}) => ({ 'X-Telegram-Init-Data': signed(id, extra) });
  const csrfFor = async (id, p = '/api/wallet') => {
    const g = await httpReq(port, 'GET', p, null, hdr(id));
    assert.strictEqual(g.status, 200, 'csrf get');
    return g.json.csrf;
  };

  try {
    // unauthorized key write
    const c1 = await csrfFor(TUAN);
    const thief = await httpReq(port, 'POST', '/api/wallet', { initData: signed(STRANGER), csrf: c1, secret: toyH.base58 });
    assert.ok(thief.status === 401 || thief.status === 403);
    assert.strictEqual(walletStore.hasKey(secretsHttp), false);
    assertNoLeak(thief.raw, toyH.base58, 'thief response');

    // missing csrf
    const noCsrf = await httpReq(port, 'POST', '/api/wallet', { initData: signed(TUAN), secret: toyH.base58 });
    assert.ok(noCsrf.status === 401 || noCsrf.status === 403);
    assert.strictEqual(walletStore.hasKey(secretsHttp), false);

    // bad format authorized
    const c2 = await csrfFor(TUAN);
    const bad = await httpReq(port, 'POST', '/api/wallet', { initData: signed(TUAN), csrf: c2, secret: 'nope' });
    assert.strictEqual(bad.status, 400);
    assert.ok(!JSON.stringify(bad.json).includes('nope') || bad.json.error === 'invalid key' || bad.json.error === 'invalid key format');

    // good save
    const c3 = await csrfFor(TUAN);
    const ok = await httpReq(port, 'POST', '/api/wallet', { initData: signed(TUAN), csrf: c3, secret: toyH.base58 });
    assert.strictEqual(ok.status, 200, 'save key');
    assert.strictEqual(ok.json.publicAddress, toyH.address);
    assert.strictEqual(ok.json.hasKey, true);
    assertNoLeak(ok.raw, toyH.base58, 'save response');
    assertNoLeak(ok.raw, toyH.json, 'save response json form');
    assert.ok(!('secret' in ok.json));
    const audit = fs.readFileSync(path.join(paperDir, 'settings-audit.log'), 'utf8');
    assert.ok(audit.includes('wallet-key-saved'));
    assert.ok(audit.includes(toyH.address));
    assertNoLeak(audit, toyH.base58, 'audit log');
    events.forEach((ev) => assertNoLeak(ev, toyH.base58, 'notify payload'));

    const got = await httpReq(port, 'GET', '/api/wallet', null, hdr(TUAN));
    assert.strictEqual(got.json.publicAddress, toyH.address);
    assertNoLeak(got.raw, toyH.base58, 'get wallet');

    // stale initData (>5 min) cannot go live or set key
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    const cStale = await csrfFor(TUAN);
    const stalePost = await httpReq(port, 'POST', '/api/wallet', {
      initData: signed(TUAN, { auth_date: stale }),
      csrf: cStale,
      secret: toyH.base58,
    });
    assert.ok(stalePost.status === 401 || stalePost.status === 403);

    // arm + start unauthorized
    const c4 = await csrfFor(TUAN, '/api/live');
    const thiefArm = await httpReq(port, 'POST', '/api/live/arm', { initData: signed(STRANGER), csrf: c4 });
    assert.ok(thiefArm.status === 401 || thiefArm.status === 403);

    // start without arm
    const c5 = await csrfFor(TUAN, '/api/live');
    const noArm = await httpReq(port, 'POST', '/api/live/start', { initData: signed(TUAN), csrf: c5, confirm: 'LIVE', armId: 'nope' });
    assert.strictEqual(noArm.status, 400);
    assert.ok(fs.existsSync(tmpStop), 'temp STOP still present without valid start');
    assertRealStopUnchanged(beforeStop);

    // arm then wrong phrase
    const c6 = await csrfFor(TUAN, '/api/live');
    const armed = await httpReq(port, 'POST', '/api/live/arm', { initData: signed(TUAN), csrf: c6 });
    assert.strictEqual(armed.status, 200, armed.raw);
    assert.ok(armed.json.armId);
    const c7 = await csrfFor(TUAN, '/api/live');
    const wrong = await httpReq(port, 'POST', '/api/live/start', { initData: signed(TUAN), csrf: c7, confirm: 'live', armId: armed.json.armId });
    assert.strictEqual(wrong.status, 400);
    assert.ok(fs.existsSync(tmpStop));
    assert.strictEqual(started.length, 0);
    assertRealStopUnchanged(beforeStop);

    // arm again and confirm LIVE — only temp STOP is removed
    const c8 = await csrfFor(TUAN, '/api/live');
    const armed2 = await httpReq(port, 'POST', '/api/live/arm', { initData: signed(TUAN), csrf: c8 });
    assert.strictEqual(armed2.status, 200, armed2.raw);
    const c9 = await csrfFor(TUAN, '/api/live');
    const go = await httpReq(port, 'POST', '/api/live/start', { initData: signed(TUAN), csrf: c9, confirm: 'LIVE', armId: armed2.json.armId });
    assert.strictEqual(go.status, 200, go.raw);
    assert.strictEqual(go.json.live, true);
    assert.ok(started.includes('start'));
    assert.ok(!fs.existsSync(tmpStop), 'temp STOP removed after operator confirm in test');
    assertNoLeak(go.raw, toyH.base58, 'go live response');
    assertRealStopUnchanged(beforeStop);

    // stop closeAll writes temp STOP only
    const c10 = await csrfFor(TUAN, '/api/live');
    const stop = await httpReq(port, 'POST', '/api/live/stop', { initData: signed(TUAN), csrf: c10, mode: 'closeAll' });
    assert.strictEqual(stop.status, 200, stop.raw);
    assert.ok(fs.existsSync(tmpStop));
    assertRealStopUnchanged(beforeStop);

    // Live ON from the button is ONE call (direct): owner + csrf + typed LIVE; a stranger or a wrong phrase is refused, no arm step needed
    { const cs = await csrfFor(STRANGER, '/api/live').catch(() => null);
      const bad = await httpReq(port, 'POST', '/api/live/start', { initData: signed(STRANGER), csrf: cs || 'x', confirm: 'LIVE', direct: true }); assert.ok(bad.status === 401 || bad.status === 403, 'stranger refused');
      const cw = await csrfFor(TUAN, '/api/live'); const wr = await httpReq(port, 'POST', '/api/live/start', { initData: signed(TUAN), csrf: cw, confirm: 'nope', direct: true }); assert.strictEqual(wr.status, 400); assert.ok(fs.existsSync(tmpStop));
      const cd = await csrfFor(TUAN, '/api/live'); const dd = await httpReq(port, 'POST', '/api/live/start', { initData: signed(TUAN), csrf: cd, confirm: 'LIVE', direct: true });
      assert.strictEqual(dd.status, 200, dd.raw); assert.strictEqual(dd.json.live, true); assert.strictEqual(dd.json.started, true); assert.ok(!fs.existsSync(tmpStop), 'direct Live ON removes the temp STOP');
      const cs2 = await csrfFor(TUAN, '/api/live'); const st2 = await httpReq(port, 'POST', '/api/live/stop', { initData: signed(TUAN), csrf: cs2, mode: 'closeAll' }); assert.strictEqual(st2.status, 200); assert.ok(fs.existsSync(tmpStop)); assertRealStopUnchanged(beforeStop); }

    const c11 = await csrfFor(TUAN, '/api/live');
    const nonew = await httpReq(port, 'POST', '/api/live/stop', { initData: signed(TUAN), csrf: c11, mode: 'noNew' });
    assert.strictEqual(nonew.status, 200, nonew.raw);
    assert.ok(fs.existsSync(tmpNoNew));
    assertRealStopUnchanged(beforeStop);

    // delete key
    const c12 = await csrfFor(TUAN, '/api/wallet');
    const del = await httpReq(port, 'POST', '/api/wallet/delete', { initData: signed(TUAN), csrf: c12 });
    assert.strictEqual(del.status, 200);
    assert.strictEqual(walletStore.hasKey(secretsHttp), false);
    assertNoLeak(del.raw, toyH.base58, 'delete response');

    // arm without key fails
    const c13 = await csrfFor(TUAN, '/api/live');
    const armNoKey = await httpReq(port, 'POST', '/api/live/arm', { initData: signed(TUAN), csrf: c13 });
    assert.strictEqual(armNoKey.status, 400);

    // lockout after repeated bad auth
    const { server: s2, port: p2 } = await startServer({
      parityFn: () => [], host: '127.0.0.1', port: 0, paperDir: tmpDir('lp-lock-'), token: FAKE_TOKEN,
      secretsDir: tmpDir('lp-lock-sec-'), stopPath: path.join(os.tmpdir(), 'no-real-stop-' + Date.now()),
      rateLimitMs: 0, skipPm2: true, failMax: 3, failWindowMs: 60_000, lockMs: 60_000,
    });
    try {
      for (let i = 0; i < 3; i++) {
        const r = await httpReq(p2, 'GET', '/api/wallet', null, hdr(STRANGER));
        assert.ok(r.status === 401 || r.status === 403);
      }
      const locked = await httpReq(p2, 'GET', '/api/wallet', null, hdr(TUAN));
      assert.ok(locked.status === 401 || locked.status === 403);
      assert.ok(locked.json.reason === 'locked out' || locked.json.locked === true || locked.json.reason);
    } finally {
      await new Promise((r) => s2.close(r));
    }
  } finally {
    await new Promise((r) => server.close(r));
    try { walletStore.deleteKey(secretsHttp); } catch { /* ignore */ }
    try { walletStore.deleteKey(secrets); } catch { /* ignore */ }
    // extra cleanup of tmp secret files
    for (const d of [secrets, secretsHttp]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  assertRealStopUnchanged(beforeStop);
  assert.strictEqual(walletStore.hasKey('/home/box/.secrets'), false, 'production secrets must not have a wallet key from tests');
  console.log('OK  wallet-store + live-control auth/leak checks (real STOP untouched, throwaway keys deleted)');
}

run().catch((e) => {
  console.error('FAIL', e && (e.stack || e.message || e));
  process.exit(1);
});
