'use strict';
// SOL capital for live == dry run (one source: paperOpenAll and liveOpen both call these). Pure: no IO, no chain.
// Free SOL capital in the live wallet = wallet SOL - fixed fee reserve - every open position's own native pile (leftoverSol: gas buffer + excess above the TVL cap).
// The position deposits are already out of the wallet (in the LP), so they are never subtracted again.
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const isSol = asset => asset === 'SOL';
function freeCapitalSol({ walletSol, reserveSol = 0, positions = [] }) {
  const piles = positions.reduce((t, p) => t + Math.max(0, +p.leftoverSol || 0), 0);
  return Math.max(0, (+walletSol || 0) - (+reserveSol || 0) - piles);
}
// Same rule as the dry run: a fixed POSITION_USDC budget needs POSITION_USDC/px SOL free; without it, the free SOL is split over the free slots.
// POSITION_SOL_OPEN > 0 (SOL capital only) is an exact SOL budget per open and wins over the USD budget; same "needs it free or open nothing" rule.
function allocation({ free, positionUsdc, positionSol = 0, px, slots }) {
  if (!(px > 0) || !(slots > 0)) return 0;
  if (positionSol > 0) return free + 1e-12 >= positionSol ? positionSol : 0;
  return positionUsdc > 0 ? (free + 1e-12 >= positionUsdc / px ? positionUsdc / px : 0) : free / slots;
}
// USDC-quoted pools need a SOL->USDC conversion (extra swap fee + slippage), so they are skipped while capital is SOL (live and dry run alike).
function skipPoolReason(capitalAsset, pool) {
  return isSol(capitalAsset) && pool?.token_y?.address === USDC ? 'pool quote USDC dilewati saat modal SOL' : null;
}
module.exports = { SOL, USDC, freeCapitalSol, allocation, skipPoolReason };
