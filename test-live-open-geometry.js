'use strict';
// Entry geometry + deposit order for live == dry run (quote only, -50%, Spot:BidAsk 50:50). Offline; a fake DLMM records calls, nothing is signed.
const assert = require('assert'); const strategy = require('./paper-strategy'); const { planEntry } = require('./live-geometry'); const { openDeposit } = require('./live-open-exec'); const PS = require('./paper-settings');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const BN = class { constructor(v) { this.v = Number(v); } }; const ST = { Spot: 'Spot', BidAsk: 'BidAsk' };
const CFG = { RANGE_DOWN_PCT: 50, LOWER_BINS: 0, RANGE_UP_PCT: 0, UPPER_BUFFER_BINS: 0, OPEN_SHAPE: 'MIXED', OPEN_SPOT_PCT: 50 };
const fake = () => { const calls = []; const mk = n => ({ n }); return { calls, dlmm: {
  initializePositionAndAddLiquidityByStrategy: async p => (calls.push(['init', p.strategy.strategyType, p.totalYAmount.v, p.strategy.minBinId, p.strategy.maxBinId]), mk('init')),
  addLiquidityByStrategy: async p => (calls.push(['add', p.strategy.strategyType, p.totalYAmount.v]), mk('add')),
  createExtendedEmptyPosition: async (a, b) => (calls.push(['ext', a, b]), mk('ext')),
  addLiquidityByStrategyChunkable: async p => (calls.push(['chunk', p.strategy.strategyType, p.totalYAmount.v]), [mk('c1'), mk('c2')]) }, send: async (tx, s, l) => { calls.push(['send', l]); } }; };
(async () => {
  await t('default and schema: UPPER_BUFFER_BINS = 0 (quote only), 0 allowed, Reset gives 0', () => { assert.equal(PS.DEFAULTS.UPPER_BUFFER_BINS, 0); assert.equal(PS.FIELDS.UPPER_BUFFER_BINS.min, 0); assert.equal(PS.FIELDS.UPPER_BUFFER_BINS.default, 0); });
  await t('geometry: -50% down, no bins above active, bin step decides the bin count', () => {
    for (const step of [10, 25, 50, 100, 200]) { const g = strategy.geometry(step, CFG, 1400); assert.equal(g.upper, 0); assert.ok(g.downPct >= 49.9 && g.downPct <= 50 + step / 100 + .1 || g.n === 1399, step + ' ' + g.downPct); assert.equal(g.bins, g.n); }
    assert.equal(strategy.geometry(200, CFG, 1400).n, 36);   // HUNG bin step 200: 36 bins down to -50%
  });
  await t('planEntry: range ends AT the active bin; active bin included; split 50:50', () => { const p = planEntry({ strategy, binStep: 100, activeBinId: -493, policy: CFG, maxBins: 1400 }); assert.equal(p.maxBinId, -493); assert.equal(p.minBinId, -493 - p.n + 1); assert.equal(p.split, .5); assert.equal(p.wide, p.width > 70); });
  await t('old setting 5 still works for positions that carry it (snapshot), range = dry run', () => { const p = planEntry({ strategy, binStep: 100, activeBinId: -493, policy: { ...CFG, UPPER_BUFFER_BINS: 5 }, maxBins: 1400 }); assert.equal(p.maxBinId, -488); });
  await t('narrow position: create+Spot first, then BidAsk, amounts sum exactly, single-sided Y only', async () => {
    const f = fake(); const plan = planEntry({ strategy, binStep: 200, activeBinId: -251, policy: CFG, maxBins: 1400 }); assert.equal(plan.wide, false);
    const r = await openDeposit({ dlmm: f.dlmm, plan, actualSol: 5.01, posKp: { publicKey: 'P' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, onCreated: async () => {} });
    const dep = f.calls.filter(c => c[0] === 'init' || c[0] === 'add'); assert.deepEqual(dep.map(c => c[1]), ['Spot', 'BidAsk']); assert.equal(dep[0][2] + dep[1][2], 5010000000); assert.equal(dep[0][3], plan.minBinId); assert.equal(dep[0][4], -251); assert.ok(r.complete);
  });
  await t('wide position (>70 bins): extended empty first, then chunked deposits', async () => {
    const f = fake(); const plan = planEntry({ strategy, binStep: 25, activeBinId: 100, policy: CFG, maxBins: 1400 }); assert.equal(plan.wide, true);
    await openDeposit({ dlmm: f.dlmm, plan, actualSol: 2, posKp: { publicKey: 'P' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, onCreated: async () => {} });
    assert.equal(f.calls[0][0], 'ext'); assert.ok(f.calls.some(c => c[0] === 'chunk' && c[1] === 'Spot') && f.calls.some(c => c[0] === 'chunk' && c[1] === 'BidAsk'));
  });
  await t('second share fails after the position exists: position kept, reported incomplete (no abort)', async () => {
    const f = fake(); f.dlmm.addLiquidityByStrategy = async () => { throw new Error('boom'); }; const plan = planEntry({ strategy, binStep: 200, activeBinId: -251, policy: CFG, maxBins: 1400 }); let created = 0;
    const r = await openDeposit({ dlmm: f.dlmm, plan, actualSol: 4, posKp: { publicKey: 'P' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, onCreated: async () => { created++; } });
    assert.equal(r.complete, false); assert.equal(created, 1); assert.equal(r.depositedLamports, 2000000000);
  });
  await t('first transaction fails: error propagates, nothing recorded', async () => {
    const f = fake(); f.dlmm.initializePositionAndAddLiquidityByStrategy = async () => { throw new Error('nope'); }; const plan = planEntry({ strategy, binStep: 200, activeBinId: -251, policy: CFG, maxBins: 1400 }); let created = 0;
    await assert.rejects(openDeposit({ dlmm: f.dlmm, plan, actualSol: 4, posKp: { publicKey: 'P' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, onCreated: async () => { created++; } }), /nope/); assert.equal(created, 0);
  });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
