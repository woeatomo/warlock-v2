'use strict';
// Dashboard front tab: structure, default tab, PnL Calendar above the character, /char-avatar.png + /dashboard.js routes,
// /api/status dashboard block (non-secret), real-data rendering and navigation wiring to the real bot menus.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const pub = path.join(__dirname, 'miniapp/public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const dashjs = fs.readFileSync(path.join(pub, 'dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'app.css'), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok', m); };

// ---- static structure ----
assert(/data-tab="dashboard" class="tab active"/.test(html), 'Dashboard must be the active first tab');
const tabs = [...html.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]); assert.deepStrictEqual(tabs, ['dashboard', 'status', 'settings', 'wallet']);
assert(/id="panel-status" class="panel hidden"/.test(html), 'Status panel hidden by default');
assert(html.indexOf('id="panel-dashboard"') < html.indexOf('id="panel-status"'));
assert(html.indexOf('id="dash-cal"') > 0, 'PnL Calendar present');
assert(!html.includes('id="dash-char"') && !html.includes('dash-bubble') && !html.includes('@SolWarlock'), 'character card, bubble and @SolWarlock handle are gone from the home');
assert(html.indexOf('id="credit"') > html.indexOf('id="panel-dashboard"') && html.indexOf('id="credit"') < html.indexOf('id="panel-status"'), 'credit sits in the Home panel only'); assert(html.includes('id="dash-live"') && html.includes('data-go="wallet:live"'), 'Home has an explicit Live button (opens Wallet > Live)'); assert(html.includes('id="credit"') && html.includes('href="https://x.com/SickNatureLimit"') && html.includes('href="https://t.me/SicknatureEcosystem"') && html.includes('@SickNatureLimit'), 'credit with X and Telegram links');
assert(!/<a [^>]*href="https:\/\/(x\.com|t\.me)[^>]*>/.test(html.replace(/<a [^>]*target="_blank" rel="noopener noreferrer"[^>]*>/g, '')), 'external links open with noopener');
assert(html.indexOf('/dashboard.js') < html.indexOf('/app.js'), 'dashboard.js loads before app.js');
assert(fs.statSync(path.join(pub, 'char-avatar.png')).size > 1000 && fs.statSync(path.join(pub, 'char-avatar.png')).size < 600000, 'avatar optimized');
assert(/body\.dash-wide\{max-width:1040px\}/.test(css) && /@media \(min-width:860px\)/.test(css) && /@media \(max-width:490px\)/.test(css), 'responsive rules');
assert(!/#fff(?:fff)?\s*;?\s*}?\s*$/m.test('') && !/\.dash-hero\{[^}]*background:#fff/.test(css), 'no white dashboard background');
for (const bad of ['TELEGRAM_BOT_TOKEN', 'PRIVATE_KEY', 'trycloudflare', '1000000001']) { assert(!html.includes(bad) && !dashjs.includes(bad), 'leak ' + bad); }
assert(/<body class="dash-wide">/.test(html) && !/dash-compact/.test(html), 'single scrolling dashboard at load (no 1 Page mode)');
assert(!/dash-viewmode|data-dash-mode/.test(html), 'no 1 Page | Detail toggle');
assert(/SATU tampilan, scroll ke bawah/.test(css) && /body\.dash-wide\{width:100%;height:auto;min-height:100vh;display:block\}/.test(css), 'dashboard height is auto (scrolls) and the layout is width-safe');
assert(/html,body\{overflow-x:hidden\}/.test(css) && /\.dash-head\{flex-wrap:wrap/.test(css), 'no horizontal overflow');
assert(dashjs.includes("'sw_dash_mode'"), 'localStorage key');
ok('static: Dashboard default tab, order Dashboard|Status|Settings|Wallet, no character card, credit links, responsive css, no secrets');

// ---- jsdom render + navigation ----
const now = new Date(), iso = (h) => new Date(now.getTime() - h * 3600e3).toISOString(), today = now.toISOString().slice(0, 10);
const closed = [
  { name: 'FOOD-SOL', closedAt: iso(1), openedAt: iso(2), pnlUsd: 6.24, usdcIn: 499.9, reason: 'oor_right_take_profit' },
  { name: 'X-SOL', closedAt: iso(3), openedAt: iso(5), pnlUsd: -9.5, usdcIn: 500, reason: 'emergency_stop SL -20%' },
  { name: 'HOLD-SOL', closedAt: iso(4), openedAt: iso(6), pnlUsd: 23.5, usdcIn: 500, reason: 'emergency_tp +10%' },
];
const values = { MAX_POSITIONS: 10, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_BIN_STEP: 80, ANTI_PVP_MODE: 'KEEP_BIGGEST', FEE_TURNOVER_MAX_PCT: 60, MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, UPPER_BUFFER_BINS: 0, OPEN_SPOT_PCT: 50, OPEN_SHAPE: 'MIXED', RESHAPE_N: 5, RESHAPE_ENABLED: true, COMPOUND_ENABLED: true, TP_USD_PCT: 13, EMERGENCY_TP_PCT: 10, EMERGENCY_TP_ENABLED: true, EMERGENCY_SLPLUS_ENABLED: true, OOR_RIGHT_MIN_BINS: 5, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3, OOR_RIGHT_MIN_PROFIT_PCT: 0.5, EMERGENCY_DROP: 0.2, CAPITAL_ASSET: 'USDC', RANGE_DOWN_PCT: 50, RUGCHECK_ENABLED: true };
const statusPayload = { ok: true, csrf: 'x', values, fields: {}, paused: false,
  dashboard: { historyCurve: [{ t: iso(4), cum: 23.5 }, { t: iso(3), cum: 14 }, { t: iso(1), cum: 20.24 }], mode: { label: 'DRY RUN', live: false }, parity: { ok: false, debt: 6, added: 0 } },
  status: { activity: [{ atWib: '2026-11-13 15:29:13 WIB', kind: 'reshape', text: 'Reshape #6 FOOD-SOL' }], window: { startedWib: '2026-11-10 13:00 WIB', endsWib: '2026-11-17 13:00 WIB' },
    positions_open: { positions: [{ position: { name: 'NIO-SOL', usdcIn: 499.9, binShape: { activeBin: 3, bins: [1, 2, 3, 4, 5].map(id => ({ id, sol: id, token: 0 })) } }, live: { valueUsd: 501 } }], updated: now.toISOString() },
    screening: { at: now.toISOString(), fetched: 146, passed: 2 },
    summary: { updated: now.toISOString(), closedRecent: closed, stats: { variant: 'N5', equityUsd: 5534.57, totalDepositedUsdc: 5000, totalNetPnlAllUsd: 20.24, winRate: 66.7, wins: 2, losses: 1, trades: 3, avgNetPnlUsd: 6.75, reshapes: 284, virtualUsdc: 4542.45, positionValueUsd: 992.12 } } } };
const calPayload = { ok: true, days: { [today]: { pnl: 20.24, trades: 3, wins: 2, losses: 1, profit: 29.74, minus: -9.5, rows: [{ name: 'FOOD-SOL', closedAt: iso(1), pnlUsd: 6.24, capital: 499.9 }], tokens: [{ name: 'FOOD-SOL', trades: 1, pnl: 6.24 }] } }, total: 20.24, trades: 3, mode: { label: 'DRY RUN', live: false } };
const res = (o, s = 200) => Promise.resolve({ status: s, json: async () => o });
const vc = new VirtualConsole(), errors = []; vc.on('jsdomError', e => errors.push(String(e && (e.stack || e))));
const dom = new JSDOM(html, { url: 'http://127.0.0.1:8797/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom, { document } = window;
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
window.Telegram = { WebApp: { initData: 'user=%7B%22id%22%3A1%7D', ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, HapticFeedback: null, showConfirm: null } };
window.fetch = async (u) => { u = String(u);
  if (u.includes('/api/pnl-calendar')) return res(calPayload);
  if (u.includes('/api/settings') || u.includes('/api/status')) return res(statusPayload);
  if (u.includes('/api/wallet')) return res({ ok: true, hasKey: false });
  if (u.includes('/api/live')) return res({ ok: true, stopPresent: true, liveRunning: false, liveStatus: 'off', hasKey: false, balanceCheck: { ok: false, reasons: [] } });
  return res({ ok: false }, 404); };
if (!window.AbortSignal.timeout) window.AbortSignal.timeout = () => new window.AbortController().signal;
const D = window.HTMLDialogElement || window.HTMLElement; if (!D.prototype.showModal) { D.prototype.showModal = function () { this.setAttribute('open', ''); }; D.prototype.close = function () { this.removeAttribute('open'); }; }
window.HTMLElement.prototype.scrollIntoView = function () {}; window.scrollTo = () => {};
window.eval(dashjs); window.eval(appjs);
const $ = (id) => document.getElementById(id), hidden = (id) => $(id).classList.contains('hidden');
const click = (el) => { assert(el, 'missing click target'); el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(80);
  assert(!hidden('panel-dashboard') && hidden('panel-status') && hidden('panel-settings') && hidden('panel-wallet'), 'Dashboard visible by default');
  assert(document.body.classList.contains('dash-wide'));
  assert($('dash-kpis').textContent.includes('$5,534.57') && $('dash-kpis').textContent.includes('66.7%') && $('dash-kpis').textContent.includes('2W / 1L') && $('dash-kpis').textContent.includes('3 CLOSED'));
  assert($('dash-kpis').textContent.includes('+$20.24'));
  assert.equal($('dash-modules').querySelectorAll('.dash-mod').length, 6);
  const mods = $('dash-modules').textContent; for (const t of ['POOL SCANNER', 'RUG & ANTI-PVP', 'QUOTE ENTRY', 'RESHAPE & COMPOUND', 'TP SL+ GUARD', 'QUOTE SWAP-BACK', '146 pool', '1/10', 'KEEP_BIGGEST', '284 reshape', 'ARMED']) assert(mods.includes(t), 'module text ' + t);
  assert.equal($('dash-flow').querySelectorAll('.dash-fnode').length, 4);
  assert($('dash-flow').querySelectorAll('.dash-bars i').length >= 3, 'shape bars rendered');
  assert($('dash-parity').textContent === 'PARITY DEBT 6' && $('dash-mode').textContent === 'DRY RUN');
  assert($('dash-run-body').querySelector('svg.dash-curve path.ln'), 'equity curve svg');
  assert($('dash-run-body').textContent.includes('3 CLOSED TRADES'));
  assert($('dash-log-body').textContent.includes('FOOD-SOL') && $('dash-log-body').textContent.includes('Reshape #6'));
  assert($('dash-strategy-body').textContent.includes('Quote-Only (0 upper)') && $('dash-strategy-body').textContent.includes('Spot 50% : Bid-Ask 50%') && $('dash-strategy-body').textContent.includes('Every 5 bins + compound'));
  assert($('dash-tiles').textContent.includes('$4,542.45') && $('dash-tiles').textContent.includes('1 / 10'));
  await wait(40);
  const cell = document.querySelector(`#dash-cal [data-go="wallet:pnlcal:${today}"]`); assert(cell && cell.classList.contains('pos'), 'calendar day cell positive');
  const side = document.querySelector('.dash-side').children; assert.equal(side[0].id, 'dash-cal'); assert.equal(side.length, 1);
  ok('render: KPIs, 6 modules, 4-stage flow, parity/mode pills, equity curve, tail log, strategy, tiles, calendar above character');

  // ---- ONE view (18 Nov): the scrolling dashboard. No 1 Page / Detail switch; an old stored choice is ignored ----
  assert(!document.body.classList.contains('dash-compact') && !document.querySelector('[data-dash-mode],.dash-viewmode'), 'single scrolling view, no mode switch');
  assert.equal(window.SWDash.getMode(), 'detail'); assert.equal(window.SWDash.setMode('compact'), 'detail'); assert(!document.body.classList.contains('dash-compact'));
  assert(!hidden('panel-dashboard'), 'still on Dashboard');
  click(document.querySelector('#dash-modules [data-go="settings:RESHAPE_N"]')); assert(!hidden('panel-settings'), 'cards navigate');
  click(document.querySelector('[data-tab="dashboard"]')); assert(!document.body.classList.contains('dash-compact'), 'still the scrolling view after a tab round-trip');
  ok('dashboard: one scrolling view (no 1 Page/Detail switch), cards navigate');
  { const dom2 = new JSDOM(html, { url: 'http://127.0.0.1:8797/', runScripts: 'outside-only' }); dom2.window.localStorage.setItem('sw_dash_mode', 'compact'); dom2.window.eval(dashjs);
    assert(!dom2.window.document.body.classList.contains('dash-compact') && dom2.window.localStorage.getItem('sw_dash_mode') === null, 'a stored 1 Page choice is ignored and cleared'); dom2.window.close(); }
  ok('stored 1 Page choice ignored on reopen');
  click(document.querySelector('#dash-modules [data-go="status:screening"]'));
  assert(!hidden('panel-status') && hidden('panel-dashboard') && !hidden('screening-view') && hidden('open-view'));
  assert(!document.body.classList.contains('dash-wide'));
  click(document.querySelector('[data-tab="dashboard"]')); assert(!hidden('panel-dashboard'));
  click(document.querySelector('#dash-tiles [data-go="status:activity"]')); assert(!hidden('activity-view'));
  click(document.querySelector('[data-tab="dashboard"]'));
  click(document.querySelector('#dash-kpis [data-go="status:history"]')); assert(!hidden('history-view'));
  click(document.querySelector('[data-tab="dashboard"]'));
  click(document.querySelector('#dash-strategy-body [data-go="settings:RESHAPE_N"]')); assert(!hidden('panel-settings'));
  click(document.querySelector('[data-tab="dashboard"]'));
  click($('dash-mode')); assert(!hidden('panel-wallet') && !hidden('wallet-live-view'));
  click(document.querySelector('[data-tab="dashboard"]'));
  click(document.querySelector('#dash-tiles [data-go="wallet:key"]')); assert(!hidden('wallet-key-view'));
  click(document.querySelector('[data-tab="dashboard"]'));
  assert(document.querySelector('#panel-dashboard #credit a[href="https://t.me/SicknatureEcosystem"]') && !document.querySelector('#dash-char'));
  click(document.querySelector('[data-tab="dashboard"]'));
  click(document.querySelector(`#dash-cal [data-go="wallet:pnlcal:${today}"]`)); await wait(60);
  assert(!hidden('panel-wallet') && !hidden('wallet-pnlcal-view'));
  const modal = $('cal-day-modal'); assert(modal.hasAttribute('open') || modal.open, 'day detail opened'); assert($('cal-day-body').textContent.includes('FOOD-SOL'));
  click(document.querySelector('[data-tab="status"]')); assert(!hidden('panel-status'));
  ok('navigation (scrolling dashboard): modules/tiles/KPIs/strategy/pills/character/calendar day -> Status subtabs, Settings, Wallet Live/Key/PnL Calendar (+ day sheet); tabs still work');
  if (errors.length) assert.fail('jsdom errors: ' + errors.join(' | '));

  // ---- server routes ----
  const { startServer } = require('./miniapp/server'), { signInitData } = require('./paper-settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-dash-test-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ books: { N5: { history: closed } } }));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(statusPayload.status.summary));
  const token = 'local-test-token-only', { server, port } = await startServer({ host: '127.0.0.1', port: 0, token, paperDir: dir });
  try {
    const base = `http://127.0.0.1:${port}`;
    let r = await fetch(base + '/char-avatar.png'); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); const buf = Buffer.from(await r.arrayBuffer()); assert.equal(buf.slice(1, 4).toString(), 'PNG');
    r = await fetch(base + '/char-avatar.png', { method: 'HEAD' }); assert.equal(r.status, 200);
    r = await fetch(base + '/dashboard.js'); assert.equal(r.status, 200); assert((await r.text()).includes('window.SWDash'));
    r = await fetch(base + '/'); const page = await r.text(); assert(page.includes('id="panel-dashboard"'));
    const init = signInitData({ user: JSON.stringify({ id: 1000000001 }), auth_date: Math.floor(Date.now() / 1000) }, token);
    r = await fetch(base + '/api/status', { headers: { 'x-telegram-init-data': init } }); assert.equal(r.status, 200);
    const body = await r.text(), j = JSON.parse(body);
    assert(j.ok && j.dashboard && Array.isArray(j.dashboard.historyCurve) && j.dashboard.historyCurve.length === 3);
    assert.equal(j.dashboard.historyCurve[2].cum, 20.24); assert(j.dashboard.parity && typeof j.dashboard.parity.debt === 'number'); assert(j.dashboard.mode && j.dashboard.mode.label);
    assert(!body.includes(token) && !/private[_-]?key/i.test(body));
    r = await fetch(base + '/api/status'); assert.equal(r.status, 403);
    ok('server: /char-avatar.png (GET+HEAD, image/png), /dashboard.js, / has dashboard, /api/status dashboard block (curve/parity/mode), 403 without initData, no token leak');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('test-dashboard-ui: all', n, 'passed'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
