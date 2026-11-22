'use strict';
// Period bounds (day = 07:00 WIB to 07:00 WIB, week from Monday, month from the 1st) and aggregation of closed trades.
const assert = require('assert');
const P = require('./pnl-period');
const WIB = 7 * 3600e3, DAY = 86400e3;
// 2026-11-20 08:30 WIB = 01:30 UTC (a Friday)
const now = Date.UTC(2026, 10, 20, 1, 30);
let b = P.bounds('day', 0, now); assert.strictEqual(b.start, Date.UTC(2026, 10, 20)); assert.strictEqual(b.end - b.start, DAY);
b = P.bounds('day', 1, now); assert.strictEqual(b.start, Date.UTC(2026, 10, 19));
b = P.bounds('week', 0, now); assert.strictEqual(new Date(b.start).getUTCDay(), 1); assert.strictEqual(b.start, Date.UTC(2026, 10, 16)); assert.strictEqual(b.end - b.start, 7 * DAY);
assert.strictEqual(P.bounds('week', 1, now).start, Date.UTC(2026, 10, 9));
b = P.bounds('month', 0, now); assert.strictEqual(b.start, Date.UTC(2026, 10, 1)); assert.strictEqual(b.end, Date.UTC(2026, 11, 1));
assert.strictEqual(P.bounds('month', 1, now).start, Date.UTC(2026, 9, 1)); assert.strictEqual(P.bounds('month', 11, now).start, Date.UTC(2025, 11, 1));
assert.strictEqual(P.title('day', P.bounds('day', 0, now)), '20 Nov 2026'); assert.strictEqual(P.title('month', P.bounds('month', 0, now)), 'November 2026'); assert.ok(/16 – 22 Nov 2026/.test(P.title('week', P.bounds('week', 0, now))));
const row = (day, hour, pct, name) => ({ name, closedAt: new Date(Date.UTC(2026, 10, day, hour)).toISOString(), openedAt: new Date(Date.UTC(2026, 10, day, hour - 1)).toISOString(), capitalAsset: 'SOL', capitalInSol: 1, pnlCapital: pct / 100, pnlCapitalPct: pct, pnlUsd: pct * 0.73, usdcIn: 73, solUsd: 73, holdHours: 1, paper: true, minBinId: 10, maxBinId: 60, entryActiveBin: 50 });
const rows = [row(20, 0, 5, 'A-SOL'), row(20, 1, -2, 'B-SOL'), row(19, 23, 3, 'C-SOL'), row(18, 12, -1, 'D-SOL'), row(1, 5, 4, 'E-SOL'), row(3, 5, 1, 'F-SOL')];
let a = P.aggregate(rows, 'day', 0, { solUsd: 73, now });
assert.strictEqual(a.trades, 2); assert.strictEqual(a.wins, 1); assert.strictEqual(a.losses, 1); assert.ok(Math.abs(a.pnlSol - 0.03) < 1e-9); assert.strictEqual(a.best.name, 'A-SOL'); assert.strictEqual(a.worst.name, 'B-SOL'); assert.strictEqual(a.bars.length, 2);
assert.ok(a.best.binShape && a.best.binShape.approx === true && a.best.binShape.bins.length > 0);   // rows without bins get a rebuilt shape, flagged approx
a = P.aggregate(rows, 'day', 1, { solUsd: 73, now }); assert.strictEqual(a.trades, 1); assert.strictEqual(a.best.name, 'C-SOL');
a = P.aggregate(rows, 'week', 0, { solUsd: 73, now }); assert.strictEqual(a.trades, 4); assert.strictEqual(a.bars.length, 7); assert.ok(Math.abs(a.bars.reduce((s, x) => s + x.pnl, 0) - a.pnlSol) < 1e-9);
a = P.aggregate(rows, 'month', 0, { solUsd: 73, now }); assert.strictEqual(a.trades, 6); assert.strictEqual(a.bars.length, 30);
a = P.aggregate(rows, 'day', 5, { solUsd: 73, now }); assert.strictEqual(a.trades, 0); assert.strictEqual(a.best, null); assert.strictEqual(a.pnlSol, 0);
// bin model: real bins win, a closed row snapshot is used next, otherwise rebuilt from the range
const M = require('./bin-model');
const real = M.forCard({ bins: { 100: { x: 0, y: 2 }, 101: { x: 3, y: 0 } }, lastPrice: 0.5, minBinId: 100, maxBinId: 101, lastActiveBin: 100 });
assert.strictEqual(real.approx, false); assert.deepStrictEqual(real.bins.map((x) => x[0]), [100, 101]); assert.ok(Math.abs(real.bins[1][2] - 1.5) < 1e-9);   // token valued in quote
const snap = M.compactBins({ 7: { x: 2, y: 1 }, 8: { x: 4, y: 0 } }, 0.25); assert.deepStrictEqual(snap, { price: 0.25, bins: [[7, 1, 2], [8, 0, 4]] });
const fromSnap = M.forCard({ binShape: snap, exitPrice: 0.25, lastActiveBin: 7 }); assert.strictEqual(fromSnap.approx, false); assert.strictEqual(fromSnap.bins[1][2], 1);
const sy = M.forCard({ minBinId: 0, maxBinId: 99, entryActiveBin: 40 }); assert.strictEqual(sy.approx, true); assert.ok(sy.bins.length <= 72 && sy.bins.some((x) => x[1] > 0) && sy.bins.some((x) => x[2] > 0));
assert.strictEqual(M.forCard({}), null); assert.strictEqual(M.compactBins({}, 1), null);
console.log('test-pnl-period: OK');
