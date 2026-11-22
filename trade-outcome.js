'use strict';
// Win / loss / breakeven of a closed trade (operator 20 Nov, like LP Agent): |PnL %| below 0.1% in the capital token ("receh") is
// breakeven: neither win nor loss and left out of the win rate, but its PnL still counts in every realized total. Display only.
const BE_PCT = 0.1;
const num = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null;
function pctOf(h) {
  if (!h) return null;
  if ((h.capitalAsset || 'USDC') === 'SOL') {
    const p = num(h.pnlCapitalPct) ?? num(h.pnlSolPct); if (p != null) return p;
    const s = num(h.pnlCapital) ?? num(h.netPnlSol) ?? num(h.realizedSol), c = num(h.initialCapitalInSol) ?? num(h.capitalInSol);
    return s != null && c > 0 ? 100 * s / c : null;
  }
  const p = num(h.pnlPct) ?? num(h.netPnlPct); if (p != null) return p;
  const u = num(h.pnlUsd) ?? num(h.netPnlUsd), c = num(h.initialUsdcIn) ?? num(h.usdcIn);
  return u != null && c > 0 ? 100 * u / c : null;
}
function valueOf(h) { return (h && (h.capitalAsset || 'USDC') === 'SOL') ? (num(h.pnlCapital) ?? num(h.netPnlSol) ?? num(h.realizedSol) ?? 0) : (num(h && h.pnlUsd) ?? num(h && h.netPnlUsd) ?? num(h && h.netPnlSol) ?? num(h && h.realizedSol) ?? 0); }
// 'win' | 'loss' | 'be'
function outcome(h, beP = BE_PCT) {
  const p = pctOf(h);
  if (p != null) return Math.abs(p) < beP ? 'be' : p > 0 ? 'win' : 'loss';
  const v = valueOf(h); return v > 0 ? 'win' : v < 0 ? 'loss' : 'be';
}
// win rate = wins / (wins + losses); breakevens are counted apart
function tally(rows) {
  let wins = 0, losses = 0, be = 0;
  for (const h of rows || []) { const o = outcome(h); if (o === 'win') wins++; else if (o === 'loss') losses++; else be++; }
  return { wins, losses, be, trades: wins + losses + be, winRate: wins + losses ? +(100 * wins / (wins + losses)).toFixed(1) : null };
}
const wlText = (t) => `${t.wins}W · ${t.losses}L${t.be ? ' · ' + t.be + ' BE' : ''}`;
module.exports = { BE_PCT, pctOf, outcome, tally, wlText };
