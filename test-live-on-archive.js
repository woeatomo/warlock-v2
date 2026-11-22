'use strict';
// Live ON saves the dry run by number (run-N + index), prepares run N+1, and never touches the dry run when live fails to start. Offline, temp dirs only.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'); const R = require('./paper-runs');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'), srv = fs.readFileSync(path.join(__dirname, 'miniapp/server.js'), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const mkState = (open = 0) => ({ meta: { startedAt: '2026-11-10T00:00:00Z' }, dryRun: { number: 2, startedAt: '2026-11-10T00:00:00Z', modal: 12000 }, capitalDeposits: [{ id: 'x' }], accountingCorrections: [],
  books: { N5: { virtual: { usdcStart: 12000, usdc: 12400, sol: 0, totalDepositedUsdc: 12000, capitalAsset: 'USDC', capitalSol: 0, lastCapitalSolUsd: 150 }, history: [{ name: 'A', pnlUsd: 25, closedAt: '2026-11-11T01:00:00Z', entryUsdc: 500 }, { name: 'B', pnlUsd: -5, closedAt: '2026-11-11T05:00:00Z' }], reshapes: [{}], rightRepositionEvents: [], positions: Array.from({ length: open }, (_, i) => ({ pool: 'p' + i })), position: null } } });
const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'liveon-')); fs.writeFileSync(path.join(d, 'state.json'), '{}'); fs.writeFileSync(path.join(d, 'settings.json'), '{"a":1}'); return d; };
t('archive: run folder + index entry saved by number, next run N+1 prepared with the same modal, history reset', () => {
  const d = dir(), s = mkState(), saves = []; const r = R.archiveForLive(s, d, { save: x => saves.push(JSON.stringify(x).length) });
  assert.ok(r.ok); assert.equal(r.run, 2); assert.equal(r.newRun, 3); assert.equal(r.modal, 12000);
  const idx = R.readIndex(d).runs; assert.equal(idx.length, 1); assert.equal(idx[0].number, 2); assert.equal(idx[0].trades, 2); assert.equal(idx[0].totalPnlUsd, 20); assert.equal(idx[0].endedReason, 'live-on');
  assert.ok(fs.existsSync(path.join(d, 'runs', idx[0].dir, 'state.json')) && fs.existsSync(path.join(d, 'runs', idx[0].dir, 'index.json')) && fs.existsSync(path.join(d, 'runs', idx[0].dir, 'pnl-calendar.json')));
  assert.equal(s.dryRun.number, 3); assert.equal(s.dryRun.previousRun, 2); assert.equal(s.books.N5.history.length, 0); assert.equal(s.books.N5.virtual.usdc, 12000); assert.equal(s.books.N5.virtual.totalDepositedUsdc, 12000); assert.ok(saves.length >= 2);
});
t('archive refuses while dry-run positions are still open (nothing written); archives once flat', () => {
  const d = dir(), s = mkState(2); const r = R.archiveForLive(s, d, { save() {} }); assert.equal(r.ok, false); assert.ok(!fs.existsSync(path.join(d, 'runs'))); assert.equal(s.dryRun.number, 2);
  s.books.N5.positions = []; assert.ok(R.archiveForLive(s, d, { save() {} }).ok);
});
t('two Live ON in a row create run 2 then run 3 (numbers never reused)', () => {
  const d = dir(), s = mkState(); R.archiveForLive(s, d, { save() {} }); s.books.N5.history.push({ name: 'C', pnlUsd: 3, closedAt: '2026-11-12T01:00:00Z' }); const r = R.archiveForLive(s, d, { save() {} });
  assert.equal(r.run, 3); assert.deepEqual(R.readIndex(d).runs.map(x => x.number), [2, 3]);
});
t('failed save rolls the in-memory state back', () => { const d = dir(), s = mkState(); let c = 0; assert.throws(() => R.archiveForLive(s, d, { save() { if (++c === 2) throw new Error('disk'); } })); assert.equal(s.dryRun.number, 2); assert.equal(s.books.N5.history.length, 2); });
t('paper bot hook: only when paused + flat + marker present; removes the marker only after success', () => {
  assert.ok(/if\(stop&&allFlat\(state\)\)\{const mk=path\.join\(PAPER_DIR,'ARCHIVE_ON_LIVE'\)/.test(src)); assert.ok(/paperRuns\.archiveForLive\(/.test(src)); assert.ok(/if\(res\.ok\)\{fs\.unlinkSync\(mk\)/.test(src));
});
t('server: live starts FIRST; the dry run is paused + marked only after a successful start; a failed start leaves the dry run untouched', () => {
  const a = srv.slice(srv.indexOf("if (pathname === '/api/live/start')"), srv.indexOf("if (pathname === '/api/live/stop')"));
  const iStart = a.indexOf('startFn()'), iPause = a.indexOf('settings.pauseDryRun'), iMark = a.indexOf('ARCHIVE_ON_LIVE'), iFail = a.indexOf('if (!started.ok)');
  assert.ok(iStart > 0 && iFail > iStart && iPause > iFail && iMark > iPause); assert.ok(!/stopPaperFn\(\)/.test(a));
});
console.log('all', n, 'tests passed');
