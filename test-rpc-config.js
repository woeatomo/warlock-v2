'use strict';
// One RPC config for dry run, live and the mini app: custom URL > Helius key > public. The key never shows in describe() or in redacted logs. Offline.
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = require('./rpc-config'); const envc = require('./env-config');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const KEY = 'abcd1234-' + 'e'.repeat(27); const saved = { ...process.env };
process.env.LP_RPC_FILE = require('path').join(require('os').tmpdir(), 'no-such-rpc-' + process.pid + '.env');
const set = (o) => { delete process.env.SOLANA_RPC_URL; delete process.env.HELIUS_API_KEY; Object.assign(process.env, o); };
t('no config -> public endpoint; public URL written explicitly + no key -> still public', () => { set({}); assert.equal(R.url(), R.PUBLIC); set({ SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }); assert.equal(R.url(), R.PUBLIC); assert.match(R.describe(), /RPC publik/); });
t('Helius key + public/empty SOLANA_RPC_URL -> Helius URL with the key', () => { set({ HELIUS_API_KEY: KEY, SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }); assert.equal(R.url(), 'https://mainnet.helius-rpc.com/?api-key=' + KEY); set({ HELIUS_API_KEY: KEY }); assert.ok(R.url().startsWith('https://mainnet.helius-rpc.com/')); });
t('a CUSTOM SOLANA_RPC_URL always wins over the Helius key', () => { set({ HELIUS_API_KEY: KEY, SOLANA_RPC_URL: 'https://my.rpc.example/abc' }); assert.equal(R.url(), 'https://my.rpc.example/abc'); assert.match(R.describe(), /RPC kustom/); });
t('placeholder values (isi_...) count as empty', () => { set({ HELIUS_API_KEY: 'isi_dengan_key', SOLANA_RPC_URL: 'isi_url' }); assert.equal(R.url(), R.PUBLIC); });
t('describe() shows host only; redact() masks the key if the URL ever reaches a log', () => { set({ HELIUS_API_KEY: KEY }); assert.ok(!R.describe().includes(KEY)); assert.match(R.describe(), /^mainnet\.helius-rpc\.com \(Helius, key aktif\)/); const red = envc.redact('RPC error at ' + R.url()); assert.ok(!red.includes(KEY), red); });
t('wiring: bot.js and the mini app live check read the SAME module (no other SOLANA_RPC_URL / mainnet-beta literal left)', () => {
  const bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'), lc = fs.readFileSync(path.join(__dirname, 'live-control.js'), 'utf8');
  assert.ok(/RPC: require\('\.\/rpc-config'\)\.url\(\)/.test(bot) && /require\('\.\/rpc-config'\)\.connection\(/.test(lc)); assert.ok(!/process\.env\.SOLANA_RPC_URL/.test(bot) && !/process\.env\.SOLANA_RPC_URL/.test(lc));
});
Object.keys(process.env).forEach(k => { if (!(k in saved)) delete process.env[k]; }); Object.assign(process.env, saved);
console.log('all', n, 'tests passed');
