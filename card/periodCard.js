// Warlock 2.0 period PnL card (daily / weekly / monthly, also the 07:00 WIB recap): hero total in SOL, W · L · BE tiles,
// and on the right the trades of the day, the 7 days of the week, or the month as a calendar heat map.
import { W, H, PAD, theme, INK, SOFT, DIM, page, topBar, tokenBadge, chip, tile, hero, F, spaced, fitFont, truncate, rrect, hashStr } from './kit.js';

function panel(ctx, x, y, w, h, title, right) {
  ctx.fillStyle = 'rgba(255,255,255,0.035)'; rrect(ctx, x, y, w, h, 24); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, h, 24); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = DIM; ctx.font = F.monoBold(14); spaced(ctx, title, x + 26, y + 38, 2.5);
  if (right) { ctx.textAlign = 'right'; ctx.font = F.mono(14); ctx.fillText(right, x + w - 26, y + 38); ctx.textAlign = 'left'; }
}
function tradeList(ctx, d, x, y, w, h) {
  const en = d.lang === 'en'; panel(ctx, x, y, w, h, en ? 'CLOSED TODAY' : 'POSISI DITUTUP', d.more ? `+${d.more} ${en ? 'more' : 'lagi'}` : `${d.rows.length} trade`);
  if (!d.rows.length) { ctx.fillStyle = SOFT; ctx.font = F.reg(22); ctx.textAlign = 'center'; ctx.fillText(en ? 'No closed trades yet' : 'Belum ada trade ditutup', x + w / 2, y + h / 2); ctx.textAlign = 'left'; return; }
  const rh = Math.min(76, (h - 70) / Math.max(1, d.rows.length));
  d.rows.forEach((r, i) => {
    const ry = y + 62 + i * rh, T = theme(r.outcome), cy = ry + rh / 2;
    if (i) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + 24, ry, w - 48, 1); }
    tokenBadge(ctx, x + 24, cy - 22, 44, { logoImg: r.logoImg, symbol: r.base });
    ctx.fillStyle = INK; ctx.font = F.bold(24); ctx.textBaseline = 'alphabetic'; ctx.fillText(truncate(ctx, r.base, 170), x + 84, cy - 2);
    ctx.fillStyle = DIM; ctx.font = F.mono(14); ctx.fillText(r.time, x + 84, cy + 22);
    const tag = r.outcome === 'win' ? 'W' : r.outcome === 'loss' ? 'L' : 'BE';
    ctx.textAlign = 'right'; ctx.fillStyle = T.main; ctx.font = F.bold(24); ctx.fillText(r.amount, x + w - 84, cy - 2);
    ctx.fillStyle = SOFT; ctx.font = F.reg(16); ctx.fillText(r.pct, x + w - 84, cy + 22); ctx.textAlign = 'left';
    ctx.font = F.monoBold(14); const tw = 44; ctx.fillStyle = `rgba(${T.rgb},0.16)`; rrect(ctx, x + w - 24 - tw, cy - 15, tw, 30, 10); ctx.fill();
    ctx.fillStyle = T.main; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tag, x + w - 24 - tw / 2, cy + 1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });
}
function weekBars(ctx, d, x, y, w, h) {
  const en = d.lang === 'en'; panel(ctx, x, y, w, h, en ? 'PNL PER DAY · SOL' : 'PNL PER HARI · SOL', '');
  const days = d.days.slice(0, 7), max = Math.max(1e-9, ...days.map((v) => Math.abs(v.pnl))), top = y + 80, bot = y + h - 70, mid = (top + bot) / 2, half = (bot - top) / 2 - 18;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(x + 24, mid); ctx.lineTo(x + w - 24, mid); ctx.stroke(); ctx.setLineDash([]);
  const cw = (w - 48) / 7;
  days.forEach((v, i) => {
    const cx = x + 24 + i * cw + cw / 2, bwid = cw * 0.52, T = theme(v.n ? (Math.abs(v.pnl) < 1e-12 ? 'be' : v.pnl > 0 ? 'win' : 'loss') : 'open'), bh = v.n ? Math.max(6, (Math.abs(v.pnl) / max) * half) : 0;
    if (v.n) { const g = ctx.createLinearGradient(0, mid - bh, 0, mid + bh); g.addColorStop(0, T.main); g.addColorStop(1, `rgba(${T.rgb},0.45)`); ctx.fillStyle = g; rrect(ctx, cx - bwid / 2, v.pnl >= 0 ? mid - bh : mid, bwid, bh, 8); ctx.fill();
      ctx.fillStyle = T.main; ctx.font = F.bold(15); ctx.textAlign = 'center'; ctx.fillText(v.text, cx, v.pnl >= 0 ? mid - bh - 10 : mid + bh + 22); }
    else { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(cx, mid, 4, 0, 6.29); ctx.fill(); }
    ctx.textAlign = 'center'; ctx.fillStyle = SOFT; ctx.font = F.med(17); ctx.fillText(d.dayNames[i], cx, bot + 30); ctx.fillStyle = DIM; ctx.font = F.mono(14); ctx.fillText(v.label, cx, bot + 52);
  });
  ctx.textAlign = 'left';
}
function monthGrid(ctx, d, x, y, w, h) {
  const en = d.lang === 'en'; panel(ctx, x, y, w, h, en ? 'PNL CALENDAR · SOL' : 'KALENDER PNL · SOL', '');
  const first = new Date(d.days[0].start + 7 * 3600e3), lead = (first.getUTCDay() + 6) % 7, rows = Math.ceil((lead + d.days.length) / 7);
  const gx = x + 22, gy = y + 84, cw = (w - 44) / 7, ch = Math.min(70, (h - 100) / rows), max = Math.max(1e-9, ...d.days.map((v) => Math.abs(v.pnl)));
  ctx.textAlign = 'center'; ctx.fillStyle = DIM; ctx.font = F.mono(13); d.dayNames.forEach((n, i) => ctx.fillText(n.toUpperCase(), gx + i * cw + cw / 2, gy - 12));
  d.days.forEach((v, i) => {
    const k = lead + i, cx = gx + (k % 7) * cw, cy = gy + Math.floor(k / 7) * ch, T = theme(v.n ? (Math.abs(v.pnl) < 1e-12 ? 'be' : v.pnl > 0 ? 'win' : 'loss') : 'open');
    const a = v.n ? 0.16 + 0.5 * Math.min(1, Math.abs(v.pnl) / max) : 0.04;
    ctx.fillStyle = v.n ? `rgba(${T.rgb},${a.toFixed(2)})` : 'rgba(255,255,255,0.035)'; rrect(ctx, cx + 3, cy + 3, cw - 6, ch - 6, 12); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = v.n ? INK : DIM; ctx.font = F.semi(15); ctx.fillText(v.label, cx + 13, cy + 25);
    if (v.n) { ctx.textAlign = 'right'; ctx.fillStyle = T.soft; ctx.font = F.bold(13); ctx.fillText(v.text.replace(/^([+−±])0\./, '$1.'), cx + cw - 11, cy + ch - 15); }
  });
  ctx.textAlign = 'left';
}

export function drawPeriodCard(ctx, d) {
  const T = theme(d.outcome), en = d.lang === 'en';
  page(ctx, { rgb: T.rgb, auraX: 0.25, auraY: 0.55, seed: hashStr(d.title + d.heroAmount) % 997 });
  topBar(ctx, { paper: d.paper, stamp: d.stampMs, subtitle: d.subtitle });
  const left = PAD, colW = 820;
  let cx = left; cx += chip(ctx, d.kindChip, cx, 166, { col: '#a78bfa', h: 36, size: 15 }) + 12;
  if (d.outcome !== 'open') chip(ctx, en ? T.label_en : T.label, cx, 166, { col: T.main, h: 36, size: 15, dot: true });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = INK; const ts = fitFont(ctx, F.bold, d.title, 52, colW, 30); ctx.font = F.bold(ts); ctx.fillText(d.title, left, 256);
  ctx.fillStyle = DIM; ctx.font = F.mono(17); ctx.fillText(d.range, left, 292);
  ctx.fillStyle = DIM; ctx.font = F.monoBold(17); spaced(ctx, d.heroLabel, left, 372, 3);
  hero(ctx, left, 490, { amount: d.heroAmount, unit: d.heroUnit, col: d.outcome === 'open' ? '#c4b5fd' : T.main, maxW: colW, size: 136 });
  let x = left; const y = 526;
  if (d.pctText) { ctx.font = F.bold(30); const w = ctx.measureText(d.pctText).width + 44; ctx.fillStyle = `rgba(${T.rgb},0.14)`; rrect(ctx, x, y, w, 56, 16); ctx.fill(); ctx.strokeStyle = `rgba(${T.rgb},0.45)`; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, 56, 16); ctx.stroke();
    ctx.fillStyle = T.main; ctx.textBaseline = 'middle'; ctx.fillText(d.pctText, x + 22, y + 30); x += w + 22; }
  ctx.fillStyle = SOFT; ctx.font = F.reg(26); ctx.textBaseline = 'middle'; ctx.fillText(truncate(ctx, d.usdText || '', colW - (x - left)), x, y + 30); ctx.textBaseline = 'alphabetic';
  if (d.best || d.worst) { ctx.font = F.reg(19); ctx.fillStyle = SOFT; let bx = left;
    if (d.best) { ctx.fillStyle = theme('win').main; ctx.fillText('▲', bx, 640); ctx.fillStyle = SOFT; ctx.fillText(`${en ? 'Best' : 'Terbaik'}  ${d.best}`, bx + 26, 640); bx += ctx.measureText(`${en ? 'Best' : 'Terbaik'}  ${d.best}`).width + 60; }
    if (d.worst) { ctx.fillStyle = theme('loss').main; ctx.fillText('▼', bx, 640); ctx.fillStyle = SOFT; ctx.fillText(`${en ? 'Worst' : 'Terburuk'}  ${d.worst}`, bx + 26, 640); } }

  const px = 930, pw = W - PAD - px, py = 166, ph = 506;
  if (d.kind === 'day') tradeList(ctx, d, px, py, pw, ph); else if (d.kind === 'week') weekBars(ctx, d, px, py, pw, ph); else monthGrid(ctx, d, px, py, pw, ph);

  const tiles = d.tiles || [], gap = 20, tw = (W - 2 * PAD - gap * (tiles.length - 1)) / Math.max(1, tiles.length);
  tiles.forEach((t, i) => tile(ctx, PAD + i * (tw + gap), 700, tw, 128, { ...t, col: i === 1 && d.outcome !== 'open' ? INK : INK }));
  ctx.textAlign = 'left'; ctx.fillStyle = SOFT; ctx.font = F.reg(17); ctx.fillText(d.meta || '', PAD, 866);
  ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = F.mono(15); ctx.fillText(d.paper ? (en ? 'dry run · not real money' : 'dry run · bukan uang asli') : (en ? 'not financial advice' : 'bukan saran finansial'), W - PAD, 866); ctx.textAlign = 'left';
}
