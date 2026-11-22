'use strict';
// LIVE views in the capital asset (operator: with CAPITAL_ASSET=SOL every live number is SOL first, USD small next to it).
// Read-only: derives display fields from the live bot's state.json/status.json/bot.log, never writes them.
const fs = require('fs'), path = require('path');
const num = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null;

// Open LP value per open position: a live entry counts only while its position is still open (status.json keeps the last
// `lives` after a close until the next pointer write -> the closed position's value was double counted in equity).
function pairLives(ps, lives) {
  const L = Array.isArray(lives) ? lives : [], keyed = L.some((l) => l && l.position);
  return (Array.isArray(ps) ? ps : []).map((p, i) => {
    let l = keyed ? L.find((x) => x && x.position === p.position) : (L.length === ps.length ? L[i] : null);
    if (!l) { const v = p.lastValuation || {}; l = num(v.value) != null ? { valueSol: +v.value, feesSol: num(v.fees) || 0, stale: true } : {}; }
    return l || {};
  });
}

const CLOSE = {
  oor_right_take_profit: 'OOR kanan · take profit (profit SOL ≥ ambang)',
  oor_right_take_profit_fallback: 'OOR kanan · take profit (estimasi on-chain)',
  oor_right_reposition_failed_reopen: 'OOR kanan · reposition: buka ulang gagal, posisi ditutup',
  oor_right_reposition_limit: 'OOR kanan · batas reposition tercapai',
  oor_right_reposition_leg: 'OOR kanan · reposition (leg)',
  oor_right_quote_unavailable: 'OOR kanan · quote tidak tersedia',
  oor_left_timeout: 'OOR kiri melewati batas waktu',
  manual_close: 'Ditutup manual',
  emergency_stop: 'Emergency stop',
  trailing_tp_usdc: 'Trailing profit',
};
function closeText(h) {
  const r = String(h.reason || '');
  if (CLOSE[r]) return CLOSE[r];
  let t = ''; try { t = require('../paper-history').closeReason(h); } catch { /* ignore */ }
  return t && t !== 'tidak diketahui' ? t.replace(/ \(aturan lama\)$/, '') : (r || 'closed');
}

// PASS lines of the live scan (bot.log): the screening data that opened an auto position.
let passCache = { key: '', list: [] };
function passEvents(rootDir) {
  const f = path.join(rootDir, 'bot.log');
  let st; try { st = fs.statSync(f); } catch { return []; }
  const key = st.size + ':' + st.mtimeMs; if (passCache.key === key) return passCache.list;
  const list = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) WIB\]\s+PASS (\S+) (\S+) ft30m=([\d.]+)% tvl=\$([\d.]+) age=([\d.]+)h bs=(\d+)(.*)$/);
    if (!m) continue;
    const rest = m[9], g = (re) => { const x = rest.match(re); return x ? +x[1] : null; };
    list.push({ time: Date.parse(`${m[1]}T${m[2]}+07:00`), wib: `${m[1]} ${m[2]} WIB`, name: m[3], prefix: m[4], ft30mPct: +m[5], tvlUsd: +m[6], ageH: +m[7], binStep: +m[8],
      pump1hPct: g(/pump1h=(-?[\d.]+)%/), pump24hPct: g(/pump24h=(-?[\d.]+)%/), insiderPct: g(/insider=([\d.]+)%/), top10Pct: g(/top10=([\d.]+)%/) });
  }
  passCache = { key, list }; return list;
}
const SRC = { scan: 'Auto bot (scan)', manual: 'Manual (Mini App)', reposition: 'Reposition (auto)' };
function openContextOf(h, passes) {
  if (h.openContext && h.openContext.source) return h.openContext;
  const code = h.openSource || 'scan', t = Date.parse(h.openedAt), pool = String(h.pool || '');
  const pass = code === 'scan' ? (passes || []).filter((e) => e.name === h.name && (!pool || pool.startsWith(e.prefix)) && e.time <= t + 1000 && t - e.time <= 15 * 60000).pop() : null;
  const usd = (n) => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n);
  const reason = code === 'manual' ? 'Open manual operator' : code === 'reposition' ? 'OOR kanan: reposition otomatis' :
    pass ? `Lolos semua filter scan ${pass.wib.slice(11, 16)} WIB · fee/TVL 30m ${pass.ft30mPct}% · TVL ${usd(pass.tvlUsd)} · umur ${pass.ageH}j · bin step ${pass.binStep}` :
      `Lolos semua filter scan · TVL ${num(h.tvlUsd) != null ? usd(+h.tvlUsd) : '?'} · bin step ${h.binStep ?? '?'}`;
  return { source: SRC[code] || code, sourceCode: code, reason, derived: true,
    snapshot: { strategy: 'N5', capitalAsset: h.capitalAsset || 'SOL', capitalInSol: h.capitalInSol ?? null, ft30mPct: pass ? pass.ft30mPct : null, tvlUsd: pass ? pass.tvlUsd : num(h.tvlUsd), ageH: pass ? pass.ageH : null,
      binStep: pass ? pass.binStep : num(h.binStep), pump1hPct: pass ? pass.pump1hPct : null, pump24hPct: pass ? pass.pump24hPct : null, insiderPct: pass ? pass.insiderPct : null, quote: h.quoteSymbol || 'SOL', passedAllFilters: code === 'scan' ? true : null, screenedAt: pass ? new Date(pass.time).toISOString() : null } };
}

// SOL result of a live close: the booked capital result (pnlCapital = SOL out - SOL in), USD = that SOL at the close price.
function solResult(h) { const n = num(h.pnlCapital) ?? num(h.netPnlSol) ?? num(h.realizedSol); return n == null ? null : n; }
function enrichRow(h, { passes, solUsd } = {}) {
  const r = { ...h, binShape: undefined };
  r.closeReasonText = closeText(h);
  r.openContext = openContextOf(h, passes);
  if ((h.capitalAsset || 'USDC') === 'SOL') {
    const s = solResult(h), px = num(h.solUsd) || num(solUsd);
    r.pnlSol = s; r.pnlSolPct = num(h.pnlCapitalPct) ?? (s != null && num(h.capitalInSol) ? 100 * s / +h.capitalInSol : null); r.pnlSolUsd = s != null && px ? s * px : null;
    r.feesSolMain = num(h.feesSol); r.displayUnit = 'SOL';
  }
  return r;
}
function enrichRows(history, opts = {}) {
  const passes = opts.rootDir ? passEvents(opts.rootDir) : [];
  return (Array.isArray(history) ? history : []).filter((h) => h && h.closedAt).map((h) => enrichRow(h, { passes, solUsd: opts.solUsd }));
}
// Calendar (live, SOL capital): unit SOL by default and win/loss days by the SOL result.
function solCalendar(cal, history) {
  const sol = (Array.isArray(history) ? history : []).some((h) => h && h.capitalAsset === 'SOL');
  if (!sol || !cal || !cal.days) return cal;
  const O = require('../trade-outcome'), byKey = new Map((history || []).map((h) => [String(h.name) + '|' + h.closedAt, h]));
  for (const d of Object.values(cal.days)) { const t = O.tally(d.rows.map((r) => byKey.get(String(r.name) + '|' + r.closedAt) || { capitalAsset: 'SOL', pnlCapital: r.pnlSol })); d.wins = t.wins; d.losses = t.losses; d.be = t.be; }
  return { ...cal, unit: 'SOL', capitalAsset: 'SOL' };
}
module.exports = { pairLives, closeText, openContextOf, enrichRow, enrichRows, solCalendar, passEvents };
