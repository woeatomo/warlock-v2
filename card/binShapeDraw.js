// Bin shape panel for the Warlock cards (same look as the Mini App chart): chunky gradient bars (quote side teal, token side violet), no lines,
// the active bin as a soft glowing band with a marker, range edges, legend. Wide ranges are grouped (max 36 bars) so the bars stay fat.
// model = { bins: [[id, quoteEq, tokenEq], ...], active, approx }
import { C, F, finite, spaced } from './wl.js';

function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
function topRound(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr); ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export function drawBinShape(ctx, model, x, y, w, h, { title = 'BIN SHAPE' } = {}) {
  if (!model || !Array.isArray(model.bins) || !model.bins.length) return;
  ctx.save();
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, 'rgba(30,22,50,0.78)'); bg.addColorStop(1, 'rgba(14,14,20,0.78)');
  ctx.fillStyle = bg; rrect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(167,139,250,0.35)'; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, h, 14); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.soft; ctx.font = F.monoBold(14);
  spaced(ctx, title, x + 16, y + 22, 3);
  if (model.approx) { ctx.textAlign = 'right'; ctx.font = F.mono(13); ctx.fillStyle = C.soft; ctx.fillText('approx. from range', x + w - 14, y + 22); }

  // group wide ranges into at most 36 fat bars
  const raw = model.bins, k = Math.max(1, Math.ceil(raw.length / 36)), bars = [];
  for (let i = 0; i < raw.length; i += k) {
    const g = raw.slice(i, i + k);
    bars.push({ first: g[0][0], last: g[g.length - 1][0], sol: g.reduce((a, b) => a + (b[1] || 0), 0), tok: g.reduce((a, b) => a + (b[2] || 0), 0) });
  }
  const ix = x + 14, iw = w - 28, top = y + 50, base = y + h - 26, ch = base - top;
  const n = bars.length, step = iw / n, gap = Math.min(3, step * 0.14), bw = Math.max(1, step - gap);
  const max = Math.max(1e-12, ...bars.map((b) => b.sol + b.tok));
  const idx = finite(model.active) ? bars.findIndex((b) => model.active >= b.first && model.active <= b.last) : -1;
  const ax = idx >= 0 ? ix + (idx + 0.5) * step : null;

  const solG = ctx.createLinearGradient(0, base, 0, top);
  solG.addColorStop(0, '#0f766e'); solG.addColorStop(0.55, '#14b8a6'); solG.addColorStop(1, '#5eead4');
  const tokG = ctx.createLinearGradient(0, base, 0, top);
  tokG.addColorStop(0, '#5b21b6'); tokG.addColorStop(0.55, '#8b5cf6'); tokG.addColorStop(1, '#ddd6fe');
  if (ax != null) {   // soft band behind the active bar (no line)
    const band = ctx.createLinearGradient(0, top - 2, 0, base);
    band.addColorStop(0, 'rgba(233,213,255,0.30)'); band.addColorStop(1, 'rgba(233,213,255,0)');
    ctx.fillStyle = band; rrect(ctx, ax - step * 0.9, top - 2, step * 1.8, ch + 2, step * 0.6); ctx.fill();
  }
  bars.forEach((b, i) => {
    const bx = ix + i * step + gap / 2, sh = (b.sol / max) * ch, th = (b.tok / max) * ch, r = Math.min(4, bw / 2);
    if (sh > 0.4) { ctx.fillStyle = solG; topRound(ctx, bx, base - sh, bw, sh, th > 0.4 ? 0 : r); ctx.fill(); }
    if (th > 0.4) { ctx.fillStyle = tokG; topRound(ctx, bx, base - sh - th, bw, th, r); ctx.fill(); }
  });
  if (ax != null) {
    ctx.save(); ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 12; ctx.fillStyle = '#f0edf8';
    ctx.beginPath(); ctx.moveTo(ax - 6, top - 13); ctx.lineTo(ax + 6, top - 13); ctx.lineTo(ax, top - 2); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.font = F.mono(12); ctx.fillStyle = C.soft; ctx.textAlign = 'left'; ctx.fillText(String(raw[0][0]), ix, y + h - 8);
  ctx.textAlign = 'right'; ctx.fillText(String(raw[raw.length - 1][0]), ix + iw, y + h - 8);
  ctx.textAlign = 'center'; ctx.fillText('quote', x + w / 2 - 36, y + h - 8); ctx.fillText('token', x + w / 2 + 36, y + h - 8);
  ctx.fillStyle = '#14b8a6'; ctx.beginPath(); ctx.arc(x + w / 2 - 70, y + h - 12, 4, 0, 6.28); ctx.fill();
  ctx.fillStyle = '#8b5cf6'; ctx.beginPath(); ctx.arc(x + w / 2 + 2, y + h - 12, 4, 0, 6.28); ctx.fill();
  ctx.restore();
}
