'use strict';
// t221u: RPC 3-slot failover. RPC_URL_1..3 (slot 1 falls back to SOLANA_RPC_URL / HELIUS_API_KEY), empty/placeholder/duplicate slots skipped,
// 429 / 5xx / network / timeout -> next slot with a cooldown, back to slot 1 after it, same signed bytes on resend, keys never shown. Offline.
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = require('./rpc-config'), envc = require('./env-config');
const K1 = 'key1-' + 'a'.repeat(30), K2 = 'key2-' + 'b'.repeat(30), K3 = 'key3-' + 'c'.repeat(30);
const H = (k) => 'https://mainnet.helius-rpc.com/?api-key=' + k;
const saved = { ...process.env }; const VARS = ['SOLANA_RPC_URL', 'HELIUS_API_KEY', 'RPC_URL_1', 'RPC_URL_2', 'RPC_URL_3', 'HELIUS_API_KEY_2', 'HELIUS_API_KEY_3'];
process.env.LP_RPC_FILE = require('path').join(require('os').tmpdir(), 'no-such-rpc-' + process.pid + '.env');   // never the real secrets file
const set = (o) => { for (const v of VARS) delete process.env[v]; Object.assign(process.env, o); R._reset(); };
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const resp = (status, body = { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 5 } }) => ({ status, ok: status < 300, statusText: String(status), headers: new Map(), json: async () => body, text: async () => JSON.stringify(body), body: { cancel: async () => {} } });
(async () => {
  await t('1 slot (old HELIUS_API_KEY only) / none -> public; RPC_URL_1 overrides; 2 and 3 slots; empty, isi_ placeholder and duplicates skipped', () => {
    set({ HELIUS_API_KEY: K1 }); assert.deepEqual(R.slots().map(s => s.slot), [1]); assert.equal(R.url(), H(K1));
    set({}); assert.deepEqual(R.slots(), [{ slot: 1, url: R.PUBLIC }]);
    set({ HELIUS_API_KEY: K1, RPC_URL_1: H(K2) }); assert.equal(R.slots()[0].url, H(K2));
    set({ HELIUS_API_KEY: K1, RPC_URL_2: H(K2) }); assert.deepEqual(R.slots().map(s => s.slot), [1, 2]);
    set({ RPC_URL_1: H(K1), RPC_URL_2: '', RPC_URL_3: H(K3) }); assert.deepEqual(R.slots().map(s => s.slot), [1, 3]);
    set({ RPC_URL_1: H(K1), RPC_URL_2: 'isi_url_helius_2', RPC_URL_3: H(K1) }); assert.deepEqual(R.slots().map(s => s.slot), [1]);
    set({ HELIUS_API_KEY: K1, HELIUS_API_KEY_2: K2, HELIUS_API_KEY_3: K3 }); assert.deepEqual(R.slots().map(s => s.url), [H(K1), H(K2), H(K3)]);
    set({ RPC_URL_2: H(K2) }); assert.deepEqual(R.slots().map(s => s.slot), [2], 'slot 1 empty (no old setting): the rate-limited public endpoint is NOT put in front of slot 2');
  });
  await t('429 on slot 1 -> same request body on slot 2, slot 1 cools down, back to slot 1 after the cooldown', async () => {
    set({ RPC_URL_1: H(K1), RPC_URL_2: H(K2), RPC_URL_3: H(K3) });
    let clock = 1_000_000; const calls = []; let limited = new Set([H(K1)]);
    const f = R.makeFetch({ now: () => clock, fetchImpl: async (u, init) => { calls.push([u, init.body]); return resp(limited.has(u) ? 429 : 200); } });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: ['SIGNED_TX_BASE64', { encoding: 'base64' }] });
    const r = await f('ignored-endpoint', { method: 'POST', body, agent: {} });
    assert.equal(r.status, 200); assert.deepEqual(calls.map(c => c[0]), [H(K1), H(K2)]); assert.equal(calls[0][1], calls[1][1], 'the SAME signed bytes go to slot 2 (same signature: lands once)');
    assert.equal(R.slotStatus(clock)[0].state, 'limited'); assert.equal(R.slotStatus(clock)[1].state, 'active'); assert.equal(R.slotStatus(clock)[2].state, 'standby');
    calls.length = 0; await f('x', { body: '{}' }); assert.deepEqual(calls.map(c => c[0]), [H(K2)], 'while slot 1 cools down, slot 2 directly');
    clock += R.COOLDOWN.rate + 1; limited = new Set(); calls.length = 0; await f('x', { body: '{}' }); assert.deepEqual(calls.map(c => c[0]), [H(K1)], 'back to slot 1');
  });
  await t('5xx, network error and timeout fail over too; slot 3 used when 1 and 2 are down', async () => {
    set({ RPC_URL_1: H(K1), RPC_URL_2: H(K2), RPC_URL_3: H(K3) }); const calls = [];
    const f = R.makeFetch({ timeoutMs: 30, fetchImpl: async (u, init) => { calls.push(u); if (u === H(K1)) return resp(503); if (u === H(K2)) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))); return resp(200); } });
    assert.equal((await f('x', { body: '{}' })).status, 200); assert.deepEqual(calls, [H(K1), H(K2), H(K3)]);
    const st = R.slotStatus(); assert.equal(st[0].state, 'limited'); assert.equal(st[1].state, 'limited'); assert.equal(st[2].state, 'active');
    set({ RPC_URL_1: H(K1), RPC_URL_2: H(K2) }); const g = R.makeFetch({ fetchImpl: async (u) => { if (u === H(K1)) throw new TypeError('fetch failed'); return resp(200); } });
    assert.equal((await g('x', { body: '{}' })).status, 200);
  });
  await t('1 slot: a 429 is handed back to web3 (its own backoff), no client timeout; network error -> error WITHOUT the URL/key', async () => {
    set({ HELIUS_API_KEY: K1 }); let sig = 'unset';
    const f = R.makeFetch({ timeoutMs: 5, fetchImpl: async (u, init) => { sig = init.signal; await new Promise(r => setTimeout(r, 20)); return resp(429); } });
    assert.equal((await f('x', { body: '{}' })).status, 429); assert.ok(!sig.aborted, 'one slot: never aborted by our timeout');
    const g = R.makeFetch({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(g('x', { body: '{}' }), (e) => !String(e.message).includes(K1) && /slot 1/.test(e.message));
  });
  await t('all slots limited: still tries (soonest back first), returns the last answer; logs show host only', async () => {
    set({ RPC_URL_1: H(K1), RPC_URL_2: H(K2) }); const logs = [];
    const f = R.makeFetch({ log: (m) => logs.push(m), fetchImpl: async () => resp(429) });
    assert.equal((await f('x', { body: '{}' })).status, 429); assert.equal((await f('x', { body: '{}' })).status, 429);
    assert.ok(logs.length >= 2 && logs.every(l => !l.includes(K1) && !l.includes(K2) && /mainnet\.helius-rpc\.com/.test(l)));
  });
  await t('a real web3 Connection goes through the failover (getBalance served by slot 2 when slot 1 answers 429)', async () => {
    set({ RPC_URL_1: H(K1), RPC_URL_2: H(K2) }); const seen = []; const orig = globalThis.fetch;
    globalThis.fetch = async (u, init) => { seen.push(String(u)); if (String(u) === H(K1)) return new Response('', { status: 429 }); const id = JSON.parse(init.body).id; return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: 123456789 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    try { const { PublicKey } = require('@solana/web3.js'); const c = R.connection('confirmed'); const bal = await c.getBalance(new PublicKey('11111111111111111111111111111111')); assert.equal(bal, 123456789); assert.deepEqual(seen, [H(K1), H(K2)]); }
    finally { globalThis.fetch = orig; }
  });
  await t('describe()/slotStatus() show hosts only; redact() masks RPC_URL_2/3 and HELIUS_API_KEY_2 values', () => {
    set({ RPC_URL_1: H(K1), RPC_URL_2: 'https://rpc.example.com/' + K2, HELIUS_API_KEY_3: K3 });
    const d = R.describe() + JSON.stringify(R.slotStatus()); for (const k of [K1, K2, K3]) assert.ok(!d.includes(k), 'leak in ' + d);
    assert.match(d, /3 slot RPC/); const red = envc.redact('a ' + process.env.RPC_URL_2 + ' b ' + K3); assert.ok(!red.includes(K2) && !red.includes(K3));
  });
  await t('wiring: bot, live check, mini app, on-chain view all use rpc-config.connection(); status shows the RPC host only', () => {
    const rd = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(/const conn = require\('\.\/rpc-config'\)\.connection\('confirmed'/.test(rd('bot.js')));
    assert.ok(/require\('\.\/rpc-config'\)\.connection\('confirmed'\)/.test(rd('live-control.js')));
    assert.ok(!/new web3\.Connection\(require\('\.\.\/rpc-config'\)\.url\(\)/.test(rd('miniapp/server.js') + rd('miniapp/onchain-view.js')));
    assert.ok(/rpc: \(\(\) => \{ try \{ return new URL\(CFG\.RPC\)\.host/.test(rd('bot.js')) && /next\.rpcSlots = require\('\.\/rpc-config'\)\.slotStatus\(\)/.test(rd('bot.js')));
  });
  for (const v of VARS) delete process.env[v]; Object.assign(process.env, saved); R._reset();
  console.log('all', n, 'rpc failover tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
