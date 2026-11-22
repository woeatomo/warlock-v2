// Synthetic unit check for reshape inventory: token conservation, fee reset, original right edge.
const assert = require('assert');
const core = require('./reshape-core');

function nearly(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}

// Entry: orig range 70..100 (upper edge 100). Price dropped, active=90.
// Bins 91-100 hold token X; 70-89 hold SOL. Accrued feeX and feeY waiting to be claimed.
const origMax = 100;
const active = 90;
const pos = {
  origMaxBinId: origMax,
  minBinId: 70,
  maxBinId: 100,
  bins: {},
  feeX: 10,
  feeY: 0.05,
  feesCompoundedSol: 0,
  feesCompoundedX: 0,
};
for (let i = 70; i <= 89; i++) pos.bins[i] = { x: 0, y: 1 };
for (let i = 91; i <= 100; i++) pos.bins[i] = { x: 2, y: 0 };

const x0 = 10 * 2; // 20 token in bins
const feeX0 = 10;
const feeY0 = 0.05;
const y0 = 20 * 1; // 20 SOL on the left

// A buggy range (active+n with n=35) would try rightMax=125, past the original edge.
const buggyMax = active + 35;
assert.ok(buggyMax > origMax, 'precondition: naive active+n exceeds original edge');

const r = core.applyReshapeInventory(pos, { activeBin: active });
assert.equal(r.ok, true);
assert.equal(r.rightMin, active + 1);
assert.equal(r.rightMax, origMax, 'token Bid-Ask must stop at the original upper edge');
assert.ok(r.rightMax < buggyMax, 'must not extend to active+n');
assert.equal(r.maxOccupiedBin, origMax, 'no inventory beyond original right edge');
assert.equal(r.feesReset, true);
assert.equal(pos.feeX, 0);
assert.equal(pos.feeY, 0);
nearly(r.amountX, x0 + feeX0);
nearly(r.xAfter, x0 + feeX0, 1e-9);
nearly(r.xAfter, r.xBefore + feeX0, 1e-9); // withdrawn then re-added + claimed token fees
nearly(pos.feesCompoundedX, feeX0);
nearly(pos.feesCompoundedSol, feeY0);
nearly(r.yAfter, y0 + feeY0);
assert.equal(r.txs, 4, 'claim + remove + add token + add SOL compound');
assert.equal(core.reshapeTxCount({ compoundedSol: false }), 3);
assert.equal(core.reshapeTxCount({ compoundedSol: true }), 4);

// No bin above origMax has inventory
for (const [id, b] of Object.entries(pos.bins)) {
  if (+id > origMax) assert.ok(((b.x || 0) + (b.y || 0)) < 1e-18, 'bin ' + id + ' beyond original edge');
}

// Token is only on the right of active, within orig edge
let rightX = 0, leftX = 0;
for (const [id, b] of Object.entries(pos.bins)) {
  if (+id > active) rightX += b.x || 0;
  if (+id < active) leftX += b.x || 0;
}
nearly(rightX, x0 + feeX0);
nearly(leftX, 0);

// Range helper itself
const range = core.tokenReshapeRange(100, 90);
assert.deepEqual(range, { rightMin: 91, rightMax: 100, ok: true });
assert.equal(core.tokenReshapeRange(100, 100).ok, false);

// Close-style PnL must not double-count compounded fees
const price = 0.5;
const feesEarned = (pos.feesCompoundedSol || 0) + (pos.feesCompoundedX || 0) * price + (pos.feeY || 0) + (pos.feeX || 0) * price;
nearly(feesEarned, feeY0 + feeX0 * price);
const { x, y } = core.sumXY(pos.bins);
const markInvExFees = (y - (pos.feesCompoundedSol || 0)) + (x - (pos.feesCompoundedX || 0)) * price;
nearly(markInvExFees, y0 + x0 * price);

console.log('OK  reshape unit check');
console.log(JSON.stringify({
  rightMin: r.rightMin, rightMax: r.rightMax, origMax,
  amountX: r.amountX, xAfter: r.xAfter, yAfter: r.yAfter,
  feeX: pos.feeX, feeY: pos.feeY, txs: r.txs,
  feesCompoundedX: pos.feesCompoundedX, feesCompoundedSol: pos.feesCompoundedSol,
  feesEarned, markInvExFees,
}, null, 2));
