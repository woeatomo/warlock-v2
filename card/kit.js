// Warlock 2.0 card kit: premium dark page, top bar, token badge, chips, stat tiles. Pure drawing: every number arrives formatted.
import { loadImage } from 'canvas';
import { C, F, finite, spaced, fitFont, truncate, rrect, logoMark, formatWib, hashStr } from './wl.js';

export const W = 1600, H = 900, PAD = 64;
// outcome themes: profit green, loss red, breakeven slate-violet, open/neutral violet
export const THEME = {
  win: { main: '#4ade80', soft: '#86efac', rgb: '74,222,128', label: 'PROFIT', label_en: 'PROFIT' },
  loss: { main: '#f87171', soft: '#fca5a5', rgb: '248,113,113', label: 'RUGI', label_en: 'LOSS' },
  be: { main: '#c4b5fd', soft: '#ddd6fe', rgb: '167,139,250', label: 'BREAKEVEN', label_en: 'BREAKEVEN' },
  open: { main: '#a78bfa', soft: '#c4b5fd', rgb: '139,92,246', label: 'OPEN', label_en: 'OPEN' },
};
export const theme = (k) => THEME[k] || THEME.open;
export const INK = '#f5f3ff', SOFT = '#a6a1b8', DIM = '#6f6a82', LINE = 'rgba(255,255,255,0.07)';

export async function prepareImages(data) {
  const one = async (o) => { if (o && o.logoB64 && !o.logoImg) { try { o.logoImg = await loadImage(Buffer.from(o.logoB64, 'base64')); } catch { o.logoImg = null; } } };
  await one(data); for (const r of Array.isArray(data.rows) ? data.rows : []) await one(r);
}

// page: deep violet-black, a soft aura in the outcome colour behind the hero, faint W watermark, thin gradient frame
export function page(ctx, { rgb = THEME.open.rgb, auraX = 0.30, auraY = 0.52, seed = 7 } = {}) {
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#120e1f'); bg.addColorStop(0.5, '#0b0a12'); bg.addColorStop(1, '#08070c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = (cx, cy, r, c, a) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  glow(W * auraX, H * auraY, 620, rgb, 0.16); glow(W * 0.95, 0, 700, '124,58,237', 0.22); glow(0, H, 520, '124,58,237', 0.10);
  // fine dot grid
  ctx.fillStyle = 'rgba(196,181,253,0.045)'; for (let x = 40; x < W; x += 32) for (let y = 40; y < H; y += 32) ctx.fillRect(x, y, 1.6, 1.6);
  ctx.save(); ctx.globalAlpha = 0.035; logoMark(ctx, W - 560, 250, 600); ctx.restore();
  let h = hashStr(seed); ctx.fillStyle = 'rgba(221,214,254,0.16)'; for (let i = 0; i < 60; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; const x = h % W; h = Math.imul(h ^ (h >>> 11), 2246822519) >>> 0; ctx.beginPath(); ctx.arc(x, h % H, 0.6 + (h % 10) / 10, 0, 6.29); ctx.fill(); }
  ctx.save(); const bd = ctx.createLinearGradient(0, 0, W, H); bd.addColorStop(0, 'rgba(167,139,250,0.55)'); bd.addColorStop(0.5, 'rgba(167,139,250,0.12)'); bd.addColorStop(1, `rgba(${rgb},0.45)`);
  ctx.strokeStyle = bd; ctx.lineWidth = 2; rrect(ctx, 16, 16, W - 32, H - 32, 36); ctx.stroke(); ctx.restore();
}

// top bar: mark + SOL WARLOCK / subtitle, right: LIVE|DRY RUN chip + WIB stamp; hairline under it
export function topBar(ctx, { paper, stamp, subtitle }) {
  logoMark(ctx, PAD, 44, 58);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = INK; ctx.font = F.bold(27); spaced(ctx, 'SOL WARLOCK', PAD + 76, 76, 5);
  ctx.fillStyle = SOFT; ctx.font = F.mono(16); spaced(ctx, subtitle || 'WARLOCK 2.0 · METEORA DLMM', PAD + 77, 102, 2.5);
  const right = W - PAD; ctx.font = F.mono(18); ctx.fillStyle = SOFT; ctx.textAlign = 'right'; const s = typeof stamp === 'number' ? formatWib(stamp) : String(stamp || ''); ctx.fillText(s, right, 96);
  const sw = ctx.measureText(s).width; ctx.textAlign = 'left';
  status(ctx, paper, right - sw - 22, 74);
  ctx.fillStyle = LINE; ctx.fillRect(PAD, 136, W - 2 * PAD, 1.5);
}
function status(ctx, paper, xRight, cy) {
  const label = paper ? 'DRY RUN' : 'LIVE', col = paper ? '#fbbf24' : '#f87171'; ctx.font = F.monoBold(16);
  const w = ctx.measureText(label).width + label.length * 2 + 52, x = xRight - w;
  ctx.fillStyle = `${col}22`; rrect(ctx, x, cy - 19, w, 38, 19); ctx.fill(); ctx.strokeStyle = `${col}88`; ctx.lineWidth = 1.5; rrect(ctx, x, cy - 19, w, 38, 19); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 20, cy, 5.5, 0, 6.29); ctx.fill();
  ctx.textBaseline = 'middle'; spaced(ctx, label, x + 34, cy + 1, 2); ctx.textBaseline = 'alphabetic';
}

// token badge: the real logo in a circle, otherwise a coloured initial
export function tokenBadge(ctx, x, y, d, { logoImg, symbol = '?', ring = 'rgba(255,255,255,0.14)' } = {}) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, 6.29); ctx.closePath();
  if (logoImg) { ctx.clip(); ctx.fillStyle = '#1b1726'; ctx.fillRect(x, y, d, d); ctx.drawImage(logoImg, x, y, d, d); }
  else { const hue = hashStr(symbol) % 360, g = ctx.createLinearGradient(x, y, x + d, y + d); g.addColorStop(0, `hsl(${hue},70%,62%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},65%,40%)`); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = F.black(Math.round(d * 0.44)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(symbol).slice(0, 1).toUpperCase(), x + d / 2, y + d / 2 + 2); }
  ctx.restore(); ctx.save(); ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, 6.29); ctx.stroke(); ctx.restore();
}

// chip: tinted rounded label, returns its width
export function chip(ctx, text, x, y, { col = '#a78bfa', h = 40, size = 17, font = F.monoBold, spacing = 2.5, fill = 0.14, align = 'left', dot = false } = {}) {
  ctx.save(); ctx.font = font(size); const tw = ctx.measureText(text).width + spacing * Math.max(0, [...text].length - 1), padX = 18, w = tw + padX * 2 + (dot ? 18 : 0), left = align === 'right' ? x - w : x;
  ctx.globalAlpha = fill; ctx.fillStyle = col; rrect(ctx, left, y, w, h, h / 2); ctx.fill(); ctx.globalAlpha = 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1.5; rrect(ctx, left, y, w, h, h / 2); ctx.stroke(); ctx.globalAlpha = 1;
  if (dot) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(left + padX + 5, y + h / 2, 5, 0, 6.29); ctx.fill(); }
  ctx.fillStyle = col; ctx.textBaseline = 'middle'; spaced(ctx, text, left + padX + (dot ? 18 : 0), y + h / 2 + 1, spacing); ctx.restore(); return w;
}

// stat tile: label (mono caps), big value, small grey sub line
export function tile(ctx, x, y, w, h, { label, value, sub = '', col = INK, font = null }) {
  ctx.save(); const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,0.055)'); g.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = g; rrect(ctx, x, y, w, h, 22); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, h, 22); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = DIM; ctx.font = F.monoBold(15); spaced(ctx, String(label).toUpperCase(), x + 26, y + 40, 2.5);
  const ff = font === 'inter' ? F.cond : F.bold; ctx.fillStyle = col; const size = fitFont(ctx, ff, String(value), 40, w - 52, 22); ctx.font = ff(size); ctx.fillText(String(value), x + 26, y + (sub ? h - 46 : h - 30));
  if (sub) { ctx.fillStyle = SOFT; ctx.font = F.reg(18); ctx.fillText(truncate(ctx, sub, w - 52), x + 26, y + h - 18); }
  ctx.restore();
}

// hero number: big amount + unit; auto-shrinks to fit maxW. Returns the drawn width.
export function hero(ctx, x, y, { amount, unit, col, maxW, size = 132 }) {
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let s = size; const uw = () => (ctx.font = F.bold(Math.round(s * 0.42)), ctx.measureText(' ' + unit).width);
  for (;;) { ctx.font = F.black(s); const aw = ctx.measureText(amount).width; if (aw + uw() <= maxW || s <= 56) break; s -= 4; }
  ctx.font = F.black(s); const aw = ctx.measureText(amount).width;
  ctx.shadowColor = col; ctx.shadowBlur = 38; ctx.fillStyle = col; ctx.fillText(amount, x, y); ctx.shadowBlur = 0;
  ctx.font = F.bold(Math.round(s * 0.42)); ctx.globalAlpha = 0.85; ctx.fillText(' ' + unit, x + aw, y); ctx.restore();
  return { width: aw + uw(), size: s };
}
export { C, F, finite, spaced, fitFont, truncate, rrect, logoMark, formatWib, hashStr };
