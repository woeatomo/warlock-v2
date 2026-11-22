// Synthetic checks for anti-rug filters and emergency stop. No network.
const assert = require('assert');
const a = require('./antirug');

function expect(ok, cond, msg) {
  assert.strictEqual(cond.ok, ok, msg + ' -> ' + JSON.stringify(cond));
}

// --- emergency stop: price drop > 30% from entry ---
assert.strictEqual(a.shouldEmergencyStop(1, 0.699, 0.30), true, 'drop 30.1% should stop');
assert.strictEqual(a.shouldEmergencyStop(1, 0.70, 0.30), false, 'drop exactly 30% is not greater than 30%');
assert.strictEqual(a.shouldEmergencyStop(1, 0.701, 0.30), false, 'drop 29.9% should not stop');
assert.strictEqual(a.shouldEmergencyStop(2, 1.0, 0.30), true, 'halved price stops');
assert.strictEqual(a.shouldEmergencyStop(1, 1.2, 0.30), false, 'price up should not stop');
assert.strictEqual(a.shouldEmergencyStop(0, 0, 0.30), false, 'invalid entry');
assert.strictEqual(a.shouldEmergencyStop(1, 0, 0.30), true, 'price to zero stops');

// --- 24h pump ---
expect(true, a.evaluatePump24h(0.50, 0.50), 'exactly +50% allowed');
expect(false, a.evaluatePump24h(0.501, 0.50), 'just over +50% rejected');
expect(true, a.evaluatePump24h(-0.6, 0.50), 'dump is not a pump filter');
expect(false, a.evaluatePump24h(null), 'missing 24h history fail-closed');
expect(false, a.evaluatePump24h(undefined), 'undefined 24h fail-closed');

// --- volume spike ---
expect(true, a.evaluateVolSpike(1000, 3000, 0.50), '1h is 33% of 24h, ok');
expect(false, a.evaluateVolSpike(1501, 3000, 0.50), '1h > 50% of 24h');
expect(false, a.evaluateVolSpike(100, 0, 0.50), 'spike from zero');
expect(false, a.evaluateVolSpike(100, null, 0.50), 'missing 24h volume');
expect(true, a.evaluateVolSpike(0, 1000, 0.50), 'zero 1h is not a spike');

// --- fee/TVL (default 30m, >= 2%) ---
expect(true, a.evaluateFeeTvl(2, 2, '30m'), 'exactly 2% 30m allowed');
expect(false, a.evaluateFeeTvl(1.99, 2, '30m'), 'just under 2% 30m rejected');
expect(false, a.evaluateFeeTvl(1.5, 2, '30m'), 'old 1.5% 1h bar fails 2% 30m');
expect(false, a.evaluateFeeTvl(null, 2, '30m'), 'missing fee/tvl fail-closed');
expect(true, a.evaluateFeeTvl(0.5, 0.5, '30m'), 'configurable 0.5% allowed');
expect(true, a.evaluateFeeTvl(2, undefined, undefined), 'defaults are 2% / 30m');
assert.strictEqual(a.evaluateFeeTvl(1.5).why, 'fee/tvl30m<2%', 'default reject label uses 30m');

// --- age / TVL ---
const now = 1_793_530_800; // 2026-11-01 18:00 WIB
expect(false, a.evaluateAgeTvl({ tvl: 12768, created_at: now - 8 * 3600 }, now), 'thin+young');
expect(false, a.evaluateAgeTvl({ tvl: 60000, created_at: (now - 8 * 3600) * 1000 }, now), 'age 8h in ms');
expect(false, a.evaluateAgeTvl({ tvl: 24999, created_at: now - 30 * 3600 }, now), 'TVL under 25k');
expect(true, a.evaluateAgeTvl({ tvl: 25000, created_at: now - 24 * 3600 }, now), 'exactly 25k and 24h');
expect(true, a.evaluateAgeTvl({ tvl: 43852, created_at: now - 30 * 3600 }, now), 'Anakin-sized TVL now passes the 25k floor');
expect(true, a.evaluateAgeTvl({ tvl: 100000, created_at: now - 48 * 3600 }, now), 'comfortable pass');

// --- rugcheck authorities / score / danger / fail-closed ---
expect(false, a.evaluateRugCheck(null), 'missing report');
expect(false, a.evaluateRugCheck({ error: '503 api.rugcheck.xyz' }), 'API fail-closed');
expect(false, a.evaluateRugCheck({ mintAuthority: null, freezeAuthority: null, rugged: true, risks: [] }), 'rugged');
expect(false, a.evaluateRugCheck({ mintAuthority: 'SomeAuth111', freezeAuthority: null, risks: [] }), 'mint auth');
expect(false, a.evaluateRugCheck({ mintAuthority: null, freezeAuthority: 'Freeze111', risks: [] }), 'freeze auth');
expect(false, a.evaluateRugCheck({
  mintAuthority: null, freezeAuthority: null,
  risks: [{ name: 'High holder concentration', level: 'danger', score: 2000 }],
  score_normalised: 20,
}), 'danger risk');
expect(false, a.evaluateRugCheck({
  mintAuthority: null, freezeAuthority: null, risks: [], score_normalised: 50,
}), 'high score at threshold');
expect(true, a.evaluateRugCheck({
  mintAuthority: null, freezeAuthority: null,
  risks: [{ name: 'Low Liquidity', level: 'warn', score: 771 }],
  score_normalised: 24,
}), 'warn only, moderate score');
expect(true, a.evaluateRugCheck({
  token: { mintAuthority: null, freezeAuthority: null },
  risks: [], score_normalised: 10,
}), 'authorities nested under token');
expect(false, a.evaluateRugCheck({ risks: [], score_normalised: 0 }), 'authorities missing fail-closed');

// --- holders: exclude LP, top10, creator ---
const clean = {
  mintAuthority: null, freezeAuthority: null, risks: [], score_normalised: 10,
  creator: 'Dev111111111111111111111111111111111111111',
  topHolders: [
    { address: 'LPVault111', owner: 'LBUZKhRxPF3XUpBCjp4YzTKgLcc2qhUcySJttmKcGcX', pct: 40 },
    { address: 'H1', owner: 'W1', pct: 5 },
    { address: 'H2', owner: 'W2', pct: 4 },
    { address: 'DevATA', owner: 'Dev111111111111111111111111111111111111111', pct: 3 },
  ],
  markets: [{ liquidity_a_account: 'LPVault111' }],
};
const hOk = a.evaluateHoldersFromReport(clean, ['ReserveX']);
expect(true, hOk, 'LP 40% excluded, remaining top holders small');
assert.ok(hOk.top10Frac < 0.15, 'top10 after exclude should be ~12%');
assert.ok(Math.abs(hOk.devFrac - 0.03) < 1e-9, 'dev 3%');

const concentrated = {
  ...clean,
  topHolders: [
    { address: 'Whale1', owner: 'W1', pct: 20 },
    { address: 'Whale2', owner: 'W2', pct: 15 },
    { address: 'DevATA', owner: 'Dev111111111111111111111111111111111111111', pct: 2 },
  ],
};
expect(false, a.evaluateHoldersFromReport(concentrated), 'top10 37% rejected');

const devHeavy = {
  ...clean,
  topHolders: [
    { address: 'DevATA', owner: 'Dev111111111111111111111111111111111111111', pct: 15 },
    { address: 'H1', owner: 'W1', pct: 2 },
  ],
};
expect(false, a.evaluateHoldersFromReport(devHeavy), 'dev 15% rejected');

expect(false, a.evaluateHolders({ top10Frac: null }), 'unknown holders fail-closed');
expect(false, a.evaluateHoldersFromReport({ topHolders: [] }), 'empty topHolders fail-closed');

// Combined: a "BLUE-like" thin, young pool fails age/TVL even before rugcheck
const blueLike = a.evaluateAgeTvl({ tvl: 12768, created_at: now - 8.04 * 3600 }, now);
expect(false, blueLike, 'BLUE-like pool rejected by new floors');

console.log('OK  anti-rug unit check');
console.log(JSON.stringify({
  emergency: {
    drop301: a.shouldEmergencyStop(1, 0.699),
    drop30: a.shouldEmergencyStop(1, 0.70),
    drop299: a.shouldEmergencyStop(1, 0.701),
  },
  holderPass: { top10Frac: hOk.top10Frac, devFrac: hOk.devFrac },
  defaults: a.DEFAULTS,
}, null, 2));
