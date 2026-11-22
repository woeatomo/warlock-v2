'use strict';
// Daily / weekly / monthly PnL over the closed trades (dry run or live). A "day" is 00:00 UTC -> 00:00 UTC = 07:00 WIB -> 07:00 WIB, the same reset as the Mini App PnL calendar.
// Weeks start on Monday 07:00 WIB, months on the 1st at 07:00 WIB. offset 0 = the current (running) period, 1 = the previous one, and so on.
const card = require('./warlock-card');
const binModel = require('./bin-model');
const DAY = 86400e3, WIB = 7 * 3600e3;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayStart = (ms) => Math.floor(ms / DAY) * DAY;

function bounds(kind, offset = 0, now = Date.now()) {
  const o = Math.max(0, offset | 0);
  if (kind === 'week') { const d = new Date(now), dow = (d.getUTCDay() + 6) % 7, start = dayStart(now) - dow * DAY - o * 7 * DAY; return { start, end: start + 7 * DAY }; }
  if (kind === 'month') { const d = new Date(now); return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - o, 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - o + 1, 1) }; }
  const start = dayStart(now) - o * DAY; return { start, end: start + DAY };
}
const wibDate = (ms) => { const d = new Date(ms + WIB); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function title(kind, b) {
  const s = new Date(b.start + WIB), e = new Date(b.end - DAY + WIB);
  if (kind === 'month') return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  if (kind === 'week') return `${s.getUTCDate()} ${s.getUTCMonth() === e.getUTCMonth() ? '' : MON[s.getUTCMonth()] + ' '}– ${e.getUTCDate()} ${MON[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  return wibDate(b.start);
}

function aggregate(closedRows, kind, offset = 0, { solUsd = null, now = Date.now() } = {}) {
  const b = bounds(kind, offset, now);
  const inRange = closedRows.filter((h) => { const t = Date.parse(h.closedAt); return t >= b.start && t < b.end; });
  const items = inRange.map((h) => ({ h, d: card.closedCardData(h, { solUsd }) }));
  let pnlSol = 0, pnlUsd = 0, invested = 0, investedSol = 0, feesSol = 0, wins = 0, losses = 0, be = 0; const O = require('./trade-outcome');
  for (const x of items) { const { d, h } = x; pnlSol += d.pnlSol || 0; pnlUsd += d.pnlUsd || 0; invested += d.investedUsd || 0; investedSol += d.investedSol || 0; feesSol += Number(h.feesSol) || 0;
    x.oc = O.outcome(h); if (x.oc === 'win') wins++; else if (x.oc === 'loss') losses++; else be++; }
  const pick = (cmp) => items.slice().sort(cmp)[0];
  const best = items.length ? pick((x, y) => (y.d.pnlPercent || 0) - (x.d.pnlPercent || 0)) : null;
  const worst = items.length ? pick((x, y) => (x.d.pnlPercent || 0) - (y.d.pnlPercent || 0)) : null;
  // bars: one per day for week/month, one per trade (oldest first, max 14) for a day
  let bars = [];
  if (kind === 'day') bars = items.slice().sort((x, y) => Date.parse(x.h.closedAt) - Date.parse(y.h.closedAt)).slice(-14).map((x, i) => ({ label: String(i + 1), pnl: x.d.pnlSol || 0 }));
  else { const n = Math.round((b.end - b.start) / DAY); for (let i = 0; i < n; i++) { const s = b.start + i * DAY, v = items.filter((x) => { const t = Date.parse(x.h.closedAt); return t >= s && t < s + DAY; }); bars.push({ label: String(new Date(s + WIB).getUTCDate()), pnl: v.reduce((a, x) => a + (x.d.pnlSol || 0), 0) }); } }
  const solN = items.filter((x) => x.h.capitalAsset === 'SOL').length;
  return {
    primary: items.length && solN < items.length / 2 ? 'USDC' : 'SOL',   // the big number is SOL for SOL-capital trades, USDC for USDC-capital ones
    kind, offset, start: b.start, end: b.end, title: title(kind, b), range: `${wibDate(b.start)} 07:00 → ${wibDate(b.end)} 07:00 WIB`,
    trades: items.length, wins, losses, be, winRate: wins + losses ? (100 * wins) / (wins + losses) : null, pnlSol, pnlUsd, pnlPercent: invested > 0 ? (pnlUsd / invested) * 100 : 0, investedUsd: invested,
    investedSol, feesSol, pnlPctSol: investedSol > 0 ? (pnlSol / investedSol) * 100 : null, solUsd: solUsd || null,
    // v2 card: the trades (newest first) and, for week/month, the per-day totals
    rows: items.slice().sort((x, y) => Date.parse(y.h.closedAt) - Date.parse(x.h.closedAt)).map((x) => ({ name: x.d.symbol, base: x.d.base, mint: x.d.mint, pnlSol: x.d.pnlSol, pnlUsd: x.d.pnlUsd, pct: x.d.pnlPercent, outcome: x.oc, closedAtMs: x.d.closedAtMs, sol: x.h.capitalAsset === 'SOL' })),
    days: kind === 'day' ? [] : bars.map((bar, i) => { const s0 = b.start + i * DAY, v = items.filter((x) => { const t = Date.parse(x.h.closedAt); return t >= s0 && t < s0 + DAY; }); return { start: s0, label: bar.label, pnl: bar.pnl, n: v.length, w: v.filter((x) => x.oc === 'win').length, l: v.filter((x) => x.oc === 'loss').length, be: v.filter((x) => x.oc === 'be').length }; }),
    best: best && { name: best.d.symbol, pct: best.d.pnlPercent || 0, binShape: binModel.forCard(best.h) }, worst: worst && { name: worst.d.symbol, pct: worst.d.pnlPercent || 0, binShape: binModel.forCard(worst.h) }, bars,
  };
}
module.exports = { bounds, aggregate, title, wibDate, DAY };
