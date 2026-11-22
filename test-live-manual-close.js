// Manual LIVE close from the Mini App (22 Nov), on the same path as the manual open: server validates + queues, the live bot takes
// the request for the position it is polling and closes through liveClose. Isolated temp dirs, fake bot functions; never signs.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), vm = require('vm');
const lc = require('./live-commands'), settings = require('./paper-settings');
const POOL = '4exs9btspvKHEYtuCFMXXV9snF99UvbFJKtDhAzmgYtz', POOL2 = 'Fg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', OPENED = '2026-11-21T17:33:10.109Z';
let ok = 0; const byId = (root, id) => lc.done(root, 50).find((x) => x.id === id).result;
const t = async (n, fn) => { await fn(); ok++; console.log('ok', n); };
(async () => {
  await t('queue: close requests are separate from open requests; one per position; expiry and re-opened position rejected', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-'));
    assert.throws(() => lc.queueClose(root, { pool: '../x' }));
    assert.ok(lc.queueClose(root, { pool: POOL, openedAt: OPENED, requestId: 'close-aaaaaa' }).queued);
    assert.ok(lc.queueClose(root, { pool: POOL, requestId: 'close-aaaaaa' }).duplicate);
    assert.ok(!lc.queueClose(root, { pool: POOL, requestId: 'close-bbbbbb' }).ok, 'one close request per position');
    assert.strictEqual(lc.take(root), null, 'the open queue never hands out a close request');
    assert.ok(lc.queue(root, { pool: POOL2, requestId: 'open-cccccccc' }).queued, 'a pending close does not block open requests');
    assert.strictEqual(lc.take(root).id, 'open-cccccccc');
    assert.strictEqual(lc.takeClose(root, POOL2), null);
    assert.strictEqual(lc.takeClose(root, POOL, OPENED).id, 'close-aaaaaa');
    lc.queueClose(root, { pool: POOL2, openedAt: 'OLD', requestId: 'close-reopen1' });
    assert.strictEqual(lc.takeClose(root, POOL2, 'NEW'), null); assert.ok(/berganti/.test(byId(root, 'close-reopen1').error));
    lc.finish(root, lc.takeClose(root, POOL, OPENED), { ok: true });
    lc.queueClose(root, { pool: POOL, requestId: 'close-old0001' });
    assert.strictEqual(lc.takeClose(root, POOL, null, Date.now() + 11 * 60000), null); assert.ok(/kedaluwarsa/.test(byId(root, 'close-old0001').error));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('bot: manual close becomes the exit reason after the decision, closes via liveClose; feature flag published', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    assert.ok(src.includes('manualOpen: !CFG.PAPER, manualClose: !CFG.PAPER'));
    const iDecision = src.indexOf("log('exit decision error (position held, retry next poll): '"), iManual = src.indexOf("if (takeManualClose(state.position) && (!exitReason || exitReason === 'oor_right_reposition')) exitReason = 'manual_close';");
    const iRepo = src.indexOf("if (exitReason === 'oor_right_reposition') {", iDecision), iClose = src.indexOf('if (exitReason) await liveClose(state, exitReason);');
    assert.ok(iDecision > 0 && iManual > iDecision && iManual < iRepo && iRepo < iClose, 'after the exit decision, before reposition/reshape, closed by liveClose');
    const body = src.slice(src.indexOf('function takeManualClose('), src.indexOf('async function liveManualOpen('));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-bot-')), logs = [];
    const ctx = { DIR: root, liveCommands: lc, log: (l) => logs.push(l) }; vm.createContext(ctx); vm.runInContext(body + ';this.fn=takeManualClose;', ctx);
    const pos = { pool: POOL, openedAt: OPENED, name: 'greg-SOL' };
    assert.strictEqual(ctx.fn(pos), null, 'nothing queued');
    lc.queueClose(root, { pool: POOL, openedAt: OPENED, requestId: 'close-bot0001' });
    assert.ok(ctx.fn(pos)); assert.strictEqual(byId(root, 'close-bot0001').closing, true); assert.strictEqual(lc.pending(root).length, 0);
    assert.ok(logs.some((l) => /manual close greg-SOL: permintaan Mini App diterima/.test(l)));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('server /api/live/close: owner + csrf + double confirm; live must run; bot must support it; position must be open; queues only', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-srv-')), paper = path.join(root, 'paper'); fs.mkdirSync(paper);
    const stop = path.join(root, 'STOP'), W = (f, v) => fs.writeFileSync(path.join(root, f), JSON.stringify(v));
    settings.applySettings(paper, { MAX_POSITIONS: 2 }, { updatedBy: 'test' });
    W('state.json', { positions: [{ pool: POOL, name: 'greg-SOL', mintX: 'M1', openedAt: OPENED }], history: [] });
    W('status.json', { updated: new Date().toISOString(), lives: [{ valueSol: 1.8 }] });
    const token = 'fake-live-close-token';
    const { server, port } = await require('./miniapp/server').startServer({ port: 0, host: '127.0.0.1', paperDir: paper, secretsDir: path.join(root, 's'), stopPath: stop, noNewPath: path.join(root, 'NO_NEW'), token, rateLimitMs: 0, failMax: 100, skipPm2: true, liveStatusFn: () => ({ running: true, status: 'online' }) });
    const signed = (id) => settings.signInitData({ user: JSON.stringify({ id }), auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'lmc' }, token);
    const init = signed(1000000001), base = 'http://127.0.0.1:' + port;
    const get = async (a = init) => { const r = await fetch(base + '/api/settings', { headers: { 'x-telegram-init-data': a } }); return r.json(); };
    const post = async (body, a = init) => { const csrf = (await get(a)).csrf; const r = await fetch(base + '/api/live/close', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': a }, body: JSON.stringify({ ...body, csrf }) }); return { status: r.status, json: await r.json() }; };
    try {
      const both = { confirmed: true, confirmedTwice: true };
      assert.strictEqual((await post({ pool: POOL, ...both }, signed(999))).status, 403, 'not the owner');
      assert.strictEqual((await post({ pool: POOL, confirmed: true })).status, 400, 'second confirm required');
      let r = await post({ pool: POOL, ...both }); assert.strictEqual(r.status, 409); assert.ok(/restart sol-lp-live/.test(r.json.error), 'old bot: nothing queued');
      W('status.json', { updated: new Date().toISOString(), features: { manualOpen: true, manualClose: true } });
      r = await post({ pool: POOL2, ...both }); assert.ok(/sudah tidak terbuka/.test(r.json.error));
      r = await post({ pool: POOL, openedAt: 'OLD', ...both }); assert.ok(/berganti/.test(r.json.error));
      r = await post({ pool: POOL, openedAt: OPENED, ...both, requestId: 'close-srv0001' }); assert.strictEqual(r.status, 202, JSON.stringify(r.json));
      const q = lc.pending(root)[0]; assert.strictEqual(q.type, 'close'); assert.strictEqual(q.pool, POOL); assert.strictEqual(q.openedAt, OPENED);
      r = await post({ pool: POOL, ...both, requestId: 'close-srv0002' }); assert.ok(/sudah antre/.test(r.json.error));
      const s = require('./miniapp/server').publicStatus(paper); assert.strictEqual(s.liveManual.closeSupported, true); assert.strictEqual(s.liveManual.pending[0].type, 'close');
      W('state.json', { positions: [{ pool: POOL, name: 'greg-SOL', openedAt: OPENED, closePendingReason: 'emergency_stop' }], history: [] });
      fs.rmSync(path.join(root, 'live-commands'), { recursive: true, force: true });
      r = await post({ pool: POOL, ...both }); assert.ok(/sedang ditutup/.test(r.json.error));
      fs.writeFileSync(stop, 'x'); r = await post({ pool: POOL, ...both }); assert.ok(/LIVE tidak berjalan/.test(r.json.error));
    } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  await t('client: "Tutup sekarang" pressable on LIVE and routed to the live close flow (2 confirms, /api/live/close)', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
    assert.ok(src.includes("data-opened=\"${esc(pos.openedAt)}\" ${paperAllowed||state.liveRunning?'':'disabled'}>Tutup sekarang"));
    assert.ok(src.includes('if(!opening&&state.liveRunning){if(validCA(pool))await liveManualClose(b,pool);return;}'));
    const fn = src.slice(src.indexOf('async function liveManualClose'), src.indexOf('async function liveManualOpen'));
    assert.strictEqual((fn.match(/await ask\(/g) || []).length, 2); assert.ok(/'\/api\/live\/close'/.test(fn) && /restart sol-lp-live/.test(fn) && /closeSupported/.test(fn));
  });
  console.log(`PASS ${ok} checks`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
