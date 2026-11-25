// Token age filter (MIN_TOKEN_AGE_H): age of the TOKEN (mint), not of the Meteora pool.
// An old token can get a brand-new DLMM pool, so pool age (MIN_AGE_H) alone lets it through as "new" and vice versa.
// Pure helpers, no network. The token's creation time is estimated as the EARLIEST timestamp seen across:
//   - RugCheck report `detectedAt` (first time RugCheck saw the mint)
//   - every Meteora pool of this mint in the current scan (`created_at`)
//   - every DexScreener pair of this mint (`pairCreatedAt`)
// Every source is >= the real mint time, so the estimate never makes a token look OLDER than it is:
// a too-young token can never pass the minimum. Unknown age (no source) fails closed.
'use strict';

const toMs = (t) => {
  if (t == null || t === '') return null;
  if (typeof t === 'string' && !/^\d+(\.\d+)?$/.test(t.trim())) { const d = Date.parse(t); return Number.isFinite(d) && d > 0 ? d : null; }
  const n = +t; if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;   // seconds or milliseconds
};

// mint: token mint; report: RugCheck report (or null/{error}); pools: Meteora pools; pairs: DexScreener pairs.
function estimate({ mint, report = null, pools = [], pairs = [], nowMs = Date.now() } = {}) {
  const cands = [];
  const add = (ms, source) => { if (ms != null && ms <= nowMs + 5 * 60_000) cands.push({ ms, source }); };
  if (report && !report.error && (!report.mint || !mint || report.mint === mint)) add(toMs(report.detectedAt), 'RugCheck');
  for (const p of pools || []) if (p && (!mint || p.token_x?.address === mint)) add(toMs(p.created_at), 'Meteora');
  for (const x of pairs || []) {
    if (!x || (x.chainId && x.chainId !== 'solana')) continue;
    if (mint && x.baseToken?.address !== mint && x.quoteToken?.address !== mint) continue;
    add(toMs(x.pairCreatedAt), 'DexScreener');
  }
  if (!cands.length) return { known: false, ageH: null, createdAtMs: null, source: null };
  cands.sort((a, b) => a.ms - b.ms);
  const first = cands[0];
  return { known: true, createdAtMs: first.ms, ageH: Math.max(0, (nowMs - first.ms) / 3_600_000), source: first.source };
}

const fmt = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' hari' : h.toFixed(1) + ' jam');

// minH <= 0 disables the filter.
function evaluate(est, minH) {
  minH = +minH || 0;
  if (!(minH > 0)) return { ok: true, off: true };
  if (!est || !est.known) return { ok: false, unknown: true, why: 'umur token tidak diketahui' };
  if (est.ageH < minH) return { ok: false, ageH: est.ageH, why: `umur token ${fmt(est.ageH)} < min ${minH} jam (${est.source})` };
  return { ok: true, ageH: est.ageH, source: est.source };
}

module.exports = { toMs, estimate, evaluate, fmt };
