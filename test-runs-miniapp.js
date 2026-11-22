'use strict';
// Mini App routes: continue a stopped dry run, activate an archived run. Auth/CSRF/confirm/live-lock guards. Temp dirs only.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const s = require('./paper-settings'), R = require('./paper-runs');
const { startServer } = require('./miniapp/server');
const TOKEN = 'test-telegram-token-not-real', TUAN = 1000000001, STRANGER = 999999999;
const signed = (uid) => s.signInitData({ user: JSON.stringify({ id: uid, first_name: 'T' }), auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE' }, TOKEN);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); });
    }); r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const mkState = (num, usdc) => ({ meta: { endsAt: '2099-12-31T00:00:00.000Z' }, books: { N5: { virtual: { usdcStart: 500, usdc, sol: 0, totalDepositedUsdc: 500, capitalAsset: 'USDC', capitalSol: 0 }, history: [], positions: [], position: null } }, capitalDeposits: [], accountingCorrections: [], dryRun: { number: num, startedAt: '2026-11-01T00:00:00.000Z' } });
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-app-')), notes = [], stopPath = path.join(dir, 'LIVE_STOP_TEST');
  fs.writeFileSync(stopPath, 'x');                                                  // live locked = dry run mode
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(mkState(2, 800)));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ endsAt: '2020-01-01T00:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, 'STOP'), 'paused'); fs.writeFileSync(path.join(dir, 'ENDED'), 'x');
  const { server, port } = await startServer({ host: '127.0.0.1', port: 0, paperDir: dir, token: TOKEN, rateLimitMs: 0, skipPm2: true, secretsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sec-')), stopPath,
    restartFn: () => { notes.push('restart'); return { ok: true }; }, notifyFn: () => Promise.resolve({ ok: true }) });
  const csrf = async (uid = TUAN) => { await wait(20); return (await req(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(uid) })).json.csrf; };
  try {
    // status carries the stopped flags
    const st = await req(port, 'GET', '/api/settings', null, { 'X-Telegram-Init-Data': signed(TUAN) });
    assert.ok(st.json.status.runs.stopped.stopped && st.json.status.runs.stopped.paused && st.json.status.runs.stopped.windowEnded);
    // stranger and missing confirm are refused, nothing changes
    const bad = await req(port, 'POST', '/api/runs/continue', { initData: signed(STRANGER), csrf: await csrf(), confirmed: true }); assert.ok(bad.status === 401 || bad.status === 403);
    const noc = await req(port, 'POST', '/api/runs/continue', { initData: signed(TUAN), csrf: await csrf() }); assert.strictEqual(noc.status, 400);
    assert.ok(fs.existsSync(path.join(dir, 'STOP')) && fs.existsSync(path.join(dir, 'ENDED')));
    // live not locked -> refused
    fs.unlinkSync(stopPath);
    const live = await req(port, 'POST', '/api/runs/continue', { initData: signed(TUAN), csrf: await csrf(), confirmed: true }); assert.strictEqual(live.status, 409);
    fs.writeFileSync(stopPath, 'x');
    // continue: autosave, STOP removed, ENDED kept as backup, window extended, bot restarted
    const ok = await req(port, 'POST', '/api/runs/continue', { initData: signed(TUAN), csrf: await csrf(), confirmed: true });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json)); assert.ok(ok.json.autosave && ok.json.extendedWindow && ok.json.clearedEnded);
    assert.ok(!fs.existsSync(path.join(dir, 'STOP')) && !fs.existsSync(path.join(dir, 'ENDED'))); assert.ok(notes.includes('restart'));
    assert.ok(fs.existsSync(path.join(dir, 'runs', 'autosave', ok.json.autosave, 'state.json')));
    // nothing stopped any more -> a second continue is refused
    const again = await req(port, 'POST', '/api/runs/continue', { initData: signed(TUAN), csrf: await csrf(), confirmed: true }); assert.strictEqual(again.status, 409);
    // activate: no such run, then a real one gets queued
    const none = await req(port, 'POST', '/api/runs/activate', { initData: signed(TUAN), csrf: await csrf(), confirmed: true, number: 7 }); assert.strictEqual(none.status, 409);
    const st2 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); const id = 'req-activate-1';
    fs.mkdirSync(path.join(dir, 'runs', 'pending'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'pending', id + '.json'), JSON.stringify({ id, type: 'new-run', paper: true, amount: 1000, updatedBy: TUAN }));
    R.applyPending(st2, dir, { save: x => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(x)), allowedId: TUAN });   // archives run 2 -> run 3 active
    const act = await req(port, 'POST', '/api/runs/activate', { initData: signed(TUAN), csrf: await csrf(), confirmed: true, number: 2, requestId: 'req-activate-2' });
    assert.strictEqual(act.status, 202, JSON.stringify(act.json)); assert.strictEqual(act.json.number, 2);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'runs', 'pending')).length, 1);
    const dup = await req(port, 'POST', '/api/runs/activate', { initData: signed(TUAN), csrf: await csrf(), confirmed: true, number: 2, requestId: 'req-activate-3' }); assert.strictEqual(dup.status, 409);
    console.log('test-runs-miniapp: OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
