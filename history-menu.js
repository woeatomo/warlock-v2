'use strict';
// Telegram menus: close history + open positions -> PnL card. Pure reading of the state files (dry run: paper/state.json and archived runs, live: state.json).
// Callback data stays well under Telegram's 64 byte limit:  mn | hs|d|0 | hc|<id> | os|d | oc|<id> | lg|en
const fs = require('fs'), path = require('path');
const card = require('./warlock-card');
const tgFormat = require('./tg-format');
const pnlPeriod = require('./pnl-period');
const { t } = require('./bot-i18n');
const PAGE = 6;
const usd = (n) => (n >= 1 || n === 0 ? n.toFixed(0) : n.toFixed(2));   // whole dollars, 2 digits only under $1
const SRC = { d: 'dry', l: 'live' };
const cache = new Map();   // file -> { mtimeMs, json }

function readJson(file) {
  try {
    const st = fs.statSync(file), c = cache.get(file);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.json;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, json });
    return json;
  } catch { return null; }
}
const booksOf = (s) => Object.values((s && s.books) || {});
const posList = (b) => (Array.isArray(b.positions) ? b.positions : (b.position ? [b.position] : []));
const closedMs = (h) => Date.parse(h.closedAt) || 0;
const tag = (h) => String((h.pool || h.position || h.name || '')).slice(0, 4).replace(/[^A-Za-z0-9]/g, '');
const closedId = (src, h) => `${src}${Math.floor(closedMs(h) / 1000)}${tag(h)}`;
const openId = (src, p) => `${src}${String(p.position || p.pool || p.name || '').slice(0, 12).replace(/[^A-Za-z0-9]/g, '')}`;

function loadTrades(root) {
  const out = { d: { closed: [], open: [] }, l: { closed: [], open: [] } };
  const seen = new Set();
  const addClosed = (src, h) => { if (!h || !closedMs(h)) return; const id = closedId(src, h); if (seen.has(id)) return; seen.add(id); out[src].closed.push({ ...h, __src: SRC[src], __id: id }); };
  const dry = readJson(path.join(root, 'paper', 'state.json'));
  for (const b of booksOf(dry)) { for (const h of b.history || []) addClosed('d', h); for (const p of posList(b)) out.d.open.push({ ...p, __src: 'dry', __id: openId('d', p) }); }
  let runs = []; try { runs = fs.readdirSync(path.join(root, 'paper', 'runs')).filter((x) => /^run-\d+-/.test(x)); } catch { /* none */ }
  for (const r of runs) for (const b of booksOf(readJson(path.join(root, 'paper', 'runs', r, 'state.json')))) for (const h of b.history || []) addClosed('d', h);
  const live = readJson(path.join(root, 'state.json'));
  if (live) { for (const h of live.history || []) addClosed('l', h); const ps = Array.isArray(live.positions) ? live.positions : (live.position ? [live.position] : []); for (const p of ps) out.l.open.push({ ...p, __src: 'live', __id: openId('l', p) }); }
  for (const k of ['d', 'l']) { out[k].closed.sort((a, b) => closedMs(b) - closedMs(a)); out[k].open.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)); }
  return out;
}

const fmtPct = (n) => (n == null || !Number.isFinite(n) ? '–' : (n >= 0 ? '+' : '') + n.toFixed(Math.abs(n) >= 10 ? 1 : 2) + '%');
function holdText(ms) {
  if (!(ms > 0)) return '–';
  const m = Math.round(ms / 60000); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const wibText = (ms) => { const d = new Date(ms + 7 * 3600e3), p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} WIB`; };
const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function mainMenu(lang, { miniAppUrl, src } = {}) {
  const k = src === 'l' ? 'l' : 'd';
  const rows = [];
  if (miniAppUrl) rows.push([{ text: t(lang, 'btn_miniapp'), web_app: { url: miniAppUrl } }]);
  rows.push([{ text: t(lang, 'btn_history'), callback_data: 'hs|' + k + '|0' }, { text: t(lang, 'btn_open'), callback_data: 'os|' + k }]);
  rows.push([{ text: t(lang, 'btn_pnl'), callback_data: 'ps|' + k }]);
  rows.push([{ text: t(lang, 'btn_lang'), callback_data: 'lg|' + (lang === 'en' ? 'id' : 'en') }]);
  return { text: t(lang, 'menu_title'), reply_markup: { inline_keyboard: rows } };
}
function modeRow(lang, prefix, srcKey, extra = '') {
  return [{ text: (srcKey === 'd' ? '• ' : '') + t(lang, 'btn_dry'), callback_data: `${prefix}|d${extra}` }, { text: (srcKey === 'l' ? '• ' : '') + t(lang, 'btn_live'), callback_data: `${prefix}|l${extra}` }];
}

function historyMenu(root, lang, srcKey = 'd', page = 0) {
  const all = loadTrades(root)[srcKey].closed, pages = Math.max(1, Math.ceil(all.length / PAGE)), p = Math.min(Math.max(0, page | 0), pages - 1);
  const mode = t(lang, srcKey === 'd' ? 'mode_dry' : 'mode_live');
  const rows = [modeRow(lang, 'hs', srcKey, '|0')];
  for (const h of all.slice(p * PAGE, p * PAGE + PAGE)) {
    const d = card.closedCardData(h, { lang });
    rows.push([{ text: tgFormat.tradeButton(h, d), callback_data: 'hc|' + h.__id }]);   // ✅ profit · 🔻 loss · ⚪ breakeven, SOL first
  }
  const nav = [];
  if (p > 0) nav.push({ text: t(lang, 'btn_prev'), callback_data: `hs|${srcKey}|${p - 1}` });
  if (p < pages - 1) nav.push({ text: t(lang, 'btn_next'), callback_data: `hs|${srcKey}|${p + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: t(lang, 'btn_menu'), callback_data: 'mn' }]);
  const text = all.length ? `${t(lang, 'history_title', { mode, page: p + 1, pages, n: all.length })}\n${t(lang, 'history_hint')}` : t(lang, 'history_empty', { mode });
  return { text, reply_markup: { inline_keyboard: rows } };
}
function openMenu(root, lang, srcKey = 'd') {
  const all = loadTrades(root)[srcKey].open, mode = t(lang, srcKey === 'd' ? 'mode_dry' : 'mode_live');
  const rows = [modeRow(lang, 'os', srcKey)];
  for (const p of all.slice(0, 10)) { const d = card.openCardData(p, { lang }); rows.push([{ text: `${(d.pnlSol ?? 0) >= 0 ? '🟢' : '🔴'} ${String(p.name || 'POOL').split('-')[0]} ${d.heroAmount} ${d.heroUnit === 'USDC' ? '$' : d.heroUnit} · ${d.pctText}`, callback_data: 'oc|' + p.__id }]); }
  rows.push([{ text: t(lang, 'btn_menu'), callback_data: 'mn' }]);
  const text = all.length ? `${t(lang, 'open_title', { mode, n: all.length })}\n${t(lang, 'open_hint')}` : t(lang, 'open_empty', { mode });
  return { text, reply_markup: { inline_keyboard: rows } };
}

// the card (PNG) + caption for one trade; null when it no longer exists
function findClosed(root, id) { const src = id[0]; return (loadTrades(root)[src] || { closed: [] }).closed.find((h) => h.__id === id) || null; }
function findOpen(root, id) { const src = id[0]; return (loadTrades(root)[src] || { open: [] }).open.find((p) => p.__id === id) || null; }
async function closedCard(root, lang, id, { solUsd = solUsdFromState(root) } = {}) {
  const h = findClosed(root, id); if (!h) return { notFound: true };
  const d = card.closedCardData(h, { solUsd, lang });
  const caption = tgFormat.closedCardHtml(h, d, { lang });   // HTML (sent with parse_mode HTML)
  return { png: await card.render(d), caption, data: d };
}
async function openCard(root, lang, id, { solUsd = solUsdFromState(root) } = {}) {
  const p = findOpen(root, id); if (!p) return { notFound: true };
  const d = card.openCardData(p, { solUsd, lang });
  const caption = tgFormat.openCardHtml(p, d, { lang });
  return { png: await card.render(d), caption, data: d, reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_refresh'), callback_data: 'oc|' + id }, { text: t(lang, 'btn_menu'), callback_data: 'mn' }]] } };
}
function pnlMenu(lang, srcKey = 'd') {
  const mode = t(lang, srcKey === 'l' ? 'mode_live' : 'mode_dry'), s = srcKey === 'l' ? 'l' : 'd';
  const b = (key, kind, off) => ({ text: t(lang, key), callback_data: `pc|${s}|${kind}|${off}` });
  const rows = [modeRow(lang, 'ps', s), [b('btn_today', 'day', 0), b('btn_yesterday', 'day', 1)], [b('btn_thisweek', 'week', 0), b('btn_lastweek', 'week', 1)], [b('btn_thismonth', 'month', 0), b('btn_lastmonth', 'month', 1)], [{ text: t(lang, 'btn_menu'), callback_data: 'mn' }]];
  return { text: t(lang, 'pnl_title', { mode }), reply_markup: { inline_keyboard: rows } };
}
async function periodCard(root, lang, srcKey, kind, offset, { solUsd, now = Date.now(), daily = false } = {}) {
  const s = srcKey === 'l' ? 'l' : 'd', k = ['day', 'week', 'month'].includes(kind) ? kind : 'day', sol = solUsd === undefined ? solUsdFromState(root, s) : solUsd;
  const agg = pnlPeriod.aggregate(loadTrades(root)[s].closed, k, Number(offset) || 0, { solUsd: sol, now });
  const data = card.periodCardData(agg, { lang, paper: s === 'd', now, daily });   // Warlock 2.0 period card (keeps agg's raw figures below)
  Object.assign(data, { agg: undefined, trades: agg.trades, wins: agg.wins, losses: agg.losses, be: agg.be, pnlSol: agg.pnlSol, pnlUsd: agg.pnlUsd, primary: agg.primary });
  const caption = tgFormat.periodHtml(agg, { lang, paper: s === 'd', daily });
  return { png: await card.render(data), caption, data, reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_pnl'), callback_data: 'ps|' + s }, { text: t(lang, 'btn_menu'), callback_data: 'mn' }]] } };
}
function solUsdFromState(root, srcKey = 'd') {
  if (srcKey === 'l') {   // LIVE card: the live bot's own latest SOL price, not the dry run's
    const l = readJson(path.join(root, 'state.json')) || {}, rows = [...(Array.isArray(l.positions) ? l.positions : []), ...(l.position ? [l.position] : []), ...((l.history || []).slice().reverse())];
    for (const r of rows) { const v = Number(r && (r.lastSolUsd ?? r.solUsd ?? r.solUsdEntry)); if (v > 0) return v; }
  }
  const s = readJson(path.join(root, 'paper', 'state.json'));
  for (const b of booksOf(s)) { const v = Number(b && b.virtual && b.virtual.lastCapitalSolUsd); if (v > 0) return v; }
  return null;
}
module.exports = { pnlMenu, periodCard, loadTrades, mainMenu, historyMenu, openMenu, closedCard, openCard, findClosed, findOpen, PAGE, closedId, openId };
