'use strict';
// Warlock 2.0 Telegram messages (parse_mode HTML): SOL first, USD small (italic), one idea per line, details folded in an expandable quote.
// Pure functions: no I/O, no secrets. Every value from outside is escaped.
const f = require('./card-format');
const O = require('./trade-outcome');
const { esc, num } = f;
// quote-denominated LP PnL (paper-quote-pnl): only when it has a value, folded with the details
function quoteLines(x) { try { const q = require('./paper-quote-pnl'), t = q.format(x), c = q.solChange(x); return [t && !/belum tersedia|not available/i.test(t) ? `📊 PnL LP (quote) ${esc(t)}` : null, c ? `📉 ${esc(c)}` : null]; } catch { return []; } }
const L = (lang, id, en) => (lang === 'en' ? en : id);
const mode = (paper) => (paper ? '🧪 DRY RUN' : '🔴 LIVE');
const short = (a) => { a = String(a || ''); return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; };
const pairOf = (name) => { const p = f.pair(name); return `${esc(p.base)}/${esc(p.quote)}`; };
const ICON = { win: '✅', loss: '🔻', be: '⚪', open: '🟣' };
const fold = (lines) => { const l = lines.filter(Boolean); return l.length ? `<blockquote expandable>${l.join('\n')}</blockquote>` : ''; };
const join = (lines) => lines.filter((x) => x !== null && x !== undefined && x !== false).join('\n').replace(/\n{3,}/g, '\n\n').trim();

function closeReasonOf(rec) { try { return require('./warlock-card').closeReasonOf(rec); } catch { return String(rec.closeReasonText || rec.reason || '—'); } }
function sourceOf(rec) { try { return require('./warlock-card').metaLine(rec, 'id'); } catch { return ''; } }

// a closed position (normal close or emergency); rec = the history row
function closeHtml(rec = {}, { lang = 'id', paper = false, emergency = false, extra = [] } = {}) {
  const sol = rec.capitalAsset === 'SOL', px = num(rec.solUsd), oc = O.outcome(rec);
  const pnlSol = sol ? (num(rec.pnlCapital) ?? num(rec.netPnlSol)) : null, pct = sol ? (num(rec.pnlCapitalPct) ?? num(rec.pnlPct)) : (num(rec.pnlPct) ?? num(rec.netPnlPct));
  const usd = sol ? (pnlSol != null && px ? pnlSol * px : null) : num(rec.pnlUsd);
  const head = emergency ? `🛑 <b>STOP LOSS · ${pairOf(rec.name)}</b>` : `${ICON[oc]} <b>${{ win: L(lang, 'PROFIT', 'PROFIT'), loss: L(lang, 'RUGI', 'LOSS'), be: 'BREAKEVEN' }[oc]} · ${pairOf(rec.name)}</b>`;
  const opened = Date.parse(rec.openedAt), closed = Date.parse(rec.closedAt), holdMs = num(rec.holdHours) != null ? num(rec.holdHours) * 3.6e6 : (opened && closed ? closed - opened : null);
  const main = sol ? `<b>${f.sol(pnlSol)} SOL</b>  (${f.pct(pct)})${usd != null ? `  <i>≈ ${f.usd(usd)}</i>` : ''}` : `<b>${f.usd(usd)}</b>  (${f.pct(pct)})`;
  const capIn = sol ? (num(rec.initialCapitalInSol) ?? num(rec.capitalInSol)) : null;
  return join([
    `${head}   ${mode(paper)}`,
    main,
    oc === 'be' ? `⚖️ <i>${L(lang, `|PnL| &lt; ${O.BE_PCT}% · dihitung breakeven, bukan win/loss`, `|PnL| &lt; ${O.BE_PCT}% · breakeven, not a win/loss`)}</i>` : null,
    '',
    `🧾 ${esc(closeReasonOf(rec))}`,
    `⏱ ${f.hold(holdMs, lang)}${opened && closed ? `  ·  ${f.wib(opened, { date: false }).replace(' WIB', '')} → ${f.wib(closed, { date: false })}` : ''}`,
    sol ? `💼 ${f.sol(capIn, { signed: false })} → ${f.sol(num(rec.solOut) ?? (capIn != null && pnlSol != null ? capIn + pnlSol : null), { signed: false })} SOL` : (num(rec.usdcIn) != null ? `💼 ${f.usd(rec.usdcIn, { signed: false })} → ${f.usd(rec.usdcOut, { signed: false })}` : null),
    `🌾 Fee ${sol || rec.feesSol != null ? `${f.sol(rec.feesSol ?? rec.feesEarnedSol, { signed: false })} SOL` : f.usd(rec.feesEarnedUsd, { signed: false })}${num(rec.reshapes) ? `  ·  🔄 ${rec.reshapes} reshape` : ''}`,
    `🧭 ${esc(sourceOf(rec))}`,
    rec.note ? `✏️ <i>${L(lang, 'Dikoreksi ke hasil on-chain', 'Corrected to the on-chain result')}</i>` : null,
    fold([
      rec.pool ? `📍 Pool <code>${esc(rec.pool)}</code>` : null,
      num(rec.gasUsedSol) != null ? `⛽ Gas/rent ${f.sol(rec.gasUsedSol, { signed: false })} SOL` : null,
      num(rec.swapCostUsd) != null ? `💸 Swap ${f.usd(rec.swapCostUsd, { signed: false })}` : null,
      ...quoteLines(rec),
      sol && px ? `💱 SOL @ $${px.toFixed(2)}${num(rec.pnlUsd) != null ? ` · ${L(lang, 'nilai USD vs entry', 'USD value vs entry')} ${f.usd(rec.pnlUsd)}` : ''}` : null,
      ...extra.map(esc),
    ]),
  ]);
}
// short caption for the photo when the full text is too long for a caption (1024)
function closeCaption(rec = {}, opts = {}) { const t = closeHtml(rec, opts); return t.length <= 1000 ? t : closeHtml(rec, { ...opts }).replace(/<blockquote expandable>[\s\S]*<\/blockquote>/, '').trim(); }

function openHtml(e = {}, { lang = 'id', paper = false } = {}) {
  const c = e.openContext || {}, s = c.snapshot || {}, sol = (s.capitalAsset || e.capitalAsset) === 'SOL', n = num(e.minBinId) != null && num(e.maxBinId) != null ? e.maxBinId - e.minBinId + 1 : null;
  const cap = num(s.capitalInSol) ?? num(e.capitalInSol);
  return join([
    `🟣 <b>${L(lang, 'POSISI BARU', 'NEW POSITION')} · ${pairOf(e.name)}</b>   ${mode(paper)}`,
    sol ? `💰 <b>${f.sol(cap, { signed: false })} SOL</b> ${L(lang, 'modal', 'capital')}${num(e.usdcIn) != null ? `  <i>≈ ${f.usd(e.usdcIn, { signed: false })}</i>` : ''}` : `💰 <b>${f.usd(e.usdcIn, { signed: false })}</b> ${L(lang, 'modal', 'capital')}`,
    `📐 Range ${e.minBinId ?? '?'} → ${e.maxBinId ?? '?'}${n ? ` · ${n} bin` : ''}${num(s.binStep ?? e.binStep) != null ? ` · step ${s.binStep ?? e.binStep}` : ''}`,
    `💵 Entry ${f.price(e.entryPrice)} ${esc(e.quoteSymbol || 'SOL')}`,
    '',
    `🧭 ${esc(c.source || 'Auto bot (scan)')} · ${L(lang, 'strategi', 'strategy')} ${esc(s.strategy || 'N5')}`,
    `📝 ${esc(c.reason || L(lang, 'Lolos screening bot', 'Passed bot screening'))}`,
    `🔎 fee/TVL 30m ${num(s.ft30mPct ?? e.ft30m) != null ? (+(s.ft30mPct ?? e.ft30m)).toFixed(2) + '%' : '—'} · TVL ${f.kusd(s.tvlUsd ?? e.tvl)}${num(s.ageH) != null ? ` · ${L(lang, 'umur', 'age')} ${(+s.ageH).toFixed(1)} ${L(lang, 'jam', 'h')}` : ''}`,
    fold([
      e.pool ? `📍 Pool <code>${esc(e.pool)}</code>` : null,
      `💧 Deposit ${f.sol(e.depositQuote ?? e.sizeSol, { signed: false })} ${esc(e.quoteSymbol || 'SOL')}${num(e.gasBufferSol) != null ? ` · buffer gas ${f.sol(e.gasBufferSol, { signed: false })} SOL` : ''}`,
      `🏷 MC ${s.marketCapUsd == null ? '—' : f.kusd(s.marketCapUsd)} · quote ${esc(s.quote || e.quoteSymbol || 'SOL')}`,
      `💸 Non-refundable entry ${s.entryCostEstimate && s.entryCostEstimate.known ? `${f.sol(s.entryCostEstimate.nonrefTotalSol, { signed: false })} SOL` : '—'}`,
      ...quoteLines(e),
      `🛡 Filter ${s.passedAllFilters === true ? L(lang, 'lolos semua', 'all passed') : s.passedAllFilters === false ? '⚠ ' + esc((s.failedFilters || []).join('; ')) : '—'}`,
    ]),
  ]);
}

// live / dry-run OOR-right reposition (close leg + reopen): SOL-first leg result, old -> new range in bins and market cap, the reopen attempts
function rangeLine(lo, hi, e) { const m = f.mcapRange(lo, hi, { refPrice: e.refPrice, refBin: e.refBin, binStep: e.binStep, solUsd: e.solUsd, supply: e.supply }); return `${lo ?? '?'} → ${hi ?? '?'}${m ? `  ·  MC ${m}` : ''}`; }
function triesLine(tries = [], lang = 'id') {
  if (!tries.length) return null; const ok = tries[tries.length - 1] === 'ok';
  if (tries.length === 1) return ok ? `✅ ${L(lang, 'Buka ulang berhasil (percobaan 1)', 'Reopened (1st try)')}` : `❌ ${L(lang, 'Buka ulang gagal', 'Reopen failed')}: ${esc(tries[0])}`;
  return ok ? `✅ ${L(lang, 'Buka ulang berhasil di percobaan 2', 'Reopened on the 2nd try')}  <i>(${L(lang, 'pertama', 'first')}: ${esc(tries[0])})</i>` : `❌ ${L(lang, 'Buka ulang gagal 2×', 'Reopen failed twice')}: ${esc(tries[tries.length - 1])}`;
}
function legLine(e, lang) {
  const sol = e.capitalAsset === 'SOL', px = num(e.solUsd);
  return sol ? `${L(lang, 'Leg lama', 'Closed leg')}: <b>${f.sol(e.pnlCapital)} SOL</b>  (${f.pct(e.pnlPct, 3)})${px && num(e.pnlCapital) != null ? `  <i>≈ ${f.usd(e.pnlCapital * px)}</i>` : num(e.pnlUsd) != null ? `  <i>≈ ${f.usd(e.pnlUsd)}</i>` : ''}`
    : `${L(lang, 'Leg lama', 'Closed leg')}: <b>${f.usd(e.pnlUsd)}</b>  (${f.pct(e.pnlPct, 3)})`;
}
function repositionHtml(e = {}, { lang = 'id', paper = false } = {}) {
  const n = num(e.minBinId) != null && num(e.maxBinId) != null ? e.maxBinId - e.minBinId + 1 : null;
  return join([
    `🔁 <b>REPOSITION #${esc(e.number || 1)}/2 · ${pairOf(e.name)}</b>   ${mode(paper)}`,
    legLine(e, lang),
    '',
    `🧾 ${esc(e.reason || 'OOR kanan')}`,
    num(e.oldMinBinId) != null ? `📐 ${L(lang, 'Range lama', 'Old range')} ${rangeLine(e.oldMinBinId, e.oldMaxBinId, e)}` : null,
    `📐 ${L(lang, 'Range baru', 'New range')} ${rangeLine(e.minBinId, e.maxBinId, e)}${n ? ` · ${n} bin` : ''}`,
    `🎯 Active bin ${e.activeBin ?? '?'}`,
    triesLine(e.tries, lang),
    `🧮 <i>${L(lang, 'Swap, gas, rent dihitung · PnL lama diteruskan · batas hold tidak direset', 'Swap, gas, rent booked · old PnL carried over · hold limit not reset')}</i>`,
    fold([e.pool ? `📍 Pool <code>${esc(e.pool)}</code>` : null, e.openContext && e.openContext.source ? `🧭 ${esc(e.openContext.source)} · ${esc(e.openContext.reason || '')}` : null, num(e.supply) ? `🪙 Supply ${(+e.supply).toLocaleString('en-US', { maximumFractionDigits: 0 })} · SOL @ $${num(e.solUsd) ? (+e.solUsd).toFixed(2) : '?'}` : null]),
  ]);
}
// the leg closed but no new position could be opened: the SOL (or USDC) is back in the wallet, booked as a normal close
function repositionFailedHtml(e = {}, { lang = 'id', paper = false } = {}) {
  const sol = e.capitalAsset === 'SOL';
  return join([
    `⚠️ <b>${L(lang, 'REOPEN GAGAL', 'REOPEN FAILED')} · ${pairOf(e.name)}</b>   ${mode(paper)}`,
    `${L(lang, 'Reposition', 'Reposition')} #${esc(e.number || 1)}: ${L(lang, 'leg lama sudah ditutup, posisi baru tidak terbuka.', 'the old leg closed, no new position opened.')}`,
    sol ? `💼 <b>${f.sol(e.proceedsSol, { signed: false })} SOL</b> ${L(lang, 'kembali di wallet', 'back in the wallet')}${num(e.solUsd) && num(e.proceedsSol) ? `  <i>≈ ${f.usd(e.proceedsSol * e.solUsd, { signed: false })}</i>` : ''}` : `💼 <b>${f.usd(e.proceedsUsdc, { signed: false })}</b> ${L(lang, 'kembali di wallet', 'back in the wallet')}`,
    legLine(e, lang),
    '',
    `🧾 ${esc(e.reason || 'OOR kanan')}`,
    num(e.oldMinBinId) != null ? `📐 ${L(lang, 'Range lama', 'Old range')} ${rangeLine(e.oldMinBinId, e.oldMaxBinId, e)}` : null,
    triesLine(e.tries, lang),
    `📒 <i>${L(lang, 'Dicatat sebagai close biasa (history). Tidak ada posisi terbuka di pool ini; bot lanjut scan (cooldown pool 30 menit).', 'Booked as a normal close. No position open on this pool; the bot keeps scanning (30 min pool cooldown).')}</i>`,
    fold([e.pool ? `📍 Pool <code>${esc(e.pool)}</code>` : null]),
  ]);
}

function reshapeHtml(e = {}, { lang = 'id', paper = false } = {}) {
  const q = esc(e.quoteSymbol || 'SOL');
  return join([
    `🔄 <b>RESHAPE #${esc(e.reshapes || e.n || '?')} · ${pairOf(e.name)}</b>   ${mode(paper)}`,
    `<i>${L(lang, 'Harga turun 5 bin: sisi kanan dibentuk ulang', 'Price fell 5 bins: right side rebuilt')}</i>`,
    '',
    `🎯 Active bin ${e.activeBin ?? '?'}  ·  📐 ${L(lang, 'kanan', 'right')} ${e.rightMin ?? '?'} → ${e.rightMax ?? '?'}`,
    `🧩 Token di-add ${num(e.amountX) != null ? (+e.amountX).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}  <i>(withdrawn ${num(e.tokenX) != null ? (+e.tokenX).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'} + fee ${num(e.feeXAdded) != null ? (+e.feeXAdded).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'})</i>`,
    `🌾 Fee ${q} di-compound ${f.sol(e.feeYAdded, { signed: false })} ${q}`,
    fold([e.pool ? `📍 Pool <code>${esc(e.pool)}</code>` : null]),
  ]);
}

// period (calendar card caption / 07:00 recap): agg = pnl-period.aggregate()
function periodHtml(agg, { lang = 'id', paper = false, daily = false } = {}) {
  let title = ''; try { title = require('./warlock-card').periodTitle(agg, lang); } catch { title = agg.title; }
  const solP = agg.primary !== 'USDC', pct = solP ? agg.pnlPctSol : agg.pnlPercent, usd = solP ? (agg.solUsd ? agg.pnlSol * agg.solUsd : agg.pnlUsd) : null;
  const K = { day: L(lang, 'Harian', 'Daily'), week: L(lang, 'Mingguan', 'Weekly'), month: L(lang, 'Bulanan', 'Monthly') }[agg.kind] || '';
  const oc = !agg.trades ? 'open' : O.outcome(solP ? { capitalAsset: 'SOL', pnlCapital: agg.pnlSol, pnlCapitalPct: agg.pnlPctSol } : { pnlUsd: agg.pnlUsd, pnlPct: agg.pnlPercent });
  const head = daily ? `☀️ <b>${L(lang, 'Rekap PnL kemarin', "Yesterday's PnL")} · ${esc(title)}</b>` : `📅 <b>PnL ${K} · ${esc(title)}</b>`;
  if (!agg.trades) return join([`${head}   ${mode(paper)}`, `📭 ${L(lang, 'Belum ada posisi ditutup di periode ini.', 'No closed positions in this period.')}`]);
  const one = (x) => (x ? `${esc(f.pair(x.name).base)} ${f.pct(x.pct)}` : '—');
  return join([
    `${head}   ${mode(paper)}`,
    `${ICON[oc]} <b>${solP ? f.sol(agg.pnlSol) + ' SOL' : f.usd(agg.pnlUsd)}</b>${pct != null ? `  (${f.pct(pct)})` : ''}${usd != null ? `  <i>≈ ${f.usd(usd)}</i>` : ''}`,
    `🔢 ${agg.trades} trade · ${O.wlText(agg)} · win rate ${agg.winRate != null ? Math.round(agg.winRate) + '%' : '—'}`,
    solP && agg.feesSol ? `🌾 Fee ${f.sol(agg.feesSol, { signed: false })} SOL${agg.solUsd ? `  <i>≈ ${f.usd(agg.feesSol * agg.solUsd, { signed: false })}</i>` : ''}` : null,
    agg.trades > 1 ? `🏆 ${one(agg.best)}   ·   🔻 ${one(agg.worst)}` : null,
    agg.be ? `<i>BE = |PnL| &lt; ${O.BE_PCT}%, ${L(lang, 'tidak dihitung win rate', 'excluded from win rate')}</i>` : null,
  ]);
}

// history menu: caption of a closed-trade card / an open-position card
function closedCardHtml(rec, d, { lang = 'id' } = {}) {
  const oc = d.outcome || O.outcome(rec);
  return join([`${ICON[oc]} <b>${pairOf(rec.name)}</b>   ${mode(d.paper)}`, `<b>${d.heroAmount} ${d.heroUnit}</b>  (${d.pctText})${d.usdText ? `  <i>${esc(d.usdText)}</i>` : ''}`,
    `🧾 ${esc(d.reason)}`, `⏱ ${f.hold(d.holdMs, lang)}  ·  ${L(lang, 'ditutup', 'closed')} ${f.wib(d.closedAtMs, { lang })}`]);
}
function openCardHtml(pos, d, { lang = 'id' } = {}) {
  return join([`🟣 <b>${pairOf(pos.name)}</b> · ${L(lang, 'posisi berjalan', 'open position')}   ${mode(d.paper)}`, `<b>${d.heroAmount} ${d.heroUnit}</b>  (${d.pctText})${d.usdText ? `  <i>${esc(d.usdText)}</i>` : ''}`,
    `⏱ ${L(lang, 'sudah jalan', 'open for')} ${f.hold(d.holdMs, lang)}${d.estimate ? `  ·  <i>${L(lang, 'estimasi', 'estimate')}</i>` : ''}`]);
}
// history list button: "✅ DCTY +0.005656 SOL · +0.57%"
function tradeButton(rec, d) { const oc = d.outcome || O.outcome(rec); return `${ICON[oc]} ${f.pair(rec.name).base.slice(0, 9)} ${d.heroAmount} ${d.heroUnit === 'USDC' ? '$' : d.heroUnit} · ${d.pctText}`; }

// 21:00 WIB daily summary (dry run): today's closes with the breakeven rule, SOL first, then the open positions
function dailySummaryHtml(st = {}, { lang = 'id', paper = true } = {}) {
  const a = st.todayAgg || null, solCap = st.capitalAsset === 'SOL', px = num(st.solUsd);
  const today = a && a.trades ? join([
    `${ICON[O.outcome(a.primary !== 'USDC' ? { capitalAsset: 'SOL', pnlCapital: a.pnlSol, pnlCapitalPct: a.pnlPctSol } : { pnlUsd: a.pnlUsd, pnlPct: a.pnlPercent })]} <b>${a.primary !== 'USDC' ? f.sol(a.pnlSol) + ' SOL' : f.usd(a.pnlUsd)}</b>${(a.primary !== 'USDC' ? a.pnlPctSol : a.pnlPercent) != null ? `  (${f.pct(a.primary !== 'USDC' ? a.pnlPctSol : a.pnlPercent)})` : ''}${a.primary !== 'USDC' && a.solUsd ? `  <i>≈ ${f.usd(a.pnlSol * a.solUsd)}</i>` : ''}`,
    `🔢 ${a.trades} trade · ${O.wlText(a)} · win rate ${a.winRate != null ? Math.round(a.winRate) + '%' : '—'}`,
  ]) : `📭 ${L(lang, 'Belum ada posisi ditutup hari ini.', 'No closed positions today.')}`;
  const eq = solCap && num(st.equitySol) != null ? `<b>${f.sol(st.equitySol, { signed: false })} SOL</b>${num(st.equityUsd) != null ? `  <i>≈ ${f.usd(st.equityUsd, { signed: false })}</i>` : ''}` : `<b>${f.usd(st.equityUsd, { signed: false })}</b>`;
  const pos = (st.positions || []).map((p) => { let q = ''; try { const t = require('./paper-quote-pnl').format(p); if (t && !/belum tersedia/i.test(t)) q = ` · PnL LP ${esc(t)}`; } catch { /* none */ } return `• ${esc(f.pair(p.name).base)} <i>[modal ${esc(p.capitalAsset || 'USDC')}]</i>${q}`; });
  return join([
    `🌙 <b>${L(lang, 'Ringkasan harian', 'Daily summary')} · ${f.wib(Date.now(), { time: false, lang, weekday: true })}</b>   ${mode(paper)}`,
    `<i>${L(lang, 'hari ini sejak 07:00 WIB', 'today since 07:00 WIB')}</i>`,
    today,
    '',
    `🏦 Equity ${eq}`,
    solCap ? `💼 ${L(lang, 'Modal bebas', 'Free capital')} ${f.sol(st.freeCapitalSol, { signed: false })} SOL${num(st.pnlTotalSol) != null ? `  ·  ${L(lang, 'total', 'total')} ${f.sol(st.pnlTotalSol)} SOL` : ''}` : `💼 ${L(lang, 'Modal', 'Capital')} ${f.usd(st.virtualUsdc, { signed: false })}  ·  PnL ${f.usd(st.pnlTotalUsd)}`,
    `📌 ${L(lang, 'Posisi', 'Positions')} ${st.openCount || 0}/${st.maxPositions || 5}${pos.length ? '' : ` · ${L(lang, 'tidak ada', 'none')}`}`,
    ...pos,
    st.endsWib ? `🗓 Window ${L(lang, 'sampai', 'until')} ${esc(st.endsWib)}` : null,
    a && a.be ? `<i>BE = |PnL| &lt; ${O.BE_PCT}%, ${L(lang, 'tidak dihitung win rate', 'excluded from win rate')}</i>` : null,
  ]);
}
const stripHtml = (t) => String(t || '').replace(/<\/?(b|i|u|s|code|pre|blockquote)( expandable)?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
module.exports = { closeHtml, closeCaption, openHtml, repositionHtml, repositionFailedHtml, dailySummaryHtml, reshapeHtml, periodHtml, closedCardHtml, openCardHtml, tradeButton, stripHtml, mode };
