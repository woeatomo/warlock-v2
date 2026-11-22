'use strict';
// Continue a stopped dry run + re-activate an archived run. Temp dirs only; nothing real is read or written.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const R = require('./paper-runs');
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
const book = (usdc, extra = {}) => ({ virtual: { usdcStart: 500, usdc, sol: 0, totalDepositedUsdc: 500, capitalAsset: 'USDC', capitalSol: 0, lastCapitalSolUsd: 100 }, history: [{ pnlUsd: usdc - 500 }], positions: [], position: null, ...extra });
const mkState = (num, usdc) => ({ meta: { endsAt: '2099-12-31T00:00:00.000Z' }, books: { N5: book(usdc) }, capitalDeposits: [{ id: 'x' + num, amount: 500 }], accountingCorrections: [], dryRun: { number: num, startedAt: '2026-11-01T00:00:00.000Z' } });
const ID = 1000000001;

// ---- stopped state + continue
{
  const d = mk(); fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(mkState(1, 520)));
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ endsAt: '2020-01-01T00:00:00.000Z', endsWib: 'x' }));
  let st = R.stoppedState(d); assert.ok(st.windowEnded && st.stopped && !st.paused && !st.ended);
  fs.writeFileSync(path.join(d, 'STOP'), 'x'); fs.writeFileSync(path.join(d, 'ENDED'), 'x');
  st = R.stoppedState(d); assert.ok(st.paused && st.ended && st.windowEnded);
  const c = R.continueRun(d);
  assert.ok(c.ok && c.extendedWindow && c.clearedEnded && c.wasPaused);
  // snapshot saved, original untouched, ENDED kept (renamed), window extended with a backup of config.json
  const snap = path.join(d, 'runs', 'autosave', c.autosave); assert.ok(fs.existsSync(path.join(snap, 'state.json')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(snap, 'state.json'))).books.N5.virtual.usdc, 520);
  assert.ok(!fs.existsSync(path.join(d, 'ENDED')) && fs.readdirSync(d).some(x => x.startsWith('ENDED.bak_continue_')));
  assert.ok(fs.readdirSync(d).some(x => x.startsWith('config.json.bak_continue_')));
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(path.join(d, 'config.json'))).endsAt) > Date.now());
  assert.ok(fs.existsSync(path.join(d, 'STOP')));                       // STOP is removed by settings.resumeDryRun, not here
  // not stopped -> refuse
  fs.unlinkSync(path.join(d, 'STOP')); assert.strictEqual(R.continueRun(d).ok, false);
  // autosave keeps only the last 20
  for (let i = 0; i < 25; i++) R.autosave(d, 'n' + i, new Date(Date.now() + i * 2000));
  assert.ok(fs.readdirSync(path.join(d, 'runs', 'autosave')).length <= 20);
}

// ---- activate an archived run end to end (new-run archive -> activate older)
(async () => {
  const d = mk(), state = mkState(1, 700); fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(state));
  const save = s => fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(s)), audit = () => {}, log = () => {};
  // archive run 1 through the normal new-run path
  const send = (type, extra) => { const id = 'req-' + Math.random().toString(36).slice(2, 12); const p = path.join(d, 'runs', 'pending'); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, id + '.json'), JSON.stringify({ id, type, paper: true, updatedBy: ID, ...extra })); return id; };
  send('new-run', { amount: 1000 });
  assert.strictEqual(R.applyPending(state, d, { save, audit, log, allowedId: ID }), 1);
  assert.strictEqual(state.dryRun.number, 2); assert.strictEqual(state.books.N5.virtual.usdc, 1000);
  assert.strictEqual(R.readIndex(d).runs.length, 1);
  state.books.N5.virtual.usdc = 1111; state.books.N5.history = [{ pnlUsd: 111 }]; save(state);
  // validation of the request
  assert.throws(() => R.queueActivate(d, 9, { updatedBy: ID, state }), /tidak ditemukan/);
  assert.throws(() => R.queueActivate(d, 2, { updatedBy: ID, state }), /tidak ditemukan|sudah aktif/);
  const open = JSON.parse(JSON.stringify(state)); open.books.N5.positions = [{ pool: 'p' }];
  assert.throws(() => R.queueActivate(d, 1, { updatedBy: ID, state: open }), /Tutup semua posisi/);
  const q = R.queueActivate(d, 1, { updatedBy: ID, state }); assert.strictEqual(q.status, 'queued');
  assert.throws(() => R.queueActivate(d, 1, { updatedBy: ID, state }), /antre/);
  // wrong requester is rejected, the request is consumed and nothing changes
  const bad = R.applyPending(JSON.parse(JSON.stringify(state)), d, { save: () => {}, audit, log, allowedId: 999 }); assert.strictEqual(bad, 0);
  state.meta = { endsAt: '2099-12-31T00:00:00.000Z', keep: true };
  // fresh request, applied by the "bot"
  const d2 = d; for (const f of fs.readdirSync(path.join(d2, 'runs', 'pending'))) fs.unlinkSync(path.join(d2, 'runs', 'pending', f));
  R.queueActivate(d, 1, { updatedBy: ID, state });
  assert.strictEqual(R.applyPending(state, d, { save, audit, log, allowedId: ID }), 1);
  assert.strictEqual(state.dryRun.number, 1);                                     // run 1 is active again
  assert.strictEqual(state.books.N5.virtual.usdc, 700);                           // with ITS books, not run 2's
  assert.strictEqual(state.meta.keep, true);                                      // the 7-day window of the running bot is untouched
  const idx = R.readIndex(d).runs; assert.deepStrictEqual(idx.map(x => x.number), [1, 2]);   // run 2 (the one that was running) is now archived
  assert.strictEqual(idx.find(x => x.number === 2).totalPnlUsd, 111);
  assert.ok(fs.existsSync(path.join(d, 'runs', 'done')) && fs.readdirSync(path.join(d, 'runs', 'done')).length >= 2);
  // the next new run must not reuse an archived number (3, not 2)
  send('new-run', { amount: 500 }); fs.readdirSync(path.join(d, 'runs', 'pending')).length;
  assert.strictEqual(R.applyPending(state, d, { save, audit, log, allowedId: ID }), 1);
  assert.strictEqual(state.dryRun.number, 3);
  assert.deepStrictEqual(R.readIndex(d).runs.map(x => x.number), [1, 2]);          // run 1 re-archived (replaces its entry), 2 stays
  // snapshot exposes the stopped state
  assert.ok('stopped' in R.snapshot(d));
  // SOL run start: native SOL capital, no conversion, USD figures marked at the entry price
  send('new-run', { amount: 10, asset: 'SOL' });
  state.books.N5.virtual.lastCapitalSolUsd = 80;
  assert.strictEqual(R.applyPending(state, d, { save, audit, log, allowedId: ID }), 1);
  const sv = state.books.N5.virtual;
  assert.strictEqual(sv.capitalAsset, 'SOL'); assert.strictEqual(sv.capitalSol, 10); assert.strictEqual(sv.usdc, 0); assert.strictEqual(sv.totalDepositedSol, 10);
  assert.strictEqual(sv.totalDepositedUsdc, 800); assert.strictEqual(sv.depositsUsdAccounted, 800); assert.strictEqual(state.dryRun.modalAsset, 'SOL'); assert.strictEqual(state.dryRun.number, 4);
  assert.strictEqual(state.capitalDeposits[0].asset, 'SOL');
  // bad amount / no price are rejected without touching the book
  send('new-run', { amount: 0.001, asset: 'SOL' });
  assert.strictEqual(R.applyPending(state, d, { save, audit, log, allowedId: ID }), 0); assert.strictEqual(state.books.N5.virtual.capitalSol, 10);
  assert.throws(() => R.solAmountValue('abc')); assert.strictEqual(R.solAmountValue('10'), 10);
  console.log('test-runs-continue-activate: OK');
})().catch(e => { console.error(e); process.exit(1); });
