'use strict';
// OOR right: reposition / limit only after price is >= OOR_RIGHT_MIN_BINS above the range; take-profit (net >= minimum) is NOT delayed. Same decide() for dry run and live.
const assert = require('assert'); const X = require('./paper-exit-policy'); const S = require('./paper-settings');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const pos = (o = {}) => ({ capitalAsset: 'USDC', openedAt: new Date().toISOString(), minBinId: -870, maxBinId: -784, rightRepositions: 0, oorRightPolls: 0, ...o });
const val = (pct) => ({ quoted: true, pnlPct: pct, pnlUsd: pct * 5, pnlCapital: pct * 5, usdcOut: 500 + pct * 5 });
const base = { OOR_RIGHT_CONFIRM_POLLS: 2, OOR_RIGHT_MIN_PROFIT_PCT: 0.5, OOR_RIGHT_MAX_REPOSITIONS: 2, EMERGENCY_DROP: 0.2, EMERGENCY_SLPLUS_ENABLED: false };
const run = (p, v, bin, s, polls = 3) => { let r = null; for (let i = 0; i < polls; i++) r = X.decide({ pos: p, val: val(v), activeBin: bin, settings: s, pollId: i + 1 }); return r; };
t('default is 5 and the field is a shared setting', () => { assert.strictEqual(S.DEFAULTS.OOR_RIGHT_MIN_BINS, 5); assert.strictEqual(S.FIELDS.OOR_RIGHT_MIN_BINS.default, 5); assert.strictEqual(S.FIELDS.OOR_RIGHT_MIN_BINS.min, 0); });
t('Max case: 1-2 bins above the range with ~0% net -> NO reposition (waits)', () => { for (const bin of [-783, -782]) assert.strictEqual(run(pos(), -0.003, bin, { ...base, OOR_RIGHT_MIN_BINS: 3 }), null, 'bin ' + bin); });
t('>= N bins above the range with ~0% net -> reposition, then the limit close after the max repositions', () => {
  assert.strictEqual(run(pos(), 0, -781, { ...base, OOR_RIGHT_MIN_BINS: 3 }), 'oor_right_reposition');
  assert.strictEqual(run(pos({ rightRepositions: 2 }), 0, -781, { ...base, OOR_RIGHT_MIN_BINS: 3 }), 'oor_right_reposition_limit');
});
t('limit is not reached by noise: at the limit but only 1 bin above -> still waits', () => { assert.strictEqual(run(pos({ rightRepositions: 2 }), 0, -783, { ...base, OOR_RIGHT_MIN_BINS: 3 }), null); });
t('take-profit is NOT delayed: net >= 0.5% closes as soon as OOR is confirmed, even 1 bin above', () => { assert.strictEqual(run(pos(), 1.2, -783, { ...base, OOR_RIGHT_MIN_BINS: 3 }), 'oor_right_take_profit'); });
t('0 (or missing) keeps the old behaviour exactly', () => { assert.strictEqual(run(pos(), -0.003, -783, { ...base, OOR_RIGHT_MIN_BINS: 0 }), 'oor_right_reposition'); assert.strictEqual(run(pos(), -0.003, -783, base), 'oor_right_reposition'); });
t('back inside the range resets the OOR poll counter (no stale confirmation)', () => { const p = pos(); run(p, 0, -783, { ...base, OOR_RIGHT_MIN_BINS: 3 }, 2); assert.ok(p.oorRightPolls >= 2); X.decide({ pos: p, val: val(0), activeBin: -790, settings: { ...base, OOR_RIGHT_MIN_BINS: 3 }, pollId: 99 }); assert.strictEqual(p.oorRightPolls, 0); });
t('reposition floor: below the floor the position is HELD; at/above it repositions; take-profit and the reposition LIMIT are unaffected (default -3%)', () => {
  const S2 = { ...base, OOR_RIGHT_MIN_BINS: 0 };
  assert.strictEqual(S.DEFAULTS.OOR_RIGHT_REPOSITION_MIN_PNL_PCT, -3); assert.strictEqual(S.FIELDS.OOR_RIGHT_REPOSITION_MIN_PNL_PCT.default, -3);
  assert.strictEqual(run(pos(), -12, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3 }), null, 'net -12% (Huang): hold');
  assert.strictEqual(run(pos(), -2.9, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3 }), 'oor_right_reposition');
  assert.strictEqual(run(pos(), -0.003, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3 }), 'oor_right_reposition');
  assert.strictEqual(run(pos(), 1.2, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3 }), 'oor_right_take_profit');
  assert.strictEqual(run(pos({ rightRepositions: 2 }), -12, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -3 }), 'oor_right_reposition_limit', 'the limit still closes');
  assert.strictEqual(run(pos(), -12, -780, { ...S2, OOR_RIGHT_REPOSITION_MIN_PNL_PCT: -100 }), 'oor_right_reposition', '-100 = off');
  assert.strictEqual(run(pos(), -12, -780, S2), 'oor_right_reposition', 'key missing = old behaviour');
});
console.log('all', n, 'tests passed');
