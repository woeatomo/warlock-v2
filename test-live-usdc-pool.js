'use strict';
// USDC-quoted pools in live == paperOpenUsdc: same planner, quote decimals 6, same exit valuation. Offline; nothing is signed.
const assert = require('assert'), fs = require('fs'), path = require('path'); const paperUsdc = require('./paper-usdc'); const liveExit = require('./live-exit'); const R = require('./live-reshape-exec');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
(async () => {
  await t('screening accepts USDC-quoted pools for live too; liveOpen routes them to the USDC planner', () => { assert.ok(!/policy\.PAPER\?\[USDC\]/.test(src)); assert.ok(/\[SOL,USDC\]\.includes\(p\.token_y/.test(src)); const lo = src.indexOf('async function liveOpen('); const body = src.slice(lo, src.indexOf('async function liveOpenUsdcPool', lo)); assert.ok(/p\.token_y\?\.address === USDC\) return liveOpenUsdcPool/.test(body)); const u = src.slice(src.indexOf('async function liveOpenUsdcPool'), src.indexOf('async function liveValuation')); assert.ok(/paperUsdc\.planUsdcOpen\(/.test(u) && /lamports: 1e6/.test(u) && /quoteMint: USDC/.test(u) && /quoteDecimals: 6/.test(u)); });
  await t('valuation uses the pool quote decimals (not a fixed 1e9)', () => { const v = src.slice(src.indexOf('async function liveValuation'), src.indexOf('async function liveSwapAllToSol')); assert.ok(/dY = 10 \*\* dlmm\.tokenY\.mint\.decimals/.test(v)); assert.ok(!/dY = 1e9/.test(v)); });
  await t('planner: deposit sized by the shared rules (cash - buffer - gas swap, TVL cap), real quote injected', async () => {
    const quote = async (a, b, raw) => ({ ok: true, inUi: Number(raw) / 1e6, outUi: Number(raw) / 1e6 / 150 });
    const pl = await paperUsdc.planUsdcOpen({ cash: 500, existingSol: 0, capUsd: 100000, gasBuffer: 0.3, rentRef: 0.0034, rentNon: 0.05, openFees: 0.00005, solUsd: 150, usdcBuffer: 0.1, quote });
    assert.ok(pl.ok && pl.depositQuote > 400 && pl.depositQuote < 500 && pl.boughtSol >= 0.3 && Math.abs(pl.usdcSpent - (pl.depositQuote + pl.gasUsdc)) < 1e-9);
  });
  await t('exit valuation of a live USDC-pool position == paperUsdc.exitQuote (quote side is USDC, not swapped; pile = SOL only)', async () => {
    const pos = { quoteMint: paperUsdc.USDC, quoteSymbol: 'USDC', capitalAsset: 'USDC', usdcIn: 500, initialUsdcIn: 500, leftoverSol: 0.2, rentRefundableSol: 0.0054, decX: 6, mintX: 'MINTX', baseFeePct: 0.3 };
    const v = { x: 1000, y: 100, fx: 0, fy: 1, price: 0.5, activeBinId: 10 };
    const quote = async (a, b, raw, di, do_) => ({ ok: true, outUi: a === 'MINTX' ? Number(raw) / 10 ** di * 0.5 : Number(raw) / 1e9 * 150 });
    const val = await liveExit.liveVal({ pos, v, pxUsd: 150, quote, txFee: 0.000025 });
    const expectedStable = 101, expectedToken = 500, expectedSol = (0.2 + 0.0054 - 3 * 0.000025) * 150;
    assert.ok(Math.abs(val.usdcOut - (expectedStable + expectedToken + expectedSol)) < 1e-6, val.usdcOut + ' vs ' + (expectedStable + expectedToken + expectedSol));
  });
  await t('reshape/compound use 6-decimal quote fees on a USDC pool', async () => {
    const BN = class { constructor(v) { this.v = BigInt(Math.floor(Number(v))); } }; const calls = []; let tok = 0n;
    const dlmm = { claimSwapFee: async () => [{}], removeLiquidity: async () => (tok += 1000000n, [{}]), addLiquidityByStrategyChunkable: async p => (calls.push([p.strategy.strategyType, p.totalYAmount.v]), [{}]) };
    const pos = { decX: 6, position: 'P', origMaxBinId: -251, minBinId: -286, walletBefore: 0.05, quoteDecimals: 6 };
    const d = { feeX: { toString: () => '0' }, feeY: { toString: () => '2000000' }, positionBinData: [{ binId: -256, positionXAmount: '500000' }] };
    const r = await R.reshape({ pos, positionKey: 'K', lbPosition: { positionData: d }, slippage: 1, dlmm, positionData: d, activeBinId: -258, settings: { COMPOUND_ENABLED: true, COMPOUND_SPOT_PCT: 50 }, txFee: 0.000025, StrategyType: { Spot: 'Spot', BidAsk: 'BidAsk' }, BN, wallet: { publicKey: 'W' }, send: async () => {}, getTokenRaw: async () => tok, getSolBalance: async () => 0.2, sleep: async () => {}, log: () => {} });
    assert.ok(Math.abs(r.compounded - 2) < 1e-9); const y = calls.filter(c => c[1] > 0n && c[0] !== undefined).map(c => c[1]); assert.ok(y.includes(1000000n));
  });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
