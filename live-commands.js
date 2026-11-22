'use strict';
// Manual LIVE open requests from the Mini App (owner initData + fresh auth + CSRF + double confirm, checked by the server).
// The Mini App only queues a request file; the live bot (sol-lp-live) takes at most one per cycle and opens through the SAME path as its own scan
// (targeted re-screen -> liveOpen). Nothing here signs or sends anything.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MAX_AGE_MS = 10 * 60 * 1000;   // a request older than this is dropped (market moved; ask again)
const ID_RE = /^[a-zA-Z0-9_-]{8,80}$/, POOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const dirs = (root) => ({ base: path.join(root, 'live-commands'), pending: path.join(root, 'live-commands', 'pending'), done: path.join(root, 'live-commands', 'done') });
function writeAtomic(file, obj) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, file); }
function pending(root) {
  const d = dirs(root).pending; if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => ID_RE.test(n.replace(/\.json$/, '')) && n.endsWith('.json')).map((n) => { try { return JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
function done(root, limit = 5) {
  const d = dirs(root).done; if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => n.endsWith('.json')).map((n) => { try { return JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, limit);
}
function queue(root, { pool, name, overrideFailedFilters = false, confirmedReasons = [], updatedBy, requestId = crypto.randomUUID() }) {
  if (!POOL_RE.test(String(pool || ''))) throw new Error('pool tidak valid');
  const id = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); if (!ID_RE.test(id)) throw new Error('requestId tidak valid');
  const d = dirs(root); fs.mkdirSync(d.pending, { recursive: true }); fs.mkdirSync(d.done, { recursive: true });
  if (fs.existsSync(path.join(d.pending, id + '.json')) || fs.existsSync(path.join(d.done, id + '.json'))) return { ok: true, id, duplicate: true };
  const openQ = pending(root).filter((r) => (r.type || 'open') === 'open');   // close requests have their own queue rules (queueClose)
  if (openQ.some((r) => r.pool === pool)) return { ok: false, error: 'Permintaan open pool ini sudah antre' };
  if (openQ.length >= 3) return { ok: false, error: 'Sudah ada 3 permintaan open antre; tunggu diproses' };
  const req = { id, type: 'open', pool, name: name || null, overrideFailedFilters: !!overrideFailedFilters, confirmedReasons: (confirmedReasons || []).map(String).slice(0, 20), updatedBy: updatedBy || null, at: new Date().toISOString() };
  writeAtomic(path.join(d.pending, id + '.json'), req);
  return { ok: true, id, queued: true };
}
// Bot side: oldest pending request (expired ones are finished as rejected first).
function take(root, now = Date.now()) {
  for (const r of pending(root)) {
    if ((r.type || 'open') !== 'open') continue;   // close requests are taken per position by takeClose
    if (!(now - Date.parse(r.at) <= MAX_AGE_MS)) { finish(root, r, { ok: false, error: 'Permintaan kedaluwarsa (>10 menit); tekan Open lagi' }); continue; }
    return r;
  }
  return null;
}
function finish(root, req, result) {
  const d = dirs(root); fs.mkdirSync(d.done, { recursive: true });
  writeAtomic(path.join(d.done, req.id + '.json'), { ...req, result, finishedAt: new Date().toISOString() });
  try { fs.unlinkSync(path.join(d.pending, req.id + '.json')); } catch { /* already gone */ }
  // keep the 30 newest results
  try { const all = fs.readdirSync(d.done).map((n) => ({ n, t: fs.statSync(path.join(d.done, n)).mtimeMs })).sort((a, b) => b.t - a.t); for (const x of all.slice(30)) fs.unlinkSync(path.join(d.done, x.n)); } catch { /* ignore */ }
}
// Manual LIVE close (22 Nov): one request per position; the live bot takes it while polling that position and closes through liveClose.
function queueClose(root, { pool, openedAt = null, name, updatedBy, requestId = crypto.randomUUID() }) {
  if (!POOL_RE.test(String(pool || ''))) throw new Error('pool tidak valid');
  const id = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); if (!ID_RE.test(id)) throw new Error('requestId tidak valid');
  const d = dirs(root); fs.mkdirSync(d.pending, { recursive: true }); fs.mkdirSync(d.done, { recursive: true });
  if (fs.existsSync(path.join(d.pending, id + '.json')) || fs.existsSync(path.join(d.done, id + '.json'))) return { ok: true, id, duplicate: true };
  if (pending(root).some((r) => r.type === 'close' && r.pool === pool)) return { ok: false, error: 'Permintaan tutup posisi ini sudah antre' };
  const req = { id, type: 'close', pool, openedAt: openedAt ? String(openedAt) : null, name: name || null, updatedBy: updatedBy || null, at: new Date().toISOString() };
  writeAtomic(path.join(d.pending, id + '.json'), req);
  return { ok: true, id, queued: true };
}
// Bot side: the close request for this position (pool, and openedAt when the request names one). Expired ones are finished as rejected.
function takeClose(root, pool, openedAt = null, now = Date.now()) {
  for (const r of pending(root)) {
    if (r.type !== 'close' || r.pool !== pool) continue;
    if (!(now - Date.parse(r.at) <= MAX_AGE_MS)) { finish(root, r, { ok: false, error: 'Permintaan kedaluwarsa (>10 menit); tekan Tutup lagi' }); continue; }
    if (r.openedAt && openedAt && r.openedAt !== openedAt) { finish(root, r, { ok: false, error: 'Posisi sudah berganti (dibuka ulang); tekan Tutup lagi' }); continue; }
    return r;
  }
  return null;
}
module.exports = { queue, pending, done, take, finish, queueClose, takeClose, MAX_AGE_MS };
