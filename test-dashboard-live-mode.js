'use strict';
// LIVE mode chrome must not blink back to DRY RUN: (1) header badge + dashboard pills follow the server mode (remembered across reopen),
// (2) a pm2 "unknown" blip with the lock file gone keeps the live wallet/equity, (3) dashboard cards patch in place (same DOM nodes),
// (4) the server serves the last good root status.json/state.json when a read catches a half-written file; SOL price from live source.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const pub = path.join(__dirname, 'miniapp/public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8'), dashjs = fs.readFileSync(path.join(pub, 'dashboard.js'), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const now = new Date().toISOString();
const values = { MAX_POSITIONS: 7, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_BIN_STEP: 80, ANTI_PVP_MODE: 'KEEP_BIGGEST', RESHAPE_N: 5 };
let equity = 502.07;
const payload = () => ({ ok: true, csrf: 'x', values, fields: {}, paused: false,
  dashboard: { historyCurve: [], mode: { label: 'LIVE', live: true }, parity: { ok: true, debt: 0, added: 0 } },
  status: { activity: [], positions_open: { positions: [], updated: now }, screening: { at: now, fetched: 150, basic: 1, passed: 0 },
    status: { lastScan: { at: now, fetched: 150 } },
    liveSummary: { live: true, walletSol: 6.0234, openValueSol: 0.9, rentRefundableSol: 0.0594, solUsd: 72.4, trades: 0, wins: 0, losses: 0, maxPositions: 7 },
    summary: { updated: now, closedRecent: [], stats: { live: true, variant: 'N5', equityUsd: equity, equitySol: 6.98, trades: 0, wins: 0, losses: 0, winRate: null, totalNetPnlUsd: 0, reshapes: 3 } } } });
const res = (o, s = 200) => Promise.resolve({ status: s, json: async () => o });
const vc = new VirtualConsole(), errors = []; vc.on('jsdomError', e => errors.push(String(e && (e.stack || e))));
const dom = new JSDOM(html, { url: 'http://127.0.0.1:8797/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom, { document } = window;
window.Telegram = { WebApp: { initData: 'user=%7B%22id%22%3A1%7D', ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, HapticFeedback: null, showConfirm: null } };
window.fetch = async (u) => { u = String(u);
  if (u.includes('/api/pnl-calendar')) return res({ ok: true, days: {}, mode: { label: 'LIVE', live: true } });
  if (u.includes('/api/settings') || u.includes('/api/status')) return res(payload());
  if (u.includes('/api/wallet')) return res({ ok: true, hasKey: true });
  // pm2 jlist blip: process status "unknown" while the STOP lock is absent (= live)
  if (u.includes('/api/live')) return res({ ok: true, stopPresent: false, liveRunning: false, liveStatus: 'unknown', hasKey: true, sol: 6.0234, usdc: 0, balanceCheck: { ok: true, reasons: [] } });
  return res({ ok: false }, 404); };
if (!window.AbortSignal.timeout) window.AbortSignal.timeout = () => new window.AbortController().signal;
const D = window.HTMLDialogElement || window.HTMLElement; if (!D.prototype.showModal) { D.prototype.showModal = function () { this.setAttribute('open', ''); }; D.prototype.close = function () { this.removeAttribute('open'); }; }
window.HTMLElement.prototype.scrollIntoView = function () {}; window.scrollTo = () => {};
const $ = (id) => document.getElementById(id);
// record every moment the DRY RUN pill becomes visible or the header badge reads DRY RUN after the first live render
const flips = []; let armed = false;
new window.MutationObserver(() => { if (!armed) return;
  if (!$('dash-mode').classList.contains('hidden')) flips.push('dash-mode visible');
  if (/DRY RUN/.test(document.querySelector('.badge .mode').textContent)) flips.push('badge DRY RUN');
  for (const el of document.querySelectorAll('[id^="dash-"]:not(#dash-mode):not(#dash-live)')) if (/dry run/i.test(el.textContent)) flips.push(el.id + ' says dry run');
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
window.eval(dashjs); window.eval(appjs);
(async () => {
  await wait(150);
  assert.equal(document.querySelector('.badge .mode').textContent, 'LIVE', 'header badge LIVE');
  assert($('dash-mode').classList.contains('hidden') && $('dash-live').classList.contains('on'), 'DRY RUN pill hidden, LIVE pill on');
  assert(window.WarlockLiveWallet && window.WarlockLiveWallet.sol === 6.0234, 'pm2 "unknown" with STOP absent keeps the live wallet');
  assert($('mode-live').classList.contains('on') && !$('mode-dry').classList.contains('on'), 'Wallet > Live mode buttons stay LIVE');
  assert.equal(window.localStorage.getItem('sw_last_live'), '1');
  ok('LIVE chrome: badge, dashboard pills, wallet mode buttons stay LIVE through a pm2 status blip');
  armed = true;
  const head = $('dash-strategy-head').firstElementChild, kpi = $('dash-kpis').firstElementChild;
  for (let i = 0; i < 4; i++) { equity += 0.37; window.SWDash.render(payload()); await wait(20); }
  assert.strictEqual($('dash-strategy-head').firstElementChild, head, 'strategy head node kept');
  assert.strictEqual($('dash-kpis').firstElementChild, kpi, 'KPI node kept (patched in place)');
  assert($('dash-kpis').textContent.includes('$503.55'), 'KPI value updated in place: ' + $('dash-kpis').textContent.slice(0, 80));
  assert.deepStrictEqual(flips, [], 'no DRY RUN flash during re-renders: ' + flips.slice(0, 5).join(', '));
  ok('dashboard re-renders patch in place and never flash DRY RUN');
  // reopen: last mode remembered, so the page starts LIVE before the first fetch returns
  { const d2 = new JSDOM(html, { url: 'http://127.0.0.1:8797/', runScripts: 'outside-only' }); d2.window.localStorage.setItem('sw_last_live', '1');
    d2.window.Telegram = window.Telegram; d2.window.fetch = () => new Promise(() => {}); d2.window.HTMLElement.prototype.scrollIntoView = function () {};
    d2.window.eval(dashjs); d2.window.eval(appjs);
    assert.equal(d2.window.document.querySelector('.badge .mode').textContent, 'LIVE'); assert(d2.window.document.getElementById('dash-mode').classList.contains('hidden')); d2.window.close(); }
  ok('reopen starts in the last known mode (no DRY RUN default flash)');
  if (errors.length) assert.fail('jsdom errors: ' + errors.join(' | '));
  window.close();

  // ---- server: torn status.json read keeps LIVE ----
  global.fetch = async (u) => { if (String(u).includes('price')) return { ok: true, json: async () => ({ So11111111111111111111111111111111111111112: { usdPrice: 72.41 } }) }; throw new Error('offline'); };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-live-mode-')), paper = path.join(root, 'paper'); fs.mkdirSync(paper);
  fs.writeFileSync(path.join(paper, 'state.json'), JSON.stringify({ books: { N5: { history: [] } } }));
  fs.writeFileSync(path.join(paper, 'summary.json'), JSON.stringify({ updated: now, stats: { solUsd: 71.9 } }));
  const status = { dryRun: false, paper: false, updated: now, solBalance: 6.0234, lives: [{ valueSol: 0.9 }], lastScan: { at: now } };
  fs.writeFileSync(path.join(root, 'status.json'), JSON.stringify(status));
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ positions: [{ name: 'DCTY-SOL', address: 'Pool1', mint: 'Mint1', openedAt: now }], history: [] }));
  const { publicStatus } = require('./miniapp/server');
  let a = publicStatus(paper); assert(a.positions_open && a.positions_open.paper === false && a.positions_open.positions.length === 1, 'live view');
  await wait(30); a = publicStatus(paper);
  assert(Math.abs(a.liveSummary.solUsd - 72.41) < 1e-9, 'live SOL price, not the stale paper summary 71.9: ' + a.liveSummary.solUsd);
  assert.equal(a.liveSummary.maxPositions, a.liveSummary.maxPositions || null);
  fs.writeFileSync(path.join(root, 'status.json'), JSON.stringify(status).slice(0, 25));   // half-written
  const b = publicStatus(paper); assert(b.positions_open && b.positions_open.paper === false && b.positions_open.positions.length === 1, 'torn read served from last good parse');
  fs.rmSync(root, { recursive: true, force: true });
  ok('server: torn root status.json keeps the LIVE view (last good parse), live SOL/USD used');
  console.log(`${n} dashboard live-mode checks passed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
