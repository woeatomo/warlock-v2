#!/usr/bin/env node
// Input kunci wallet bot lewat terminal (SSH). Kunci diketik tersembunyi, tidak lewat tunnel, tidak masuk riwayat shell.
// Hanya mencetak alamat publik. Jalankan sebagai user lpbot dari folder bot:
//   sudo -u lpbot node set-wallet-key.js
'use strict';
const fs = require('fs');
const path = require('path');
require('./env-config').load(__dirname);
const walletStore = require('./wallet-store');

const secretsDir = path.resolve(process.env.LP_SECRETS_DIR || path.join(__dirname, 'secrets'));
const expected = path.resolve(path.join(__dirname, 'secrets'));
function die(m) { process.stderr.write(m + '\n'); process.exit(1); }

if (!process.stdin.isTTY) die('Harus dijalankan di terminal interaktif (bukan pipe).');
if (secretsDir !== expected) die('LP_SECRETS_DIR tidak sama dengan folder secrets bot: ' + secretsDir + ' (batal)');
if (process.getuid && process.getuid() === 0) die('Jangan jalankan sebagai root; pakai user lpbot.');
if (!fs.existsSync(secretsDir)) die('Folder secrets tidak ada: ' + secretsDir);

function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\nBatal.\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const meta = walletStore.readEnvelopeMeta(secretsDir);
  if (meta && meta.hasKey) {
    const a = await readHidden('Sudah ada kunci (alamat ' + meta.publicAddress + '). Ketik TIMPA untuk mengganti: ');
    if (a.trim() !== 'TIMPA') die('Batal, kunci lama tidak diubah.');
  }
  let secret = await readHidden('Private key (base58 atau array JSON, tidak tampil): ');
  let saved;
  try { saved = walletStore.saveKey(secret, secretsDir); }
  catch (e) { secret = ''; die('Gagal: ' + (e && e.expose ? e.message : 'kunci tidak valid')); }
  secret = '';
  console.log('Tersimpan terenkripsi. Alamat publik wallet bot: ' + saved.publicAddress);
  console.log('Cocokkan alamat ini dengan wallet yang operator maksud sebelum mengisi dana.');
})();
