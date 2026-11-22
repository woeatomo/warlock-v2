'use strict';
// MIN_VOL24H_TVL_X: a pool whose 24h volume is less than X times its TVL is a quiet token and is rejected (Huss / :3 case, 22 Nov 2026).
// Offline: screening reasons + settings schema + the shared bot.js scan source. Never loads state, keys or the network.
const assert = require('assert'), fs = require('fs'), path = require('path');
const sr = require('./screen-reasons'), antiPvp = require('./anti-pvp'), S = require('./paper-settings');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const SOL = 'So11111111111111111111111111111111111111112';
const nowS = 1794410000;
const base = { PAPER: true, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, MIN_AGE_H: 0.5, MIN_BIN_STEP: 80, MAX_BIN_STEP: 400, MIN_VOL_1H: 1000,
  VOL_SPIKE_1H_OF_24H: 0.5, SL_BLACKLIST_ENABLED: true, MAX_NONREFUND_SOL: 0.05, MAX_PUMP1H: 1.5, MAX_PUMP_24H: 2, RUGCHECK: false, CHECK_TOP_HOLDERS: false,
  MAX_INSIDER_PCT: 25, MAX_POSITIONS: 10, ANTI_PVP_MODE: 'OFF', ANTI_PVP_MIN_LIQ_USD: 10000, FILTERS_ENABLED: false };
const pool = (o) => ({ address: 'POOL', name: 'Huss-SOL', tvl: 21189, created_at: (nowS - 30 * 3600) * 1000, pool_config: { bin_step: 100 }, token_y: { address: SOL, symbol: 'SOL' }, token_y_amount: 50,
  token_x: { address: 'MINT', symbol: 'Huss', name: 'Huss' }, fees: { '30m': 200 }, fee_tvl_ratio: { '30m': 1 }, volume: { '1h': 3825, '24h': 49859 }, ...o });
const reasons = (p, policy) => sr.evaluate(p, { policy, nowS, flags: antiPvp.filterFlags(policy), entryCost: { skipCheck: true }, pu: 0, pu24: 0, pvp: { ok: true, twins: [] } })
  .filter((x) => x.s === 'fail').map((x) => x.k);

t('settings: default 2.5x, editable, 0 allowed (= off), negative rejected', () => {
  assert.strictEqual(S.DEFAULTS.MIN_VOL24H_TVL_X, 2.5);
  assert.strictEqual(S.FIELDS.MIN_VOL24H_TVL_X.type, 'number');
  assert.strictEqual(S.validatePatch({ MIN_VOL24H_TVL_X: 0 }, S.DEFAULTS).ok, true);
  assert.strictEqual(S.validatePatch({ MIN_VOL24H_TVL_X: -1 }, S.DEFAULTS).ok, false);
});
t('Huss entry (vol24h $49.9k vs TVL $21.2k = 2.35x) is rejected at 2.5x', () => {
  assert.ok(reasons(pool({}), { ...base, MIN_VOL24H_TVL_X: 2.5 }).includes('vol24_tvl'));
});
t('busy pool (vol24h 21x TVL, FIONA-like) passes', () => {
  assert.ok(!reasons(pool({ tvl: 38168, volume: { '1h': 24878, '24h': 806104 } }), { ...base, MIN_VOL24H_TVL_X: 2.5 }).includes('vol24_tvl'));
});
t('exactly 2.5x passes (rule is strictly below)', () => {
  assert.ok(!reasons(pool({ tvl: 20000, volume: { '1h': 5000, '24h': 50000 } }), { ...base, MIN_VOL24H_TVL_X: 2.5 }).includes('vol24_tvl'));
});
t('0 = off; missing 24h volume never blocks', () => {
  assert.ok(!reasons(pool({}), { ...base, MIN_VOL24H_TVL_X: 0 }).includes('vol24_tvl'));
  assert.ok(!reasons(pool({ volume: { '1h': 3825 } }), { ...base, MIN_VOL24H_TVL_X: 2.5 }).includes('vol24_tvl'));
});
t('bot.js: the shared scan (paper + live) applies the same rule and CFG follows the settings file', () => {
  const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  assert.ok(/mx=\+policy\.MIN_VOL24H_TVL_X\|\|0;if\(mx>0&&tv>0&&Number\.isFinite\(v24\)&&v24\/tv<mx&&soft\(/.test(src), 'scan filter missing');
  assert.ok(src.includes('CFG.MIN_VOL24H_TVL_X = values.MIN_VOL24H_TVL_X;'), 'settings not applied to CFG');
});
console.log(`PASS ${n} vol24/tvl filter tests`);
