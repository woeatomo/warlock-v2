'use strict';
// t221u: close swap-back in LIVE for both quotes, with fake Jupiter/DLMM (nothing is signed or sent).
// SOL capital + SOL pool: only the token -> SOL, native SOL (gas buffer) untouched. USDC capital (SOL or USDC pool): token -> USDC + the position's SOL pile -> USDC.
// SOL capital never opens a USDC-quoted pool. Unsold tokens: retried with 3% -> 8% max slippage + 1 min -> 1 h backoff, booked at price - 1% until sold,
// retried into the position's capital asset (USDC capital -> USDC). Jupiter route (referral) fee kept on every swap.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { swapBack, swapBackSol } = require('./live-close-exec'), liveSafety = require('./live-safety'), liveCapital = require('./live-capital'), swapRoute = require('./swap-route-config');
const SOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
(async () => {
  await t('SOL pool + CAPITAL_ASSET SOL: token -> SOL, token account closed, NO SOL swap (gas buffer stays)', async () => {
    let sol = 6.0; const calls = [];
    const r = await swapBackSol({ pos: { mintX: 'TOK' }, getToken: async () => ({ raw: 1_000_000n, decimals: 6 }), getSolBalance: async () => sol,
      swapTokenToSol: async (raw, dec) => { calls.push(['tok->sol', raw, dec]); sol += 0.25; return { ok: true }; }, closeTokenAccounts: async () => calls.push(['close']) });
    assert.deepEqual(calls.map(c => c[0]), ['tok->sol', 'close']); assert.ok(r.complete); assert.ok(Math.abs(r.solAfter - r.solBefore - 0.25) < 1e-12);
    assert.ok(!/swapSolTo/.test(swapBackSol.toString()), 'SOL capital has no SOL->USDC leg');
  });
  await t('SOL capital: swap keeps failing -> 3 tries, incomplete (bot books the estimate and queues a pending sell)', async () => {
    let tries = 0; const r = await swapBackSol({ pos: {}, getToken: async () => ({ raw: 5n, decimals: 6 }), getSolBalance: async () => 1, swapTokenToSol: async () => { tries++; throw new Error('429'); }, closeTokenAccounts: async () => {} });
    assert.equal(tries, 3); assert.ok(!r.complete);
  });
  await t('USDC capital (SOL or USDC pool): token -> USDC, then only this position pile of SOL -> USDC; wallet SOL from before is kept', async () => {
    let sol = 6.3, usdc = 0; const calls = [];
    const r = await swapBack({ pos: { walletBefore: 6.0 }, pileSol: 0.3, getToken: async () => ({ raw: 2_000_000n, decimals: 6 }), getSolBalance: async () => sol, getUsdcBalance: async () => usdc,
      swapTokenToUsdc: async () => { calls.push('tok->usdc'); usdc += 40; return { ok: true }; }, swapSolToUsdc: async (lam) => { calls.push('sol->usdc ' + lam); sol -= Number(lam) / 1e9; usdc += 21.6; return { ok: true }; }, closeTokenAccounts: async () => calls.push('close') });
    assert.deepEqual(calls, ['tok->usdc', 'close', 'sol->usdc 300000000']); assert.ok(r.complete); assert.ok(Math.abs(r.usdcOut - 61.6) < 1e-9); assert.ok(sol >= 6.0 - 1e-9);
  });
  await t('CAPITAL_ASSET SOL never opens a USDC-quoted pool (so there is no USDC to convert back); USDC capital opens both', () => {
    assert.match(liveCapital.skipPoolReason('SOL', { token_y: { address: USDC } }), /USDC dilewati/); assert.equal(liveCapital.skipPoolReason('SOL', { token_y: { address: SOL } }), null); assert.equal(liveCapital.skipPoolReason('USDC', { token_y: { address: USDC } }), null);
    const lo = src.slice(src.indexOf('async function liveOpen('), src.indexOf('async function liveOpenUsdcPool'));
    assert.ok(lo.indexOf('liveCapital.skipPoolReason') < lo.indexOf('liveOpenUsdcPool('), 'the SOL-capital skip runs before the USDC-pool branch');
  });
  await t('close routing: capitalAsset SOL -> liveCloseSol (token->SOL); otherwise swapBack (token->USDC + pile->USDC)', () => {
    const f = src.slice(src.indexOf('async function finishLiveClose'), src.indexOf('async function liveCloseSol'));
    assert.ok(/if \(pos\.capitalAsset === 'SOL'\) return liveCloseSol/.test(f)); assert.ok(/jupiterSwapLive\(pos\.mintX, USDC,/.test(f) && /jupiterSwapLive\(SOL, USDC,/.test(f));
    assert.ok(/jupiterSwapLive\(pos\.mintX, SOL, raw, dec, 9, 'token-to-sol-close'\)/.test(src));
  });
  await t('pending sells: slippage 3% -> +1.5%/try capped at 8%, backoff 1 min doubling to 1 h; USDC capital retried to USDC (staged fix)', () => {
    const plans = [0, 1, 2, 3, 4, 9].map(tries => liveSafety.pendingSellPlan({ tries }, 0));
    assert.deepEqual(plans.map(p => p.slippageBps), [300, 450, 600, 750, 800, 800]); assert.deepEqual(plans.map(p => p.delay / 60000), [1, 2, 4, 8, 16, 60]);
    const loop = src.slice(src.indexOf('if (state.pendingSells && state.pendingSells.length)'), src.indexOf('// Supervised live test'));
    assert.ok(/const toUsdc = ps\.to === 'USDC'/.test(loop) && /jupiterSwapLive\(ps\.mint, toUsdc \? USDC : SOL, raw, ps\.dec, toUsdc \? 6 : 9/.test(loop));
    assert.ok(/to: 'USDC'/.test(src.slice(src.indexOf('async function finishLiveClose'), src.indexOf('async function liveCloseSol'))));
  });
  await t('unsold-token booking: SOL capital at price - 1% (corrected on sale); USDC capital now the same in USDC', () => {
    assert.ok(/pendingTokenEstimateSol = Number\(ownedRaw\) \/ 10 \*\* dec \* v\.price \* 0\.99/.test(src));
    const row = { usdcIn: 100, usdcOut: 60 + 39.6, legUsdcOut: 99.6, pnlUsd: -0.4, netPnlUsd: -0.4, pendingTokenEstimateUsdc: 39.6 };
    const d = liveSafety.adjustRowForSaleUsdc(row, 41); assert.ok(Math.abs(d - 1.4) < 1e-9 && Math.abs(row.pnlUsd - 1.0) < 1e-9 && Math.abs(row.pnlPct - 1.0) < 1e-9 && row.swapBackComplete && row.pendingTokenEstimateUsdc === 0);
    const r2 = { usdcIn: 100, usdcOut: 99.6, pnlUsd: -0.4, pendingTokenEstimateUsdc: 39.6 }; liveSafety.adjustRowForSaleUsdc(r2, 0); assert.ok(Math.abs(r2.pnlUsd + 40) < 1e-9, 'nothing sold -> estimate removed');
    const sr = { solOut: 0.9, pnlCapital: -0.1, realizedSol: -0.1, initialCapitalInSol: 1, pendingTokenEstimateSol: 0.2, pnlUsd: -7, netPnlUsd: -7, usdcOut: 65, legUsdcOut: 65 };
    liveSafety.adjustRowForSale(sr, 0.25, 72); assert.ok(Math.abs(sr.pnlCapital + 0.05) < 1e-9 && Math.abs(sr.pnlUsd + 3.4) < 1e-9);
  });
  await t('route (referral) fee kept: quote asks platformFeeBps + V2 when the fee account exists, the swap body sends feeAccount; amounts as strings', async () => {
    const { PublicKey } = require('@solana/web3.js'); const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
    const rows = swapRoute.feeCandidates('TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'.slice(0, 0) || 'So11111111111111111111111111111111111111112', USDC);
    const data = Buffer.alloc(165); new PublicKey(USDC).toBuffer().copy(data, 0); data[108] = 1;
    const connection = { getMultipleAccountsInfo: async (keys) => keys.map((k, i) => (i === 0 ? { owner: TOKEN_PROGRAM_ID, data } : null)) };
    let qurl = ''; const q = await swapRoute.swapQuote({ connection, getJSON: async (u) => { qurl = u; return { inAmount: '1', outAmount: '2' }; }, inputMint: SOL, outputMint: USDC, amount: 1000n });
    assert.ok(/platformFeeBps=50/.test(qurl) && /instructionVersion=V2/.test(qurl)); assert.equal(swapRoute.swapBodyParams(q).feeAccount, rows[0].address.toBase58());
    const sw = src.slice(src.indexOf('async function jupiterSwapLive'), src.indexOf('async function finishGhostClose'));
    assert.ok(/\.\.\.swapRoute\.swapBodyParams\(q\)/.test(sw) && /inAmount: String\(q\.inAmount\), outAmount: String\(q\.outAmount\)/.test(sw));
  });
  console.log('all', n, 'swap-back case tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
