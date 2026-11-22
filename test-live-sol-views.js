'use strict';
// LIVE + CAPITAL_ASSET=SOL (operator 20 Nov 17:15): (1) a closed position drops out of equity at once (status.json kept the last `lives`
// after the close -> 0.90 SOL "di posisi" with 0 positions); (2) every live number is SOL first with USD small; (3) live history rows get
// their open source/reason (scan PASS line) and a real close reason instead of "riwayat lama / tidak diketahui"; (4) FIONA correction shows.
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const liveView = require('./miniapp/live-view');
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8'));   // the real DCTY + corrected FIONA rows
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-sol-views-')), paper = path.join(root, 'paper'); fs.mkdirSync(paper);
const W = (f, v) => fs.writeFileSync(path.join(root, f), typeof v === 'string' ? v : JSON.stringify(v));
W('bot.log', ['[2026-11-20 14:09:08 WIB]   PASS DCTY-SOL 4exs9b ft30m=0.63% tvl=$54188 age=39.2h bs=80 pump1h=9.3% pump24h=-66.3% rugScore=1 insider=11.5% antiPvP=ok top10=17.9%',
  '[2026-11-20 16:36:46 WIB]   PASS FIONA-SOL DQpF5i ft30m=0.79% tvl=$16532 age=11.7h bs=80 pump1h=-20.5% pump24h=189.0% rugScore=1 insider=9.6% antiPvP=kept(1 kembar) top10=13.0%'].join('\n') + '\n');
W('state.json', { position: null, positions: [], history: hist });
// status.json exactly as at 17:12: 0 positions but the last valuation still in lives/live
W('status.json', { updated: '2026-11-20T10:12:30.000Z', updatedWib: '2026-11-20 17:12 WIB', solBalance: 6.982175181, solUsd: 72.09, config: { maxPositions: 7 }, lives: [{ valueSol: 0.89998, pnlSol: -0.00003, feesSol: 0.00014 }], live: { valueSol: 0.89998 } });
fs.writeFileSync(path.join(paper, 'state.json'), JSON.stringify({ books: { N5: { history: [] } } }));
fs.writeFileSync(path.join(paper, 'summary.json'), JSON.stringify({ stats: {} }));
global.fetch = async () => { throw new Error('offline'); };
const server = require('./miniapp/server');

(async () => {
  const out = server.publicStatus(paper), L = out.liveSummary, s = out.summary.stats;
  assert.strictEqual(L.openValueSol, 0, 'stale lives dropped'); assert.strictEqual(L.rentRefundableSol, 0); assert.strictEqual(L.openFeesSol, 0);
  assert.ok(Math.abs(s.equitySol - 6.982175181) < 1e-9, 'equity = wallet when flat: ' + s.equitySol);
  ok('0 positions: equity = wallet only (was wallet + 0.90 SOL stale LP value)');
  assert.ok(Math.abs(L.realizedSol - (0.00565557 - 0.000429747)) < 1e-9, L.realizedSol); assert.strictEqual(L.capitalAsset, 'SOL');
  assert.ok(Math.abs(s.totalNetPnlSol - 0.005225823) < 1e-9 && Math.abs(s.totalNetPnlSolUsd - 0.005225823 * 72.09) < 1e-6);
  assert.ok(Math.abs(L.totalProfitSol - 0.005225823) < 1e-9, L.totalProfitSol);
  assert.ok(Math.abs(L.capitalBasisSol - (6.982175181 - 0.005225823)) < 1e-9, L.capitalBasisSol);
  assert.ok(Math.abs(L.totalProfitPct - 100 * 0.005225823 / (6.982175181 - 0.005225823)) < 1e-9, L.totalProfitPct);
  assert.strictEqual(L.liveSince, '2026-11-20T07:09:40.008Z');
  assert.strictEqual(L.wins, 1); assert.strictEqual(L.losses, 0); assert.strictEqual(L.be, 1); assert.strictEqual(L.winRate, 100);   // FIONA −0.043% = breakeven
  ok('realized in SOL with the FIONA correction: +0.005226 SOL (DCTY +0.005656, FIONA −0.000430)');
  const rows = out.summary.closedRecent, d = rows.find((r) => r.name === 'DCTY-SOL'), f = rows.find((r) => r.name === 'FIONA-SOL');
  assert.ok(d.displayUnit === 'SOL' && Math.abs(d.pnlSol - 0.00565557) < 1e-9 && Math.abs(d.pnlSolPct - 0.565557) < 1e-6 && Math.abs(d.pnlSolUsd - 0.00565557 * 72.09) < 1e-9);
  assert.ok(Math.abs(f.pnlSol + 0.000429747) < 1e-9 && /approved by operator/.test(f.note));
  assert.strictEqual(d.openContext.source, 'Auto bot (scan)'); assert.ok(/Lolos semua filter scan 14:09 WIB · fee\/TVL 30m 0.63% · TVL \$54\.2k/.test(d.openContext.reason), d.openContext.reason);
  assert.ok(/16:36 WIB · fee\/TVL 30m 0.79%/.test(f.openContext.reason)); assert.strictEqual(f.openContext.snapshot.ft30mPct, 0.79);
  assert.ok(/take profit/.test(d.closeReasonText) && !/aturan lama/.test(d.closeReasonText + f.closeReasonText) && /buka ulang gagal/.test(f.closeReasonText));
  ok('history rows: SOL result + %, USD = SOL × close price, open source/reason from the scan PASS, close reason text');
  // lives keyed by position / aligned / fallback
  const ps = [{ position: 'A', lastValuation: { value: 0.5 } }, { position: 'B', lastValuation: { value: 0.7, fees: 0.01 } }];
  assert.deepStrictEqual(liveView.pairLives(ps, [{ position: 'B', valueSol: 0.71 }]).map((l) => l.valueSol), [0.5, 0.71]);
  assert.deepStrictEqual(liveView.pairLives(ps, [{ valueSol: 1 }, { valueSol: 2 }]).map((l) => l.valueSol), [1, 2]);
  assert.deepStrictEqual(liveView.pairLives(ps, [{ valueSol: 9 }]).map((l) => l.valueSol), [0.5, 0.7], 'unkeyed + length mismatch: own last valuation');
  assert.deepStrictEqual(liveView.pairLives([], [{ valueSol: 9 }]), []);
  ok('lives pairing: keyed, aligned, mismatch falls back to each position\'s own last valuation');
  const cal = liveView.solCalendar(require('./paper-pnl-calendar').buildLive(root), hist), day = cal.days['2026-11-20'];
  assert.strictEqual(cal.unit, 'SOL'); assert.strictEqual(day.wins, 1); assert.strictEqual(day.losses, 0); assert.strictEqual(day.be, 1); assert.ok(Math.abs(day.pnlSol - 0.005226) < 1e-6, day.pnlSol);
  ok('calendar: unit SOL, day win/loss by the SOL result, day total +0.005226 SOL');

  // ---- UI (jsdom): SOL main, USD small, no "riwayat lama" ----
  const { JSDOM, VirtualConsole } = require('jsdom'), pub = path.join(__dirname, 'miniapp/public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8'), appjs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8'), dashjs = fs.readFileSync(path.join(pub, 'dashboard.js'), 'utf8');
  const vc = new VirtualConsole(), errors = []; vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e))));
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8797/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc }), { window } = dom, { document } = window;
  window.Telegram = { WebApp: { initData: 'user=%7B%22id%22%3A1%7D', ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, HapticFeedback: null, showConfirm: null } };
  const res = (o, st = 200) => Promise.resolve({ status: st, json: async () => o });
  const calApi = { ok: true, ...liveView.solCalendar(require('./paper-pnl-calendar').buildLive(root), hist), mode: { label: 'LIVE', live: true } };
  const now = Date.now(), fresh = out.summary.closedRecent.map((r, i) => ({ ...r, closedAt: new Date(now - (i + 1) * 3600e3).toISOString() }));   // History list = last 24 h
  const status = { ...out, summary: { ...out.summary, closedRecent: fresh } };
  window.fetch = async (u) => { u = String(u);
    if (u.includes('/api/pnl-calendar')) return res(calApi);
    if (u.includes('/api/settings') || u.includes('/api/status')) return res({ ok: true, csrf: 'x', values: { MAX_POSITIONS: 7, CAPITAL_ASSET: 'SOL' }, fields: { CAPITAL_ASSET: { value: 'SOL' } }, paused: false, dashboard: { historyCurve: [], mode: { label: 'LIVE', live: true }, parity: { ok: true, debt: 0, added: 0 } }, status });
    if (u.includes('/api/wallet')) return res({ ok: true, hasKey: true });
    if (u.includes('/api/live')) return res({ ok: true, stopPresent: false, liveRunning: true, liveStatus: 'online', hasKey: true, sol: 6.982175181, usdc: 0, balanceCheck: { ok: true, reasons: [] } });
    return res({ ok: false }, 404); };
  if (!window.AbortSignal.timeout) window.AbortSignal.timeout = () => new window.AbortController().signal;
  const D = window.HTMLDialogElement || window.HTMLElement; if (!D.prototype.showModal) { D.prototype.showModal = function () { this.setAttribute('open', ''); }; D.prototype.close = function () { this.removeAttribute('open'); }; }
  window.HTMLElement.prototype.scrollIntoView = function () {}; window.scrollTo = () => {};
  window.eval(dashjs); window.eval(appjs); await new Promise((r) => setTimeout(r, 300));
  const $ = (id) => document.getElementById(id), txt = (id) => ($(id) ? $(id).textContent.replace(/\s+/g, ' ') : '');
  const hist2 = txt('closed');
  assert.ok(/DCTY-SOL/.test(hist2) && /\+0\.005656 SOL \(\+0\.57%\)/.test(hist2) && /−0\.000430 SOL \(−0\.04%\)/.test(hist2), hist2.slice(0, 400));
  assert.ok(!/riwayat lama|Alasan buka tidak diketahui/.test(hist2) && /Auto bot \(scan\)/.test(hist2) && /≈ \+\$0\.41/.test(hist2) && /≈ −\$0\.03/.test(hist2), hist2.slice(0, 600));
  assert.ok($('closed').querySelector('.usd-sub'), 'USD in the small grey element');
  ok('History rows: SOL first (+0.005656 SOL / −0.000430 SOL), USD small, Auto bot (scan) + reason, no "riwayat lama"');
  const sb = txt('status-body');
  assert.ok(/6\.98 SOL/.test(sb) && /Di posisi 0\.00 SOL/.test(sb) && /Realized · sudah ditutup \(SOL\) ?\+0\.0052 SOL/.test(sb), sb.slice(0, 500));
  assert.ok(/Total profit/i.test(sb) && /\+0\.07%/.test(sb) && /\+0\.0052 SOL/.test(sb) && /≈ \+\$0\.38/.test(sb) && /Live \d+ (hari|jam|menit)/.test(sb), sb);
  assert.ok(document.querySelector('#status-body .tile-profit'), 'total profit tile in the equity grid');
  assert.ok(/realized \+0\.005226 SOL/.test(txt('archive-note')), txt('archive-note'));
  ok('Status: equity 6.98 SOL, di posisi 0.00 SOL, realized +0.0052 SOL (USD small); History header realized in SOL');
  const k = txt('dash-kpis');
  assert.ok(/6\.98 SOL/.test(k) && /\+0\.0052 SOL/.test(k) && /REALIZED NET \(SOL\)/.test(k), k);
  assert.ok(/\+0\.005226 SOL realized/.test(txt('dash-run-head')), txt('dash-run-head'));
  assert.ok(/1W \/ 0L \/ 1BE/.test(k) && /100\.0%/.test(k) && /1 menang · 0 kalah · 1 BE/.test(k), k);
  assert.ok(/win rate 100% · 1W · 0L · 1 BE/.test(txt('archive-note')), txt('archive-note'));
  ok('Dashboard KPIs/run head in SOL; W/L "1W / 0L / 1BE", win rate 100% (FIONA breakeven), History header "1W · 0L · 1 BE"');
  window.SWApp && window.SWApp.go && window.SWApp.go('wallet:pnlcal'); await new Promise((r) => setTimeout(r, 200));
  const cal2 = txt('pnlcal'); if (cal2) { assert.ok(/\+0\.005 SOL|\+0\.0052|\+0\.005226/.test(cal2) && /aria-pressed|SOL/.test(cal2), cal2.slice(0, 300)); ok('PnL calendar defaults to SOL in live'); }
  if (errors.length) assert.fail('jsdom errors: ' + errors.join(' | '));
  window.close();
  console.log('all', n, 'live SOL view tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
