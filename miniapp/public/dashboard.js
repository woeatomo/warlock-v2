/* Sol Warlock · Dashboard (front tab). Read-only view; every card navigates to the real bot menu via window.SWApp.go(). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const money = (n, d = 2) => num(n) ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const signed = (n, d = 2) => num(n) ? (+n >= 0 ? '+' : '−') + money(Math.abs(+n), d) : '—';
  const pct = (n, d = 2) => num(n) ? (+n >= 0 ? '+' : '−') + Math.abs(+n).toFixed(d) + '%' : '—';
  // LIVE + modal SOL: SOL is the main number, USD small next to it (the operator's rule).
  const solS = (n, d = 4) => num(n) ? (+n >= 0 ? '+' : '−') + Math.abs(+n).toFixed(d) + ' SOL' : '—';
  const solV = (n, d = 2) => num(n) ? (+n).toFixed(d) + ' SOL' : '—';
  const tone = (n) => num(n) ? (+n > 0 ? 'positive' : +n < 0 ? 'negative' : '') : '';
  // closed row outcome by the capital-token result (SOL rows: pnlSol / pnlSolPct), |PnL%| < 0.1% = breakeven (same rule as W/L/BE)
  const isSolR = (r) => r && r.displayUnit === 'SOL' && num(r.pnlSol);
  const outcomeOf = (r) => { const v = isSolR(r) ? +r.pnlSol : +r.pnlUsd, p = rowPct(r); if (num(p) && Math.abs(+p) < 0.1) return 'be'; return v > 0 ? 'win' : v < 0 ? 'loss' : 'be'; };
  const toneOf = (r) => ({ win: 'positive', loss: 'negative', be: 'be' })[outcomeOf(r)];
  const usdOf = (r) => isSolR(r) ? (num(r.pnlSolUsd) ? +r.pnlSolUsd : null) : (num(r.pnlUsd) ? +r.pnlUsd : null);   // SOL rows: SOL PnL x SOL price at close
  const onOff = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'ON';
  const hhmm = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return '--:--'; return new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }); };
  const dShort = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return '—'; return new Date(t).toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' }); };
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  // In-place DOM patch (same as app.js patchMarkup): only changed text/attributes are touched, so 7 s polls don't rebuild/blink the cards.
  function morphNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    morphChildren(a, b);
  }
  function morphChildren(a, b) {
    const next = Array.from(b.childNodes);
    next.forEach((n, i) => { const cur = a.childNodes[i]; if (cur) morphNode(cur, n); else a.appendChild(n); });
    while (a.childNodes.length > next.length) a.removeChild(a.lastChild);
  }
  const set = (id, html) => {
    const el = $(id); if (!el || el.__html === html) return; el.__html = html;
    if (!el.firstChild) { el.innerHTML = html; return; }
    const t = document.createElement('template'); t.innerHTML = html; morphChildren(el, t.content);
  };
  // Latest scan: screening.json is written a few ms before status.lastScan, so prefer it unless clearly older (same rule as app.js pickScan).
  function pickScan(st, summary) {
    const old = (st.status || {}).lastScan || summary.lastScan || {}, sc = st.screening; if (!sc) return old;
    const a = Date.parse(sc.at), b = Date.parse(old.at || 0); return !Number.isFinite(b) || !Number.isFinite(a) || a >= b - 120000 ? sc : old;
  }
  const app = () => window.SWApp || null;
  const dash = { payload: null, cal: null, calAt: 0, calBusy: false, bubbleI: 0, bubbles: [] };

  function capOf(r) { const c = r && (r.initialUsdcIn != null ? r.initialUsdcIn : r.usdcIn); return num(c) && +c > 0 ? +c : null; }
  function rowPct(r) { if (r && r.displayUnit === 'SOL' && num(r.pnlSolPct)) return +r.pnlSolPct; const c = capOf(r); return num(r && r.pnlUsd) && c ? 100 * (+r.pnlUsd) / c : (num(r && r.pnlCapitalPct) ? +r.pnlCapitalPct : null); }
  function tagOf(r) {
    const a = app(); const g = a && a.closeTag ? a.closeTag(r) : null;
    if (g) return { t: g.t === 'TP EMERGENCY SL+' ? 'SL+' : g.t === 'TP EMERGENCY' ? 'EM TP' : g.t, c: g.c };
    return { t: 'CLOSE', c: '#64748b' };
  }

  function model(p) {
    const st = p.status || {}, summary = st.summary || {}, stats = summary.stats || {}, v = p.values || {}, d = p.dashboard || {};
    const openBox = st.positions_open || {};
    const entries = openBox.positions || (openBox.position ? [{ position: openBox.position, live: openBox.live }] : []);
    const maxPos = num(v.MAX_POSITIONS) ? +v.MAX_POSITIONS : (stats.maxPositions || 5);
    const scan = pickScan(st, summary);
    const deposited = num(stats.totalDepositedUsdc) ? +stats.totalDepositedUsdc : num(st.capital && st.capital.totalDepositedUsdc) ? +st.capital.totalDepositedUsdc : (+stats.virtualStartUsdc || 0);
    let equity = num(stats.equityUsd) ? +stats.equityUsd : null;
    if (window.WarlockLiveWallet && num(window.WarlockLiveEquityUsd)) equity = +window.WarlockLiveEquityUsd;   // LIVE: wallet + LP positions (computed in app.js renderStatus)
    const realized = num(stats.totalNetPnlAllUsd) ? +stats.totalNetPnlAllUsd : num(stats.totalNetPnlUsd) ? +stats.totalNetPnlUsd : null;
    const closed = (summary.closedRecent || []).slice().sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
    const deployed = num(stats.positionValueUsd) ? +stats.positionValueUsd : entries.reduce((n, e) => n + (+((e.live || {}).valueUsd ?? (e.position || {}).usdcIn) || 0), 0);
    const parity = d.parity || null;
    const mode = (d.mode && d.mode.live) || window.WarlockLiveMode === true || (stats.live && st.liveSummary && st.liveSummary.live) ? { label: 'LIVE', live: true } : (d.mode || { label: 'DRY RUN', live: false });
    // LIVE: realized / wins / trades come from the live bot's own history, not the dry run book
    const LS = (window.WarlockLiveWallet && st.liveSummary && st.liveSummary.live) ? st.liveSummary : null;
    if (LS) { stats.wins = LS.wins; stats.losses = LS.losses; stats.tradesAll = LS.trades; stats.be = LS.be || 0; stats.winRate = (LS.wins + LS.losses) ? 100 * LS.wins / (LS.wins + LS.losses) : null; /* breakeven (|PnL%| < 0.1%) left out */ stats.avgNetPnlUsd = LS.trades ? LS.realizedUsd / LS.trades : null; }
    const SOLM = LS && LS.capitalAsset === 'SOL' && num(LS.solUsd) && +LS.solUsd > 0;
    const sol = SOLM ? { px: +LS.solUsd, equity: num(equity) ? equity / +LS.solUsd : null, realized: +LS.realizedSol || 0, realizedUsd: num(LS.realizedSolUsd) ? +LS.realizedSolUsd : (+LS.realizedSol || 0) * +LS.solUsd,
      avg: LS.trades ? (+LS.realizedSol || 0) / LS.trades : null, deployed: (+LS.openValueSol || 0) + (+LS.rentRefundableSol || 0) } : null;
    return {
      sol, st, summary, stats, v, d, entries, maxPos, scan, deposited: LS ? 0 : deposited, equity, realized: LS ? LS.realizedUsd : realized, closed, deployed: LS && LS.solUsd ? (LS.openValueSol + LS.rentRefundableSol) * LS.solUsd : deployed, parity, mode,
      openCount: entries.length, freeCash: num(stats.virtualUsdc) ? +stats.virtualUsdc : (st.capital || {}).virtualUsdc,
      wins: +stats.wins || 0, losses: +stats.losses || 0, be: +stats.be || 0, trades: num(stats.tradesAll) ? +stats.tradesAll : (+stats.trades || 0),
      winRate: num(stats.winRate) ? +stats.winRate : null, avg: num(stats.avgNetPnlUsd) ? +stats.avgNetPnlUsd : null,
      reshapes: num(stats.reshapes) ? +stats.reshapes : 0, equityPct: equity != null && deposited > 0 ? 100 * (equity - deposited) / deposited : null,
      curve: !SOLM && Array.isArray(d.historyCurve) && d.historyCurve.length ? d.historyCurve : closed.slice().reverse().reduce((a, r) => { const prev = a.length ? a[a.length - 1].cum : 0; a.push({ t: r.closedAt, cum: prev + (SOLM && num(r.pnlSol) ? +r.pnlSol : (+r.pnlUsd || 0)) }); return a; }, []),
      activity: st.activity || [],
    };
  }
  function parityPill(par) {
    if (!par || par.debt == null) return { cls: 'warn', text: 'PARITY ?', title: 'Parity check belum tersedia' };
    if (par.debt === 0) return { cls: 'ok', text: 'PARITY OK', title: 'Kode live = logika dry run: 0 perbedaan (parity-check)' };
    return { cls: par.added ? 'bad' : 'warn', text: 'PARITY DEBT ' + par.debt, title: (par.added ? par.added + ' perbedaan BARU · ' : '0 perbedaan baru · ') + par.debt + ' perbedaan live vs dry run yang diketahui (Go Live ditolak sampai 0)' };
  }
  function scanCount(s) { return num(s.fetched) ? +s.fetched : num(s.n) ? +s.n : null; }
  function scanPassed(s) { return num(s.passed) ? +s.passed : Array.isArray(s.candidates) ? s.candidates.length : 0; }
  function ddrop(v) { const x = +v; return num(v) ? (x <= 1 ? x * 100 : x) : null; }

  // What the close does with the tokens, per capital asset (bot.js finishLiveClose / liveCloseSol): SOL capital -> token to SOL (SOL pools only,
  // USDC pools are skipped); USDC capital -> token to USDC + the position's SOL pile to USDC (SOL and USDC pools).
  function swapBackText(asset) {
    return String(asset || 'USDC').toUpperCase() === 'SOL' ? 'Close: token → SOL (pool SOL) · gas buffer tetap di wallet' : 'Close: token → USDC + sisa SOL posisi → USDC (pool SOL & USDC)';
  }
  function renderHero(m) {
    const live = !!m.mode.live, par = parityPill(m.parity);
    const mb = $('dash-mode'); if (mb) { if (mb.textContent !== 'DRY RUN') mb.textContent = 'DRY RUN'; const c = 'dash-pill dry' + (live ? ' hidden' : ' on'); if (mb.className !== c) mb.className = c; } const lb = $('dash-live'); if (lb) { if (lb.textContent !== 'LIVE') lb.textContent = 'LIVE'; { const c = 'dash-pill live' + (live ? ' on' : ''); if (lb.className !== c) lb.className = c; } }
    const pb = $('dash-parity'); if (pb) { if (pb.textContent !== par.text) pb.textContent = par.text; if (pb.className !== 'dash-pill ' + par.cls) pb.className = 'dash-pill ' + par.cls; if (pb.title !== par.title) pb.title = par.title; }
    const sub = $('dash-sub'); if (sub) { const t = 'Meteora DLMM · ' + (m.stats.variant || 'N5') + ' · modal ' + (m.v.CAPITAL_ASSET || m.stats.capitalAsset || 'USDC') + ' · ' + (live ? 'LIVE' : 'Dry run') + ' · sync ' + hhmm(m.summary.updated || m.st.positions_open && m.st.positions_open.updated) + ' WIB'; if (sub.textContent !== t) sub.textContent = t; }
    const kpi = (go, label, value, sub, cls) => `<button type="button" class="dash-kpi" data-go="${go}"><strong class="mono ${cls || ''}">${esc(value)}</strong><span>${esc(label)}</span><small>${esc(sub)}</small></button>`;
    set('dash-kpis',
      kpi('status:open', 'EQUITY', m.sol ? solV(m.sol.equity) : money(m.equity), (m.sol ? '≈ ' + money(m.equity) + ' · ' : '') + (window.WarlockLiveWallet && m.st.liveSummary ? 'wallet ' + (+window.WarlockLiveWallet.sol).toFixed(2) + ' SOL + posisi LP' : pct(m.equityPct) + ' vs modal ' + money(m.deposited, 0)), tone(m.equityPct)) +
      (m.sol ? kpi('status:history', 'REALIZED NET (SOL)', solS(m.sol.realized), '≈ ' + signed(m.sol.realizedUsd) + ' · ' + m.trades + ' trade ditutup', tone(m.sol.realized)) : kpi('status:history', 'REALIZED NET', signed(m.realized), m.trades + ' trade ditutup', tone(m.realized))) +
      kpi('status:history', 'WIN RATE', m.winRate == null ? '—' : m.winRate.toFixed(1) + '%', m.wins + ' menang · ' + m.losses + ' kalah' + (m.be ? ' · ' + m.be + ' BE' : ''), '') +
      kpi('status:history', 'W / L', m.wins + 'W / ' + m.losses + 'L' + (m.be ? ' / ' + m.be + 'BE' : ''), m.trades + ' CLOSED' + (m.be ? ' · BE = |PnL| < 0.1%' : ''), ''));
  }

  function renderModules(m) {
    const v = m.v, s = m.scan || {}, par = parityPill(m.parity);
    const tpArmed = onOff(v.EMERGENCY_TP_ENABLED) || onOff(v.EMERGENCY_SLPLUS_ENABLED) || num(v.TP_USD_PCT);
    const mods = [
      { go: 'status:screening', ic: '◎', c: 'orange', t: 'POOL SCANNER', tag: 'SCAN', k: `${scanCount(s) ?? '—'} pool · ${scanPassed(s)} lolos`, d: 'Baca volume & fee/TVL Meteora DLMM', s: `fee/TVL ≥${v.MIN_FT ?? '—'}% (${v.FT_WINDOW || '30m'}) · bin ≥${v.MIN_BIN_STEP ?? '—'} · ${scanCount(s) ?? '—'} pool · ${scanPassed(s)} lolos`, on: true },
      { go: 'settings:ANTI_PVP_MODE', ic: '⛨', c: 'pink', t: 'RUG & ANTI-PVP', tag: 'FILTER', k: `TO ≤${v.FEE_TURNOVER_MAX_PCT ?? '—'}% · ${v.ANTI_PVP_MODE || '—'}`, d: 'Sticky RugCheck + anti PvP + fee turnover', s: `RugCheck ${onOff(v.RUGCHECK_ENABLED) ? 'ON' : 'OFF'} · PvP ${v.ANTI_PVP_MODE || '—'} · turnover ≤${v.FEE_TURNOVER_MAX_PCT ?? '—'}% · TVL ${money(v.MIN_LIQ_USD, 0)}–${money(v.MAX_LIQ_USD, 0)}${onOff(v.TVL_DROP_FILTER_ENABLED) ? ' · TVL drop ≤' + (v.TVL_DROP_MAX_PCT ?? '—') + '%' : ''}`, on: v.FILTERS_ENABLED !== false },
      { go: 'status:open', ic: '◆', c: 'green', t: 'QUOTE ENTRY', tag: m.openCount ? 'ACTIVE' : 'WAITING', k: `${m.openCount}/${m.maxPos} · ${m.sol ? solV(m.sol.deployed) : money(m.deployed, 0)}`, d: `${+v.UPPER_BUFFER_BINS ? 'Range +' + v.UPPER_BUFFER_BINS + ' bin atas' : 'Quote-only'} −${v.RANGE_DOWN_PCT ?? 50}% · ${v.OPEN_SHAPE === 'MIXED' || v.OPEN_SHAPE == null ? 'Spot:Bid-Ask ' + (v.OPEN_SPOT_PCT ?? 50) + ':' + (100 - (+v.OPEN_SPOT_PCT || 50)) : v.OPEN_SHAPE}`, s: `open ${m.openCount}/${m.maxPos} slot · ${m.sol ? solV(m.sol.deployed, 4) : money(m.deployed)} · upper ${v.UPPER_BUFFER_BINS ?? 0}${+v.UPPER_BUFFER_BINS ? '' : ' (quote-only)'}`, on: m.openCount > 0 },
      { go: 'settings:RESHAPE_N', ic: '⟳', c: 'blue', t: 'RESHAPE & COMPOUND', tag: onOff(v.RESHAPE_ENABLED) ? (v.RESHAPE_N ?? '—') + ' BINS' : 'OFF', k: `${m.reshapes} reshape`, d: 'Auto-recenter & compound fee', s: `${onOff(v.RESHAPE_ENABLED) ? 'tiap ' + (v.RESHAPE_N ?? '—') + ' bin' : 'reshape OFF'}${onOff(v.COMPOUND_ENABLED) ? ' + compound' : ''} · ${m.reshapes} reshape tercatat`, on: onOff(v.RESHAPE_ENABLED) },
      { go: 'settings:EMERGENCY_SLPLUS_ENABLED', ic: '⚑', c: 'violet', t: 'TP SL+ GUARD', tag: tpArmed ? 'ARMED' : 'OFF', k: `TP +${v.TP_USD_PCT ?? '—'}% · SL+ ${onOff(v.EMERGENCY_SLPLUS_ENABLED) ? 'ON' : 'OFF'}`, d: `TP +${v.TP_USD_PCT ?? '—'}% · Emerg TP ${onOff(v.EMERGENCY_TP_ENABLED) ? '+' + (v.EMERGENCY_TP_PCT ?? '—') + '%' : 'OFF'}`, s: `SL+ ${onOff(v.EMERGENCY_SLPLUS_ENABLED) ? 'ON' : 'OFF'} · OOR ≥${v.OOR_RIGHT_MIN_BINS ?? '—'} bin · SL −${ddrop(v.EMERGENCY_DROP) ?? '—'}%`, on: tpArmed },
      { go: 'status:history', ic: '⇄', c: 'slate', t: 'QUOTE SWAP-BACK', tag: par.text.replace('PARITY DEBT', 'DEBT'), k: m.sol ? `${solS(m.sol.avg, 6)}/trade` : `${signed(m.avg)}/trade`, d: swapBackText(v.CAPITAL_ASSET), s: m.sol ? `avg ${solS(m.sol.avg, 6)}/trade · realized ${solS(m.sol.realized, 6)} (≈ ${signed(m.sol.realizedUsd)})` : `avg ${signed(m.avg)}/trade · realized ${signed(m.realized)}`, on: true, warn: par.cls !== 'ok' },
    ];
    set('dash-online', mods.filter(x => x.on).length + ' ONLINE');
    set('dash-modules', mods.map((x, i) => `<div class="dash-mod c-${x.c}${x.on ? ' on' : ''}" role="button" tabindex="0" data-go="${x.go}"><span class="dash-node">${esc(x.ic)}</span><div class="dash-mod-body"><div class="dash-mod-top"><strong>${esc(x.t)}</strong><b class="dash-tag${x.warn ? ' warn' : ''}">${esc(x.tag)}</b></div><p>${esc(x.d)}</p><code>${esc(x.s)}</code><em class="dash-mod-key mono">${esc(x.k)}</em></div><i class="dash-step">${i + 1}</i></div>`).join(''));
  }

  function shapeBars(m) {
    const pos = m.entries[0] && m.entries[0].position;
    const bins = pos && pos.binShape && Array.isArray(pos.binShape.bins) ? pos.binShape.bins : null;
    let vals = [], src = '';
    if (bins && bins.length >= 3) {
      const step = Math.max(1, Math.ceil(bins.length / 22)); const active = pos.binShape.activeBin;
      for (let i = 0; i < bins.length; i += step) { const g = bins.slice(i, i + step); vals.push({ v: g.reduce((n, b) => n + (+b.sol || 0) + (+b.token || 0) * (+pos.lastPrice || +pos.entryPrice || 0), 0), a: g.some(b => b.id === active) }); }
      src = esc(pos.name || 'posisi') + ' · bins live';
    } else {
      const spot = num(m.v.OPEN_SPOT_PCT) ? +m.v.OPEN_SPOT_PCT : 50, n = 18;
      for (let i = 0; i < n; i++) vals.push({ v: spot / n + (100 - spot) * (2 * (n - i) / (n * (n + 1))), a: i === n - 1 });
      src = 'setelan OPEN_SPOT_PCT';
    }
    const max = Math.max(...vals.map(x => x.v), 1e-9);
    return { html: vals.map(x => `<i class="${x.a ? 'act' : ''}" style="height:${Math.max(8, Math.round(100 * x.v / max))}%"></i>`).join(''), src };
  }

  function renderRoute(m) {
    const v = m.v, s = m.scan || {};
    const recent = m.closed.slice(0, 4);
    const pills = recent.map(r => { const g = tagOf(r), p = rowPct(r), u = usdOf(r); return `<button type="button" class="dash-hl ${toneOf(r)}" data-go="status:history"><strong>${esc(r.name || 'Pool')}</strong><b class="mono">${esc(pct(p))}${outcomeOf(r) === 'be' ? ' <i class="be-tag">BE</i>' : ''}</b><small>${esc(g.t)} · ${esc(isSolR(r) ? solS(r.pnlSol, 6) : signed(r.pnlUsd))}</small>${isSolR(r) && u != null ? `<small class="usd">≈ ${esc(signed(u))}</small>` : ''}</button>`; }).join('') || '<div class="dash-empty">Belum ada posisi ditutup.</div>';
    const shape = shapeBars(m);
    const rug = onOff(v.RUGCHECK_ENABLED), slp = onOff(v.EMERGENCY_SLPLUS_ENABLED);
    const node = (n, cls, go, title, sub, body) => `<div class="dash-fnode ${cls}" role="button" tabindex="0" data-go="${go}"><span class="dash-fnum">${n}</span><strong>${esc(title)}</strong><small>${esc(sub)}</small>${body}</div>`;
    const link = (label) => `<div class="dash-link" aria-hidden="true"><span>${esc(label)}</span><i></i></div>`;
    const wins = m.closed.filter(r => outcomeOf(r) === 'win').slice(0, 3);
    set('dash-route-pills', pills);
    set('dash-flow',
      node(1, 'n-scan', 'status:screening', 'POOL FEED', 'Meteora ' + (v.FT_WINDOW || '30m'), `<code>${scanCount(s) ?? '—'} pool · SOL/USDC</code><code>fee/TVL ≥${v.MIN_FT ?? '—'}% · bin ≥${v.MIN_BIN_STEP ?? '—'}</code>`) +
      link('POOL') +
      node(2, 'n-filter', 'status:screening', 'FILTERED', scanPassed(s) + ' lolos scan terakhir', `<code>${rug ? 'RugCheck ✓' : 'RugCheck OFF'} · PvP ${esc(v.ANTI_PVP_MODE || '—')}</code><code>turnover ≤${v.FEE_TURNOVER_MAX_PCT ?? '—'}% · TVL drop ${onOff(v.TVL_DROP_FILTER_ENABLED) ? 'ON' : 'OFF'}</code>`) +
      link('PASS ✓') +
      node(3, 'n-shape', 'status:open', 'ACTIVE SHAPE', `${m.openCount}/${m.maxPos} open · Spot ${v.OPEN_SPOT_PCT ?? 50}:${100 - (+v.OPEN_SPOT_PCT || 50)}`, `<div class="dash-bars">${shape.html}</div><small class="dash-src">${shape.src}</small><span class="dash-chip pulse">${onOff(v.COMPOUND_ENABLED) ? 'COMPOUND' : 'RESHAPE'}</span>`) +
      link(onOff(v.RESHAPE_ENABLED) ? 'N=' + (v.RESHAPE_N ?? '—') : 'EXIT') +
      node(4, 'n-exit', 'settings:TP_USD_PCT', 'TP / SL+ & RESHAPE', m.reshapes + ' reshape', `<code>EMERG +${v.EMERGENCY_TP_PCT ?? '—'}% · SL+ ${slp ? 'ARMED' : 'OFF'}</code><code>OOR ≥${v.OOR_RIGHT_MIN_BINS ?? '—'} BIN · TP +${v.TP_USD_PCT ?? '—'}%</code>`));
    set('dash-output', `<div><span class="k">REALIZED ${esc(v.CAPITAL_ASSET || 'USDC')} OUTPUT · Swap-back locked</span><div class="dash-wins">${wins.map(r => `<b>${esc(r.name || 'Pool')} ${esc(m.sol && num(r.pnlSol) ? solS(r.pnlSol, 6) : signed(r.pnlUsd))}</b>`).join('') || '<b>—</b>'}</div></div><strong class="mono ${tone(m.sol ? m.sol.realized : m.realized)}">${esc(m.sol ? solS(m.sol.realized, 6) : signed(m.realized))}</strong>`);
    const tile = (go, k, val, sub, cls) => `<button type="button" class="dash-tile" data-go="${go}"><span class="k">${esc(k)}</span><strong class="mono ${cls || ''}">${esc(val)}</strong><small>${esc(sub)}</small></button>`;
    set('dash-tiles',
      (window.WarlockLiveWallet && m.st.liveSummary
        ? tile('wallet:key', 'DI WALLET', (+window.WarlockLiveWallet.sol).toFixed(2) + ' SOL', 'saldo bebas wallet asli' + (+window.WarlockLiveWallet.usdc > 0.005 ? ' + ' + (+window.WarlockLiveWallet.usdc).toFixed(2) + ' USDC' : ''))
        : tile('wallet:key', 'FREE CASH', money(m.freeCash), 'saldo bebas ' + (m.mode.live ? 'live' : 'virtual'))) +
      tile('status:open', 'OPEN SLOTS', m.openCount + ' / ' + m.maxPos, (m.sol ? solV(m.sol.deployed, 4) + ' (≈ ' + money(m.sol.deployed * m.sol.px) + ')' : money(m.deployed)) + ' terpasang') +
      tile('status:activity', 'RESHAPES', m.reshapes + ' total', onOff(v.RESHAPE_ENABLED) ? 'tiap ' + (v.RESHAPE_N ?? '—') + ' bin' : 'OFF', 'purple') +
      (m.sol ? tile('status:history', 'AVG TRADE', solS(m.sol.avg, 6), '≈ ' + signed(num(m.sol.avg) ? m.sol.avg * m.sol.px : null) + ' · ' + m.trades + ' trade', tone(m.sol.avg)) : tile('status:history', 'AVG TRADE', signed(m.avg), m.trades + ' trade', tone(m.avg))));
    set('dash-route-badge', 'WARLOCK 2.0 PIPELINE · ' + (m.mode.live ? 'LIVE' : 'DRY RUN'));
  }

  function renderStrategy(m) {
    const v = m.v, par = parityPill(m.parity), spot = num(v.OPEN_SPOT_PCT) ? +v.OPEN_SPOT_PCT : 50;
    const row = (k, val, key) => `<div class="dash-srow" role="button" tabindex="0" data-go="settings:${key}"><span>${esc(k)}</span><b class="mono">${esc(val)}</b></div>`;
    set('dash-strategy-head', `<span>ACTIVE STRATEGY · ${esc((m.stats.variant || 'N5') + ' ' + (m.mode.live ? 'LIVE' : 'DRY RUN'))}</span><b class="dash-pill ${par.cls}" title="${esc(par.title)}">${esc(par.text)}</b>`);
    set('dash-strategy-body',
      row('Entry Mode', +v.UPPER_BUFFER_BINS ? `Two-sided (+${v.UPPER_BUFFER_BINS} upper)` : `Quote-Only (${v.UPPER_BUFFER_BINS ?? 0} upper)`, 'UPPER_BUFFER_BINS') +
      row('Range bawah', '−' + (v.RANGE_DOWN_PCT ?? 50) + '%', 'RANGE_DOWN_PCT') +
      row('Distribution', v.OPEN_SHAPE && v.OPEN_SHAPE !== 'MIXED' ? String(v.OPEN_SHAPE) : `Spot ${spot}% : Bid-Ask ${100 - spot}%`, 'OPEN_SPOT_PCT') +
      row('Reshape Rule', onOff(v.RESHAPE_ENABLED) ? `Every ${v.RESHAPE_N ?? '—'} bins${onOff(v.COMPOUND_ENABLED) ? ' + compound' : ''}` : 'OFF', 'RESHAPE_N') +
      row('OOR Right Guard', `≥${v.OOR_RIGHT_MIN_BINS ?? '—'} bins & ≥${v.OOR_RIGHT_REPOSITION_MIN_PNL_PCT ?? '—'}% / TP +${v.OOR_RIGHT_MIN_PROFIT_PCT ?? '—'}%`, 'OOR_RIGHT_MIN_BINS') +
      row('Slot & modal', `${m.maxPos} slot · ${v.CAPITAL_ASSET || 'USDC'}`, 'MAX_POSITIONS'));
  }

  function renderLog(m) {
    const closes = m.closed.slice(0, 5).map(r => { const g = tagOf(r); return `<div class="dash-ln"><time>${esc(hhmm(r.closedAt))}</time><b style="color:${esc(g.c)}">${esc(g.t)}</b><span>${esc(r.name || 'Pool')}</span><em class="${tone(m.sol && num(r.pnlSol) ? r.pnlSol : r.pnlUsd)}">${esc(pct(rowPct(r)))} (${esc(m.sol && num(r.pnlSol) ? solS(r.pnlSol, 6) : signed(r.pnlUsd))})</em></div>`; }).join('');
    const ev = m.activity.slice(0, 5).map(e => `<div class="dash-ln ev k-${esc(e.kind)}"><time>${esc(String(e.atWib || '').replace(/^\d{4}-\d\d-\d\d /, '').slice(0, 5))}</time><span>${esc(e.text)}</span></div>`).join('');
    set('dash-log-body', (closes || '<div class="dash-ln"><span>Belum ada close.</span></div>') + '<div class="dash-ln sep"><span>— aktivitas bot —</span></div>' + (ev || '<div class="dash-ln"><span>Belum ada event.</span></div>') + '<div class="dash-ln cursor"><span>▍</span></div>');
  }

  function curveSvg(pts) {
    if (!pts || pts.length < 2) return '<div class="dash-empty">Kurva muncul setelah ≥2 trade ditutup.</div>';
    const W = 320, H = 110, P = 6, ys = pts.map(p => +p.cum || 0), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), rng = hi - lo || 1;
    const x = (i) => P + (W - 2 * P) * i / (pts.length - 1), y = (val) => H - P - (H - 2 * P) * (val - lo) / rng;
    const line = ys.map((val, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1)).join(' ');
    const area = line + ` L${x(pts.length - 1).toFixed(1)} ${y(lo).toFixed(1)} L${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`;
    const last = ys[ys.length - 1], zero = y(0).toFixed(1);
    return `<svg class="dash-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Realized equity curve"><defs><linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80" stop-opacity=".35"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></linearGradient></defs><line x1="${P}" x2="${W - P}" y1="${zero}" y2="${zero}" class="zero"/><path d="${area}" fill="url(#dashArea)"/><path d="${line}" class="ln ${last < 0 ? 'neg' : ''}"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5" class="dot"/></svg>`;
  }
  function renderRun(m) {
    const w = m.st.window || {}, start = w.startedWib || m.summary.startedWib || (m.curve[0] && dShort(m.curve[0].t)), end = w.endsWib || m.summary.endsWib;
    const prog = m.deposited > 0 && m.equity != null ? Math.max(4, Math.min(100, 100 * m.equity / (m.deposited * 1.25))) : 0;
    const last3 = m.closed.slice(0, 3).map(r => { const g = tagOf(r); return `<div class="dash-trade"><b style="background:${esc(g.c)}">${esc(g.t)}</b><span>${esc(r.name || 'Pool')} · ${esc(hhmm(r.closedAt))} WIB</span><em class="mono ${tone(m.sol && num(r.pnlSol) ? r.pnlSol : r.pnlUsd)}">${esc(pct(rowPct(r)))} (${esc(m.sol && num(r.pnlSol) ? solS(r.pnlSol, 6) : signed(r.pnlUsd))})</em></div>`; }).join('');
    set('dash-run-head', `<span>${m.mode.live ? 'LIVE RUN' : 'REAL DRY RUN'} · ${esc(String(start || '—').slice(0, 16))} → ${esc(String(end || '—').slice(0, 16))}</span><b class="mono ${tone(m.sol ? m.sol.realized : m.realized)}">${esc(m.sol ? solS(m.sol.realized, 6) : signed(m.realized))} realized</b>`);
    set('dash-run-body', `<div class="dash-prog"><i style="width:${prog.toFixed(1)}%"></i></div><div class="dash-prog-txt"><span class="mono">${(window.WarlockLiveWallet && m.st.liveSummary) ? 'total wallet + posisi LP ' + esc(m.sol ? solV(m.sol.equity, 4) + ' (≈ ' + money(m.equity) + ')' : money(m.equity)) : esc(money(m.deposited)) + ' → ' + esc(money(m.equity)) + ' (' + esc(pct(m.equityPct)) + ')'}</span><b>${m.wins}W / ${m.losses}L${m.be ? ' / ' + m.be + 'BE' : ''} · ${m.winRate == null ? '—' : m.winRate.toFixed(1)}% WR</b></div><div class="dash-curve-box"><div class="dash-curve-head"><span>REALIZED EQUITY CURVE (${m.curve.length} CLOSED TRADES)</span><b class="${tone(m.curve.length ? m.curve[m.curve.length - 1].cum : 0)}">${esc(signed(m.curve.length ? m.curve[m.curve.length - 1].cum : 0))} NET</b></div>${curveSvg(m.curve)}</div>${last3}`);
  }

  function renderCal() {
    const d = dash.cal, now = new Date(), y = now.getUTCFullYear(), mo = now.getUTCMonth(), pre = `${y}-${String(mo + 1).padStart(2, '0')}-`;
    const first = (new Date(Date.UTC(y, mo, 1)).getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), today = now.toISOString().slice(0, 10);
    let tot = 0, trades = 0, cells = '';
    for (let i = 0; i < first; i++) cells += '<i class="pad"></i>';
    for (let day = 1; day <= dim; day++) {
      const k = pre + String(day).padStart(2, '0'), x = d && d.days ? d.days[k] : null; let cls = 'dash-cd';
      const pv = (x) => d && d.unit === 'SOL' ? (+x.pnlSol || 0) : (+x.pnl || 0), fm = (n) => d && d.unit === 'SOL' ? solS(n, 4) : signed(n);
      if (x) { tot += pv(x); trades += +x.trades || 0; cls += pv(x) > 0 ? ' pos' : pv(x) < 0 ? ' neg' : ' flat'; }
      if (k === today) cls += ' today';
      cells += `<button type="button" class="${cls}" data-go="wallet:pnlcal:${k}" title="${esc(x ? fm(pv(x)) + ' · ' + x.trades + ' trade' : 'Tidak ada trade')}">${day}${x ? `<small>${esc(d.unit === 'SOL' ? (pv(x) >= 0 ? '+' : '−') + Math.abs(pv(x)).toFixed(3) : (+x.pnl >= 0 ? '+' : '−') + Math.abs(+x.pnl).toFixed(Math.abs(+x.pnl) >= 100 ? 0 : 1))}</small>` : ''}</button>`;
    }
    set('dash-cal', `<div class="dash-cal-head" role="button" tabindex="0" data-go="wallet:pnlcal"><span>📅 PNL CALENDAR · ${esc(MONTHS[mo].toUpperCase())} ${y}</span><b class="mono ${tone(tot)}">${d ? esc(d.unit === 'SOL' ? solS(tot, 6) : signed(tot)) : '…'}</b></div><div class="dash-cal-sub">${d ? trades + ' trade bulan ini · ' + esc((d.mode && d.mode.label) || 'DRY RUN') : 'Memuat…'} · reset 07:00 WIB</div><div class="dash-cal-grid dash-cal-wk">${['S', 'S', 'R', 'K', 'J', 'S', 'M'].map(w => `<i>${w}</i>`).join('')}</div><div class="dash-cal-grid">${cells}</div>`);
  }
  async function loadCal(force) {
    const a = app(); if (!a || !a.api || dash.calBusy) return;
    if (!force && dash.cal && Date.now() - dash.calAt < 60000) return;
    dash.calBusy = true;
    try { const r = await a.api('GET', '/api/pnl-calendar'); if (r.status === 200 && r.json && r.json.ok) { dash.cal = r.json; dash.calAt = Date.now(); } } catch (e) { /* keep last */ }
    dash.calBusy = false; renderCal();
  }

  function renderChar(m) {
    const par = parityPill(m.parity), s = m.scan || {};
    dash.bubbles = [
      `Monitoring ${m.stats.variant || 'N5'}…`,
      `${m.openCount}/${m.maxPos} open · ${m.sol ? solV(m.sol.deployed) : money(m.deployed, 0)}`,
      par.text === 'PARITY OK' ? 'Parity OK' : par.text.replace('PARITY DEBT', 'Parity debt'),
      `Last scan: ${scanCount(s) ?? '—'} pools · ${hhmm(s.at)} WIB`,
      `Realized ${m.sol ? solS(m.sol.realized, 6) : signed(m.realized)}`,
    ];
    const b = $('dash-bubble'); if (b && !b.textContent) b.textContent = dash.bubbles[0];
  }
  setInterval(() => { const b = $('dash-bubble'); if (!b || !dash.bubbles.length) return; dash.bubbleI = (dash.bubbleI + 1) % dash.bubbles.length; b.classList.remove('swap'); void b.offsetWidth; b.textContent = dash.bubbles[dash.bubbleI]; b.classList.add('swap'); }, 3500);

  function render(payload) {
    if (!payload) return; dash.payload = payload;
    const m = model(payload);
    renderHero(m); renderModules(m); renderRoute(m); renderStrategy(m); renderLog(m); renderRun(m); renderChar(m); renderCal();
    const panel = $('panel-dashboard'); if (panel && !panel.classList.contains('hidden')) loadCal(false);
  }
  // ---- ONE view only (operator 18 Nov): the long dashboard that scrolls down. The old '1 Page' mode (height locked to the screen, boxes clipped) is gone.
  function getMode() { return 'detail'; }
  function setMode() { document.body.classList.remove('dash-compact'); return 'detail'; }
  setMode();
  try { localStorage.removeItem('sw_dash_mode'); } catch (e) { /* private mode */ }

  function go(target) { const a = app(); if (a && a.go) a.go(target); }
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('#panel-dashboard [data-go]'); if (!t) return; e.preventDefault(); go(t.dataset.go); });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const t = e.target.closest && e.target.closest('#panel-dashboard [role="button"][data-go]'); if (!t) return; e.preventDefault(); go(t.dataset.go); });
  setInterval(() => { const p = $('panel-dashboard'); if (p && !p.classList.contains('hidden') && !document.hidden) loadCal(false); }, 60000);
  window.SWDash = { render, loadCal, model, parityPill, curveSvg, setMode, getMode };
})();
