'use strict';
// Fee-turnover guard (24h fees / TVL > X% AND TVL < cap): the Huang / X-SOL profile is skipped, healthy pools are not. Offline.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'); const FT = require('./fee-turnover'); const S = require('./paper-settings');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const cfg = { FEE_TURNOVER_MAX_PCT: 60, FEE_TURNOVER_TVL_BELOW_USD: 25000 };
const pool = (fees24, tvl) => ({ tvl, fees: { '24h': fees24 } });
t('Huang profile (turnover 78%, TVL $12.7k) is blocked; X-SOL (86%, $22k) is blocked', () => { for (const [f, v] of [[9927, 12666], [18900, 22000]]) { const r = FT.evaluate(pool(f, v), cfg); assert.equal(r.ok, false); assert.match(r.why, /^fee turnover 24h \d+% > 60% \(tvl \$\d+ < \$25000\)/); } });
t('hot but BIG pools pass (PUSSY-like 77% with TVL $30k); healthy small pools pass (50% with $12k)', () => { assert.equal(FT.evaluate(pool(23100, 30000), cfg).ok, true); assert.equal(FT.evaluate(pool(6000, 12000), cfg).ok, true); assert.equal(FT.evaluate(pool(3000, 21000), cfg).ok, true); });
t('boundaries: exactly 60% passes; exactly TVL cap passes', () => { assert.equal(FT.evaluate(pool(6000, 10000), cfg).ok, true); assert.equal(FT.evaluate(pool(20000, 25000), cfg).ok, true); assert.equal(FT.evaluate(pool(6001, 10000), cfg).ok, false); });
t('off / TVL cap 0 / missing data', () => {
  assert.equal(FT.evaluate(pool(99999, 5000), { ...cfg, FEE_TURNOVER_MAX_PCT: 0 }).ok, true);
  assert.equal(FT.evaluate(pool(30000, 40000), { ...cfg, FEE_TURNOVER_TVL_BELOW_USD: 0 }).ok, false, 'cap 0 = applies to every TVL');
  assert.equal(FT.evaluate({ tvl: 12000 }, cfg).ok, true); assert.equal(FT.evaluate({ fees: { '24h': 5000 } }, cfg).ok, true); assert.equal(FT.evaluate(pool('x', 12000), cfg).ok, true);
});
t('settings: defaults 60% / $25k, ranges, restored by Reset; override of a manual pick uses the same soft() path', () => {
  assert.equal(S.DEFAULTS.FEE_TURNOVER_MAX_PCT, 60); assert.equal(S.DEFAULTS.FEE_TURNOVER_TVL_BELOW_USD, 25000); assert.equal(S.FIELDS.FEE_TURNOVER_MAX_PCT.min, 0);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-')); assert.ok(S.applySettings(d, { FEE_TURNOVER_MAX_PCT: 0, FEE_TURNOVER_TVL_BELOW_USD: 0 }, { updatedBy: 't' }).ok); const r = S.resetSettings(d, { updatedBy: 't' }); assert.equal(r.values.FEE_TURNOVER_MAX_PCT, 60); assert.equal(r.values.FEE_TURNOVER_TVL_BELOW_USD, 25000);
  const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); assert.ok(/const fto = feeTurnover\.evaluate\(p, policy\);\n\s+if \(!fto\.ok&&soft\(p,fto\.why\)\)return false;/.test(src)); assert.ok(/for\(const k of \[[^\]]*'FEE_TURNOVER_MAX_PCT','FEE_TURNOVER_TVL_BELOW_USD'/.test(src));
});
console.log('all', n, 'tests passed');
