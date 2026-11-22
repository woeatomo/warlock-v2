'use strict';
// RPC 1/2/3 typed in the mini app (Wallet, under the private key). Stored server-side only in <secretsDir>/rpc.env (dir 700, file 600),
// written tmp + fsync + rename with a .bak of the previous file. Values never leave the server except as the last 5 characters (mask()).
// rpc-config.js reads the same file (hot reload), so the bot and the mini app pick a change up within ~10 s.
const fs = require('fs'), path = require('path');
const rpcConfig = require('./rpc-config');
const KEYS = ['RPC_URL_1', 'RPC_URL_2', 'RPC_URL_3'];
function file(secretsDir) { return path.join(secretsDir, 'rpc.env'); }
function read(secretsDir) { try { return rpcConfig.parseSlotsFile(fs.readFileSync(file(secretsDir), 'utf8')); } catch { return {}; } }
function mask(u) { const s = String(u || ''); return s ? '•••••' + s.slice(-5) : ''; }
function err(msg) { const e = new Error(msg); e.expose = true; return e; }
// https only, a host, no spaces / quotes / control characters, sane length. The error text never echoes the value.
function validate(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) throw err('URL kosong');
  if (s.length > 512) throw err('URL terlalu panjang');
  if (/[\s"'`<>\\\u0000-\u001f\u007f]/.test(s)) throw err('URL berisi karakter tidak valid');
  let x; try { x = new URL(s); } catch { throw err('URL tidak valid'); }
  if (x.protocol !== 'https:') throw err('RPC harus https://');
  if (!x.hostname || x.username || x.password) throw err('URL tidak valid');
  return s;
}
function writeAtomic(secretsDir, vals) {
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 }); try { fs.chmodSync(secretsDir, 0o700); } catch { /* ignore */ }
  const f = file(secretsDir), tmp = f + '.' + process.pid + '.tmp';
  const text = '# RPC slots saved from the mini app. Secret: never commit, never share. Empty = slot cleared.\n' + KEYS.filter(k => k in vals).map(k => k + '=' + JSON.stringify(String(vals[k] || ''))).join('\n') + '\n';
  if (fs.existsSync(f)) { const b = f + '.bak', bt = b + '.tmp'; fs.writeFileSync(bt, fs.readFileSync(f), { mode: 0o600 }); try { fs.chmodSync(bt, 0o600); } catch { /* ignore */ } fs.renameSync(bt, b); }
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.chmodSync(tmp, 0o600); } catch { /* ignore */ }
  fs.renameSync(tmp, f); try { fs.chmodSync(f, 0o600); } catch { /* ignore */ }
}
// Effective view per slot with the SAME resolution the failover uses: { slot, configured, mask, source: miniapp|env|none }.
function view(secretsDir) {
  const prev = process.env.LP_RPC_FILE; process.env.LP_RPC_FILE = file(secretsDir); rpcConfig._reloadFile();
  try {
    return [1, 2, 3].map(n => { const s = rpcConfig.slotSource(n); return { slot: n, configured: !!s.url, mask: mask(s.url), source: s.url ? s.source : 'none' }; });
  } finally { if (prev == null) delete process.env.LP_RPC_FILE; else process.env.LP_RPC_FILE = prev; rpcConfig._reloadFile(); }
}
function save(secretsDir, slot, url) {
  const n = Number(slot); if (![1, 2, 3].includes(n)) throw err('slot harus 1, 2 atau 3');
  const v = validate(url), vals = read(secretsDir); vals['RPC_URL_' + n] = v; writeAtomic(secretsDir, vals);
  return view(secretsDir);
}
// Clear: slot 2/3 always; slot 1 only if another RPC source stays (an old SOLANA_RPC_URL/HELIUS_API_KEY in .env, or slot 2/3).
function clear(secretsDir, slot) {
  const n = Number(slot); if (![1, 2, 3].includes(n)) throw err('slot harus 1, 2 atau 3');
  const vals = read(secretsDir), next = { ...vals, ['RPC_URL_' + n]: '' };
  if (n === 1) {
    const prevF = process.env.LP_RPC_FILE, f = file(secretsDir) + '.check'; let ok = false;
    try { process.env.LP_RPC_FILE = f; fs.writeFileSync(f, KEYS.filter(k => k in next).map(k => k + '=' + JSON.stringify(String(next[k] || ''))).join('\n'), { mode: 0o600 }); rpcConfig._reloadFile();
      ok = rpcConfig.slots().some(s => s.url !== rpcConfig.PUBLIC); }
    finally { try { fs.unlinkSync(f); } catch { /* ignore */ } if (prevF == null) delete process.env.LP_RPC_FILE; else process.env.LP_RPC_FILE = prevF; rpcConfig._reloadFile(); }
    if (!ok) throw err('RPC 1 tidak bisa dikosongkan: tidak ada RPC lain (isi RPC 2/3 dulu)');
  }
  writeAtomic(secretsDir, next);
  return view(secretsDir);
}
module.exports = { file, read, mask, validate, view, save, clear };
