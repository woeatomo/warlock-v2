'use strict';
// Preview every Telegram PnL card/message with real data, WITHOUT sending anything (both transports captured).
// Run only in an isolated copy of the bot dir (no .env, no secrets):  LP_BOT_DIR=<copy> PAPER=0 DRY_RUN=0 node tools/tg-preview.js <outDir>
const fs = require('fs'), path = require('path');
const out = path.resolve(process.argv[2] || 'tg-preview'); fs.mkdirSync(out, { recursive: true });
const ROOT = process.env.LP_BOT_DIR; if (!ROOT || fs.existsSync(path.join(ROOT, '.env')) || fs.existsSync(path.join(ROOT, 'secrets'))) { console.error('run in an isolated copy (no .env / secrets)'); process.exit(2); }
const T = require('../telegram-notify'), H = require('../history-menu'), card = require('../warlock-card');
let cur = 'x'; const sent = [];
T.setMessageTransport((text, opts) => { sent.push({ kind: 'text', name: cur, text, opts }); return { ok: true }; });
T.setPhotoTransport((caption, png, opts) => { sent.push({ kind: 'photo', name: cur, caption, png, opts }); return { ok: true }; });
T.setAutoCard(true);
const W = (f, v) => fs.writeFileSync(path.join(out, f), v);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function capture(name, fn) { cur = name; const n0 = sent.length; await fn(); for (let i = 0; i < 80 && sent.length === n0; i++) await wait(100); await wait(2500); let k = 0;
  for (const m of sent.slice(n0)) { k++; const base = `${name}${k > 1 ? '-' + k : ''}`; if (m.kind === 'photo') { W(base + '.png', m.png); W(base + '.caption.txt', m.caption + '\n'); } else W(base + '.txt', m.text + '\n'); if (m.opts && m.opts.parse_mode) W(base + '.parse_mode', m.opts.parse_mode); } }
(async () => {
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')), hist = live.history || [];
  const dcty = hist.find((h) => /^DCTY/.test(h.name)), fiona = hist.find((h) => /^FIONA/.test(h.name));
  const trades = H.loadTrades(ROOT), loss = trades.d.closed.find((h) => (h.capitalAsset === 'SOL' ? +h.pnlCapitalPct : +h.pnlPct) <= -1 && h.binShape) || trades.d.closed.find((h) => +h.pnlUsd < 0);
  const lang = 'id', now = Date.parse('2026-11-20T11:00:00Z');   // 18:00 WIB on 20 Nov: today's live trades
  // (1) PnL calendar cards (history menu /calendar) and the 07:00 daily card (day that just ended, sent 21 Nov 07:00 WIB)
  for (const k of ['day', 'week', 'month']) { const r = await H.periodCard(ROOT, lang, 'l', k, 0, { now }); W(`calendar-${k}.png`, r.png); W(`calendar-${k}.caption.txt`, r.caption + '\n'); }
  { const r = await H.periodCard(ROOT, lang, 'l', 'day', 1, { now: Date.parse('2026-11-21T00:00:30Z'), daily: true }); W('daily-0700.png', r.png); W('daily-0700.caption.txt', r.caption + '\n'); }
  // (2) close: text + auto card (profit / breakeven / loss)
  await capture('close-profit-DCTY', () => T.notifyClose({ ...dcty, paper: false }));
  await capture('close-breakeven-FIONA', () => T.notifyClose({ ...fiona, paper: false }));
  if (loss) await capture('close-loss-' + String(loss.name).split('-')[0], () => T.notifyClose({ ...loss, paper: true }));
  if (loss) await capture('emergency-sl-' + String(loss.name).split('-')[0], () => T.notifyEmergency({ ...loss, paper: true, reason: 'emergency_stop SL -' + Math.abs(+loss.pnlCapitalPct || +loss.pnlPct || 5).toFixed(1) + '%' }));
  // (3) history menu cards: closed (profit / loss) + open snapshot
  for (const h of [dcty, fiona]) { const id = H.loadTrades(ROOT).l.closed.find((x) => x.name === h.name).__id; const r = await H.closedCard(ROOT, lang, id); W(`history-closed-${h.name.split('-')[0]}.png`, r.png); W(`history-closed-${h.name.split('-')[0]}.caption.txt`, r.caption + '\n'); }
  { const pos = { ...fiona, closedAt: undefined, reason: undefined, paper: false, lastLive: { pnlCapital: 0.0012, pnlCapitalPct: 0.12, pnlUsd: 0.09, quoted: true }, lastSolUsd: 72.09 };
    const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')); st.positions = [pos]; fs.writeFileSync(path.join(ROOT, 'state.json'), JSON.stringify(st));
    const id = H.loadTrades(ROOT).l.open[0].__id, r = await H.openCard(ROOT, lang, id, { solUsd: 72.09 }); W('history-open-FIONA.png', r.png); W('history-open-FIONA.caption.txt', r.caption + '\n');
    st.positions = []; fs.writeFileSync(path.join(ROOT, 'state.json'), JSON.stringify(st)); }
  // (4) open / reshape / reposition notifications (FIONA's real open, DCTY's reshape, FIONA's reposition)
  const oc = fiona.openContext || { source: 'Auto bot (scan)', reason: 'Lolos screening bot', snapshot: { capitalAsset: 'SOL', capitalInSol: 1, ft30mPct: 0.79, tvlUsd: 16532, ageH: 11.7, binStep: 80, quote: 'SOL', strategy: 'N5', passedAllFilters: true } };
  await capture('open-FIONA', () => T.notifyOpen({ name: fiona.name, pool: fiona.pool, sizeSol: fiona.depositSol, quoteSymbol: 'SOL', depositQuote: fiona.depositSol, usdcIn: fiona.usdcIn, gasBufferSol: fiona.leftoverSol, leftoverSol: fiona.leftoverSol,
    minBinId: fiona.minBinId, maxBinId: fiona.maxBinId, entryPrice: fiona.entryPrice, ft30m: 0.79, tvl: fiona.tvlUsd, activeBin: fiona.entryActiveBin, lastActiveBin: fiona.entryActiveBin, shape: fiona.shape, binShape: fiona.binShape, openContext: oc, mintX: fiona.mintX, binStep: fiona.binStep, capitalAsset: 'SOL', capitalInSol: 1 }));
  await capture('reshape-DCTY', () => T.notifyReshape({ name: dcty.name, pool: dcty.pool, n: 3, reshapes: 3, activeBin: -370, rightMin: -369, rightMax: -355, amountX: 41.366879, tokenX: 40.1, feeXAdded: 1.27, feeYAdded: 0.00055449, quoteSymbol: 'SOL', binShape: dcty.binShape, mintX: dcty.mintX }));
  await capture('reposition-FIONA', () => T.notifyReposition({ number: 1, name: fiona.name, pool: fiona.pool, reason: 'OOR kanan 5 bin (active −416 > range −507..−421), PnL −0.80% < 0.5%', openContext: oc, capitalAsset: 'SOL', pnlCapital: -0.000384, pnlPct: -0.0384, pnlUsd: -0.028, minBinId: -502, maxBinId: -416, activeBin: -416, binShape: fiona.binShape, mintX: fiona.mintX, solUsd: 72.09 }));
  // (5) menus
  W('menu-main.txt', H.mainMenu(lang, { src: 'l' }).text + '\n'); W('menu-history.txt', H.historyMenu(ROOT, lang, 'l', 0).text + '\n' + JSON.stringify(H.historyMenu(ROOT, lang, 'l', 0).reply_markup.inline_keyboard.map((r) => r.map((b) => b.text))) + '\n'); W('menu-calendar.txt', H.pnlMenu(lang, 'l').text + '\n');
  console.log('done', fs.readdirSync(out).length, 'files'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
