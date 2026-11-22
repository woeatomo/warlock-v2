'use strict';
const assert = require('assert');
const { earliestOpenedAt, formatLiveAge, totalProfit } = require('./live-total-profit');

let n = 0;
const ok = (m) => { n++; console.log('ok', m); };

// equity 14.58036338, realized+unreal 0.378630326362022 → basis 14.201733053637978, +2.666%
{
  const t = totalProfit({
    realizedSol: 0.29236032636202197,
    openPnlSol: 0.08627,
    walletSol: 10.600585957,
    openValueSol: 3.88594,
    rentRefundableSol: 0.09383742299999964,
    solUsd: 69.2,
    history: [{ openedAt: '2026-11-20T07:09:40.008Z' }, { openedAt: '2026-11-20T21:29:56.877Z' }],
    positions: [{ openedAt: '2026-11-20T20:23:06.379Z' }],
    now: Date.parse('2026-11-21T02:37:00.000Z'),
  });
  assert.ok(Math.abs(t.totalProfitSol - 0.378630326362022) < 1e-12, t.totalProfitSol);
  assert.ok(Math.abs(t.equitySol - 14.58036338) < 1e-9, t.equitySol);
  assert.ok(Math.abs(t.capitalBasisSol - (t.equitySol - t.totalProfitSol)) < 1e-12);
  assert.ok(Math.abs(t.totalProfitPct - 100 * t.totalProfitSol / t.capitalBasisSol) < 1e-12);
  assert.ok(Math.abs(t.totalProfitPct - 2.6660853638917708) < 1e-8, t.totalProfitPct);
  assert.ok(Math.abs(t.totalProfitUsd - 0.378630326362022 * 69.2) < 1e-9, t.totalProfitUsd);
  assert.strictEqual(t.liveSince, '2026-11-20T07:09:40.008Z');
  assert.strictEqual(t.liveAgeText, 'Live 19 jam');
  ok('basis = equity − (realized + unrealized); % and USD; live since first history open');
}

{
  const t = totalProfit({ realizedSol: 0.005225823, openPnlSol: 0, walletSol: 6.982175181, solUsd: 72.09 });
  assert.ok(Math.abs(t.capitalBasisSol - (6.982175181 - 0.005225823)) < 1e-12);
  assert.ok(Math.abs(t.totalProfitPct - 0.074901) < 1e-6, t.totalProfitPct);
  ok('flat book: basis = wallet − realized');
}

{
  const t = totalProfit({ realizedSol: 0, openPnlSol: 0, walletSol: 10, openValueSol: 2, rentRefundableSol: 0.05, solUsd: 70 });
  assert.strictEqual(t.totalProfitSol, 0);
  assert.strictEqual(t.totalProfitPct, 0);
  assert.strictEqual(t.capitalBasisSol, 12.05);
  ok('zero profit: 0% on full equity as basis');
}

{
  const t = totalProfit({ realizedSol: -0.2, openPnlSol: -0.1, walletSol: 5, openValueSol: 1.7, rentRefundableSol: 0, solUsd: 80 });
  assert.ok(Math.abs(t.totalProfitSol + 0.3) < 1e-12);
  assert.ok(t.totalProfitPct < 0);
  assert.ok(Math.abs(t.capitalBasisSol - 7) < 1e-12, t.capitalBasisSol); // equity 6.7, minus -0.3 = 7
  ok('loss: red %, basis still equity − profit');
}

{
  const t = totalProfit({ realizedSol: 1, openPnlSol: 0, walletSol: 0, openValueSol: 0, rentRefundableSol: 0, solUsd: 70 });
  assert.strictEqual(t.capitalBasisSol, -1);
  assert.strictEqual(t.totalProfitPct, null);
  ok('basis ≤ 0 → no percent');
}

{
  const t = totalProfit({
    walletSol: 8, walletUsdc: 69.2, solUsd: 69.2, realizedSol: 0.1, openPnlSol: 0, openValueSol: 0, rentRefundableSol: 0,
  });
  assert.ok(Math.abs(t.equitySol - 9) < 1e-12, t.equitySol);
  assert.ok(Math.abs(t.capitalBasisSol - 8.9) < 1e-12, t.capitalBasisSol);
  ok('wallet USDC counts in equity/basis when a SOL price is present');
}

assert.strictEqual(earliestOpenedAt([], [{ openedAt: '2026-11-21T02:16:16.475Z' }]), '2026-11-21T02:16:16.475Z');
assert.strictEqual(earliestOpenedAt([{ openedAt: 'nope' }], []), null);
assert.strictEqual(formatLiveAge('2026-11-17T02:37:00.000Z', Date.parse('2026-11-21T02:37:00.000Z')), 'Live 4 hari');
assert.strictEqual(formatLiveAge('2026-11-20T02:37:00.000Z', Date.parse('2026-11-21T03:40:00.000Z')), 'Live 1 hari');
assert.strictEqual(formatLiveAge('2026-11-21T01:00:00.000Z', Date.parse('2026-11-21T03:40:00.000Z')), 'Live 2 jam');
assert.strictEqual(formatLiveAge('2026-11-21T03:10:00.000Z', Date.parse('2026-11-21T03:40:00.000Z')), 'Live 30 menit');
assert.strictEqual(formatLiveAge('2026-11-21T03:39:30.000Z', Date.parse('2026-11-21T03:40:00.000Z')), 'Live baru');
assert.strictEqual(formatLiveAge(null, Date.now()), '');
ok('age text: hari if ≥1 day, jam if <1 day, menit if <1 hour');

console.log('all', n, 'live total profit tests passed');
