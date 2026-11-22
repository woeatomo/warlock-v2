'use strict';
// 15 Nov 2026: trades that entered with pump 1h > 15% are voided (would be filtered by MAX_PUMP1H 15%): rows + their events leave the book,
// cash restored, equity identity unchanged, receipt keeps originals, open positions untouched. Synthetic state only.
const assert = require('assert'); const R = require('./paper-reconcile');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const V = R.PUMP1H_VOID;
const snap = (pump) => ({ openContext: { snapshot: { pump1hPct: pump } } });
const keep = (o = {}) => ({ name: 'KEEP-SOL', pool: 'PK', position: 'QK', openedAt: '2026-11-13T00:00:00.000Z', closedAt: '2026-11-13T01:00:00.000Z', pnlUsd: 12.5, pnlQuoteUsd: 10, usdcIn: 499.9, usdcOut: 512.4, reason: 'oor_right_take_profit', ...snap(3), ...o });
const voidRow = (s) => ({ ...s, pnlQuoteUsd: s.pnlUsd, usdcIn: 499.9, usdcOut: 499.9 + s.pnlUsd, reason: s.pnlUsd < -100 ? 'emergency_stop' : 'oor_right_take_profit', ...snap(V.maxPump1hPct + 5) });
const openPos = () => ({ name: 'timmy-SOL', pool: 'Apb6s7SHxckEBHuJoKmidjQb6jggR2h8U7dtjZDdwvcV', openedAt: '2026-11-14T19:27:15.013Z', initialUsdcIn: 499.9, usdcIn: 499.9, bins: { a: { x: 1, y: 2 } } });
const mkState = () => {
  const hist = [keep({ position: 'LEGACY', ...{ openContext: { snapshot: {} } } }), ...V.rows.map(voidRow), keep()];
  const dep = 5000, sum = hist.reduce((s, r) => s + r.pnlUsd, 0), pos = openPos();
  return { books: { N5: { virtual: { usdc: dep + sum - pos.initialUsdcIn + 0.37, totalDepositedUsdc: dep }, positions: [pos], position: null, history: hist,
    rightRepositionEvents: [{ name: 'Snoopy-SOL', at: '2026-11-14T17:00:00.000Z' }, { name: 'Snoopy-SOL', at: '2026-11-14T19:00:00.000Z' }, { name: 'KEEP-SOL', at: '2026-11-13T00:30:00.000Z' }],
    reshapes: [{ name: 'GTA$-SOL', at: '2026-11-14T15:30:00.000Z' }, { name: 'timmy-SOL', at: '2026-11-14T19:30:00.000Z' }, { name: 'KEEP-SOL', at: '2026-11-13T00:40:00.000Z' }] } }, accountingCorrections: [] };
};
t('removes exactly the 19 rows; legacy (no pump data) and other rows stay; cash restored by -sum(PnL) = +338.78; equity identity unchanged', () => {
  const st = mkState(), b = st.books.N5, gap0 = R.bookEquityGap(b), cash0 = b.virtual.usdc;
  const rc = R.applyPump1hVoid(st, '2026-11-15T00:00:00Z');
  assert.ok(rc && rc.id === R.PUMP1H_VOID_ID); assert.equal(b.history.length, 2); assert.deepEqual(b.history.map(r => r.position), ['LEGACY', 'QK']);
  assert.ok(Math.abs(rc.cashDeltaUsdc - 338.780207) < 1e-5); assert.ok(Math.abs(b.virtual.usdc - (cash0 + rc.cashDeltaUsdc)) < 1e-9);
  assert.ok(Math.abs(R.bookEquityGap(b) - gap0) < 1e-9); assert.equal(rc.historyBefore, 21); assert.equal(rc.historyAfter, 2); assert.equal(rc.rows.length, 19);
});
t('removes only events inside a voided trade life; the open position and its events, and other tokens, stay untouched', () => {
  const st = mkState(), b = st.books.N5, posBefore = JSON.stringify(b.positions), posRef = b.positions[0]; R.applyPump1hVoid(st);
  assert.deepEqual(b.rightRepositionEvents.map(e => e.at), ['2026-11-14T19:00:00.000Z', '2026-11-13T00:30:00.000Z']);
  assert.deepEqual(b.reshapes.map(e => e.name), ['timmy-SOL', 'KEEP-SOL']);
  assert.equal(JSON.stringify(b.positions), posBefore); assert.strictEqual(b.positions[0], posRef);
});
t('receipt keeps full originals + removed events; idempotent (second call = null, nothing changes)', () => {
  const st = mkState(), rc = R.applyPump1hVoid(st); assert.equal(rc.removed.rows.length, 19); assert.equal(rc.removed.rightRepositionEvents.length, 1); assert.equal(rc.removed.reshapes.length, 1);
  assert.ok(rc.rows.every(r => r.pump1hPct > V.maxPump1hPct)); const snapState = JSON.stringify(st); assert.equal(R.applyPump1hVoid(st), null); assert.equal(JSON.stringify(st), snapState);
});
t('none present -> null (fresh dry run); partial / changed baseline / pump not above 15% / closed after cutoff -> refuses and leaves state untouched', () => {
  const none = mkState(); none.books.N5.history = none.books.N5.history.filter(r => !V.rows.some(s => s.position === r.position)); assert.equal(R.applyPump1hVoid(none), null);
  const cases = [s => s.books.N5.history.splice(5, 1), s => { s.books.N5.history[3].pnlUsd += 1; }, s => { s.books.N5.history[4].openContext.snapshot.pump1hPct = 15; },
    s => { s.books.N5.history[6].correction = { id: 'x' }; }];
  for (const mutate of cases) { const st = mkState(); mutate(st); const before = JSON.stringify(st); assert.throws(() => R.applyPump1hVoid(st), /pump1h void/); assert.equal(JSON.stringify(st), before); }
  const late = mkState(); const spec = { ...V, cutoff: '2026-11-14T00:00:00.000Z' }; const before = JSON.stringify(late); assert.throws(() => R.applyPump1hVoid(late, undefined, spec), /closed after/); assert.equal(JSON.stringify(late), before);
});
t('runs through apply() at startup and is reported', async () => {});
(async () => { const st = mkState(); const rc = await R.apply(st); assert.ok(rc && rc.id === R.PUMP1H_VOID_ID); assert.equal(st.books.N5.history.length, 2); console.log(`OK pump1h void: ${n} checks + apply()`); })().catch(e => { console.error(e); process.exit(1); });
