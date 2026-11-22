'use strict';
// Reshape + compound for live == paperReshape (dry run). Same trigger (price down N bins from lastReshapeActiveBin ?? entryActiveBin),
// same guard (leftover SOL must cover the tx fees), same range (reshape-core.tokenReshapeRange: [active+1 .. origMaxBinId]),
// same steps on the SAME position: claim fees -> remove ONLY token-side bins (> active) -> re-add token-only (RESHAPE_SHAPE) -> compound claimed quote fees to the left (COMPOUND_SPOT_PCT).
// Every chain call is injected (dlmm / send / wallet balances), so the sequence is unit-tested with fakes; this module signs nothing.
const core = require('./reshape-core');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
function trigger({ pos, activeBinId, settings, stop }) {
  if (stop || settings.RESHAPE_ENABLED === false) return { due: false };
  const n = settings.RESHAPE_N ?? 5, anchor = pos.lastReshapeActiveBin ?? pos.entryActiveBin, down = anchor - activeBinId;
  return { due: down >= n, down, n, anchor };
}
async function reshape({ pos, positionKey, lbPosition, slippage, dlmm, positionData, activeBinId, settings, txFee, StrategyType, BN, wallet, send, getTokenRaw, getSolBalance, sleep = async () => {}, log = () => {}, retries = 3 }) {
  const compoundOn = settings.COMPOUND_ENABLED !== false;
  const d = positionData, decX = pos.decX;
  const qDec = 10 ** (pos.quoteDecimals ?? 9), feeXui = Number(d.feeX.toString()) / 10 ** decX, feeYui = Number(d.feeY.toString()) / qDec;   // quote decimals: 9 SOL pool, 6 USDC pool
  const txsGuess = core.reshapeTxCount({ compoundedSol: compoundOn && feeYui > 0 }), txCostGuess = txsGuess * txFee;
  const pile = pos.leftoverSol != null ? pos.leftoverSol : Math.max(0, (await getSolBalance()) - (pos.walletBefore || 0));   // = the dry run's book.virtual.sol: THIS position's own SOL
  if (pile + 1e-12 < txCostGuess) return { skipped: 'leftover SOL buffer cannot cover reshape tx fees', leftoverSol: pile, txCostGuess };
  const range = core.tokenReshapeRange(pos.origMaxBinId, activeBinId);
  const tokenBins = (d.positionBinData || []).filter(b => b.binId > activeBinId && Number(b.positionXAmount) > 0).sort((a, b) => a.binId - b.binId);
  const tokenOnChain = tokenBins.reduce((s, b) => s + Number(b.positionXAmount), 0) / 10 ** decX;
  if (!(tokenOnChain + (compoundOn ? feeXui : 0) > 0)) return { skipped: 'no token-side inventory or token fees to reshape', ...range };
  if (!range.ok) return { skipped: 'no room on the right within original position edge', ...range };   // checked BEFORE withdrawing: nothing is taken out
  const run = async (name, fn) => { let last; for (let i = 1; i <= retries; i++) { try { return await fn(); } catch (e) { last = e; log(`  reshape ${name} failed (${i}/${retries}): ${e.message}`); await sleep(2000); } } throw last; };
  const tokenBefore = await getTokenRaw();
  const owner = wallet.publicKey, position = positionKey || pos.position;
  // 1) claim all fees (token fees feeX and quote fees feeY land in the wallet)
  const claimTxs = await run('claim', async () => { // the SDK wants the loaded LbPosition object here (it reads position.positionData), not the public key; no fee yet is not an error
    if (!lbPosition) throw new Error('lbPosition missing');
    try { const t = await dlmm.claimSwapFee({ owner, position: lbPosition }); return Array.isArray(t) ? t : [t]; } catch (e) { if (/No fee to claim/i.test(e.message)) return []; throw e; } });
  for (const [i, tx] of claimTxs.entries()) await run('claim send', () => send(tx, [wallet], `reshape-claim ${i + 1}/${claimTxs.length}`));
  // live-pnl-fix: the claimed quote fees are now native SOL in the wallet, outside the position. Credit them to THIS position's pile at once
  // (the compound below takes back exactly what it re-adds), so a failed / skipped compound or a crash in between never drops them from the value.
  const quoteIsSol = !pos.quoteMint || pos.quoteMint === SOL_MINT;
  let feeYPiled = 0;
  if (claimTxs.length && quoteIsSol && feeYui > 0 && pos.leftoverSol != null) {   /* leftoverSol == null: the pile is read from the wallet itself (older positions), nothing to credit */ feeYPiled = feeYui; pos.leftoverSol = (Number(pos.leftoverSol) || 0) + feeYui; pos.feesClaimedToPileSol = (Number(pos.feesClaimedToPileSol) || 0) + feeYui; }
  // 2) withdraw ONLY the token-side bins (> active); the quote side is never withdrawn
  // live-bugfix: a failed / partly landed remove no longer throws away the bookkeeping: what DID reach the wallet is measured, owned by this position
  // (pos.walletTokenRaw) and queued for re-add like any withdrawal; no compound on that poll.
  const errors = [];
  let removeOk = true;
  if (tokenBins.length) {
    try {
      const rm = await run('remove token bins', () => dlmm.removeLiquidity({ user: owner, position, fromBinId: tokenBins[0].binId, toBinId: tokenBins[tokenBins.length - 1].binId, bps: new BN(10000), shouldClaimAndClose: false }));
      for (const [i, tx] of rm.entries()) await run('remove send', () => send(tx, [wallet], `reshape-remove ${i + 1}/${rm.length}`));
    } catch (e) { removeOk = false; errors.push('remove: ' + e.message); log('  ERROR reshape remove failed; measuring what reached the wallet: ' + e.message); }
  }
  await sleep(2000);
  const feeXRaw = BigInt(Math.floor(feeXui * 10 ** decX));
  let after = null; try { after = await run('token balance', getTokenRaw); } catch { /* estimated below */ }
  let amountRaw = after != null ? after - tokenBefore : (removeOk ? BigInt(Math.floor(tokenBins.reduce((t, b) => t + Number(b.positionXAmount), 0))) : 0n) + (claimTxs.length ? feeXRaw : 0n);   // withdrawn X + claimed feeX
  if (amountRaw < 0n) amountRaw = 0n;
  if (pos.walletTokenRaw != null) pos.walletTokenRaw = (BigInt(pos.walletTokenRaw) + amountRaw).toString();   // M1: these tokens are this position's, wherever they sit
  const readdRaw = compoundOn ? amountRaw : amountRaw - (feeXRaw < amountRaw ? feeXRaw : amountRaw);
  const shape = settings.RESHAPE_SHAPE === 'SPOT' ? StrategyType.Spot : StrategyType.BidAsk;
  let tokenAdded = false;
  pos.reshapePending = readdRaw > 0n ? { amountRaw: readdRaw.toString(), rightMin: range.rightMin, rightMax: range.rightMax, shape: settings.RESHAPE_SHAPE || 'BIDASK' } : null;   // persisted by the caller: a crash/failure after the withdrawal can resume
  if (readdRaw > 0n) {
    try { await readd({ dlmm, pos, owner, position, StrategyType, BN, wallet, send, run, plan: pos.reshapePending, slippage }); tokenAdded = true; pos.reshapePending = null; subOwned(pos, readdRaw); }
    catch (e) { errors.push('token re-add: ' + e.message); log('  ERROR reshape token re-add failed; tokens stay in the wallet, retried next poll: ' + e.message); }
  }
  // 3) compound claimed quote fees to the LEFT bins (add only), COMPOUND_SPOT_PCT split like the dry run
  let compounded = 0;
  if (compoundOn && removeOk && feeYui >= 1e-8 && (tokenAdded || readdRaw === 0n)) {
    if (activeBinId > pos.minBinId) {
      const w = (settings.COMPOUND_SPOT_PCT ?? 50) / 100, totalLam = Math.floor(feeYui * qDec), spotLam = Math.floor(totalLam * w), bidLam = totalLam - spotLam;
      try {
        for (const [type, lam, nm] of [[StrategyType.Spot, spotLam, 'spot'], [StrategyType.BidAsk, bidLam, 'bidask']]) {
          if (!(lam > 0)) continue;
          const txs = await run('compound add ' + nm, async () => { if (dlmm.refetchStates) await dlmm.refetchStates(); const t = await dlmm.addLiquidityByStrategyChunkable({ positionPubKey: position, totalXAmount: new BN(0), totalYAmount: new BN(lam), strategy: { minBinId: pos.minBinId, maxBinId: activeBinId - 1, strategyType: type }, user: owner, slippage }); return Array.isArray(t) ? t : [t]; });
          for (const [i, tx] of txs.entries()) await run('compound send', () => send(tx, [wallet], `reshape-compound-${nm} ${i + 1}/${txs.length}`));
          if (feeYPiled > 0) { const back = Math.min(lam / qDec, Number(pos.leftoverSol) || 0); pos.leftoverSol = (Number(pos.leftoverSol) || 0) - back; pos.feesClaimedToPileSol = Math.max(0, (Number(pos.feesClaimedToPileSol) || 0) - back); }   // this share is in the position now
        }
        compounded = feeYui;
      } catch (e) { errors.push('compound: ' + e.message); log('  ERROR compound failed, fees stay in the wallet pile: ' + e.message); }
    } else log('  cannot compound quote fees to the left: no bins below active (dry run would extend the position lower; live keeps the fees in the pile)');
  }
  return { ok: removeOk && (tokenAdded || readdRaw === 0n), tokenAdded, compounded, feeYPiled, errors, range, amountX: Number(readdRaw) / 10 ** decX, feeXAdded: compoundOn ? feeXui : 0, txs: txsGuess, txCost: txsGuess * txFee, tokenBins: tokenBins.length };
}
function subOwned(pos, raw) { if (pos.walletTokenRaw == null) return; const v = BigInt(pos.walletTokenRaw) - BigInt(raw); pos.walletTokenRaw = (v > 0n ? v : 0n).toString(); }
async function readd({ dlmm, owner, position, StrategyType, BN, wallet, send, run, plan, slippage }) {
  const type = plan.shape === 'SPOT' ? StrategyType.Spot : StrategyType.BidAsk;
  const txs = await run('token add', async () => { if (dlmm.refetchStates) await dlmm.refetchStates(); /* fresh active bin after claim/remove: a stale one gave ExceededBinSlippageTolerance */ const t = await dlmm.addLiquidityByStrategyChunkable({ positionPubKey: position, totalXAmount: new BN(plan.amountRaw), totalYAmount: new BN(0), strategy: { minBinId: plan.rightMin, maxBinId: plan.rightMax, strategyType: type }, user: owner, slippage: Math.max(Number(slippage) || 0, 5) })   /* token-only add above the active bin: the active bin moving a little must not abort it (ExceededBinSlippageTolerance) */; return Array.isArray(t) ? t : [t]; });
  for (const [i, tx] of txs.entries()) await run('token add send', () => send(tx, [wallet], `reshape-add-token ${i + 1}/${txs.length}`));
}
// Resume a re-add that was interrupted after the withdrawal (position keeps reshapePending until it succeeds).
async function resumePending(args) {
  const { pos } = args; if (!pos.reshapePending) return { resumed: false };
  const run = async (name, fn) => { let last; for (let i = 1; i <= 3; i++) { try { return await fn(); } catch (e) { last = e; await (args.sleep || (async () => {}))(2000); } } throw last; };
  const plan = pos.reshapePending;
  await readd({ ...args, owner: args.wallet.publicKey, position: args.positionKey || pos.position, run, plan });
  subOwned(pos, plan.amountRaw); pos.reshapePending = null; return { resumed: true };
}
// live-pnl-fix: resume with a persisted failure counter. polls >= holdPolls -> re-plan once from the CURRENT active bin (token-only side = active+1 .. origMax);
// polls >= maxPolls -> give up the re-add (pos.reshapePending = null, recorded in pos.reshapeAbandoned): the tokens stay in the wallet, liveValuation counts them and the close sells them.
async function resumePendingCapped(args, { holdPolls = 3, maxPolls = 6 } = {}) {
  const { pos } = args; const rp = pos.reshapePending; if (!rp) return { resumed: false };
  let replanned = false;
  if ((Number(rp.polls) || 0) >= holdPolls && Number.isFinite(args.activeBinId)) {   // re-plan from the current active bin on every retry after the hold (price keeps moving)
    const nr = core.tokenReshapeRange(pos.origMaxBinId ?? pos.maxBinId, args.activeBinId);
    if (nr.ok) { rp.rightMin = nr.rightMin; rp.rightMax = nr.rightMax; replanned = true; }
    rp.replanned = true;
  }
  const slip = Math.min(15, Math.max(Number(args.slippage) || 0, 5) + (Number(rp.polls) || 0));   // 5% first try, +1% per failed poll, max 15%
  try { const r = await resumePending({ ...args, slippage: slip }); if (r.resumed && rp.replanned && Number.isFinite(args.activeBinId)) pos.lastReshapeActiveBin = args.activeBinId; /* re-planned range starts at today's active bin: the next reshape counts from there */ return { ...r, replanned }; }
  catch (e) {
    rp.polls = (Number(rp.polls) || 0) + 1; rp.lastError = String(e && e.message || e).split('\n')[0].slice(0, 200); rp.lastFailAt = new Date().toISOString();
    if (rp.polls >= maxPolls) { pos.reshapeAbandoned = { ...rp, at: new Date().toISOString() }; pos.reshapePending = null; if (Number.isFinite(args.activeBinId)) pos.lastReshapeActiveBin = args.activeBinId; return { resumed: false, abandoned: true, polls: rp.polls, error: rp.lastError, replanned }; }
    return { resumed: false, polls: rp.polls, error: rp.lastError, replanned };
  }
}
module.exports = { trigger, reshape, resumePending, resumePendingCapped, subOwned };
