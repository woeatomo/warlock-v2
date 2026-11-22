'use strict';
// Previews (no sending): live reposition card, failed-reopen alert, 21:00 summary, silent reshape. Isolated copy only (no .env / secrets).
const fs = require('fs'), path = require('path');
const out = path.resolve(process.argv[2] || 'tg-preview2'); fs.mkdirSync(out, { recursive: true });
const ROOT = process.env.LP_BOT_DIR; if (!ROOT || fs.existsSync(path.join(ROOT, '.env')) || fs.existsSync(path.join(ROOT, 'secrets'))) { console.error('isolated copy only'); process.exit(2); }
const T = require('../telegram-notify'); let cur = 'x'; const sent = [];
T.setMessageTransport((text, opts) => { sent.push({ kind: 'text', name: cur, text, opts }); return { ok: true }; });
T.setPhotoTransport((caption, png, opts) => { sent.push({ kind: 'photo', name: cur, caption, png, opts }); return { ok: true }; });
T.setAutoCard(true);
const W = (f, v) => fs.writeFileSync(path.join(out, f), v), wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function capture(name, fn) { cur = name; const n0 = sent.length; await fn(); await wait(500); let k = 0;
  for (const m of sent.slice(n0)) { k++; const b = `${name}${k > 1 ? '-' + k : ''}`; if (m.kind === 'photo') { W(b + '.png', m.png); W(b + '.caption.html.txt', m.caption + '\n'); } else W(b + '.html.txt', m.text + '\n'); }
  return sent.length - n0; }
(async () => {
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')), fiona = st.history.find((h) => /^FIONA/.test(h.name));
  // real FIONA 16:37-16:38 WIB: OOR right, leg closed at 16:37:50, reopen -502..-416 refused at 16:38:03 (active -415 moved above the range)
  const ev = { number: 1, name: fiona.name, pool: fiona.pool, mintX: fiona.mintX, binStep: fiona.binStep, capitalAsset: 'SOL', solUsd: 72.09, paper: false,
    pnlCapital: fiona.pnlCapital, pnlPct: fiona.pnlCapitalPct, pnlUsd: fiona.pnlCapital * 72.09, proceedsSol: fiona.solOut, proceedsUsdc: fiona.solOut * 72.09,
    reason: 'OOR kanan: active bin -416 > range -507..-421 · PnL leg -0.043% < min profit 0.5%', oldMinBinId: -507, oldMaxBinId: -421, refPrice: fiona.entryPrice, refBin: fiona.entryActiveBin,
    openContext: fiona.openContext || { source: 'Auto bot (scan)', reason: 'Lolos semua filter scan 16:36 WIB · fee/TVL 30m 0.79% · TVL $16.5k · umur 11.7j · bin step 80' }, supply: 984154705.18, mintSupplySource: 'getTokenSupply' };
  const err = 'deposit failed: empty position closed (active bin -415 moved above the range -502..-416)';
  await capture('reopen-failed-FIONA-real', () => T.notifyRepositionFailed({ ...ev, tries: [err], error: err, walletAsset: 'SOL' }));
  // same event if the new one-time retry had worked (illustration: retry at the fresh active bin -415 -> range -501..-415)
  await capture('reposition-FIONA-retry-ok', () => T.notifyReposition({ ...ev, tries: [err, 'ok'], minBinId: -501, maxBinId: -415, activeBin: -415, refPrice: fiona.entryPrice, refBin: fiona.entryActiveBin, nBins: 87 }));
  await capture('reposition-FIONA-first-try', () => T.notifyReposition({ ...ev, tries: ['ok'], minBinId: -502, maxBinId: -416, activeBin: -416, nBins: 87 }));
  const n = await capture('reshape-silent', () => T.notifyReshape({ name: 'DCTY-SOL', pool: 'x', reshapes: 3 })); W('reshape-silent.txt', `notifyReshape sent ${n} message(s)\n`);
  // 21:00 summary from the dry-run state
  const ps = JSON.parse(fs.readFileSync(path.join(ROOT, 'paper', 'state.json'), 'utf8'));
  const status = T.statusFromState(ps, { solUsd: 72.09 }); fs.writeFileSync(path.join(ROOT, 'tg.json'), '{}');
  W('summary-2100.html.txt', require('../tg-format').dailySummaryHtml(status, { lang: 'id', paper: true }) + '\n');
  console.log('done', fs.readdirSync(out).join(' ')); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
