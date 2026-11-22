'use strict';
// OOR-right reposition for live == paperRepositionRight (dry run): close this leg to USDC, then open a NEW position on the same pool with
// ONLY this leg's proceeds as budget (never newly topped-up cash), same strategySettings, and carry the accounting (initialUsdcIn, realizedPnlCarryUsd, fees carry,
// openedAt, peaks, rightRepositions). The pool is checked (fetch + sanity + proceeds > 1 USDC) BEFORE anything is closed, so a bad pool defers the reposition and the
// old position stays open (retry next poll), like the dry run. All IO is injected; this module signs nothing.
function carryFields(old, leg, pos, number, pxUsd) {
  const feesUsd = (old.feesCarryUsd || 0) + (leg.row?.feesSol || 0) * (pxUsd || 0);
  const set = {
    initialUsdcIn: old.initialUsdcIn || old.usdcIn,
    realizedPnlCarryUsd: (old.realizedPnlCarryUsd || 0) + leg.usdcOut - old.usdcIn,
    ...(old.capitalAsset === 'SOL' ? { initialCapitalInSol: old.initialCapitalInSol || old.capitalInSol, realizedPnlCarrySol: (old.realizedPnlCarrySol || 0) + leg.solOut - old.capitalInSol } : {}),
    feesCarryUsd: feesUsd, swapCostCarryUsd: old.swapCostCarryUsd || 0, gasCarrySol: old.gasCarrySol || 0,
    riskEntryPrice: old.riskEntryPrice || old.entryPrice,
    legOpenedAt: pos.openedAt, openedAt: old.openedAt, entryWib: old.entryWib,
    rightRepositions: number, oorRightPolls: 0,
    openContext: old.openContext, openSource: old.openSource, openReason: old.openReason,
    initialEntryQuoteAmount: old.initialEntryQuoteAmount || old.entryQuoteAmount || old.depositSol,
  };
  for (const k of ['peakPnlCapital', 'peakPnlUsd', 'peakPnlPctUsdc', 'peakPnlAt']) if (old[k] != null) set[k] = old[k];
  Object.assign(pos, set); return set;
}
const RETRYABLE = /deposit failed|moved above the range|moved below the range|active bin/i;   // price moved during the open: a fresh plan can succeed
async function reposition({ state, val, settings, pxUsd, deps }) {
  const old = state.position, number = (old.rightRepositions || 0) + 1, { log = () => {}, now = () => new Date().toISOString() } = deps;
  let pool;
  try {
    pool = await deps.fetchPool(old.pool);
    const bad = deps.sanityReason(pool, settings.MIN_LIQ_USD); if (bad) throw new Error(bad);
    if (!(Math.max(0, val.usdcOut) > 1)) throw new Error('Proceeds too small to reposition');   // usdcOut is solOut*px for SOL capital
  } catch (e) {
    old.repositionRetryCount = (old.repositionRetryCount || 0) + 1; old.repositionRetryAt = now();
    old.repositionRetryError = String(e.message).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 160);
    log(`reposition kanan ditunda ${old.name}: ${old.repositionRetryError}; retry=${old.repositionRetryCount}; posisi lama tetap terbuka`);
    return { done: false, deferred: true };
  }
  const leg = await deps.closeLeg(state);                       // intermediate close: no history row, position object stays until replaced
  const solCap = old.capitalAsset === 'SOL', proceeds = Math.max(0, leg.usdcOut);
  state.position = null;
  let opened = null;
  const openArgs = { source: 'reposition', strategySettings: old.strategySettings, positionBudgetUsdc: proceeds, capitalAsset: solCap ? 'SOL' : 'USDC', ...(solCap ? { positionBudgetSol: Math.max(0, leg.solOut) } : {}) };
  const tries = [];
  try { opened = await deps.openNew(pool, openArgs); }
  catch (e) { log('reposition reopen error: ' + e.message); opened = { error: e.message }; }
  tries.push(state.position ? 'ok' : String(opened?.skipped || opened?.error || 'no position'));
  // The leg is already closed, so a live reopen cannot be rolled back like the dry run's.
  // Retry ONCE if the reopen failed for a retryable price-move / deposit error (6004, stale
  // blockhash, etc.). The active-bin range guard is gone (21 Nov 2026): a SOL-only deposit
  // is sent even when the price ran past the new range. Max 2 repositions then close.
  if (!state.position && RETRYABLE.test(String(opened?.skipped || opened?.error || ''))) {
    log(`reposition ${old.name}: reopen refused (${opened.skipped || opened.error}); retrying once at the current active bin`);
    try { opened = await deps.openNew(pool, openArgs); } catch (e) { log('reposition reopen retry error: ' + e.message); opened = { error: e.message }; }
    tries.push(state.position ? 'ok' : String(opened?.skipped || opened?.error || 'no position'));
  }
  // Telegram (Warlock 2.0 reposition card / reopen-failed alert): display only, never blocks or changes the reposition
  const event = { number, name: old.name, pool: old.pool, mintX: old.mintX, binStep: old.binStep, capitalAsset: solCap ? 'SOL' : 'USDC', solUsd: pxUsd, paper: false,
    pnlCapital: solCap ? leg.solOut - old.capitalInSol : null, pnlPct: solCap ? (old.capitalInSol ? 100 * (leg.solOut - old.capitalInSol) / old.capitalInSol : null) : (old.usdcIn ? 100 * (leg.usdcOut - old.usdcIn) / old.usdcIn : null),
    pnlUsd: leg.usdcOut - old.usdcIn, proceedsSol: solCap ? leg.solOut : null, proceedsUsdc: leg.usdcOut, reason: deps.reasonText || null, oldMinBinId: old.minBinId, oldMaxBinId: old.maxBinId,
    refPrice: old.entryPrice, refBin: old.entryActiveBin, openContext: old.openContext, openSource: old.openSource, strategySettings: old.strategySettings, tries, at: now() };
  const notify = (kind, extra) => { try { if (deps.notify) Promise.resolve(deps.notify(kind, { ...event, ...extra })).catch(() => {}); } catch { /* display only */ } };
  if (!state.position) {                                         // the leg is already closed on chain: it becomes an ordinary close, never a lost trade
    const row = { ...leg.row, reason: 'oor_right_reposition_failed_reopen' };
    state.history.push(row); log(`ERROR reposition ${old.name}: reopen failed after the leg closed (${opened?.skipped || opened?.error || 'no position'}); recorded as a normal close, the ${solCap ? 'SOL' : 'USDC'} stays in the wallet`);
    notify('reopen_failed', { error: tries[tries.length - 1], walletAsset: solCap ? 'SOL' : 'USDC' });
    return { done: true, reopened: false, row };
  }
  const set = carryFields(old, leg, state.position, number, pxUsd);
  log(`REPOSITION KANAN #${number} ${old.name}: range ${state.position.minBinId}..${state.position.maxBinId}; carryPnL=${set.realizedPnlCarryUsd.toFixed(4)} USDC`);
  const np = state.position;
  notify('reposition', { minBinId: np.minBinId, maxBinId: np.maxBinId, activeBin: np.entryActiveBin, refPrice: np.entryPrice || event.refPrice, refBin: np.entryActiveBin ?? event.refBin, nBins: np.nBins, shape: np.shape, bins: np.bins, binShape: np.binShape, depositSol: np.depositSol });
  return { done: true, reopened: true, number, set };
}
module.exports = { reposition, carryFields };
