'use strict';
// MIN_TOKEN_AGE_H / MAX_TOKEN_AGE_H: filter on the age of the TOKEN (mint) from Jupiter (single source, like Meridian-OP), not the pool.
// Offline: pure helper + screening reasons + settings + the real bot.js Jupiter batch lookup with a stubbed network.
const assert = require('assert'), fs = require('fs'), path = require('path');
const ta = require('./token-age'), sr = require('./screen-reasons'), S = require('./paper-settings'), refresh = require('./paper-screen-refresh');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const SOL = 'So11111111111111111111111111111111111111112', MINT = 'TokenMint1111111111111111111111111111111111';
const nowMs = 1794410000 * 1000, H = 3_600_000, nowS = nowMs / 1000;

t('Jupiter createdAt / firstPool.createdAt: the earlier wins, garbage is null', () => {
  assert.strictEqual(ta.createdAtMs({ createdAt: new Date(nowMs - 30 * 24 * H).toISOString(), firstPool: { createdAt: new Date(nowMs - 2 * H).toISOString() } }), nowMs - 30 * 24 * H);
  assert.strictEqual(ta.createdAtMs({ firstPool: { createdAt: new Date(nowMs - 50 * H).toISOString() } }), nowMs - 50 * H);
  assert.strictEqual(ta.createdAtMs({ createdAt: 'not a date' }), null);
  assert.strictEqual(ta.createdAtMs(undefined), null);
});
t('seconds and milliseconds both parse', () => { assert.strictEqual(ta.toMs(1700000000), 1700000000000); assert.strictEqual(ta.toMs(1700000000000), 1700000000000); assert.strictEqual(ta.toMs('1700000000'), 1700000000000); assert.strictEqual(ta.toMs(null), null); });
t('estimate: known, unknown, future timestamp is unknown', () => {
  const e = ta.estimate({ createdAtMs: nowMs - 72 * H }, nowMs); assert.ok(e.known); assert.ok(Math.abs(e.ageH - 72) < 1e-9); assert.strictEqual(e.source, 'Jupiter');
  assert.ok(!ta.estimate(undefined, nowMs).known); assert.ok(!ta.estimate({ createdAtMs: null }, nowMs).known);
  assert.ok(!ta.estimate({ createdAtMs: nowMs + 10 * H }, nowMs).known);
});
t('evaluate: off at 0/0, min, max, unknown fails closed', () => {
  assert.ok(ta.evaluate({ known: false }, 0, 0).ok);
  assert.ok(ta.evaluate({ known: true, ageH: 49 }, 48).ok);
  const f = ta.evaluate({ known: true, ageH: 10 }, 24); assert.ok(!f.ok); assert.strictEqual(f.why, 'umur token 10.0 jam < min 24 jam');
  const x = ta.evaluate({ known: true, ageH: 100 }, 24, 72); assert.ok(!x.ok); assert.strictEqual(x.why, 'umur token 4.2 hari > maks 72 jam');
  assert.ok(ta.evaluate({ known: true, ageH: 50 }, 24, 72).ok);
  assert.ok(ta.evaluate({ known: true, ageH: 5000 }, 24, 0).ok, 'max 0 = no maximum');
  const u = ta.evaluate({ known: false, error: '429' }, 24); assert.ok(!u.ok && u.unknown); assert.match(u.why, /tidak diketahui \(Jupiter: 429\)/);
  assert.ok(!ta.evaluate({ known: false }, 0, 72).ok, 'max alone also fails closed on unknown');
});

const P = { PAPER: true, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, MIN_AGE_H: 0.5, MIN_BIN_STEP: 80, MAX_BIN_STEP: 400, MIN_VOL_1H: 1000,
  VOL_SPIKE_1H_OF_24H: 0.5, MAX_NONREFUND_SOL: 0.05, RUGCHECK: false, CHECK_TOP_HOLDERS: false, FILTERS_ENABLED: false };
const pool = { address: 'POOL', name: 'X-SOL', tvl: 20000, created_at: nowS - 5 * 3600, pool_config: { bin_step: 100 }, token_x: { address: MINT }, token_y: { address: SOL, symbol: 'SOL' },
  token_y_amount: 50, volume: { '1h': 2000, '24h': 40000 }, fees: { '30m': 400 }, fee_tvl_ratio: { '30m': 2 } };
const keys = (l, k) => l.filter((x) => x.k === k);
t('screen reasons: off by default, unchecked, min fail, max fail, unknown, pass', () => {
  const ctx = { policy: P, nowS, flags: {}, entryCost: { nonrefTotalSol: 0, skipCheck: true } };
  assert.strictEqual(keys(sr.evaluate(pool, ctx), 'token_age').length, 0);
  const P2 = { ...P, MIN_TOKEN_AGE_H: 48, MAX_TOKEN_AGE_H: 720 };
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2 }), 'token_age')[0].s, 'unchecked');
  const f = keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: true, ageH: 5 } }), 'token_age')[0];
  assert.strictEqual(f.s, 'fail'); assert.strictEqual(f.t, 'Umur token: 5.0 jam < min 48 jam (Jupiter)');
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: true, ageH: 1000 } }), 'token_age')[0].t, 'Umur token: 41.7 hari > maks 720 jam (Jupiter)');
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: false } }), 'token_age')[0].t, 'Umur token: tidak diketahui (Jupiter)');
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: true, ageH: 100 } }), 'token_age').length, 0);
});
t('settings: MIN/MAX_TOKEN_AGE_H default 0 (off), validated, part of the scan policy', () => {
  assert.strictEqual(S.DEFAULTS.MIN_TOKEN_AGE_H, 0); assert.strictEqual(S.DEFAULTS.MAX_TOKEN_AGE_H, 0);
  assert.deepStrictEqual(S.validatePatch({ MIN_TOKEN_AGE_H: 48, MAX_TOKEN_AGE_H: 720 }), { ok: true, sanitized: { MIN_TOKEN_AGE_H: 48, MAX_TOKEN_AGE_H: 720 } });
  assert.strictEqual(S.validatePatch({ MIN_TOKEN_AGE_H: -1 }).ok, false);
  assert.ok(refresh.KEYS.includes('MIN_TOKEN_AGE_H') && refresh.KEYS.includes('MAX_TOKEN_AGE_H'));
  assert.strictEqual(refresh.category('umur token 3.0 jam < min 24 jam'), 'umur token');
});

const botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
const grab = (start, end) => { const i = botSrc.indexOf(start); assert.ok(i >= 0, start); const j = botSrc.indexOf(end, i); assert.ok(j > i, end); return botSrc.slice(i, j); };
t('bot.js: settings applied, only Jupiter used, no request when both limits are off', () => {
  assert.match(botSrc, /CFG\.MIN_TOKEN_AGE_H = values\.MIN_TOKEN_AGE_H/); assert.match(botSrc, /CFG\.MAX_TOKEN_AGE_H = values\.MAX_TOKEN_AGE_H/);
  assert.match(botSrc, /tokenAge\.evaluate\(est, policy\.MIN_TOKEN_AGE_H, policy\.MAX_TOKEN_AGE_H\)/);
  assert.match(botSrc, /const jupAge = tokenAgeOn \? await jupTokenPrefetch\(/, 'prefetch only when a limit is on');
  assert.strictEqual((botSrc.match(/jupTokenPrefetch\(/g) || []).length, 2, 'only the definition and the guarded call');
  assert.ok(!/dexTokenPairs|tokenPairsCache/.test(botSrc), 'DexScreener token-age source removed');
  const block = grab('if (tokenAgeOn) {', 'if (!ta.ok && skipSoft'); assert.ok(!/await|fetchRugCheck|getJSON/.test(block), 'per-candidate check makes no request');
  assert.match(fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8'), /'MIN_AGE_H', 'MIN_TOKEN_AGE_H', 'MAX_TOKEN_AGE_H'/);
});

// The real jupTokenPrefetch from bot.js with a stubbed Jupiter.
async function asyncTests() {
  const fnSrc = grab('const jupTokenCache = new Map();', 'const telegram = require(');
  const make = (fake, logs = []) => new Function('jupGetJSON', 'log', 'tokenAge', fnSrc + '; return { jupTokenPrefetch, cache: jupTokenCache };')(fake, (x) => logs.push(x), ta);
  const urls = [];
  const ok = make(async (url) => { urls.push(url); const ids = decodeURIComponent(url.split('query=')[1]).split(',');
    return ids.filter((m) => m !== 'NOTLISTED').map((m) => ({ id: m, createdAt: new Date(Date.now() - 100 * H).toISOString() })); });
  const mints = Array.from({ length: 140 }, (_, i) => 'M' + i).concat(['NOTLISTED', 'M1', null]);
  const r = await ok.jupTokenPrefetch(mints);
  assert.strictEqual(urls.length, 2, '141 unique mints = 2 requests (100 per batch)'); assert.strictEqual(r.fetched, 141);
  assert.ok(Math.abs(ta.estimate(ok.cache.get('M5')).ageH - 100) < 0.01);
  assert.ok(!ta.estimate(ok.cache.get('NOTLISTED')).known, 'mint Jupiter does not know = unknown');
  await ok.jupTokenPrefetch(['M1', 'M2']); assert.strictEqual(urls.length, 2, 'known creation dates are served from cache');
  console.log('ok - Jupiter batch: 100 mints per request, cached'); n++;
  let calls = 0; const logs = [];
  const down = make(async () => { calls++; throw new Error('429 Too Many Requests'); }, logs);
  const a = await down.jupTokenPrefetch(['A1', 'A2']); assert.match(a.error, /429/);
  const b = await down.jupTokenPrefetch(['B1']); assert.match(b.error, /jeda 2 menit/); assert.strictEqual(calls, 1, 'paused after one failure');
  assert.ok(!down.cache.has('A1'), 'failures are not cached per mint'); assert.strictEqual(logs.length, 1);
  console.log('ok - Jupiter outage: one failed request, then 2 min pause, tokens fail closed'); n++;
}
asyncTests().then(() => console.log(`${n} tests passed`)).catch((e) => { console.error(e); process.exit(1); });
