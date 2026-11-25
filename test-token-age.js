'use strict';
// MIN_TOKEN_AGE_H: filter on the age of the TOKEN (mint), not the pool. An old token with a brand-new pool must count as old,
// a new token must never pass because one source is missing. Offline: pure helper + screening reasons + settings + bot.js wiring.
const assert = require('assert'), fs = require('fs'), path = require('path');
const ta = require('./token-age'), sr = require('./screen-reasons'), S = require('./paper-settings'), refresh = require('./paper-screen-refresh');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const SOL = 'So11111111111111111111111111111111111111112', MINT = 'TokenMint1111111111111111111111111111111111';
const nowMs = 1794410000 * 1000, H = 3_600_000, nowS = nowMs / 1000;

t('earliest source wins: old token with a new pool is old', () => {
  const e = ta.estimate({ mint: MINT, nowMs,
    report: { mint: MINT, detectedAt: new Date(nowMs - 30 * 24 * H).toISOString() },
    pools: [{ token_x: { address: MINT }, created_at: nowMs - 2 * H }],
    pairs: [{ chainId: 'solana', baseToken: { address: MINT }, pairCreatedAt: nowMs - 10 * 24 * H }] });
  assert.ok(e.known); assert.strictEqual(e.source, 'RugCheck'); assert.ok(Math.abs(e.ageH - 720) < 1e-6);
});
t('DexScreener pair older than RugCheck detection is used', () => {
  const e = ta.estimate({ mint: MINT, nowMs, report: { detectedAt: new Date(nowMs - 5 * H).toISOString() },
    pairs: [{ chainId: 'solana', baseToken: { address: MINT }, pairCreatedAt: nowMs - 50 * H }] });
  assert.strictEqual(e.source, 'DexScreener'); assert.ok(Math.abs(e.ageH - 50) < 1e-6);
});
t('other mints, other chains, RugCheck errors and future timestamps are ignored', () => {
  const e = ta.estimate({ mint: MINT, nowMs, report: { error: '503' },
    pools: [{ token_x: { address: 'OTHER' }, created_at: (nowMs - 900 * H) / 1000 }, { token_x: { address: MINT }, created_at: (nowMs - 3 * H) / 1000 }],
    pairs: [{ chainId: 'base', baseToken: { address: MINT }, pairCreatedAt: nowMs - 900 * H }, { chainId: 'solana', baseToken: { address: 'OTHER' }, pairCreatedAt: nowMs - 900 * H },
      { chainId: 'solana', baseToken: { address: MINT }, pairCreatedAt: nowMs + 10 * H }] });
  assert.strictEqual(e.source, 'Meteora'); assert.ok(Math.abs(e.ageH - 3) < 1e-6);
});
t('seconds and milliseconds both parse', () => { assert.strictEqual(ta.toMs(1700000000), 1700000000000); assert.strictEqual(ta.toMs(1700000000000), 1700000000000); assert.strictEqual(ta.toMs('1700000000'), 1700000000000); assert.strictEqual(ta.toMs(null), null); });
t('evaluate: off at 0, pass/fail at min, unknown fails closed', () => {
  assert.ok(ta.evaluate({ known: false }, 0).ok);
  assert.ok(ta.evaluate({ known: true, ageH: 49, source: 'DexScreener' }, 48).ok);
  const f = ta.evaluate({ known: true, ageH: 10, source: 'RugCheck' }, 24); assert.ok(!f.ok); assert.match(f.why, /^umur token 10\.0 jam < min 24 jam/);
  const u = ta.evaluate({ known: false }, 24); assert.ok(!u.ok && u.unknown);
});

const P = { PAPER: true, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, MIN_AGE_H: 0.5, MIN_BIN_STEP: 80, MAX_BIN_STEP: 400, MIN_VOL_1H: 1000,
  VOL_SPIKE_1H_OF_24H: 0.5, MAX_NONREFUND_SOL: 0.05, RUGCHECK: false, CHECK_TOP_HOLDERS: false, FILTERS_ENABLED: false };
const pool = { address: 'POOL', name: 'X-SOL', tvl: 20000, created_at: nowS - 5 * 3600, pool_config: { bin_step: 100 }, token_x: { address: MINT }, token_y: { address: SOL, symbol: 'SOL' },
  token_y_amount: 50, volume: { '1h': 2000, '24h': 40000 }, fees: { '30m': 400 }, fee_tvl_ratio: { '30m': 2 } };
const keys = (l, k) => l.filter((x) => x.k === k);
t('screen reasons: token age off by default, unchecked, fail, pass', () => {
  const ctx = { policy: P, nowS, flags: {}, entryCost: { nonrefTotalSol: 0, skipCheck: true } };
  assert.strictEqual(keys(sr.evaluate(pool, ctx), 'token_age').length, 0);
  const P2 = { ...P, MIN_TOKEN_AGE_H: 48 };
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2 }), 'token_age')[0].s, 'unchecked');
  const f = keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: true, ageH: 5, source: 'Meteora' } }), 'token_age')[0];
  assert.strictEqual(f.s, 'fail'); assert.match(f.t, /Umur token: 5\.0 jam < min 48 jam \(Meteora\)/);
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: false } }), 'token_age')[0].s, 'fail');
  assert.strictEqual(keys(sr.evaluate(pool, { ...ctx, policy: P2, tokenAge: { known: true, ageH: 100, source: 'RugCheck' } }), 'token_age').length, 0);
});
t('settings: MIN_TOKEN_AGE_H default 0 (off), validated, part of the scan policy', () => {
  assert.strictEqual(S.DEFAULTS.MIN_TOKEN_AGE_H, 0);
  assert.deepStrictEqual(S.validatePatch({ MIN_TOKEN_AGE_H: 48 }), { ok: true, sanitized: { MIN_TOKEN_AGE_H: 48 } });
  assert.strictEqual(S.validatePatch({ MIN_TOKEN_AGE_H: -1 }).ok, false);
  assert.ok(refresh.KEYS.includes('MIN_TOKEN_AGE_H'));
  assert.strictEqual(refresh.category('umur token 3.0 jam < min 24 jam (Meteora)'), 'umur token');
});
t('bot.js applies the setting and runs the filter in the decision loop', () => {
  const s = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  assert.match(s, /CFG\.MIN_TOKEN_AGE_H = values\.MIN_TOKEN_AGE_H/);
  assert.match(s, /tokenAge\.evaluate\(est, policy\.MIN_TOKEN_AGE_H\)/);
  assert.match(s, /api\.dexscreener\.com\/tokens\/v1\/solana\//);
  assert.match(fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8'), /'MIN_AGE_H', 'MIN_TOKEN_AGE_H'/);
});
console.log(`${n} tests passed`);
