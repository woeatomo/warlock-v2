'use strict';
// Warlock 2.0 PnL cards (see card/). The drawing runs in a CHILD process with an empty environment (no .env, no keys):
// the native `canvas` module never lives inside a process that can see the wallet key. Returns a PNG Buffer, or null when rendering failed.
// *CardData() keep the raw figures (pnl-period / history-menu aggregate them) and add the formatted v2 presentation the card draws.
const { spawn } = require('child_process');
const path = require('path');
const binModel = require('./bin-model');
const O = require('./trade-outcome');
const f = require('./card-format');
const CARD_DIR = path.join(__dirname, 'card');
const num = f.num;

const SHAPE = { 'M-double-bidask': 'Double BidAsk', 'open-mixed': 'Spot + BidAsk', spot: 'Spot', bidask: 'BidAsk', curve: 'Curve' };
const shapeText = (s) => (s ? SHAPE[s] || String(s).replace(/[-_]+/g, ' ') : null);
function closeReasonOf(h) {
  try { const t = require('./miniapp/live-view').closeText(h); if (t && t !== 'closed') return t; } catch { /* fallback */ }
  return String(h.closeReasonText || h.reason || '—').replace(/ \(aturan lama\)$/, '');
}
function sourceOf(h) {
  const c = h.openContext || {}, code = h.openSource || c.sourceCode || 'scan';
  return c.source || { scan: 'Auto bot (scan)', manual: 'Manual (Mini App)', reposition: 'Reposition (auto)' }[code] || code;
}
function metaLine(h, lang) {
  const parts = [sourceOf(h)];
  const st = h.strategySettings && h.strategySettings.STRATEGY || (h.openContext && h.openContext.snapshot && h.openContext.snapshot.strategy) || 'N5';
  parts.push(`${lang === 'en' ? 'strategy' : 'strategi'} ${st}`);
  if (shapeText(h.shape)) parts.push(shapeText(h.shape));
  if (num(h.binStep) != null) parts.push(`bin step ${h.binStep}`);
  const n = num(h.nBins) ?? (num(h.minBinId) != null && num(h.maxBinId) != null ? h.maxBinId - h.minBinId + 1 : null); if (n) parts.push(`${n} bin`);
  return parts.join('  ·  ');
}
const L = (lang, id, en) => (lang === 'en' ? en : id);

// closed trade (a row of state.history, dry run or live)
function closedCardData(row, { solUsd = null, lang = 'id' } = {}) {
  const px = num(row.solUsd) > 0 ? num(row.solUsd) : (num(solUsd) > 0 ? num(solUsd) : null);
  const sol = row.capitalAsset === 'SOL';
  const investedUsd = num(row.initialUsdcIn) ?? num(row.usdcIn);
  const pnlUsdBook = num(row.pnlUsd) ?? num(row.netPnlUsd);
  const pnlSol = sol ? (num(row.pnlCapital) ?? num(row.netPnlSol)) : (px && pnlUsdBook != null ? pnlUsdBook / px : num(row.netPnlSol));
  const investedSol = sol ? (num(row.initialCapitalInSol) ?? num(row.capitalInSol)) : (px && investedUsd != null ? investedUsd / px : null);
  const pct = sol ? (num(row.pnlCapitalPct) ?? num(row.pnlPct)) : (num(row.pnlPct) ?? num(row.netPnlPct));
  const returnedSol = investedSol != null && pnlSol != null ? investedSol + pnlSol : (num(row.solOut) ?? null);
  const closedAtMs = Date.parse(row.closedAt) || Date.now(), openedMs = Date.parse(row.openedAt);
  const holdMs = num(row.holdHours) != null ? num(row.holdHours) * 3.6e6 : (openedMs ? closedAtMs - openedMs : null);
  // SOL capital: the USD figure is the SOL result at the close price (the booked pnlUsd also carries the SOL price move)
  const pnlUsd = sol && pnlSol != null && px ? pnlSol * px : pnlUsdBook;
  const outcome = O.outcome(row), p = f.pair(row.name), feesSol = num(row.feesSol);
  const d = {
    symbol: String(row.name || row.pair || 'POOL'), pnlPercent: pct ?? 0, pnlSol: pnlSol ?? 0, pnlUsd, investedSol: investedSol ?? 0, returnedSol: returnedSol ?? 0,
    investedUsd, returnedUsd: investedUsd != null && pnlUsd != null ? investedUsd + pnlUsd : num(row.usdcOut),
    holdMs, closedAtMs, paper: row.paper === true || row.__src === 'dry', estimate: row.quoted === false, open: false, binShape: binModel.forCard(row),
    // v2 presentation
    v: 2, event: 'close', outcome, base: p.base, quote: p.quote, mint: row.mintX || null, stampMs: closedAtMs, lang,
    statusChip: L(lang, 'DITUTUP', 'CLOSED'),
    heroLabel: sol ? L(lang, 'PNL BERSIH · SOL', 'NET PNL · SOL') : L(lang, 'PNL BERSIH · USDC', 'NET PNL · USDC'),
    heroAmount: sol ? f.sol(pnlSol) : f.usd(pnlUsd).replace('$', ''), heroUnit: sol ? 'SOL' : 'USDC',
    pctText: f.pct(pct), usdText: sol && pnlUsd != null ? `≈ ${f.usd(pnlUsd)}` : (pnlSol != null ? `≈ ${f.sol(pnlSol)} SOL` : ''),
    reason: closeReasonOf(row), meta: metaLine(row, lang),
    beNote: outcome === 'be' ? L(lang, `|PnL| < ${O.BE_PCT}% · tidak dihitung win/loss`, `|PnL| < ${O.BE_PCT}% · not counted as win/loss`) : '',
    tiles: [
      { label: L(lang, 'Modal', 'Invested'), value: sol ? `${f.sol(investedSol, { signed: false })} SOL` : f.usd(investedUsd, { signed: false }), sub: sol && investedUsd != null ? `≈ ${f.usd(investedUsd, { signed: false })} saat entry` : '' },
      { label: L(lang, 'Kembali', 'Returned'), value: sol ? `${f.sol(returnedSol, { signed: false })} SOL` : f.usd(investedUsd != null && pnlUsdBook != null ? investedUsd + pnlUsdBook : num(row.usdcOut), { signed: false }), sub: sol && px && returnedSol != null ? `≈ ${f.usd(returnedSol * px, { signed: false })} @ $${px.toFixed(2)}` : '' },
      { label: L(lang, 'Fee didapat', 'Fees earned'), value: feesSol != null ? `${f.sol(feesSol, { signed: false })} SOL` : '—', sub: feesSol != null && px ? `≈ ${f.usd(feesSol * px, { signed: false })}${num(row.reshapes) ? ` · ${row.reshapes} reshape` : ''}` : '' },
      { label: L(lang, 'Durasi', 'Hold time'), value: f.hold(holdMs, lang), sub: openedMs ? `${f.wib(openedMs, { date: false }).replace(' WIB', '')} → ${f.wib(closedAtMs, { date: false })}` : '' },
    ],
  };
  if (row.note) d.footNote = L(lang, 'angka dikoreksi ke hasil on-chain', 'figures corrected to the on-chain result');
  return d;
}

// ongoing position (an entry of state.positions): the figures are a snapshot of its last monitor poll
function openCardData(pos, { solUsd = null, now = Date.now(), lang = 'id' } = {}) {
  const Lv = pos.lastLive || {}, px = num(solUsd) > 0 ? num(solUsd) : (num(pos.lastSolUsd) > 0 ? num(pos.lastSolUsd) : null);
  const sol = pos.capitalAsset === 'SOL';
  const investedUsd = num(pos.initialUsdcIn) ?? num(pos.usdcIn);
  const pnlUsdBook = num(Lv.pnlUsd);
  const pnlSol = sol ? num(Lv.pnlCapital) : (px && pnlUsdBook != null ? pnlUsdBook / px : null);
  const investedSol = sol ? (num(pos.initialCapitalInSol) ?? num(pos.capitalInSol)) : (px && investedUsd != null ? investedUsd / px : null);
  const pct = sol ? (num(Lv.pnlCapitalPct) ?? num(Lv.pnlPct)) : num(Lv.pnlPct);
  const pnlUsd = sol && pnlSol != null && px ? pnlSol * px : pnlUsdBook;
  const opened = Date.parse(pos.openedAt), p = f.pair(pos.name), valueSol = (investedSol ?? 0) + (pnlSol ?? 0), feesSol = num(pos.lastValuation && pos.lastValuation.fees);
  return {
    symbol: String(pos.name || 'POOL'), pnlPercent: pct ?? 0, pnlSol: pnlSol ?? 0, pnlUsd, investedSol: investedSol ?? 0, returnedSol: valueSol,
    investedUsd, returnedUsd: investedUsd != null && pnlUsd != null ? investedUsd + pnlUsd : null,
    holdMs: opened ? now - opened : null, closedAtMs: now, paper: pos.paper === true || pos.__src === 'dry', estimate: Lv.quoted === false, open: true, binShape: binModel.forCard(pos),
    v: 2, event: 'snapshot', outcome: 'open', heroTone: (pnlSol ?? 0) >= 0 ? 'win' : 'loss', base: p.base, quote: p.quote, mint: pos.mintX || null, stampMs: now, lang,
    statusChip: L(lang, 'OPEN · BELUM REALISASI', 'OPEN · UNREALIZED'),
    heroLabel: sol ? L(lang, 'PNL BERJALAN · SOL', 'UNREALIZED PNL · SOL') : L(lang, 'PNL BERJALAN · USDC', 'UNREALIZED PNL · USDC'),
    heroAmount: sol ? f.sol(pnlSol) : f.usd(pnlUsd).replace('$', ''), heroUnit: sol ? 'SOL' : 'USDC', pctText: f.pct(pct), usdText: sol && pnlUsd != null ? `≈ ${f.usd(pnlUsd)}` : '',
    reason: Lv.quoted === false ? L(lang, 'estimasi (quote belum tersedia)', 'estimate (no quote yet)') : L(lang, 'snapshot poll terakhir', 'last monitor poll'), meta: metaLine(pos, lang),
    tiles: [
      { label: L(lang, 'Modal', 'Invested'), value: sol ? `${f.sol(investedSol, { signed: false })} SOL` : f.usd(investedUsd, { signed: false }), sub: sol && investedUsd != null ? `≈ ${f.usd(investedUsd, { signed: false })} saat entry` : '' },
      { label: L(lang, 'Nilai sekarang', 'Value now'), value: sol ? `${f.sol(valueSol, { signed: false })} SOL` : f.usd(investedUsd != null && pnlUsdBook != null ? investedUsd + pnlUsdBook : null, { signed: false }), sub: sol && px ? `≈ ${f.usd(valueSol * px, { signed: false })} @ $${px.toFixed(2)}` : '' },
      { label: L(lang, 'Fee belum klaim', 'Unclaimed fees'), value: feesSol != null ? `${f.sol(feesSol, { signed: false })} SOL` : '—', sub: num(pos.reshapes) ? `${pos.reshapes} reshape` : '' },
      { label: L(lang, 'Sudah jalan', 'Open for'), value: f.hold(opened ? now - opened : null, lang), sub: opened ? `${L(lang, 'buka', 'opened')} ${f.wib(opened, { date: false })}` : '' },
    ],
  };
}

// open / reposition notifications (live bot): e = the event object telegram-notify receives
function eventCardData(e, kind, { lang = 'id', now = Date.now() } = {}) {
  const p = f.pair(e.name), sol = (e.capitalAsset || (e.openContext && e.openContext.snapshot && e.openContext.snapshot.capitalAsset)) === 'SOL', px = num(e.solUsd);
  const snap = (e.openContext && e.openContext.snapshot) || {}, n = num(e.minBinId) != null && num(e.maxBinId) != null ? e.maxBinId - e.minBinId + 1 : null;
  const base = { v: 2, event: kind, base: p.base, quote: p.quote, mint: e.mintX || null, stampMs: now, lang, paper: e.paper === true, binShape: (e.binShape || e.bins || num(e.minBinId) != null) ? binModel.forCard({ ...e, lastActiveBin: e.activeBin ?? e.lastActiveBin }) : null, meta: metaLine({ ...e, openSource: e.openSource || snap.sourceCode }, lang), symbol: e.name };
  if (kind === 'open') {
    const cap = num(e.capitalInSol) ?? num(snap.capitalInSol) ?? num(e.sizeSol);
    return { ...base, outcome: 'open', statusChip: L(lang, 'POSISI BARU', 'NEW POSITION'), heroLabel: L(lang, 'MODAL MASUK', 'CAPITAL IN'),
      heroAmount: sol ? f.sol(cap, { signed: false }) : f.usd(e.usdcIn, { signed: false }).replace('$', ''), heroUnit: sol ? 'SOL' : 'USDC',
      pctText: '', usdText: num(e.usdcIn) != null ? `≈ ${f.usd(e.usdcIn, { signed: false })} · deposit ${f.sol(e.depositQuote ?? e.sizeSol, { signed: false })} SOL` : '',
      reason: (e.openContext && e.openContext.reason) || L(lang, 'Lolos screening bot', 'Passed bot screening'),
      tiles: [
        { label: 'Range', value: num(e.minBinId) != null ? `${e.minBinId} → ${e.maxBinId}` : '—', sub: [n ? `${n} bin` : null, num(e.binStep) ? `step ${e.binStep}` : null].filter(Boolean).join(' · ') },
        { label: L(lang, 'Harga entry', 'Entry price'), value: `${f.price(e.entryPrice)}`, sub: `SOL / ${p.base}` },
        { label: 'Fee/TVL 30m', value: num(e.ft30m ?? snap.ft30mPct) != null ? `${(+(e.ft30m ?? snap.ft30mPct)).toFixed(2)}%` : '—', sub: `TVL ${f.kusd(e.tvl ?? snap.tvlUsd)}` },
        { label: L(lang, 'Umur pool', 'Pool age'), value: num(snap.ageH) != null ? `${(+snap.ageH).toFixed(1)} ${L(lang, 'jam', 'h')}` : '—', sub: snap.passedAllFilters ? L(lang, 'lolos semua filter', 'passed all filters') : '' },
      ] };
  }
  // reposition (and the failed-reopen alert): the closed leg's result, the old -> new range in bins + market cap, the reopen attempts
  const tone = O.outcome({ capitalAsset: sol ? 'SOL' : 'USDC', pnlCapital: e.pnlCapital, pnlCapitalPct: e.pnlPct, pnlUsd: e.pnlUsd, pnlPct: e.pnlPct });
  const mc = { refPrice: e.refPrice, refBin: e.refBin, binStep: e.binStep, solUsd: e.solUsd, supply: e.supply }, mr = (lo, hi) => f.mcapRange(lo, hi, mc);
  const tries = Array.isArray(e.tries) ? e.tries : [], ok = tries[tries.length - 1] === 'ok';
  const triesTile = { label: L(lang, 'Buka ulang', 'Reopen'), value: !tries.length ? '—' : ok ? (tries.length > 1 ? L(lang, 'OK · coba ke-2', 'OK · 2nd try') : L(lang, 'OK · coba ke-1', 'OK · 1st try')) : L(lang, `GAGAL ${tries.length}×`, `FAILED ${tries.length}×`), sub: !ok && tries.length ? String(tries[tries.length - 1]).slice(0, 60) : (tries.length > 1 ? String(tries[0]).slice(0, 60) : '') };
  const legHero = { heroLabel: L(lang, 'PNL LEG LAMA · SOL', 'CLOSED LEG PNL · SOL'), heroAmount: sol ? f.sol(e.pnlCapital) : f.usd(e.pnlUsd).replace('$', ''), heroUnit: sol ? 'SOL' : 'USDC', pctText: f.pct(e.pnlPct, 3),
    usdText: sol && px && num(e.pnlCapital) != null ? `≈ ${f.usd(e.pnlCapital * px)}` : '' };
  const oldTile = { label: L(lang, 'Range lama', 'Old range'), value: num(e.oldMinBinId) != null ? `${e.oldMinBinId} → ${e.oldMaxBinId}` : '—', sub: mr(e.oldMinBinId, e.oldMaxBinId) ? `MC ${mr(e.oldMinBinId, e.oldMaxBinId)}` : '' };
  if (kind === 'reposition_failed') {
    return { ...base, ...legHero, outcome: 'loss', alert: true, statusChip: L(lang, `REOPEN GAGAL · #${e.number || 1}`, `REOPEN FAILED · #${e.number || 1}`), binShape: null,
      reason: e.reason || 'OOR kanan', beNote: '', footNote: L(lang, 'Leg ditutup, posisi baru tidak terbuka · dicatat sebagai close biasa', 'Leg closed, no new position · booked as a normal close'),
      tiles: [oldTile, triesTile,
        { label: L(lang, 'Di wallet', 'In wallet'), value: sol ? `${f.sol(e.proceedsSol, { signed: false })} SOL` : f.usd(e.proceedsUsdc, { signed: false }), sub: sol && px && num(e.proceedsSol) ? `≈ ${f.usd(e.proceedsSol * px, { signed: false })}` : '' },
        { label: 'Status', value: L(lang, 'Flat', 'Flat'), sub: L(lang, 'cooldown pool 30 menit', '30 min pool cooldown') }] };
  }
  return { ...base, ...legHero, outcome: tone, statusChip: `REPOSITION #${e.number || 1}/2`, reason: e.reason || 'OOR kanan',
    tiles: [oldTile,
      { label: L(lang, 'Range baru', 'New range'), value: num(e.minBinId) != null ? `${e.minBinId} → ${e.maxBinId}` : '—', sub: mr(e.minBinId, e.maxBinId) ? `MC ${mr(e.minBinId, e.maxBinId)}` : (n ? `${n} bin` : '') },
      triesTile,
      { label: 'Active bin', value: num(e.activeBin) != null ? String(e.activeBin) : '—', sub: L(lang, 'PnL lama diteruskan', 'old PnL carried over') },
    ] };
}

// period card (day / week / month) from pnl-period.aggregate(): formatted for card/periodCard.js
const MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function periodTitle(agg, lang) {
  const s = new Date(agg.start + 7 * 3600e3), e = new Date(agg.end - 86400e3 + 7 * 3600e3);
  if (agg.kind === 'month') return `${(lang === 'en' ? MONTH_EN : MONTH_ID)[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  if (agg.kind === 'week') { const a = f.wib(agg.start, { time: false, lang }), b = f.wib(agg.end - 86400e3, { time: false, lang }); return s.getUTCMonth() === e.getUTCMonth() ? `${s.getUTCDate()} – ${b}` : `${a.replace(/ \d{4}$/, '')} – ${b}`; }
  return f.wib(agg.start, { time: false, lang, weekday: true });
}
function periodCardData(agg, { lang = 'id', paper = false, now = Date.now(), daily = false } = {}) {
  const solP = agg.primary !== 'USDC', amount = solP ? agg.pnlSol : agg.pnlUsd, pct = solP ? agg.pnlPctSol : agg.pnlPercent;
  const outcome = !agg.trades ? 'open' : O.outcome(solP ? { capitalAsset: 'SOL', pnlCapital: agg.pnlSol, pnlCapitalPct: agg.pnlPctSol } : { pnlUsd: agg.pnlUsd, pnlPct: agg.pnlPercent });
  const usd = solP ? (agg.solUsd ? agg.pnlSol * agg.solUsd : agg.pnlUsd) : null;
  const K = { day: L(lang, 'HARIAN', 'DAILY'), week: L(lang, 'MINGGUAN', 'WEEKLY'), month: L(lang, 'BULANAN', 'MONTHLY') }[agg.kind] || 'PNL';
  const wl = O.wlText ? O.wlText(agg) : `${agg.wins}W · ${agg.losses}L${agg.be ? ` · ${agg.be} BE` : ''}`;
  return {
    v: 2, cardKind: 'period', kind: agg.kind, paper, lang, stampMs: now, outcome, daily,
    subtitle: `WARLOCK 2.0 · ${daily ? L(lang, 'REKAP 07:00 WIB', '07:00 WIB RECAP') : 'PNL ' + K}`, kindChip: `PNL ${K}`,
    title: periodTitle(agg, lang), range: `${f.wib(agg.start, { lang })} → ${f.wib(agg.end, { lang })}`.replace(/ · /g, ' '),
    heroLabel: solP ? L(lang, 'PNL BERSIH · SOL', 'NET PNL · SOL') : L(lang, 'PNL BERSIH · USDC', 'NET PNL · USDC'),
    heroAmount: agg.trades ? (solP ? f.sol(amount) : f.usd(amount).replace('$', '')) : '0', heroUnit: solP ? 'SOL' : 'USDC',
    pctText: agg.trades && pct != null ? f.pct(pct) : '', usdText: agg.trades ? (usd != null ? `≈ ${f.usd(usd)}` : '') + (solP && agg.investedSol ? `  ·  ${L(lang, 'dari modal', 'on')} ${f.sol(agg.investedSol, { signed: false })} SOL` : '') : L(lang, 'belum ada posisi ditutup', 'no closed positions yet'),
    tiles: [
      { label: 'Trade', value: String(agg.trades), sub: L(lang, 'posisi ditutup', 'positions closed') },
      { label: 'W · L · BE', value: wl, font: 'inter', sub: `BE = |PnL| < ${O.BE_PCT}%` },
      { label: 'Win rate', value: agg.winRate != null ? `${Math.round(agg.winRate)}%` : '—', sub: L(lang, 'tanpa breakeven', 'excl. breakeven') },
      { label: L(lang, 'Fee didapat', 'Fees earned'), value: solP ? `${f.sol(agg.feesSol || 0, { signed: false })} SOL` : '—', sub: solP && agg.solUsd ? `≈ ${f.usd((agg.feesSol || 0) * agg.solUsd, { signed: false })}` : '' },
    ],
    rows: (agg.rows || []).slice(0, 6).map((r) => ({ base: r.base, mint: r.mint, outcome: r.outcome, time: f.wib(r.closedAtMs, { date: agg.kind !== 'day', time: true, lang }).replace(/ \d{4} ·/, ' ·'),
      amount: r.sol ? `${f.sol(r.pnlSol)} SOL` : f.usd(r.pnlUsd), pct: f.pct(r.pct) })), more: Math.max(0, (agg.rows || []).length - 6),
    days: (agg.days || []).map((d) => ({ start: d.start, label: d.label, pnl: d.pnl, n: d.n, text: d.n ? f.sol(d.pnl) : '', wl: d.n ? `${d.w}W ${d.l}L${d.be ? ` ${d.be}BE` : ''}` : '' })),
    dayNames: lang === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
    best: agg.best && agg.trades > 1 ? `${f.pair(agg.best.name).base} ${f.pct(agg.best.pct)}` : '', worst: agg.worst && agg.trades > 1 ? `${f.pair(agg.worst.name).base} ${f.pct(agg.worst.pct)}` : '',
    meta: `${L(lang, 'hari = 07:00 → 07:00 WIB', 'day = 07:00 → 07:00 WIB')}  ·  ${paper ? 'dry run' : 'live'}${solP ? L(lang, '  ·  modal SOL', '  ·  SOL capital') : ''}`,
  };
}

// logo bytes for the card(s); fetched here (parent), never in the render child
async function withLogos(data) {
  try {
    const logo = require('./card-logo');
    if (data.mint && !data.logoB64) data.logoB64 = await logo.logoB64(data.mint);
    if (Array.isArray(data.rows)) await Promise.all(data.rows.slice(0, 8).map(async (r) => { if (r.mint && !r.logoB64) r.logoB64 = await logo.logoB64(r.mint); }));
  } catch { /* initials instead */ }
  return data;
}

function render(data, { timeoutMs = 30000, logos = true } = {}) {
  return (logos ? withLogos(data) : Promise.resolve(data)).then((d) => new Promise((resolve) => {
    let done = false; const out = [];
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let child;
    try { child = spawn(process.execPath, [path.join(CARD_DIR, 'render.js')], { cwd: CARD_DIR, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return finish(null); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(null); }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', (code) => { clearTimeout(timer); const png = Buffer.concat(out); finish(code === 0 && png.length > 1000 && png.slice(1, 4).toString() === 'PNG' ? png : null); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(d));
  }));
}
module.exports = { closedCardData, openCardData, eventCardData, periodCardData, periodTitle, render, withLogos, closeReasonOf, sourceOf, metaLine, shapeText };
