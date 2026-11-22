// Warlock 2.0 trade card: close (profit / loss / breakeven), open-position snapshot, new position, reposition.
// Everything arrives formatted from warlock-card.js (v2 fields); this file only lays it out.
import { W as CW, H as CH, PAD, theme, INK, SOFT, DIM, page, topBar, tokenBadge, chip, tile, hero, F, spaced, fitFont, truncate, rrect, finite, hashStr } from './kit.js';
import { drawBinShape } from './binShapeDraw.js';

export const CARD_W = CW;
export const CARD_H = CH;

function binStats(model) {
  if (!model || !model.bins || !model.bins.length) return null;
  const q = model.bins.reduce((a, b) => a + (b[1] || 0), 0), t = model.bins.reduce((a, b) => a + (b[2] || 0), 0), all = Math.max(1e-12, q + t);
  return { range: `${model.bins[0][0]} → ${model.bins[model.bins.length - 1][0]}`, active: finite(model.active) ? String(model.active) : '—', quote: Math.round((q / all) * 100), token: Math.round((t / all) * 100) };
}
export function infoChips(ctx, st, x, y, w, en) {
  if (!st) return;
  const gap = 14, cw = (w - gap * 2) / 3;
  [['ACTIVE BIN', st.active], ['RANGE', st.range], [en ? 'QUOTE / TOKEN' : 'QUOTE / TOKEN', `${st.quote}% / ${st.token}%`]].forEach(([k, v], i) => {
    const cx = x + i * (cw + gap); ctx.fillStyle = 'rgba(255,255,255,0.04)'; rrect(ctx, cx, y, cw, 74, 18); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5; rrect(ctx, cx, y, cw, 74, 18); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = DIM; ctx.font = F.monoBold(13); spaced(ctx, k, cx + 18, y + 28, 2);
    ctx.fillStyle = INK; const s = fitFont(ctx, F.bold, v, 24, cw - 34, 14); ctx.font = F.bold(s); ctx.fillText(v, cx + 18, y + 60);
  });
}
// emblem in the outcome colour: ▲ profit, ▼ loss, = breakeven, ◆ open/new
function emblem(ctx, kind, x, cy, s, col) {
  ctx.save(); ctx.fillStyle = col; ctx.beginPath();
  if (kind === 'win') { ctx.moveTo(x, cy + s / 2); ctx.lineTo(x + s, cy + s / 2); ctx.lineTo(x + s / 2, cy - s / 2); }
  else if (kind === 'loss') { ctx.moveTo(x, cy - s / 2); ctx.lineTo(x + s, cy - s / 2); ctx.lineTo(x + s / 2, cy + s / 2); }
  else if (kind === 'be') { ctx.rect(x, cy - s * 0.3, s, s * 0.18); ctx.rect(x, cy + s * 0.12, s, s * 0.18); }
  else { ctx.moveTo(x + s / 2, cy - s / 2); ctx.lineTo(x + s, cy); ctx.lineTo(x + s / 2, cy + s / 2); ctx.lineTo(x, cy); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

export function drawTradeCard(ctx, d) {
  const en = d.lang === 'en', tone = d.outcome === 'open' && d.heroTone ? d.heroTone : d.outcome, T = theme(tone), chipT = theme(d.outcome);
  page(ctx, { rgb: T.rgb, auraX: 0.26, auraY: 0.55, seed: hashStr(String(d.symbol) + d.stampMs) % 997 });
  const sub = { close: en ? 'POSITION CLOSED' : 'POSISI DITUTUP', snapshot: en ? 'OPEN POSITION' : 'POSISI BERJALAN', open: en ? 'NEW POSITION' : 'POSISI BARU', reposition: 'REPOSITION', reposition_failed: en ? 'REOPEN FAILED' : 'REOPEN GAGAL' }[d.event] || 'PNL CARD';
  topBar(ctx, { paper: d.paper, stamp: d.stampMs, subtitle: `WARLOCK 2.0 · ${sub}` });

  // token row
  const left = PAD, colW = 820;
  tokenBadge(ctx, left, 168, 92, { logoImg: d.logoImg, symbol: d.base });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const ns = fitFont(ctx, F.black, d.base, 60, 470, 30); ctx.font = F.black(ns); ctx.fillStyle = INK; ctx.fillText(d.base, left + 116, 222);
  const bw = ctx.measureText(d.base).width; ctx.font = F.semi(34); ctx.fillStyle = DIM; ctx.fillText(` / ${d.quote}`, left + 116 + bw, 222);
  let cx = left + 116; const label = d.event === 'close' ? (en ? chipT.label_en : chipT.label) : null;
  if (label) cx += chip(ctx, label, cx, 238, { col: chipT.main, h: 34, size: 15, dot: true }) + 12;
  chip(ctx, d.statusChip || '', cx, 238, { col: '#a6a1b8', h: 34, size: 15, fill: 0.08 });

  // hero
  ctx.fillStyle = DIM; ctx.font = F.monoBold(17); spaced(ctx, d.heroLabel || '', left, 356, 3);
  const heroCol = d.event === 'open' ? '#e9e5ff' : T.main;
  hero(ctx, left, 476, { amount: d.heroAmount, unit: d.heroUnit, col: heroCol, maxW: colW, size: 136 });
  // % chip + USD (small, grey)
  let y = 512, x = left;
  if (d.pctText) {
    ctx.font = F.bold(30); const tw = ctx.measureText(d.pctText).width, w = tw + 84;
    ctx.fillStyle = `rgba(${T.rgb},0.14)`; rrect(ctx, x, y, w, 56, 16); ctx.fill(); ctx.strokeStyle = `rgba(${T.rgb},0.45)`; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, 56, 16); ctx.stroke();
    emblem(ctx, tone, x + 20, y + 28, 22, T.main); ctx.fillStyle = T.main; ctx.textBaseline = 'middle'; ctx.fillText(d.pctText, x + 56, y + 30); ctx.textBaseline = 'alphabetic'; x += w + 22;
  }
  if (d.usdText) { ctx.fillStyle = SOFT; ctx.font = F.reg(28); ctx.textBaseline = 'middle'; ctx.fillText(truncate(ctx, d.usdText, colW - (x - left)), x, y + 30); ctx.textBaseline = 'alphabetic'; }

  // reason (+ breakeven note)
  const rl = d.event === 'open' ? (en ? 'OPEN REASON' : 'ALASAN BUKA') : /^reposition/.test(d.event) ? (en ? 'TRIGGER' : 'PEMICU') : d.event === 'snapshot' ? (en ? 'STATUS' : 'STATUS') : (en ? 'CLOSE REASON' : 'ALASAN TUTUP');
  ctx.fillStyle = DIM; ctx.font = F.monoBold(14); spaced(ctx, rl, left, 616, 2.5);
  ctx.fillStyle = INK; ctx.font = F.med(23); ctx.fillText(truncate(ctx, d.reason || '—', colW), left, 648);
  if (d.beNote || d.footNote) { ctx.fillStyle = d.beNote ? theme('be').main : '#fbbf24'; ctx.font = F.reg(18); ctx.fillText(truncate(ctx, d.beNote || d.footNote, colW), left, 676); }

  // bins (right)
  const px = 930, pw = CW - PAD - px;
  if (d.binShape) { drawBinShape(ctx, d.binShape, px, 166, pw, 344, { title: en ? 'LIQUIDITY BINS' : 'SEBARAN LIKUIDITAS' }); infoChips(ctx, binStats(d.binShape), px, 528, pw, en); }
  else { ctx.fillStyle = 'rgba(255,255,255,0.03)'; rrect(ctx, px, 166, pw, 436, 24); ctx.fill(); ctx.save(); ctx.globalAlpha = 0.5; emblem(ctx, tone, px + pw / 2 - 60, 384, 120, T.main); ctx.restore(); }

  // tiles
  const tiles = (d.tiles || []).slice(0, 4), gap = 20, tw = (CW - 2 * PAD - gap * (tiles.length - 1)) / Math.max(1, tiles.length);
  tiles.forEach((t, i) => tile(ctx, PAD + i * (tw + gap), 700, tw, 128, t));

  // footer
  ctx.textAlign = 'left'; ctx.fillStyle = SOFT; ctx.font = F.reg(17); ctx.fillText(truncate(ctx, d.meta || '', 1050), PAD, 866);
  ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = F.mono(15); ctx.fillText(d.paper ? (en ? 'dry run · not real money' : 'dry run · bukan uang asli') : (en ? 'not financial advice' : 'bukan saran finansial'), CW - PAD, 866); ctx.textAlign = 'left';
}
