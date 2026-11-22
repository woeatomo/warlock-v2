'use strict';
// Live dashboard "Total profit" tile: realized + unrealized, % vs net capital.
// No separate deposit ledger is kept, so the capital basis is equity − total profit
// (wallet + open LP value + rent refundable − (realized + unrealized)). That moves
// with the operator's deposits and withdrawals, and does not treat a manual add as profit
// when the add has already been booked as capital.
// Live duration starts at the earliest openedAt in history + open positions
// (first live trade, or the first still-open position if history is empty).

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function earliestOpenedAt(history, positions) {
  let t = null, iso = null;
  for (const row of [].concat(history || [], positions || [])) {
    const raw = row && row.openedAt, ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    if (t == null || ms < t) {
      t = ms;
      iso = typeof raw === 'string' ? raw : new Date(ms).toISOString();
    }
  }
  return iso;
}

function formatLiveAge(sinceIso, now) {
  const t = Date.parse(sinceIso), n = now == null ? Date.now() : +now;
  if (!Number.isFinite(t) || !Number.isFinite(n) || n < t) return '';
  const ms = n - t, hari = Math.floor(ms / 86400000);
  if (hari >= 1) return 'Live ' + hari + ' hari';
  const jam = Math.floor(ms / 3600000);
  if (jam >= 1) return 'Live ' + jam + ' jam';
  const menit = Math.floor(ms / 60000);
  if (menit >= 1) return 'Live ' + menit + ' menit';
  return 'Live baru';
}

function totalProfit(opts) {
  const o = opts || {};
  const profitSol = num(o.realizedSol) + num(o.openPnlSol);
  const sx = num(o.solUsd);
  const usdcSol = sx > 0 ? num(o.walletUsdc) / sx : 0;
  const equitySol = num(o.walletSol) + usdcSol + num(o.openValueSol) + num(o.rentRefundableSol);
  const capitalBasisSol = equitySol - profitSol;
  const totalProfitPct = capitalBasisSol > 1e-9 ? (100 * profitSol) / capitalBasisSol : null;
  const totalProfitUsd = sx > 0 ? profitSol * sx : null;
  const liveSince = earliestOpenedAt(o.history, o.positions);
  return {
    totalProfitSol: profitSol,
    totalProfitPct,
    totalProfitUsd,
    capitalBasisSol,
    equitySol,
    liveSince,
    liveAgeText: formatLiveAge(liveSince, o.now),
  };
}

module.exports = { earliestOpenedAt, formatLiveAge, totalProfit };
