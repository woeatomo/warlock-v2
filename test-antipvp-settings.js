'use strict';
if(!process.env.LP_BOT_DIR||!process.env.LP_BOT_DIR.startsWith('/tmp/')){const __d=require('fs').mkdtempSync('/tmp/lp-test-');process.env.LP_BOT_DIR=__d;process.env.LP_PAPER_DIR=__d+'/paper';require('fs').mkdirSync(__d+'/paper',{recursive:true});}   // self-provisioned temp dirs (never the real ones)
// Run only in a temp copy: LP_BOT_DIR/LP_PAPER_DIR must point at temp dirs.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = process.env.LP_BOT_DIR; assert(root && root.startsWith('/tmp/'), 'temp LP_BOT_DIR required');
const s = require('./paper-settings');
assert(path.resolve(s.paths().dir).startsWith('/tmp/'), 'paper dir must be temp');
const NEW = { FILTERS_ENABLED: true, PUMP1H_FILTER_ENABLED: true, PUMP24H_FILTER_ENABLED: true, RUGCHECK_ENABLED: true, TOP_HOLDERS_ENABLED: true, CHECK_INSIDERS: true, MAX_INSIDER_PCT: 25, ANTI_PVP_MODE: 'KEEP_BIGGEST', ANTI_PVP_MIN_LIQ_USD: 10000, TVL_DROP_FILTER_ENABLED: true, TVL_DROP_MAX_PCT: 45 };
for (const [k, v] of Object.entries(NEW)) { assert.strictEqual(s.DEFAULTS[k], v, k); assert(s.ALLOWED_KEYS.includes(k), k); assert.strictEqual(s.FIELDS[k].default, v, k + ' field default'); }
const bad = s.validatePatch({ ANTI_PVP_MODE: 'BOGUS' }); assert.strictEqual(bad.ok, false);
const good = s.validatePatch({ ANTI_PVP_MODE: 'SKIP_ALL', FILTERS_ENABLED: false, MAX_INSIDER_PCT: 30, CHECK_INSIDERS: '0' }); assert.strictEqual(good.ok, true, JSON.stringify(good));
// Master OFF keeps individual toggles.
const r1 = s.applySettings(s.paths().dir, { FILTERS_ENABLED: false }, { updatedBy: 'test' }); assert.strictEqual(r1.ok, true);
const cur = s.currentValues(); assert.strictEqual(cur.FILTERS_ENABLED, false); assert.strictEqual(cur.PUMP1H_FILTER_ENABLED, true); assert.strictEqual(cur.ANTI_PVP_MODE, 'KEEP_BIGGEST');
const r2 = s.applySettings(s.paths().dir, { FILTERS_ENABLED: true }, { updatedBy: 'test' }); assert.strictEqual(r2.ok, true);
assert.strictEqual(s.currentValues().FILTERS_ENABLED, true);
console.log('test-antipvp-settings: ok');
