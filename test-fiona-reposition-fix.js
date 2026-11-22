'use strict';
// FIONA 20 Nov 16:37-16:38 WIB: (1) the reposition leg was booked -0.80% for a real -0.04% because the SOL pile used the rent ESTIMATE (0.059445)
// instead of what the open really spent (rent 0.051609); (2) the reopen was refused because the price ran 1 bin past the new range during the
// open (guard: no out-of-range deposit) and the leg became a closed trade; now retried once at the fresh active bin; (3) log said "cash is USDC" for SOL capital.
const assert = require('assert'), fs = require('fs'), path = require('path');
const liveSafety = require('./live-safety'), { reposition } = require('./live-reposition-exec');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
(async () => {
  await t('FIONA numbers: real pile 0.048114 (estimate 0.040555), rent 0.051886 -> leg booked ~-0.04% (on-chain open+close -0.00038 SOL)', () => {
    const before = 6.982604928, spent = 0.051609160 + 0.362143910 + 0.087996321 + 0.432085950 + 0.018051062;   // open + 4 add txs, fee-payer deltas from chain
    const r = liveSafety.realOpenPile({ budgetSol: 1, walletBefore: before, walletAfter: before - spent, estimateLeftover: 0.04050464, depositSol: 0.9, rentEstimate: 0.05944536 });
    assert.ok(r.use); assert.ok(Math.abs(r.leftover - 0.048113557) < 1e-6, r.leftover); assert.ok(Math.abs(r.rent - 0.051886443) < 1e-6);
    const received = 0.794049382 + 0.157452444, solOut = r.leftover + received;   // close txs (closeSigsLamports)
    assert.ok(Math.abs((solOut - 1) - (-0.000384)) < 2e-6, 'booked ' + (solOut - 1)); assert.ok(Math.abs((0.04050464 + received - 1) - (-0.007994)) < 2e-6, 'old booking reproduced');
  });
  await t('not used when implausible: an incoming transfer (spent < deposit), pile outside the budget, or far from the estimate', () => {
    assert.ok(!liveSafety.realOpenPile({ budgetSol: 1, walletBefore: 5, walletAfter: 5.5, estimateLeftover: 0.04, depositSol: 0.9 }).use);
    assert.ok(!liveSafety.realOpenPile({ budgetSol: 1, walletBefore: 5, walletAfter: 3.5, estimateLeftover: 0.04, depositSol: 0.9 }).use);
    const far = liveSafety.realOpenPile({ budgetSol: 1, walletBefore: 5, walletAfter: 4.0, estimateLeftover: 0.04, depositSol: 0.9 }); assert.ok(!far.use && /differs/.test(far.why));
    assert.ok(!liveSafety.realOpenPile({ budgetSol: 1, walletBefore: NaN, walletAfter: 4, estimateLeftover: 0.04, depositSol: 0.9 }).use);
  });
  const rig = (results) => { const calls = []; const state = { position: { name: 'FIONA-SOL', pool: 'P', capitalAsset: 'SOL', capitalInSol: 1, usdcIn: 72, strategySettings: {} }, history: [] }; const logs = [];
    const deps = { log: (m) => logs.push(m), fetchPool: async () => ({ address: 'P' }), sanityReason: () => null, closeLeg: async () => ({ usdcOut: 71.5, solOut: 0.9996, row: { name: 'FIONA-SOL', feesSol: 0.00014 } }),
      openNew: async (pool, o) => { calls.push(o); const r = results[calls.length - 1]; if (r === 'open') { state.position = { name: 'FIONA-SOL', openedAt: 'now', minBinId: -500, maxBinId: -414 }; return { opened: true }; } return r; } };
    return { state, deps, calls, logs }; };
  await t('reopen refused because the price ran past the new range -> retried once at the fresh active bin, same SOL budget', async () => {
    const f = rig([{ opened: false, skipped: 'deposit failed: empty position closed' }, 'open']);
    const r = await reposition({ state: f.state, val: { usdcOut: 72 }, settings: { MIN_LIQ_USD: 10000 }, pxUsd: 72, deps: f.deps });
    assert.ok(r.reopened); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].positionBudgetSol, 0.9996); assert.equal(f.calls[1].capitalAsset, 'SOL'); assert.equal(f.state.history.length, 0);
  });
  await t('retry fails too, or a non-price refusal (no retry) -> ordinary close row; log says SOL stays in the wallet (not "cash is USDC")', async () => {
    const f = rig([{ skipped: 'deposit failed: empty position closed' }, { skipped: 'deposit failed: empty position closed' }]);
    const r = await reposition({ state: f.state, val: { usdcOut: 72 }, settings: {}, pxUsd: 72, deps: f.deps });
    assert.ok(!r.reopened && f.calls.length === 2 && f.state.history[0].reason === 'oor_right_reposition_failed_reopen');
    assert.ok(f.logs.some(l => /the SOL stays in the wallet/.test(l)) && !f.logs.some(l => /cash is USDC/.test(l)));
    const g = rig([{ skipped: 'Saldo SOL tidak cukup untuk budget' }]); await reposition({ state: g.state, val: { usdcOut: 72 }, settings: {}, pxUsd: 72, deps: g.deps }); assert.equal(g.calls.length, 1);
  });
  await t('wiring: liveOpen (SOL capital) books the pile from the wallet after the deposit, before notify/return', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'), lo = src.slice(src.indexOf('async function liveOpen('), src.indexOf('async function liveOpenUsdcPool'));
    assert.ok(lo.indexOf('liveSafety.realOpenPile(') > lo.indexOf('bookOnchainDeposit(state.position, dep') && lo.indexOf('liveSafety.realOpenPile(') < lo.indexOf('notifyPartialShape('));
  });
  console.log('all', n, 'FIONA fix tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
