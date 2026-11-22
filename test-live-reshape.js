'use strict';
// Live reshape/compound == paperReshape: trigger, guards, range, step order. Fake DLMM, nothing signed.
const assert = require('assert'), fs = require('fs'), path = require('path'); const R = require('./live-reshape-exec'); const core = require('./reshape-core');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const BN = class { constructor(v) { this.v = typeof v === 'string' ? BigInt(v) : BigInt(Math.floor(Number(v))); } };
const ST = { Spot: 'Spot', BidAsk: 'BidAsk' };
const mk = (o = {}) => { const calls = []; let tok = o.tokStart ?? 0n, sol = o.sol ?? 0.2;
  const dlmm = { claimSwapFee: async ({ position }) => { if (!position || !position.positionData) throw new TypeError("Cannot read properties of undefined (reading 'feeX')"); /* like the real SDK: needs the loaded LbPosition, not a public key */ calls.push(['claim']); return [{ t: 'claim' }]; },
    removeLiquidity: async p => (calls.push(['remove', p.fromBinId, p.toBinId, p.shouldClaimAndClose]), tok += o.withdraw ?? 1000000n, [{ t: 'rm' }]),
    addLiquidityByStrategyChunkable: async p => { calls.push(['add', p.strategy.strategyType, p.strategy.minBinId, p.strategy.maxBinId, p.totalXAmount.v, p.totalYAmount.v]); if (o.failTokenAdd && p.totalXAmount.v > 0n) throw new Error('rpc'); return [{ t: 'add' }]; } };
  const pos = { decX: 6, position: 'POS', origMaxBinId: -251, minBinId: -286, walletBefore: 0.05, ...(o.pos || {}) };
  const d = { feeX: { toString: () => String(o.feeX ?? 0) }, feeY: { toString: () => String(o.feeY ?? 0) }, positionBinData: o.bins ?? [{ binId: -256, positionXAmount: '500000' }, { binId: -255, positionXAmount: '500000' }, { binId: -260, positionXAmount: '0' }] };
  return { calls, pos, args: { pos, positionKey: 'POSKEY', lbPosition: { positionData: d }, slippage: 1, dlmm, positionData: d, activeBinId: o.active ?? -258, settings: { COMPOUND_ENABLED: true, COMPOUND_SPOT_PCT: 50, RESHAPE_SHAPE: 'BIDASK', ...(o.settings || {}) }, txFee: 0.000025, StrategyType: ST, BN, wallet: { publicKey: 'W' }, send: async (tx, s, l) => { calls.push(['send', l]); }, getTokenRaw: async () => tok, getSolBalance: async () => sol, sleep: async () => {}, log: () => {} } }; };
(async () => {
  await t('trigger: price down N bins from lastReshapeActiveBin (else entryActiveBin); RESHAPE_ENABLED=false or stop -> never', () => {
    assert.equal(R.trigger({ pos: { entryActiveBin: -251 }, activeBinId: -256, settings: { RESHAPE_N: 5 } }).due, true);
    assert.equal(R.trigger({ pos: { entryActiveBin: -251 }, activeBinId: -255, settings: { RESHAPE_N: 5 } }).due, false);
    assert.equal(R.trigger({ pos: { entryActiveBin: -251, lastReshapeActiveBin: -256 }, activeBinId: -260, settings: { RESHAPE_N: 5 } }).due, false);
    assert.equal(R.trigger({ pos: { entryActiveBin: -251 }, activeBinId: -300, settings: { RESHAPE_N: 5, RESHAPE_ENABLED: false } }).due, false);
    assert.equal(R.trigger({ pos: { entryActiveBin: -251 }, activeBinId: -300, settings: { RESHAPE_N: 5 }, stop: true }).due, false);
  });
  await t('steps in dry-run order on the SAME position: claim, remove ONLY token bins (> active, no close), re-add token-only BidAsk [active+1..origMax], compound quote fees to the left 50:50', async () => {
    const m = mk({ feeY: 40000000, feeX: 100000 }); const r = await R.reshape(m.args);
    assert.deepEqual(m.calls.filter(c => c[0] !== 'send').map(c => c[0]), ['claim', 'remove', 'add', 'add', 'add']);
    const rm = m.calls.find(c => c[0] === 'remove'); assert.equal(rm[1], -256); assert.equal(rm[2], -255); assert.equal(rm[3], false);
    const adds = m.calls.filter(c => c[0] === 'add');
    assert.equal(adds[0][1], 'BidAsk'); assert.equal(adds[0][2], -257); assert.equal(adds[0][3], -251); assert.equal(adds[0][4], 1000000n); assert.equal(adds[0][5], 0n);
    assert.equal(adds[1][1], 'Spot'); assert.equal(adds[1][2], -286); assert.equal(adds[1][3], -259); assert.equal(adds[1][5], 20000000n);
    assert.equal(adds[2][1], 'BidAsk'); assert.equal(adds[2][5], 20000000n);
    assert.ok(r.ok && r.tokenAdded && Math.abs(r.compounded - 0.04) < 1e-9); assert.equal(r.txs, 4);
  });
  await t('guard: leftover SOL pile must cover the tx fees, else skip BEFORE touching the position', async () => { const m = mk({ sol: 0.05 }); const r = await R.reshape(m.args); assert.ok(/cannot cover/.test(r.skipped)); assert.equal(m.calls.length, 0); });
  await t('no token inventory: skipped, nothing sent', async () => { const m = mk({ bins: [{ binId: -260, positionXAmount: '0' }] }); const r = await R.reshape(m.args); assert.ok(/no token-side/.test(r.skipped)); assert.equal(m.calls.length, 0); });
  await t('no room on the right (active >= origMax): skipped BEFORE withdrawing (nothing taken out)', async () => { const m = mk({ active: -251, bins: [{ binId: -250, positionXAmount: '500000' }] }); const r = await R.reshape(m.args); assert.ok(/no room/.test(r.skipped)); assert.equal(m.calls.length, 0); });
  await t('COMPOUND_ENABLED=false: token fees stay unclaimed-for-readd (not re-added) and no quote compound', async () => { const m = mk({ feeY: 40000000, feeX: 100000, settings: { COMPOUND_ENABLED: false } }); const r = await R.reshape(m.args); const adds = m.calls.filter(c => c[0] === 'add'); assert.equal(adds.length, 1); assert.equal(adds[0][4], 900000n); assert.equal(r.compounded, 0); });
  await t('RESHAPE_SHAPE=SPOT uses Spot for the token re-add', async () => { const m = mk({ settings: { RESHAPE_SHAPE: 'SPOT' } }); await R.reshape(m.args); assert.equal(m.calls.find(c => c[0] === 'add')[1], 'Spot'); });
  await t('token re-add fails after the withdrawal: pending plan kept on the position, reported (not thrown); resumePending finishes it', async () => {
    const m = mk({ failTokenAdd: true }); const r = await R.reshape(m.args); assert.equal(r.ok, false); assert.ok(m.pos.reshapePending && m.pos.reshapePending.amountRaw === '1000000');
    const m2 = mk({}); m2.pos.reshapePending = m.pos.reshapePending; const rr = await R.resumePending({ ...m2.args }); assert.equal(rr.resumed, true); assert.equal(m2.pos.reshapePending, null); assert.equal(m2.calls.filter(c => c[0] === 'add').length, 1);
  });
  await t('no bins below active: quote fees are not compounded, no crash', async () => { const m = mk({ feeY: 40000000, active: -258, pos: { minBinId: -258 } }); const r = await R.reshape(m.args); assert.equal(r.compounded, 0); assert.ok(r.tokenAdded); });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
