// Token age filter (MIN_TOKEN_AGE_H / MAX_TOKEN_AGE_H): age of the TOKEN (mint), not of the Meteora pool.
// An old token can get a brand-new DLMM pool, so pool age (MIN_AGE_H) alone makes it look new.
// Single source, same as Meridian-OP: Jupiter token data (tokens/v2 search) `createdAt`, falling back to `firstPool.createdAt`.
// Pure helpers, no network. Unknown age fails closed whenever a limit is on.
'use strict';

const toMs = (t) => {
  if (t == null || t === '') return null;
  if (typeof t === 'string' && !/^\d+(\.\d+)?$/.test(t.trim())) { const d = Date.parse(t); return Number.isFinite(d) && d > 0 ? d : null; }
  const n = +t; if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;   // seconds or milliseconds
};

// Creation time (ms) of one Jupiter token object, or null. Both fields are >= the real mint time; the earlier one wins.
function createdAtMs(token) {
  if (!token || typeof token !== 'object') return null;
  const c = [toMs(token.createdAt), toMs(token.firstPool?.createdAt)].filter((x) => x != null);
  return c.length ? Math.min(...c) : null;
}

// entry: cached Jupiter lookup for the mint: { createdAtMs } (found), { createdAtMs: null } (no date), undefined (not fetched / failed).
function estimate(entry, nowMs = Date.now()) {
  const ms = entry?.createdAtMs;
  if (ms == null || !(ms <= nowMs + 5 * 60_000)) return { known: false, ageH: null, createdAtMs: null, source: 'Jupiter', error: entry?.error };
  return { known: true, createdAtMs: ms, ageH: Math.max(0, (nowMs - ms) / 3_600_000), source: 'Jupiter' };
}

const fmt = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' hari' : h.toFixed(1) + ' jam');
const enabled = (minH, maxH) => (+minH || 0) > 0 || (+maxH || 0) > 0;

// minH / maxH <= 0 = that limit is off.
function evaluate(est, minH, maxH = 0) {
  minH = +minH || 0; maxH = +maxH || 0;
  if (!enabled(minH, maxH)) return { ok: true, off: true };
  if (!est || !est.known) return { ok: false, unknown: true, why: 'umur token tidak diketahui (Jupiter' + (est?.error ? ': ' + String(est.error).slice(0, 60) : '') + ')' };
  if (minH > 0 && est.ageH < minH) return { ok: false, ageH: est.ageH, why: `umur token ${fmt(est.ageH)} < min ${minH} jam` };
  if (maxH > 0 && est.ageH > maxH) return { ok: false, ageH: est.ageH, why: `umur token ${fmt(est.ageH)} > maks ${maxH} jam` };
  return { ok: true, ageH: est.ageH };
}

module.exports = { toMs, createdAtMs, estimate, evaluate, enabled, fmt };
