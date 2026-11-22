// Manual LIVE open from the Mini App: queue (server, owner auth + double confirm + override confirm), bot side (same open path), live screening rows.
// Isolated temp dirs, fake bot functions; never signs, never touches the real bot folder.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), vm = require('vm');
const lc = require('./live-commands'), settings = require('./paper-settings');
const POOL = '4exs9btspvKHEYtuCFMXXV9snF99UvbFJKtDhAzmgYtz', POOL2 = 'Fg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', MINT2 = 'Mint2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
let ok = 0; const byId = (root, id) => lc.done(root, 50).find((x) => x.id === id).result;
const t = async (n, fn) => { await fn(); ok++; console.log('ok', n); };
(async () => {
  await t('queue: pool/id validated, duplicate id idempotent, one pending per pool, max 3, expiry rejects', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
    assert.throws(() => lc.queue(root, { pool: '../x' }));
    assert.ok(lc.queue(root, { pool: POOL, requestId: 'req-aaaaaaaa' }).queued);
    assert.ok(lc.queue(root, { pool: POOL, requestId: 'req-aaaaaaaa' }).duplicate);
    assert.ok(!lc.queue(root, { pool: POOL, requestId: 'req-bbbbbbbb' }).ok);
    assert.strictEqual(lc.take(root).id, 'req-aaaaaaaa');
    lc.finish(root, lc.take(root), { ok: true }); assert.strictEqual(lc.pending(root).length, 0); assert.strictEqual(byId(root, 'req-aaaaaaaa').ok, true);
    lc.queue(root, { pool: POOL2, requestId: 'req-cccccccc' });
    assert.strictEqual(lc.take(root, Date.now() + 11 * 60000), null); assert.ok(/kedaluwarsa/.test(byId(root, 'req-cccccccc').error));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('bot liveManualOpen: slot full / duplicate / failed re-screen rejected; success opens through liveOpen(source manual) + openContext', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const body = src.slice(src.indexOf('async function liveManualOpen('), src.indexOf('async function liveCycle('));
    assert.ok(/if \(await liveManualOpen\(state, maxPos\)\)/.test(src) && src.indexOf('await liveManualOpen(state, maxPos)') > src.indexOf("if (noNew) {"), 'called after STOP / NO_NEW checks');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmo-')), logs = [], opened = [];
    const ctx = { DIR: root, liveCommands: lc, log: (l) => logs.push(l), now: () => 'NOW', CFG: { CAPITAL_ASSET: 'SOL', POSITION_SOL_OPEN: 1 }, liveTestCaps: null,
      exitQuotePriority: () => 0, applyPaperSettings: () => {}, scan: {}, solUsd: async () => 70, realSolBal: async () => 6, wallet: { publicKey: 'W' },
      liveControl: { MIN_LIVE_SOL: 0.1 }, liveCapital: { freeCapitalSol: ({ walletSol }) => walletSol - 0.1 }, liveSafety: { canAffordOpen: ({ free, budgetSol }) => free >= budgetSol },
      livePositions: { duplicate: (ps, a, m) => ps.some((p) => p.pool === a || p.mintX === m), syncPositions: () => {}, list: (s) => s.positions },
      evaluateManualPool: async (r) => { if (r.pool === 'Fail') throw new Error('Filter wajib / screening terbaru menolak: {"rugcheck":1}'); return { address: r.pool, name: 'NEW-SOL', token_x: { address: MINT2 }, manualWarnings: r.overrideFailedFilters ? ['fee/tvl30m<0.6%'] : [] }; },
      liveOpen: async (p, state, o) => { opened.push(o.source); state.positions.push({ pool: p.address, mintX: MINT2, name: p.name }); return { opened: true, complete: true }; } };
    vm.createContext(ctx); vm.runInContext(body + ';this.fn=liveManualOpen;', ctx);
    const state = { positions: [{ pool: POOL, mintX: 'M1' }] };
    assert.strictEqual(await ctx.fn(state, 7), false, 'nothing queued');
    lc.queue(root, { pool: POOL2, name: 'NEW-SOL', requestId: 'r-full-0001' }); assert.strictEqual(await ctx.fn(state, 1), true); assert.ok(/Slot penuh/.test(byId(root, 'r-full-0001').error)); assert.strictEqual(opened.length, 0);
    lc.queue(root, { pool: POOL, requestId: 'r-dup-00001' }); await ctx.fn(state, 7); assert.ok(/sudah dibuka/.test(byId(root, 'r-dup-00001').error));
    lc.queue(root, { pool: POOL2, overrideFailedFilters: true, confirmedReasons: ['fee/tvl30m<0.6%'], requestId: 'r-ok-000001' });
    assert.strictEqual(await ctx.fn(state, 7), true); assert.deepStrictEqual(opened, ['manual']);
    const np = state.positions.find((p) => p.pool === POOL2); assert.strictEqual(np.openContext.source, 'Manual (Mini App)'); assert.strictEqual(np.openContext.snapshot.passedAllFilters, false);
    assert.strictEqual(byId(root, 'r-ok-000001').ok, true); assert.ok(logs.some((l) => /manual open NEW-SOL: OPENED/.test(l)));
    ctx.realSolBal = async () => 0.5; lc.queue(root, { pool: 'Gg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', requestId: 'r-poor-0001' }); await ctx.fn({ positions: [] }, 7); assert.ok(/Saldo SOL/.test(byId(root, 'r-poor-0001').error));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('server /api/live/open: owner + csrf + double confirm; live must run; not before the bot supports it; full / held / failed-filter rules; queues only', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmo-srv-')), paper = path.join(root, 'paper'); fs.mkdirSync(paper);
    const stop = path.join(root, 'STOP'), W = (f, v) => fs.writeFileSync(path.join(root, f), JSON.stringify(v));
    settings.applySettings(paper, { MAX_POSITIONS: 2 }, { updatedBy: 'test' });
    W('state.json', { positions: [{ pool: POOL, name: 'DCTY-SOL', mintX: 'M1', openedAt: '2026-11-20T07:09:40.008Z' }], history: [] });
    W('status.json', { updated: new Date().toISOString(), lives: [{ valueSol: 0.9 }] });
    fs.writeFileSync(path.join(paper, 'screening.json'), JSON.stringify({ at: new Date().toISOString(), display: [
      { name: 'GOOD-SOL', address: POOL2, mintX: MINT2, status: 'passed', reasons: [] },
      { name: 'SKIP-SOL', address: 'Gg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', mintX: 'M3', status: 'rejected', reasons: ['fee/tvl30m<0.6%'] }] }));
    const token = 'fake-live-open-token';
    const { server, port } = await require('./miniapp/server').startServer({ port: 0, host: '127.0.0.1', paperDir: paper, secretsDir: path.join(root, 's'), stopPath: stop, noNewPath: path.join(root, 'NO_NEW'), token, rateLimitMs: 0, failMax: 100, skipPm2: true, notifyFn: async () => {}, liveStatusFn: () => ({ running: true, status: 'online' }) });
    const signed = (id) => settings.signInitData({ user: JSON.stringify({ id }), auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'lmo' }, token);
    const init = signed(1000000001), base = 'http://127.0.0.1:' + port;
    const get = async (a = init) => { const r = await fetch(base + '/api/settings', { headers: { 'x-telegram-init-data': a } }); return r.json(); };
    const post = async (body, a = init) => { const csrf = (await get(a)).csrf; const r = await fetch(base + '/api/live/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': a }, body: JSON.stringify({ ...body, csrf }) }); return { status: r.status, json: await r.json() }; };
    try {
      const both = { confirmed: true, confirmedTwice: true };
      { const x = await post({ pool: POOL2, ...both }, signed(999)); assert.strictEqual(x.status, 403, 'not the owner ' + x.status + JSON.stringify(x.json)); }
      assert.strictEqual((await post({ pool: POOL2, confirmed: true })).status, 400, 'second confirm required');
      let r = await post({ pool: POOL2, ...both }); assert.strictEqual(r.status, 409); assert.ok(/restart sol-lp-live/.test(r.json.error), 'old bot: nothing queued');
      W('status.json', { updated: new Date().toISOString(), features: { manualOpen: true } });
      r = await post({ pool: POOL, ...both }); assert.ok(/sudah dibuka/.test(r.json.error));
      r = await post({ pool: 'Gg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', ...both }); assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.json.reasons, ['fee/tvl30m<0.6%']);
      r = await post({ pool: 'Gg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', overrideFailedFilters: true, overrideConfirmed: true, ...both, requestId: 'skip-0000001' }); assert.strictEqual(r.status, 202, JSON.stringify(r.json));
      const q = lc.pending(root)[0]; assert.strictEqual(q.overrideFailedFilters, true); assert.deepStrictEqual(q.confirmedReasons, ['fee/tvl30m<0.6%']);
      r = await post({ pool: POOL2, ...both, requestId: 'good-0000001' }); assert.strictEqual(r.status, 202); assert.strictEqual(lc.pending(root).find((x) => x.pool === POOL2).overrideFailedFilters, false);
      W('state.json', { positions: [{ pool: POOL, mintX: 'M1' }, { pool: 'Xx', mintX: 'M9' }], history: [] });
      r = await post({ pool: 'Gg6jSVuF7cnWB2Qj4WZK1QkbKqrJRyY2xAdkbiQ8KL2c', overrideFailedFilters: true, overrideConfirmed: true, ...both }); assert.ok(/Slot penuh \(2\/2\)/.test(r.json.error));
      fs.writeFileSync(stop, 'x'); r = await post({ pool: POOL2, ...both }); assert.ok(/LIVE tidak berjalan/.test(r.json.error));
      // status payload: live screening pins the live position with "alasan dibuka", skipped rows keep their reasons, manual-open flag exposed
      fs.unlinkSync(stop); W('state.json', { positions: [{ pool: POOL, name: 'DCTY-SOL', mintX: 'M1', openedAt: '2026-11-20T07:09:40.008Z', openSource: 'scan' }], history: [] });
      fs.writeFileSync(path.join(root, 'bot.log'), '[2026-11-20 14:09:07 WIB]   PASS DCTY-SOL 4exs9b ft30m=0.73% tvl=$53390 age=39.4h bs=80 pump1h=-3.8% pump24h=-67.6% insider=11.5% antiPvP=ok top10=17.9%\n');
      const s = require('./miniapp/server').publicStatus(paper), d = s.screening.display;
      assert.strictEqual(d[0].address, POOL); assert.strictEqual(d[0].isOpen, true); assert.ok(d[0].openInfo.list.some((x) => /Fee\/TVL 30m: 0\.73%/.test(x.t)), JSON.stringify(d[0].openInfo)); assert.strictEqual(d[0].openInfo.source, 'Auto (bot)');
      assert.ok(d.some((x) => x.name === 'SKIP-SOL' && x.reasons[0] === 'fee/tvl30m<0.6%'));
      assert.strictEqual(s.liveManual.supported, true); assert.strictEqual(s.liveManual.pending.length, 2);
    } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  await t('client: screening list prefers the screening file over a few-ms-newer lastScan; LIVE button pressable; live flow confirms', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
    const body = src.slice(src.indexOf('  function pickScan('), src.indexOf('  function tile(k,v'));
    const ctx = {}; vm.createContext(ctx); vm.runInContext(body + ';this.pick=pickScan;', ctx);
    const sc = { at: '2026-11-20T08:10:18.381Z', display: [1] }, last = { at: '2026-11-20T08:10:18.393Z', fetched: 149 };
    assert.strictEqual(ctx.pick({ screening: sc, status: { lastScan: last } }), sc, 'same scan: screening file wins (was the bug)');
    assert.strictEqual(ctx.pick({ screening: sc, status: { lastScan: { at: '2026-11-20T08:20:00.000Z' } } }).at, '2026-11-20T08:20:00.000Z');
    assert.ok(src.includes("${(paperAllowed||state.liveRunning)&&!held?'':'disabled'}"));
    assert.ok(src.includes("if(opening&&state.liveRunning){if(validCA(pool))await liveManualOpen(b,pool);return;}"));
    const fn = src.slice(src.indexOf('async function liveManualOpen'), src.indexOf('function setPositionView'));
    assert.strictEqual((fn.match(/await ask\(/g) || []).length, 4); assert.ok(/'\/api\/live\/open'/.test(fn) && /restart sol-lp-live/.test(fn) && /Slot penuh/.test(fn));
  });
  console.log(`PASS ${ok} checks`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
