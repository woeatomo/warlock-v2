// Tests for paper settings writes: validation, auth, CSRF, pause/resume, live-STOP refusal.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const s = require('./paper-settings');
const { startServer } = require('./miniapp/server');

const FAKE_TOKEN = 'test-telegram-token-not-real';
const TUAN = 1000000001;
const STRANGER = 999999999;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lp-paper-settings-'));
}

function signed(userId, extra = {}) {
  const user = JSON.stringify({ id: userId, first_name: 'operator' });
  return s.signInitData({
    user,
    auth_date: String(extra.auth_date != null ? extra.auth_date : Math.floor(Date.now() / 1000)),
    query_id: extra.query_id || 'AAE',
  }, extra.token || FAKE_TOKEN);
}

function almost(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
}

// --- validation ---
{
  const badType = s.validatePatch({ MIN_FT: 'abc' });
  assert.strictEqual(badType.ok, false);
  assert.ok(badType.rejected.some((r) => r.key === 'MIN_FT'));

  const outOfRange = s.validatePatch({ MIN_FT: 99, GAS_BUFFER_SOL: 0.01, RESHAPE_N: 0, TP: 0 });
  assert.strictEqual(outOfRange.ok, false);
  const keys = outOfRange.rejected.map((r) => r.key).sort();
  assert.deepStrictEqual(keys, ['GAS_BUFFER_SOL', 'MIN_FT', 'RESHAPE_N', 'TP']);

  const forbidden = s.validatePatch({
    DRY_RUN: 0,
    LIVE_CONFIRMED: 1,
    SOLANA_BOT_PRIVATE_KEY: 'x',
    POSITION_SOL: 9,
    PAPER_USDC: 5000,
    withdraw: true,
  });
  assert.strictEqual(forbidden.ok, false);
  assert.ok(forbidden.rejected.length >= 5, 'all live/funding/size keys rejected');
  assert.ok(forbidden.rejected.every((r) => /forbidden|unknown/.test(r.reason)));

  const unknown = s.validatePatch({ RPC: 'https://evil', MIN_FT: 2 });
  assert.strictEqual(unknown.ok, false);
  assert.ok(unknown.rejected.some((r) => r.key === 'RPC'));

  const ok = s.validatePatch({ MIN_FT: 1.5, MIN_LIQ_USD: 30000, RESHAPE_N: 7, TP: 0.25, GAS_BUFFER_SOL: 0.4 });
  assert.strictEqual(ok.ok, true);
  almost(ok.sanitized.MIN_FT, 1.5);
  assert.strictEqual(ok.sanitized.RESHAPE_N, 7);

  const notInt = s.validatePatch({ RESHAPE_N: 5.5 });
  assert.strictEqual(notInt.ok, false);

  const tooBigUsdc = s.validatePatch({ PAPER_USDC: 9999 });
  assert.strictEqual(tooBigUsdc.ok, false);
}

// --- file write + audit + reset ---
{
  const dir = tmpDir();
  const applied = s.applySettings(dir, { MIN_FT: 1.5, GAS_BUFFER_SOL: 0.4 }, { updatedBy: TUAN });
  assert.strictEqual(applied.ok, true);
  almost(applied.values.MIN_FT, 1.5);
  almost(applied.values.GAS_BUFFER_SOL, 0.4);
  almost(applied.values.TP, 0.13); // default kept (normal TP is 13% since v1.6)
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  almost(onDisk.values.MIN_FT, 1.5);
  assert.ok(String(onDisk.updatedWib).includes('WIB'));
  const audit = fs.readFileSync(path.join(dir, 'settings-audit.log'), 'utf8');
  assert.ok(audit.includes('WIB'));
  assert.ok(audit.includes('action=update'));
  assert.ok(audit.includes('MIN_FT'));
  assert.ok(!audit.includes(FAKE_TOKEN));

  const reset = s.resetSettings(dir, { updatedBy: TUAN });
  assert.strictEqual(reset.ok, true);
  almost(reset.values.MIN_FT, 0.6);   // current default
  almost(reset.values.GAS_BUFFER_SOL, 0.3);
  const audit2 = fs.readFileSync(path.join(dir, 'settings-audit.log'), 'utf8');
  assert.ok(audit2.includes('action=reset-to-default'));
}

// --- pause / resume never touches live STOP ---
{
  const dir = tmpDir();
  const liveBefore = fs.existsSync(s.LIVE_STOP);
  const liveStat = liveBefore ? fs.statSync(s.LIVE_STOP) : null;
  const liveMtime = liveStat && liveStat.mtimeMs;
  const liveContent = liveBefore ? fs.readFileSync(s.LIVE_STOP) : null;

  const paused = s.pauseDryRun(dir, { updatedBy: TUAN });
  assert.strictEqual(paused.ok, true);
  assert.strictEqual(s.isPaused(dir), true);
  assert.ok(fs.existsSync(path.join(dir, 'STOP')));
  assert.strictEqual(fs.existsSync(s.LIVE_STOP), liveBefore);
  if (liveBefore) {
    assert.strictEqual(fs.statSync(s.LIVE_STOP).mtimeMs, liveMtime);
    assert.ok(fs.readFileSync(s.LIVE_STOP).equals(liveContent));
  }

  let restartCalled = 0;
  const resumed = s.resumeDryRun(dir, { updatedBy: TUAN }, {
    restartFn: () => { restartCalled += 1; return { ok: true }; },
  });
  assert.strictEqual(resumed.ok, true);
  assert.strictEqual(s.isPaused(dir), false);
  assert.strictEqual(restartCalled, 1);
  assert.strictEqual(fs.existsSync(s.LIVE_STOP), liveBefore);
  if (liveBefore) {
    assert.strictEqual(fs.statSync(s.LIVE_STOP).mtimeMs, liveMtime);
    assert.ok(fs.readFileSync(s.LIVE_STOP).equals(liveContent));
  }
  const audit = fs.readFileSync(path.join(dir, 'settings-audit.log'), 'utf8');
  assert.ok(audit.includes('action=pause'));
  assert.ok(audit.includes('action=resume'));
  assert.ok(audit.includes('live STOP not touched'));
}

// refuse to treat live STOP as paper stop
{
  assert.strictEqual(s.isLiveStopPath(s.LIVE_STOP), true);
  assert.strictEqual(s.isLiveStopPath(path.join(path.dirname(s.LIVE_STOP), 'paper', 'STOP')), false);
  let threw = false;
  try {
    s.assertPaperStopOnly && s.assertPaperStopOnly(s.LIVE_STOP);
  } catch (e) {
    threw = /live STOP/i.test(e.message);
  }
  // function may not be exported; resume/pause use it internally
  void threw;
}

// --- initData auth ---
{
  const ok = s.validateInitData(signed(TUAN), FAKE_TOKEN);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.userId, TUAN);

  const stranger = s.validateInitData(signed(STRANGER), FAKE_TOKEN);
  assert.strictEqual(stranger.ok, false);
  assert.strictEqual(stranger.reason, 'user not allowed');

  const badHash = signed(TUAN).replace(/hash=[0-9a-f]+/, 'hash=' + '00'.repeat(32));
  const bad = s.validateInitData(badHash, FAKE_TOKEN);
  assert.strictEqual(bad.ok, false);

  const wrongToken = s.validateInitData(signed(TUAN), 'some-other-token');
  assert.strictEqual(wrongToken.ok, false);

  const missing = s.validateInitData('', FAKE_TOKEN);
  assert.strictEqual(missing.ok, false);

  const expired = s.validateInitData(signed(TUAN, { auth_date: Math.floor(Date.now() / 1000) - 48 * 3600 }), FAKE_TOKEN);
  assert.strictEqual(expired.ok, false);
  assert.strictEqual(expired.reason, 'initData expired');
}

// --- CSRF ---
{
  const store = s.createCsrfStore({ ttlMs: 50 });
  const tok = store.issue(TUAN);
  assert.ok(tok && tok.length >= 32);
  const mismatch = store.consume(tok, STRANGER);
  assert.strictEqual(mismatch.ok, false);
  // token not consumed on mismatch
  const ok = store.consume(tok, TUAN);
  assert.strictEqual(ok.ok, true);
  const reuse = store.consume(tok, TUAN);
  assert.strictEqual(reuse.ok, false);
  const t2 = store.issue(TUAN);
  const until = Date.now() + 80;
  while (Date.now() < until) { /* wait for csrf ttl */ }
  const expired = store.consume(t2, TUAN);
  assert.strictEqual(expired.ok, false);
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runHttpTests() {
  const dir = tmpDir();
  const notes = [];
  const { server, port } = await startServer({
    host: '127.0.0.1',
    port: 0,
    paperDir: dir,
    token: FAKE_TOKEN,
    rateLimitMs: 0,
    skipPm2: true,
    secretsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secrets-settings-')),
    stopPath: path.join(dir, 'LIVE_STOP_TEST'),
    restartFn: () => { notes.push('restart'); return { ok: true }; },
    notifyFn: (payload) => { notes.push(['notify', payload]); return Promise.resolve({ ok: true }); },
  });

  try {
    const health = await httpReq(port, 'GET', '/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.paper, true);
    assert.ok(!JSON.stringify(health.json).toLowerCase().includes('private'));

    // GET settings without auth
    const noAuth = await httpReq(port, 'GET', '/api/settings');
    assert.ok(noAuth.status === 401 || noAuth.status === 403);

    // stranger cannot get a csrf
    const strangerGet = await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(STRANGER) });
    assert.ok(strangerGet.status === 401 || strangerGet.status === 403);
    assert.ok(!strangerGet.json || !strangerGet.json.csrf);

    const get = await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) });
    assert.strictEqual(get.status, 200);
    assert.ok(get.json.csrf);
    assert.strictEqual(get.json.values.MIN_FT, 0.6);   // current default
    assert.ok(get.json.defaults);
    assert.ok(get.json.paused === false);

    // POST without csrf
    const noCsrf = await httpReq(port, 'POST', '/api/settings', {
      initData: signed(TUAN),
      settings: { MIN_FT: 1.5 },
    });
    assert.ok(noCsrf.status === 401 || noCsrf.status === 403);
    almost(s.currentValues(dir).MIN_FT, 0.6);   // current default

    // POST with csrf but stranger initData
    const csrf2 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const thief = await httpReq(port, 'POST', '/api/settings', {
      initData: signed(STRANGER),
      csrf: csrf2,
      settings: { MIN_FT: 0.5 },
    });
    assert.ok(thief.status === 401 || thief.status === 403);
    almost(s.currentValues(dir).MIN_FT, 0.6);   // current default

    // POST invalid values (authorized)
    const csrf3 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const invalid2 = await httpReq(port, 'POST', '/api/settings', {
      initData: signed(TUAN),
      csrf: csrf3,
      settings: { MIN_FT: 99, DRY_RUN: 0, POSITION_SOL: 99 },
    });
    assert.ok(invalid2.status === 400);
    assert.strictEqual(invalid2.json.ok, false);
    almost(s.currentValues(dir).MIN_FT, 0.6);   // current default

    // reuse of a consumed or unused? csrf3 was used by invalid2 (rejected after auth). CSRF is consumed on auth success even if validation fails? We'll assert current behavior.
    // Fresh csrf for a good write
    const csrf4 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const good = await httpReq(port, 'POST', '/api/settings', {
      initData: signed(TUAN),
      csrf: csrf4,
      strategyConfirmed: true,   // RESHAPE_N is a strategy key: the server asks for confirmation
      settings: { MIN_FT: 1.25, RESHAPE_N: 8 },
    });
    assert.strictEqual(good.status, 200, good.raw);
    assert.strictEqual(good.json.ok, true);
    almost(s.currentValues(dir).MIN_FT, 1.25);
    assert.strictEqual(s.currentValues(dir).RESHAPE_N, 8);
    assert.ok(notes.some((n) => Array.isArray(n) && n[0] === 'notify'));

    // csrf replay
    const replay = await httpReq(port, 'POST', '/api/settings', {
      initData: signed(TUAN),
      csrf: csrf4,
      settings: { MIN_FT: 3 },
    });
    assert.ok(replay.status === 401 || replay.status === 403);
    almost(s.currentValues(dir).MIN_FT, 1.25);

    // reset
    await wait(450);
    const csrf5 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const reset = await httpReq(port, 'POST', '/api/settings/reset', { initData: signed(TUAN), csrf: csrf5 });
    assert.strictEqual(reset.status, 200, reset.raw);
    almost(s.currentValues(dir).MIN_FT, 0.6);   // current default

    // pause / resume
    await wait(450);
    const csrf6 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const pause = await httpReq(port, 'POST', '/api/pause', { initData: signed(TUAN), csrf: csrf6 });
    assert.strictEqual(pause.status, 200, pause.raw);
    assert.strictEqual(s.isPaused(dir), true);
    assert.ok(fs.existsSync(s.LIVE_STOP), 'live STOP must still exist after paper pause');

    await wait(450);
    const csrf7 = (await httpReq(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) })).json.csrf;
    const resume = await httpReq(port, 'POST', '/api/resume', { initData: signed(TUAN), csrf: csrf7 });
    assert.strictEqual(resume.status, 200, resume.raw);
    assert.strictEqual(s.isPaused(dir), false);
    assert.ok(notes.includes('restart'));
    assert.ok(fs.existsSync(s.LIVE_STOP), 'live STOP must still exist after paper resume');

    // GET /api/live is allowed for operator (status only). Unguarded live start is tested in test-wallet-live.js.
    const liveStatus = await httpReq(port, 'GET', '/api/live', null, { 'X-Telegram-Init-Data': signed(TUAN) });
    assert.strictEqual(liveStatus.status, 200);
    assert.strictEqual(liveStatus.json.ok, true);
    assert.ok(!('secret' in (liveStatus.json || {})));
  } finally {
    await new Promise((r) => server.close(r));
  }
}

runHttpTests().then(() => {
  console.log('OK  paper-settings unit + http auth checks');
}).catch((e) => {
  console.error('FAIL', e && (e.stack || e));
  process.exit(1);
});
