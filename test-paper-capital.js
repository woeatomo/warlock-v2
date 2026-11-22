// USDC paper-capital round trip and gas-buffer tests. No network.
'use strict';
const assert = require('assert');
const c = require('./paper-capital');

function almost(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
}

// Default buffer covers pos+ATA + 2 bin arrays + generous txs, with margin, floored at 0.30
const buf = c.computeGasBufferSol();
assert.ok(buf.buffer >= 0.30, 'floor 0.30 SOL');
const twoArrayRaw = c.POSITION_RENT_SOL + c.ATA_RENT_SOL + 2 * c.BIN_ARRAY_RENT_SOL + c.DEFAULT_TX_FEE_SOL * (2 + 3 + 3 + 75);
almost(buf.raw, twoArrayRaw, 1e-12);
assert.ok(buf.buffer >= buf.needed, 'floor at least needed');
// If a pool quotes 3 arrays, buffer rises above the floor
const three = c.computeGasBufferSol({ rentNonRefundable: 3 * c.BIN_ARRAY_RENT_SOL, floor: 0.30 });
assert.ok(three.buffer > 0.30, '3 arrays should exceed 0.30 floor');
assert.ok(three.buffer >= three.needed);

// Spend plan: 500 USDC, $10k cap, extra 0.30 SOL at $100
const plan = c.planOpenSpend({ usdcCash: 500, usdcBuffer: 0.10, capUsd: 10000, extraSol: 0.30, solUsd: 100, slippagePad: 1.01 });
assert.strictEqual(plan.ok, true);
almost(plan.extraUsd, 0.30 * 100 * 1.01);
almost(plan.usdcForPosition, 500 - 0.10 - plan.extraUsd);
almost(plan.usdcToSwap, plan.usdcForPosition + plan.extraUsd);
assert.strictEqual(plan.capped, false);

// TVL cap binds
const capped = c.planOpenSpend({ usdcCash: 500, usdcBuffer: 0.10, capUsd: 50, extraSol: 0.30, solUsd: 100, slippagePad: 1.00 });
assert.strictEqual(capped.ok, true);
almost(capped.usdcForPosition, 50);
almost(capped.usdcToSwap, 50 + 30);
assert.strictEqual(capped.capped, true);

// Not enough USDC for buffer
const short = c.planOpenSpend({ usdcCash: 20, usdcBuffer: 0.10, capUsd: 1000, extraSol: 0.30, solUsd: 100 });
assert.strictEqual(short.ok, false);

// Allocate: bought 3.30 SOL, rent 0.13, open fees 0.00005, extra 0.30
const alloc = c.allocateOpenSol(3.30, { rentRef: 0.05944536, rentNon: 0.07143744, openFees: 0.00005, extraSol: 0.30 });
assert.strictEqual(alloc.ok, true);
almost(alloc.openCost, 0.05944536 + 0.07143744 + 0.00005);
almost(alloc.reserve, 0.30 - alloc.openCost);
almost(alloc.deposit, 3.30 - alloc.openCost - alloc.reserve);
almost(alloc.deposit + alloc.reserve + alloc.openCost, 3.30);

const tooSmall = c.allocateOpenSol(0.05, { rentRef: 0.059, rentNon: 0, openFees: 0.00005, extraSol: 0.30 });
assert.strictEqual(tooSmall.ok, false);

// Close pile: position + leftover gas + rent refund - close fees, then all of it goes to USDC
const pile = c.closeSolPile({ positionSol: 3.05, leftoverSol: 0.16, rentRefund: 0.05944536, closeFees: 0.000075 });
almost(pile, 3.05 + 0.16 + 0.05944536 - 0.000075);

// Round trip: 499.9 USDC in, 502.0 USDC out, swap costs and gas reported separately
const gasUsed = c.gasUsedSol({ rentPaid: 0.1308828, rentRefunded: 0.05944536, networkFees: 0.0002 });
almost(gasUsed, 0.1308828 - 0.05944536 + 0.0002);
const rt = c.closeRoundTrip({
  usdcIn: 499.9,
  usdcOut: 502.0,
  openSwapCostUsd: 0.40,
  tokenSwapCostUsd: 0.10,
  solSwapCostUsd: 0.35,
  gasUsedSol: gasUsed,
  solUsd: 100,
});
almost(rt.pnlUsd, 2.1);
almost(rt.pnlPct, 2.1 / 499.9 * 100);
almost(rt.swapCostUsd, 0.85);
almost(rt.pnlSolEq, 2.1 / 100);
almost(rt.pnlUsdAfterGas, 2.1 - gasUsed * 100);
assert.ok(rt.pnlUsd > 0, 'round trip profit in USDC');

// Losing round trip
const loss = c.closeRoundTrip({ usdcIn: 500, usdcOut: 490, solUsd: 80 });
almost(loss.pnlUsd, -10);
almost(loss.pnlPct, -2);
almost(loss.pnlSolEq, -10 / 80);

// Parse quote: 100 USDC (6 dec) -> 1.176 SOL (9 dec) at $85
const q = c.parseQuote({ inAmount: '100000000', outAmount: '1176000000', priceImpactPct: '0.01' }, 6, 9);
assert.strictEqual(q.ok, true);
almost(q.inUi, 100);
almost(q.outUi, 1.176);
const sc = c.swapCostUsd({ inUi: q.inUi, outUi: q.outUi, inIsUsd: true, outIsUsd: false, solUsd: 85 });
almost(sc, 100 - 1.176 * 85);

const start = c.emptyVirtual(500);
almost(start.usdc, 500);
almost(start.sol, 0);

console.log('OK  paper-capital unit check');
console.log(JSON.stringify({
  defaultBufferSol: buf.buffer,
  neededSol: buf.needed,
  rawSol: buf.raw,
  threeArrayBuffer: three.buffer,
  sampleRoundTrip: rt,
}, null, 2));
