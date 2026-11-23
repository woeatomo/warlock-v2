'use strict';
// Mini App appearance (woeatomo fork): wallpaper + glass settings. Cosmetic only: no funds, keys or bot settings.
// Prefs live in miniapp/appearance.json, the wallpaper in miniapp/public/bg.<ext> (both gitignored).
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({ glass: 0.6, blur: 10, dim: 0.55, bgVersion: 0 });
const LIMITS = Object.freeze({ glass: [0, 1], blur: [0, 30], dim: [0, 0.9] });
const BG_FILES = Object.freeze([['bg.jpg', 'image/jpeg'], ['bg.jpeg', 'image/jpeg'], ['bg.png', 'image/png'], ['bg.webp', 'image/webp']]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function clamp(v, [lo, hi]) { const n = Number(v); if (!Number.isFinite(n)) return null; return Math.min(hi, Math.max(lo, n)); }

function read(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = { ...DEFAULTS };
    for (const k of Object.keys(LIMITS)) { const c = clamp(j[k], LIMITS[k]); if (c != null) out[k] = c; }
    if (Number.isFinite(+j.bgVersion)) out.bgVersion = +j.bgVersion;
    return out;
  } catch { return { ...DEFAULTS }; }
}

function writeAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function update(file, input = {}) {
  const cur = read(file);
  for (const k of Object.keys(LIMITS)) {
    if (input[k] === undefined) continue;
    const c = clamp(input[k], LIMITS[k]);
    if (c == null) return { ok: false, error: 'Nilai ' + k + ' tidak valid' };
    cur[k] = Math.round(c * 100) / 100;
  }
  writeAtomic(file, cur);
  return { ok: true, prefs: cur };
}

function reset(file, publicDir) {
  const cur = { ...DEFAULTS, bgVersion: read(file).bgVersion };
  writeAtomic(file, cur);
  return { ok: true, prefs: cur, hasBg: !!findBg(publicDir) };
}

function findBg(publicDir) {
  for (const [f, type] of BG_FILES) {
    try { if (fs.statSync(path.join(publicDir, f)).isFile()) return { file: path.join(publicDir, f), type }; } catch { /* next */ }
  }
  return null;
}

// Accepts a data URL or bare base64. The type comes from the file's magic bytes, never from the client.
function detect(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'bg.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'bg.png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'bg.webp';
  return null;
}

function saveBg(file, publicDir, image) {
  if (typeof image !== 'string' || !image) return { ok: false, error: 'Gambar kosong' };
  const b64 = image.replace(/^data:image\/[a-z+]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { ok: false, error: 'Format gambar tidak valid' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { ok: false, error: 'Gambar kosong' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Gambar terlalu besar (maks 4 MB)' };
  const name = detect(buf);
  if (!name) return { ok: false, error: 'Hanya JPG, PNG atau WEBP' };
  removeBgFiles(publicDir);
  const target = path.join(publicDir, name), tmp = target + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
  const cur = read(file); cur.bgVersion = Date.now(); writeAtomic(file, cur);
  return { ok: true, prefs: cur, hasBg: true, bytes: buf.length };
}

function removeBgFiles(publicDir) {
  for (const [f] of BG_FILES) { try { fs.unlinkSync(path.join(publicDir, f)); } catch { /* absent */ } }
}

function deleteBg(file, publicDir) {
  removeBgFiles(publicDir);
  const cur = read(file); cur.bgVersion = Date.now(); writeAtomic(file, cur);
  return { ok: true, prefs: cur, hasBg: false };
}

module.exports = { DEFAULTS, LIMITS, BG_FILES, MAX_IMAGE_BYTES, read, update, reset, findBg, detect, saveBg, deleteBg };
