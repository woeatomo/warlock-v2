'use strict';
// Shared number/text formatting for the Warlock 2.0 cards and Telegram messages (SOL first, USD small).
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const MINUS = '−';
// SOL amounts: enough decimals that a small PnL never rounds to 0.01 (DCTY +0.005656, not "+0.01")
function solDp(n) { const a = Math.abs(n); return a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 4 : 6; }
function sol(n, { signed = true, dp = null } = {}) { n = num(n); if (n == null) return '—'; const d = dp ?? solDp(n), s = Math.abs(n).toFixed(d); return (signed ? (n > 0 ? '+' : n < 0 ? MINUS : '±') : n < 0 ? MINUS : '') + s; }
function usd(n, { signed = true, dp = 2 } = {}) { n = num(n); if (n == null) return '—'; const a = Math.abs(n), s = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toFixed(dp); return (signed ? (n > 0 ? '+' : n < 0 ? MINUS : '±') : n < 0 ? MINUS : '') + '$' + s; }
function pct(n, dp = 2) { n = num(n); if (n == null) return '—'; return (n > 0 ? '+' : n < 0 ? MINUS : '±') + Math.abs(n).toFixed(dp) + '%'; }
function kusd(n) { n = num(n); if (n == null) return '—'; const a = Math.abs(n); return '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : a.toFixed(0)); }
function hold(ms, lang = 'id') { ms = num(ms); if (ms == null || ms < 0) return '—'; const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60, H = lang === 'en' ? 'h' : 'j';
  return d ? `${d}d ${h}${H}` : h ? `${h}${H} ${mm}m` : `${mm}m`; }
function price(n) { n = num(n); if (n == null) return '—'; const a = Math.abs(n); return a >= 1 ? n.toFixed(4) : a >= 1e-3 ? n.toPrecision(4) : n.toExponential(3); }
const DAY_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'], DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'], MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function wib(ms, { date = true, time = true, lang = 'id', weekday = false } = {}) { ms = num(ms); if (ms == null) return '—'; const d = new Date(ms + 7 * 3600e3), p = (x) => String(x).padStart(2, '0');
  const ds = `${weekday ? (lang === 'en' ? DAY_EN : DAY_ID)[d.getUTCDay()] + ', ' : ''}${d.getUTCDate()} ${(lang === 'en' ? MON_EN : MON)[d.getUTCMonth()]} ${d.getUTCFullYear()}`, ts = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} WIB`;
  return date && time ? `${ds} · ${ts}` : date ? ds : ts; }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function pair(name) { const [b, q] = String(name || 'POOL').split('-'); return { base: b || 'POOL', quote: q || 'SOL' }; }
// market cap at a DLMM bin: price(bin) = refPrice * (1 + binStep/1e4)^(bin - refBin) [quote per token], * solUsd * supply
function mcapAtBin(bin, { refPrice, refBin, binStep, solUsd, supply } = {}) {
  if ([bin, refPrice, refBin, binStep, solUsd, supply].some((v) => num(v) == null) || !(+supply > 0)) return null;
  return +refPrice * Math.pow(1 + binStep / 1e4, bin - refBin) * +solUsd * +supply;
}
function mcapRange(lo, hi, ctx) { const a = mcapAtBin(lo, ctx), b = mcapAtBin(hi, ctx); return a != null && b != null ? `${kusd(a)} – ${kusd(b)}` : null; }
module.exports = { mcapAtBin, mcapRange, num, sol, usd, pct, kusd, hold, price, wib, esc, pair, MINUS };
