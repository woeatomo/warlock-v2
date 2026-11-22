'use strict';
// Dry run == live: a live Jupiter swap carries the route (referral) fee, and its quote's outAmount is already net of it
// (checked on the real quote API: outAmount ratio 0.9950 at 50 bps). The paper quote has no fee, so it is applied here from the SAME constant live uses
// (swap-route-config.ROUTE_FEE_BPS). Pure: no IO. The fee only exists when SOL or USDC is one side (the account holds those mints), which is every swap the bot makes.
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function applyToQuote(q, inputMint, outputMint, bps) {
  if (!q || !q.ok || q.skipped || !(bps > 0)) return q;
  const has = m => m === SOL || m === USDC;
  if (!has(inputMint) && !has(outputMint)) return q;
  const f = 1 - bps / 1e4, out = { ...q };
  if (Number.isFinite(q.outUi)) out.outUi = q.outUi * f;
  for (const k of ['outAmount', 'otherAmountThreshold']) if (q[k] != null && Number.isFinite(+q[k])) out[k] = String(Math.floor(+q[k] * f));
  out.platformFee = { feeBps: bps, modeled: true };
  return out;
}
module.exports = { applyToQuote };
