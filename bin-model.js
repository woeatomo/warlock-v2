'use strict';
// Bin shape for the PnL cards. Real bins (open dry-run positions, or the snapshot a close now stores in row.binShape) are used when they exist;
// older closed trades and live positions only kept their range, so their shape is rebuilt from range + active bin + strategy (flagged approx).
const binShape = require('./bin-shape');
const N = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
const MAX_BARS = 72;

// pos.bins ({binId: {x: token, y: quote}}) -> compact snapshot stored on the closed row: { price, bins: [[id, quote, token], ...] }
function compactBins(bins, price) {
  const out = [];
  for (const [k, b] of Object.entries(bins || {})) {
    const id = N(b && b.binId != null ? b.binId : k); if (id == null) continue;
    const y = +b.y || 0, x = +b.x || 0; if (y > 0 || x > 0) out.push([id, +y.toFixed(6), +x.toFixed(4)]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.length ? { price: N(price), bins: out.slice(0, 400) } : null;
}

function synth(row) {
  let lo = N(row.minBinId) ?? N(row.origMinBinId), hi = N(row.maxBinId) ?? N(row.origMaxBinId);
  if (lo == null || hi == null) return null;
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  let active = N(row.lastActiveBin) ?? N(row.entryActiveBin) ?? Math.round((lo + hi) / 2);
  active = Math.max(lo, Math.min(hi, active));
  const bins = [], reshaped = (+row.reshapes || 0) > 0 || /M|reshape/i.test(String(row.shape || ''));
  for (let id = lo; id <= hi; id++) {
    if (id <= active) { const t = (active - id) / Math.max(1, active - lo); bins.push([id, 0.5 + 0.5 * (0.3 + 1.2 * t), 0]); }   // quote side: half spot, half bid-ask (heavier further down)
    else { const t = (id - active) / Math.max(1, hi - active); bins.push([id, 0, (reshaped ? 0.5 : 0.35) + 1.1 * t]); }                // token side: bid-ask, heavier far right
  }
  return { bins, active, approx: true };
}

// -> { bins: [[id, quoteEq, tokenEq], ...], active, approx }  (<= MAX_BARS bars)
function forCard(row) {
  if (!row) return null;
  let out = null;
  const price = N(row.exitPrice) ?? N(row.lastPrice) ?? N(row.entryPrice) ?? 1;
  const real = row.bins && Object.keys(row.bins).length ? binShape.toBinList(row).bins.map((b) => [b.id, b.sol, b.token]) : null;
  const snap = row.binShape && Array.isArray(row.binShape.bins) ? row.binShape.bins : null;
  const active = N(row.lastActiveBin) ?? N(row.activeBin) ?? N(row.entryActiveBin);
  if (real && real.some((b) => b[1] > 0 || b[2] > 0)) out = { bins: real.map((b) => [b[0], b[1], b[2] * price]), active, approx: false };
  else if (snap) out = { bins: snap.map((b) => [b[0], b[1], b[2] * (N(row.binShape.price) ?? price)]), active, approx: false };
  else out = synth(row);
  if (!out || !out.bins.length) return null;
  let bins = out.bins;
  if (bins.length > MAX_BARS) {   // merge neighbours so the card stays readable
    const k = Math.ceil(bins.length / MAX_BARS), merged = [];
    for (let i = 0; i < bins.length; i += k) { const g = bins.slice(i, i + k); merged.push([g[Math.floor(g.length / 2)][0], g.reduce((a, b) => a + b[1], 0), g.reduce((a, b) => a + b[2], 0)]); }
    bins = merged;
  }
  return { bins: bins.map((b) => [b[0], +b[1].toPrecision(5), +b[2].toPrecision(5)]), active: out.active, approx: out.approx };
}
module.exports = { compactBins, forCard, synth };
