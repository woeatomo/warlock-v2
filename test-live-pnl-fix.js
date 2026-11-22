'use strict';
// live-pnl-fix (20 Nov 2026): the false "big minus -> emergency SL" cases seen live today, replayed with fakes. Nothing signed, no network, no state files.
//  FIONA#3: part of the deposit expired -> undeposited SOL must stay the position's pile (no emergency).
//  DCTY   : reshape withdrew the tokens and the re-add failed -> tokens in the wallet + claimed SOL fees still count (no emergency).
//  stuck re-add: the exit-rule hold ends after 3 failed polls (counter persisted on the position), then SL evaluates; re-add abandoned after 6.
//  emergency confirm read: same pollId -> policy counters advance once.
//  empty position close: no removeLiquidity (SDK 'binId' TypeError), only claim + close.
const assert = require('assert'), fs = require('fs'), path = require('path');
const openExec = require('./live-open-exec'), R = require('./live-reshape-exec'), liveExit = require('./live-exit');
const SRC = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const SOL = 'So11111111111111111111111111111111111111112';
const PRICE = 2.5e-5, quote = async (m, o, raw, dec) => ({ ok: true, outUi: Number(raw) / 10 ** dec * PRICE });
const CFG = { EMERGENCY_DROP: 0.2, TP_USD_PCT: 13, OOR_RIGHT_CONFIRM_POLLS: 2 };
const basePos = (o = {}) => ({ name: 'FIONA-SOL', mintX: 'X', decX: 6, capitalAsset: 'SOL', capitalInSol: 1, depositSol: 0.9, spotSol: 0.45, bidaskSol: 0.45, leftoverSol: 0.0405, rentRefundableSol: 0.0594, usdcIn: 72, initialUsdcIn: 72, baseFeePct: 2, quoteMint: SOL, binStep: 80, entryActiveBin: -461, minBinId: -547, maxBinId: -461, origMaxBinId: -461, openedAt: new Date().toISOString(), strategySettings: {}, ...o });
const decide = (pos, v, pollId = 1) => liveExit.decideLiveExit({ pos, v: { x: 0, y: 0, fx: 0, fy: 0, price: PRICE, activeBinId: -470, ...v }, pxUsd: 72, quote, txFee: 0.000025, CFG, pollId });
const BN = class { constructor(v) { this.v = typeof v === 'string' ? BigInt(v) : BigInt(Math.floor(Number(v))); } };
const ST = { Spot: 'Spot', BidAsk: 'BidAsk' };
(async () => {
  await t('FIONA#3 partial deposit (spot chunk 1/2 landed, rest expired): booked from chain, undeposited SOL -> leftoverSol, PnL ~0%, no emergency', async () => {
    const pos = basePos(), dep = { complete: false, depositedLamports: 0 };
    const before = await decide(basePos(), { y: 0.225 });
    assert.equal(before.reason, 'emergency_stop');                                   // what happened live at 11:44 WIB
    const booked = openExec.bookOnchainDeposit(pos, dep, 0.225, { unit: 1e9, quote: 'SOL' });
    assert.equal(booked, 0.225); assert.equal(pos.depositSol, 0.225); assert.equal(dep.depositedLamports, 225000000); assert.equal(dep.complete, false);
    assert.ok(Math.abs(pos.leftoverSol - (0.0405 + 0.675)) < 1e-9);
    const r = await decide(pos, { y: 0.225 }); assert.equal(r.reason, null); assert.ok(Math.abs(r.val.pnlPct) < 0.5, 'pnl ' + r.val.pnlPct);
  });
  await t('deposit booking: within tolerance keeps planned; RPC fail falls back to landed count; real 0 -> cleanup path; re-booking never double-credits', async () => {
    let pos = basePos(), dep = { complete: true, depositedLamports: 9e8 };
    openExec.bookOnchainDeposit(pos, dep, 0.898, {}); assert.equal(pos.depositSol, 0.9); assert.equal(dep.complete, true); assert.ok(Math.abs(pos.leftoverSol - 0.0405) < 1e-12);
    pos = basePos(); dep = { complete: false, depositedLamports: 4.5e8 };
    openExec.bookOnchainDeposit(pos, dep, null, {}); assert.equal(pos.depositSol, 0.45); assert.ok(Math.abs(pos.leftoverSol - 0.4905) < 1e-9);
    pos = basePos(); dep = { complete: false, depositedLamports: 4.5e8 };
    openExec.bookOnchainDeposit(pos, dep, 0, {}); assert.equal(dep.depositedLamports, 0);   // bot.js then runs emptyLivePositionCleanup
    openExec.bookOnchainDeposit(pos, { complete: false, depositedLamports: 0 }, 0.3, {});    // repairZeroDeposit: liquidity found after all
    assert.equal(pos.depositSol, 0.3); assert.ok(Math.abs(pos.leftoverSol - (0.0405 + 0.6)) < 1e-9, 'credit replaced, not added: ' + pos.leftoverSol);
    pos = basePos(); dep = { complete: true, depositedLamports: 9e8 };                    // planned 0.9 but chain says 0.6 although every tx "confirmed"
    openExec.bookOnchainDeposit(pos, dep, 0.6, {}); assert.equal(pos.depositSol, 0.6); assert.equal(dep.complete, false); assert.equal(dep.depositedLamports, 6e8);
  });
  await t('deposit booking USDC pool: depositQuote booked, unspent USDC taken out of usdcIn', async () => {
    const pos = { depositSol: 100, depositQuote: 100, spotQuote: 50, bidaskQuote: 50, usdcIn: 105, initialUsdcIn: 105, leftoverSol: 0.02 }, dep = { complete: false, depositedLamports: 0 };
    openExec.bookOnchainDeposit(pos, dep, 50, { unit: 1e6, quote: 'USDC' });
    assert.equal(pos.depositQuote, 50); assert.equal(dep.depositedLamports, 50e6); assert.equal(pos.usdcIn, 55); assert.equal(pos.leftoverSol, 0.02);
  });
  await t('bot.js: Claude\'s overwrite (depositSol = dep.depositedLamports / LAMPORTS) is gone and both open paths call bookOnchainDeposit', async () => {
    const lo = SRC.slice(SRC.indexOf('async function liveOpen('), SRC.indexOf('async function liveOpenUsdcPool'));
    assert.ok(!/depositSol = dep\.depositedLamports/.test(lo)); assert.ok(/bookOnchainDeposit\(state\.position, dep, await onchainQuoteDeposit/.test(lo));
    const lu = SRC.slice(SRC.indexOf('async function liveOpenUsdcPool'), SRC.indexOf('async function onchainQuoteDeposit'));
    assert.ok(!/depositSol = dep\.depositedLamports/.test(lu)); assert.ok(/bookOnchainDeposit\(state\.position, dep, await onchainQuoteDeposit/.test(lu));
  });
  const mkReshape = (o = {}) => { const calls = []; let tok = 0n;
    const d = { feeX: { toString: () => '0' }, feeY: { toString: () => String(o.feeY ?? 0) }, positionBinData: [{ binId: -462, positionXAmount: '2000000000' }, { binId: -463, positionXAmount: '2196513273' }, { binId: -470, positionXAmount: '0' }] };
    const dlmm = { claimSwapFee: async () => (calls.push('claim'), [{}]), removeLiquidity: async () => (calls.push('remove'), tok += 4196513273n, [{}]),
      addLiquidityByStrategyChunkable: async p => { calls.push('add'); if (p.totalXAmount.v > 0n && o.failTokenAdd) throw new Error('Simulation failed. ExceededBinSlippageTolerance'); return [{}]; } };
    const pos = basePos({ name: 'DCTY-SOL', origMaxBinId: -461, ...(o.pos || {}) });
    return { calls, pos, args: { pos, positionKey: 'K', lbPosition: { positionData: d }, slippage: 1, dlmm, positionData: d, activeBinId: o.active ?? -464, settings: { COMPOUND_ENABLED: true, COMPOUND_SPOT_PCT: 50, RESHAPE_SHAPE: 'BIDASK' }, txFee: 0.000025, StrategyType: ST, BN, wallet: { publicKey: 'W' }, send: async () => {}, getTokenRaw: async () => tok, getSolBalance: async () => 7, sleep: async () => {}, log: () => {} } };
  };
  await t('DCTY reshape: tokens withdrawn, re-add fails -> claimed SOL fees go to the pile, wallet tokens counted -> no false SL', async () => {
    const m = mkReshape({ failTokenAdd: true, feeY: 1260000 });
    const r = await R.reshape(m.args);
    assert.equal(r.tokenAdded, false); assert.ok(m.pos.reshapePending); assert.equal(r.feeYPiled, 0.00126);
    assert.ok(Math.abs(m.pos.leftoverSol - (0.0405 + 0.00126)) < 1e-12, 'fees piled ' + m.pos.leftoverSol);   // compound skipped because the re-add failed
    // value: SOL side still in the position, the 4196.5 tokens now in the wallet (liveValuation adds them to x)
    const tokens = 12000, ySol = 0.9 - tokens * PRICE;   // ~0.30 SOL of tokens out of the position, like DCTY (4196.5 DCTY ~ 0.28 SOL)
    const without = await decide(basePos(), { y: ySol, x: 0 }); assert.equal(without.reason, 'emergency_stop');   // the old reading (tokens ignored)
    const withW = await decide(m.pos, { y: ySol, x: tokens }); assert.notEqual(withW.reason, 'emergency_stop'); assert.ok(withW.val.pnlPct > -5, 'pnl ' + withW.val.pnlPct);
  });
  await t('reshape with compound: the piled fees are taken back exactly when compounded (no double count)', async () => {
    const m = mkReshape({ feeY: 40000000 }); const r = await R.reshape(m.args);
    assert.ok(r.tokenAdded); assert.ok(Math.abs(r.compounded - 0.04) < 1e-12); assert.ok(Math.abs(m.pos.leftoverSol - 0.0405) < 1e-9, 'pile back to ' + m.pos.leftoverSol);
  });
  await t('reshape COMPOUND_ENABLED=false: claimed SOL fees stay in the pile (were dropped from the value before)', async () => {
    const m = mkReshape({ feeY: 40000000 }); m.args.settings.COMPOUND_ENABLED = false; const r = await R.reshape(m.args);
    assert.equal(r.compounded, 0); assert.ok(Math.abs(m.pos.leftoverSol - 0.0805) < 1e-9);
  });
  await t('stuck reshapePending: hold ends after 3 failed polls (persisted counter), SL evaluates, re-plan from current active, abandoned after 6', async () => {
    assert.ok(/RESHAPE_PENDING_HOLD_POLLS = 3, RESHAPE_PENDING_MAX_POLLS = Infinity;/.test(SRC));
    assert.ok(/const reshapeHeld = !!rpNow && \(Number\(rpNow\.polls\) \|\| 0\) < RESHAPE_PENDING_HOLD_POLLS;/.test(SRC));
    assert.ok(/liveReshapeExec\.resumePendingCapped\(rctx, \{ holdPolls: RESHAPE_PENDING_HOLD_POLLS, maxPolls: RESHAPE_PENDING_MAX_POLLS \}\)/.test(SRC));
    const held = pos => !!pos.reshapePending && (Number(pos.reshapePending.polls) || 0) < 3;   // same expression as bot.js
    const m = mkReshape({ failTokenAdd: true }); await R.reshape(m.args); const pos = m.pos;
    assert.ok(held(pos));
    for (let i = 1; i <= 3; i++) { const rs = await R.resumePendingCapped({ ...m.args, activeBinId: -464 }, { holdPolls: 3, maxPolls: 6 }); assert.equal(rs.polls, i); }
    const saved = JSON.parse(JSON.stringify(pos)); assert.equal(saved.reshapePending.polls, 3);              // survives a restart (state.json)
    assert.equal(held(saved), false);
    const dump = await decide(saved, { y: 0.3, x: 0 }); assert.equal(dump.reason, 'emergency_stop');          // a real dump now closes
    const rs4 = await R.resumePendingCapped({ ...m.args, pos: saved, activeBinId: -455 + -10 }, { holdPolls: 3, maxPolls: 6 });
    assert.equal(rs4.replanned, true); assert.equal(saved.reshapePending.rightMin, -464); assert.equal(saved.reshapePending.rightMax, -461);
    await R.resumePendingCapped({ ...m.args, pos: saved, activeBinId: -465 }, { holdPolls: 3, maxPolls: 6 });
    const rs6 = await R.resumePendingCapped({ ...m.args, pos: saved, activeBinId: -465 }, { holdPolls: 3, maxPolls: 6 });
    assert.equal(rs6.abandoned, true); assert.equal(saved.reshapePending, null); assert.ok(saved.reshapeAbandoned && saved.reshapeAbandoned.amountRaw);
    const ok = mkReshape({}); ok.pos.reshapePending = { amountRaw: '1000', rightMin: -463, rightMax: -461, shape: 'BIDASK', polls: 2 };
    const rr = await R.resumePendingCapped(ok.args, {}); assert.equal(rr.resumed, true); assert.equal(ok.pos.reshapePending, null);
    assert.ok(/never start a new reshape on top of an unfinished re-add/.test(SRC));
  });
  await t('emergency confirm read reuses the pollId: counters (oorRightPolls, SL+ polls) advance once per poll', async () => {
    const pos = basePos();
    await decide(pos, { y: 0.9, activeBinId: -455 }, 7); assert.equal(pos.oorRightPolls, 1);
    await decide(pos, { y: 0.9, activeBinId: -455 }, 7); assert.equal(pos.oorRightPolls, 1);   // confirm read, same poll
    await decide(pos, { y: 0.9, activeBinId: -455 }, 8); assert.equal(pos.oorRightPolls, 2);
    const cyc = SRC.slice(SRC.indexOf('async function livePositionCycle'), SRC.indexOf('async function liveCycle'));
    const confirm = cyc.slice(cyc.indexOf("if (exitReason === 'emergency_stop')"), cyc.indexOf('second reading failed'));
    assert.ok(/CFG, pollId \}\)/.test(confirm)); assert.ok(!/livePollSequence/.test(confirm));
  });
  await t('empty position close: no removeLiquidity (binId TypeError), claim + close only; never-funded -> empty cleanup, nothing booked', async () => {
    const lc = SRC.slice(SRC.indexOf('async function emptyPositionCloseTxs'), SRC.indexOf('async function liveCloseSol'));
    assert.ok(/if \(!\(Number\(pos\.depositSol\) > 0\) && pos\.closeStartSol == null\)[^\n]*emptyLivePositionCleanup\(state, pos\)/.test(lc));
    assert.ok(/const txs = liqLeft \? await v\.dlmm\.removeLiquidity\(/.test(lc));
    const fnSrc = SRC.slice(SRC.indexOf('async function emptyPositionCloseTxs'), SRC.indexOf('async function liveClose('));
    const wallet = { publicKey: 'W' }; const calls = [];
    const emptyPositionCloseTxs = new Function('wallet', fnSrc + '; return emptyPositionCloseTxs;')(wallet);
    const dlmm = { removeLiquidity: async () => { throw new TypeError("Cannot read properties of undefined (reading 'binId')"); }, claimSwapFee: async () => (calls.push('claim'), [{ t: 'claim' }]), closePosition: async () => (calls.push('close'), { t: 'close' }) };
    const v = { dlmm, p: { positionData: { feeX: '0', feeY: '0', positionBinData: [{ positionXAmount: '0', positionYAmount: '0' }] } } };
    const txs = await emptyPositionCloseTxs(v); assert.deepEqual(calls, ['close']); assert.equal(txs.length, 1);
    v.p.positionData.feeY = '1500'; calls.length = 0; const txs2 = await emptyPositionCloseTxs(v); assert.deepEqual(calls, ['claim', 'close']); assert.equal(txs2.length, 2);
  });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
