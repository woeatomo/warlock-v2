// Warlock card kit (original design): dark violet "arcane" glass. No paper, stamps, tickets or serif type; system DejaVu fonts (wide, techy).
export const C = {
  bg: '#0b0b0f', panel: '#15151c', ink: '#f0edf8', soft: '#8e899f', line: '#272531',
  violet: '#8b5cf6', violetSoft: '#a78bfa', violetPale: '#c4b5fd',
  green: '#4ade80', greenDeep: '#86efac', red: '#f87171', redDeep: '#fca5a5', amber: '#fbbf24', teal: '#14b8a6',
};
// Fonts (bundled in card/fonts, OFL; registered in render.js): Sora for numbers/titles, Inter for text, IBM Plex Mono for labels. DejaVu fallback.
export const F = {
  bold: (px) => `700 ${px}px Sora, "DejaVu Sans", sans-serif`,
  black: (px) => `800 ${px}px Sora, "DejaVu Sans", sans-serif`,
  semi: (px) => `600 ${px}px Sora, "DejaVu Sans", sans-serif`,
  cond: (px) => `700 ${px}px Inter, "DejaVu Sans Condensed", sans-serif`,
  reg: (px) => `400 ${px}px Inter, "DejaVu Sans", sans-serif`,
  med: (px) => `600 ${px}px Inter, "DejaVu Sans", sans-serif`,
  mono: (px) => `500 ${px}px "Plex Mono", "DejaVu Sans Mono", monospace`,
  monoBold: (px) => `600 ${px}px "Plex Mono", "DejaVu Sans Mono", monospace`,
};
export const finite = (v) => v != null && Number.isFinite(Number(v));
export const rgb = { green: '74,222,128', red: '248,113,113', violet: '139,92,246' };

// ---- numbers: SOL with 2 digits after the point, USD/USDC without decimals (2 only under $1), percent with 2
export function fmtSol(v, dec = 2, signed = true) {
  if (!finite(v)) return '—';
  const n = Number(v), s = Math.abs(n).toFixed(dec);
  return `${signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : ''}${s}`;
}
export function fmtUsd(v, { signed = false } = {}) {
  if (!finite(v)) return '—';
  const n = Number(v), a = Math.abs(n), d = a > 0 && a < 1 ? 2 : 0;
  return `${signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : (n < 0 ? '−' : '')}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
export function fmtPct(v, dec = 2, signed = true) {
  if (!finite(v)) return '—';
  const n = Number(v);
  return `${signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : ''}${Math.abs(n).toFixed(dec)}%`;
}
export function formatHold(ms) {
  if (!finite(ms) || ms <= 0) return '—';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} sec`;
  const m = Math.round(ms / 60000); if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60; if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export function formatWib(ms) {
  if (!finite(ms)) return '';
  const d = new Date(ms + 7 * 3600e3), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()], p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} WIB`;
}
export function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- text helpers
export function spaced(ctx, text, x, y, spacing = 0, align = 'left') {
  const chars = [...String(text)], widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const prev = ctx.textAlign; ctx.textAlign = 'left';
  chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = prev; return total;
}
export function fitFont(ctx, fontFn, text, px, maxW, min = 20) { let size = px; ctx.font = fontFn(size); while (size > min && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = fontFn(size); } return size; }
export function truncate(ctx, text, maxW) { let t = String(text); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1); return `${t}…`; }

// ---- shapes
export function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr); ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr); ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr); ctx.closePath();
}
export function glass(ctx, x, y, w, h, r = 26, { tint = '139,92,246', alpha = 0.10, border = 0.30 } = {}) {
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(${tint},${alpha + 0.06})`); g.addColorStop(1, `rgba(${tint},${alpha * 0.4})`);
  ctx.fillStyle = 'rgba(16,14,26,0.62)'; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.fillStyle = g; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = `rgba(${tint},${border})`; ctx.lineWidth = 1.5; rrect(ctx, x, y, w, h, r); ctx.stroke();
  ctx.restore();
}
export function pill(ctx, text, x, y, { color = C.violetSoft, size = 20, align = 'left', fill = 0.14, padX = 20, h = 40, font = F.monoBold, spacing = 3 } = {}) {
  ctx.save(); ctx.font = font(size);
  const w = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1) + padX * 2, left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = color; ctx.globalAlpha = fill; rrect(ctx, left, y, w, h, h / 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = color; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; rrect(ctx, left, y, w, h, h / 2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; spaced(ctx, text, left + padX, y + h / 2 + 1, spacing); ctx.restore();
  return w;
}
export function arrow(ctx, x, y, size, up, color) {
  ctx.save(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.beginPath();
  if (up) { ctx.moveTo(x, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size / 2, y); } else { ctx.moveTo(x, y); ctx.lineTo(x + size, y); ctx.lineTo(x + size / 2, y + size); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

// ---- Warlock mark: violet shield, light W, amber star (same geometry as miniapp/public/logo.svg, viewBox 0 0 24 24)
export function logoMark(ctx, x, y, size) {
  const k = size / 24; ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  const g = ctx.createLinearGradient(3, 1.8, 21, 22.6); g.addColorStop(0, '#a78bfa'); g.addColorStop(1, '#7c3aed'); ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(12, 1.8); ctx.lineTo(21, 5.2); ctx.lineTo(21, 13); ctx.bezierCurveTo(21, 17.8, 17, 21.3, 12, 22.6); ctx.bezierCurveTo(7, 21.3, 3, 17.8, 3, 13); ctx.lineTo(3, 5.2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f0edf8'; ctx.lineWidth = 2.2; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.miterLimit = 10;
  ctx.beginPath(); ctx.moveTo(6.2, 8.4); ctx.lineTo(9.1, 17); ctx.lineTo(12, 11.2); ctx.lineTo(14.9, 17); ctx.lineTo(17.8, 8.4); ctx.stroke();
  ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.moveTo(12, 3.4); ctx.lineTo(12.8, 5.2); ctx.lineTo(14.6, 6); ctx.lineTo(12.8, 6.8); ctx.lineTo(12, 8.6); ctx.lineTo(11.2, 6.8); ctx.lineTo(9.4, 6); ctx.lineTo(11.2, 5.2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---- page: violet-black gradient, hex grid, aura behind the hero number, W watermark, rounded glow border
export function backdrop(ctx, W, H, { aura = rgb.violet, frame = C.violet, seed = 7 } = {}) {
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#150f26'); bg.addColorStop(0.55, '#0d0c14'); bg.addColorStop(1, '#0a0a0f');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // hex grid
  ctx.strokeStyle = 'rgba(167,139,250,0.05)'; ctx.lineWidth = 1.2; const R = 44, hh = Math.sqrt(3) * R;
  for (let col = -1; col < W / (R * 1.5) + 2; col++) for (let row = -1; row < H / hh + 2; row++) {
    const cx = col * R * 1.5, cy = row * hh + (col % 2 ? hh / 2 : 0); ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i, px = cx + R * Math.cos(a), py = cy + R * Math.sin(a); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.stroke();
  }
  const glow = (cx, cy, rad, color, a) => { const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad); g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  glow(W * 0.27, H * 0.46, 640, aura, 0.20); glow(W * 0.9, H * 0.12, 620, rgb.violet, 0.28); glow(W * 0.05, H * 1.0, 480, rgb.violet, 0.12);
  ctx.save(); ctx.globalAlpha = 0.045; logoMark(ctx, W - 700, 130, 640); ctx.restore();
  const r = rng(seed); for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(196,181,253,${(0.05 + r() * 0.2).toFixed(3)})`; ctx.beginPath(); ctx.arc(r() * W, r() * H, 0.5 + r() * 1.4, 0, 6.28); ctx.fill(); }
  ctx.save(); const bd = ctx.createLinearGradient(0, 0, W, H); bd.addColorStop(0, frame); bd.addColorStop(1, 'rgba(139,92,246,0.35)'); ctx.strokeStyle = bd; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; rrect(ctx, 18, 18, W - 36, H - 36, 34); ctx.stroke(); ctx.restore();
}
export function header(ctx, W, { paper, stamp, subtitle = 'PNL CARD' }) {
  logoMark(ctx, 64, 50, 78);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = F.bold(38); spaced(ctx, 'WARLOCK', 158, 96, 8);
  ctx.fillStyle = C.soft; ctx.font = F.mono(15); spaced(ctx, subtitle, 160, 126, 6);
  pill(ctx, paper ? 'DRY RUN' : 'LIVE', W - 64, 52, { color: paper ? C.violetSoft : C.red, align: 'right', size: 19, h: 38 });
  ctx.fillStyle = C.soft; ctx.font = F.mono(19); ctx.textAlign = 'right'; ctx.fillText(stamp, W - 64, 120); ctx.textAlign = 'left';
}
// a glass capsule with an icon, label, big value and a small note
export function capsule(ctx, x, y, w, h, { label, value, note = '', icon = 'in', color = C.violetSoft }) {
  glass(ctx, x, y, w, h, 28);
  ctx.save(); ctx.translate(x + 40, y + 42);
  ctx.fillStyle = 'rgba(139,92,246,0.18)'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.28); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  if (icon === 'in') { ctx.moveTo(0, -9); ctx.lineTo(0, 8); ctx.moveTo(-7, 2); ctx.lineTo(0, 9); ctx.lineTo(7, 2); }
  else if (icon === 'out') { ctx.moveTo(0, 9); ctx.lineTo(0, -8); ctx.moveTo(-7, -2); ctx.lineTo(0, -9); ctx.lineTo(7, -2); }
  else if (icon === 'win') { ctx.moveTo(-9, 4); ctx.lineTo(-3, -3); ctx.lineTo(2, 2); ctx.lineTo(9, -7); }
  else if (icon === 'loss') { ctx.moveTo(-9, -6); ctx.lineTo(-3, 1); ctx.lineTo(2, -4); ctx.lineTo(9, 6); }
  else { ctx.arc(0, 0, 9, 0, 6.28); ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(5, 3); }
  ctx.stroke(); ctx.restore();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.soft; ctx.font = F.monoBold(16); spaced(ctx, label, x + 78, y + 48, 5);
  ctx.fillStyle = C.ink; const size = fitFont(ctx, F.bold, value, 54, w - 70 - (note ? 130 : 0), 26); ctx.font = F.bold(size); ctx.fillText(value, x + 36, y + h - 34);
  if (note) { ctx.fillStyle = C.soft; ctx.font = F.mono(19); ctx.textAlign = 'right'; ctx.fillText(note, x + w - 34, y + h - 36); ctx.textAlign = 'left'; }
}
