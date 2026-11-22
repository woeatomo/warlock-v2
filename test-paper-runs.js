'use strict';
if(!process.env.LP_BOT_DIR||!process.env.LP_BOT_DIR.startsWith('/tmp/')){const __d=require('fs').mkdtempSync('/tmp/lp-test-');process.env.LP_BOT_DIR=__d;process.env.LP_PAPER_DIR=__d+'/paper';require('fs').mkdirSync(__d+'/paper',{recursive:true});require('fs').copyFileSync(require('path').join(__dirname,'fixture-history-state.json'),__d+'/paper/state.json');for(const [f,c] of [['sl-blacklist.json','{"mints":{}}'],['settings.json','{}'],['summary.json','{}'],['history.csv','pair,pnl_usd\n']])require('fs').writeFileSync(__d+'/paper/'+f,c);}   // self-provisioned temp dirs (never the real ones)
// Temp copy only. Uses a COPY of the live state (no secrets) under LP_PAPER_DIR.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = process.env.LP_PAPER_DIR; assert(dir && dir.startsWith('/tmp/'), 'temp LP_PAPER_DIR required');
const runs = require('./paper-runs'), cal = require('./paper-pnl-calendar'), funding = require('./paper-funding');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const F = (f) => path.join(dir, f), read = (f) => JSON.parse(fs.readFileSync(F(f), 'utf8'));
const save = (s) => { const tmp = F('state.json.' + process.pid + '.tmp'); fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, F('state.json')); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(F(f))).digest('hex');
const UID = 4242; const opts = { save, allowedId: UID, audit: (l) => fs.appendFileSync(F('settings-audit.log'), l + '\n'), log: () => {} };
t('amount validation: 0 / empty / negative rejected with "Modal minimal $1"', () => {
  for (const v of [0, '0', '', ' ', -5, 0.5, null]) assert.throws(() => runs.amountValue(v), /Modal minimal \$1/);
  assert.strictEqual(runs.amountValue('1'), 1); assert.strictEqual(runs.amountValue(5000), 5000);
});
t('refuses while positions are open (queue + bot side), nothing changed', () => {
  const st = read('state.json'); assert(st.books.N5.positions.length > 0, 'fixture needs open positions');
  assert.throws(() => runs.queueNewRun(dir, 1000, { updatedBy: UID, state: st }), /Tutup semua posisi dulu/);
  const before = sha('state.json');
  runs.queueNewRun(dir, 1000, { updatedBy: UID, requestId: 'reqopen-0001' }); // bypass UI check to test bot-side refusal
  assert.strictEqual(runs.applyPending(st, dir, opts), 0);
  assert.strictEqual(sha('state.json'), before);
  const done = JSON.parse(fs.readFileSync(path.join(dir, 'runs/done/reqopen-0001.json'), 'utf8'));
  assert.strictEqual(done.result.ok, false); assert.match(done.result.error, /^Tutup semua posisi dulu/);
  assert(!fs.existsSync(path.join(dir, 'runs/index.json')));
});
t('archive + fresh start when flat; SL blacklist and settings untouched', () => {
  const st = read('state.json'); const b = st.books.N5;
  for (const p of b.positions) { b.virtual.usdc += p.lastExitUsdc; } b.positions = []; b.position = null; save(st); // simulate all closed
  const oldHist = b.history.length, oldPnl = b.history.reduce((a, h) => a + (h.pnlUsd ?? 0), 0), oldModal = b.virtual.totalDepositedUsdc;
  const slSha = sha('sl-blacklist.json'), setSha = sha('settings.json');
  assert.throws(() => runs.queueNewRun(dir, 2000, { updatedBy: UID, state: st, expectedOldModal: 1234 }), /Modal sudah berubah/);
  runs.queueNewRun(dir, 2000, { updatedBy: UID, state: st, expectedOldModal: oldModal, requestId: 'reqflat-0001' });
  assert.throws(() => runs.queueNewRun(dir, 3000, { updatedBy: UID, state: st }), /antre/);
  assert.strictEqual(runs.applyPending(st, dir, opts), 1);
  const ns = read('state.json'), nb = ns.books.N5;
  assert.deepStrictEqual([nb.history.length, nb.positions.length, nb.reshapes.length], [0, 0, 0]);
  assert.strictEqual(nb.virtual.usdc, 2000); assert.strictEqual(nb.virtual.totalDepositedUsdc, 2000); assert.strictEqual(nb.virtual.usdcStart, 2000); assert.strictEqual(nb.virtual.capitalAsset, 'USDC');
  assert.strictEqual(ns.dryRun.number, 2); assert.strictEqual(ns.capitalDeposits.length, 1); assert.strictEqual(ns.capitalDeposits[0].type, 'run-start');
  assert.strictEqual(sha('sl-blacklist.json'), slSha); assert.strictEqual(sha('settings.json'), setSha);
  const c = cal.build(dir); assert.strictEqual(c.trades, 0); assert.strictEqual(c.total, 0);
  const idx = read('runs/index.json'); assert.strictEqual(idx.runs.length, 1);
  const r1 = idx.runs[0]; assert.strictEqual(r1.number, 1); assert.strictEqual(r1.modal, oldModal); assert.strictEqual(r1.trades, oldHist); assert(Math.abs(r1.totalPnlUsd - oldPnl) < 1e-5);
  const rd = path.join(dir, 'runs', r1.dir); for (const f of ['state.json', 'index.json', 'pnl-calendar.json', 'history.csv', 'summary.json', 'sl-blacklist.json']) assert(fs.existsSync(path.join(rd, f)), f);
  const archived = JSON.parse(fs.readFileSync(path.join(rd, 'state.json'), 'utf8')); assert.strictEqual(archived.books.N5.history.length, oldHist);
  assert(fs.readFileSync(F('settings-audit.log'), 'utf8').includes('action=paper-new-run id=reqflat-0001 archived=run#1'));
  const snap = runs.snapshot(dir); assert.strictEqual(snap.current.number, 2); assert.strictEqual(snap.current.modal, 2000); assert.strictEqual(snap.runs.length, 1);
  assert.strictEqual(funding.snapshot(dir).totalDepositedUsdc, 2000);
});
t('second edit archives run #2 as its own folder', () => {
  const st = read('state.json');
  runs.queueNewRun(dir, 1, { updatedBy: UID, state: st, expectedOldModal: 2000, requestId: 'reqflat-0002' });
  assert.strictEqual(runs.applyPending(st, dir, { ...opts, now: () => new Date(Date.now() + 2000) }), 1);
  const idx = read('runs/index.json'); assert.deepStrictEqual(idx.runs.map((r) => r.number), [1, 2]); assert.notStrictEqual(idx.runs[0].dir, idx.runs[1].dir);
  assert.strictEqual(read('state.json').books.N5.virtual.usdc, 1); assert.strictEqual(read('state.json').dryRun.number, 3);
});
t('wrong user / non-paper requests rejected', () => {
  const st = read('state.json');
  runs.queueNewRun(dir, 50, { updatedBy: 999, requestId: 'reqbad-00001' });
  assert.strictEqual(runs.applyPending(st, dir, opts), 0); assert.strictEqual(read('state.json').books.N5.virtual.usdc, 1);
});
t('fresh-install defaults are $0', () => {
  assert.strictEqual(require('./paper-capital').DEFAULT_USDC_START, 0);
  const s = { books: { N5: { virtual: { usdc: 0 } } } }; funding.initialize(s); assert.strictEqual(s.books.N5.virtual.totalDepositedUsdc, 0);
});
console.log(`test-paper-runs: ${n} passed`);
