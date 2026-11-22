'use strict';
// PATCH tests (woeatomo fork): no developer swap fee, no MAX_NONREFUND_SOL bypass for wide ranges.
const assert = require('assert');
const ec = require('./paper-entry-cost');
// screening: wide range without numbers yet -> deferred (not rejected)
assert.strictEqual(ec.rejection({ skipCheck: true, known: false }, 0.05), null);
// open: wide range with a fast estimate over the cap -> rejected (used to be bypassed)
const over = { skipCheck: true, known: true, estimated: true, nonrefTotalSol: 0.143, nonrefRentSol: 0.1429, openTxFeeSol: 0.000075, newBinArrays: 2 };
assert.ok(/Non-refundable/.test(ec.rejection(over, 0.05)));
// open: wide range with no new bin arrays -> allowed
assert.strictEqual(ec.rejection({ ...over, nonrefTotalSol: 0.000075, nonrefRentSol: 0, newBinArrays: 0 }, 0.05), null);
// swap fee
const src = require('fs').readFileSync(__dirname + '/swap-route-config.js', 'utf8');
assert.ok(/const ROUTE_FEE_BPS=0;/.test(src) && /return \{\};\s+\/\/ PATCH: no platform fee/.test(src) && /function swapBodyParams\(quote\)\{return \{\};\}/.test(src));
console.log('patch tests passed');
