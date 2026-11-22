'use strict';
const assert = require('assert');
const cap = require('./live-capital');
const closeExec = require('./live-close-exec');
const rep = require('./live-reposition-exec');
const liveExit = require('./live-exit');
const SOL = cap.SOL, USDC = cap.USDC;
(async () => {
  // free capital: wallet - reserve - piles
  assert.strictEqual(cap.freeCapitalSol({ walletSol: 10, reserveSol: .05, positions: [{ leftoverSol: .3 }, { leftoverSol: .2 }] }), 9.45);
  assert.strictEqual(cap.freeCapitalSol({ walletSol: .1, reserveSol: .05, positions: [{ leftoverSol: .3 }] }), 0);
  // allocation == dry run rule
  assert.strictEqual(cap.allocation({ free: 10, positionUsdc: 500, px: 100, slots: 5 }), 5);
  assert.strictEqual(cap.allocation({ free: 4, positionUsdc: 500, px: 100, slots: 5 }), 0);
  assert.strictEqual(cap.allocation({ free: 10, positionUsdc: 0, px: 100, slots: 5 }), 2);
  assert.strictEqual(cap.allocation({ free: 10, positionUsdc: 500, px: 0, slots: 5 }), 0);
  // USDC pools skipped only under SOL capital
  assert.ok(cap.skipPoolReason('SOL', { token_y: { address: USDC } }));
  assert.strictEqual(cap.skipPoolReason('SOL', { token_y: { address: SOL } }), null);
  assert.strictEqual(cap.skipPoolReason('USDC', { token_y: { address: USDC } }), null);
  // swapBackSol: token -> SOL only, nothing else touched
  const calls = [];
  const r = await closeExec.swapBackSol({
    pos: {}, getToken: async () => ({ raw: 1000n, decimals: 6, accounts: [] }), swapTokenToSol: async raw => { calls.push('tok' + raw); return { ok: true }; },
    closeTokenAccounts: async () => calls.push('close'), getSolBalance: async () => 5,
  });
  assert.deepStrictEqual(calls, ['tok1000', 'close']); assert.strictEqual(r.tokenSwapped, 1000); assert.strictEqual(r.complete, true);
  const none = await closeExec.swapBackSol({ pos: {}, getToken: async () => ({ raw: 0n, decimals: 6, accounts: [] }), swapTokenToSol: async () => { throw Error('no'); }, closeTokenAccounts: async () => {}, getSolBalance: async () => 5 });
  assert.strictEqual(none.complete, true);
  const fail = await closeExec.swapBackSol({ pos: {}, getToken: async () => ({ raw: 5n, decimals: 6, accounts: [] }), swapTokenToSol: async () => ({ ok: false, error: 'x' }), closeTokenAccounts: async () => {}, getSolBalance: async () => 5, retries: 2 });
  assert.strictEqual(fail.complete, false); assert.strictEqual(fail.errors.length, 2);
  // live exit valuation uses the SOL model for SOL positions (== paper-usdc.exitSolQuote)
  const pos = { capitalAsset: 'SOL', capitalInSol: 5, usdcIn: 500, initialUsdcIn: 500, quoteMint: SOL, mintX: 'MINT', decX: 6, leftoverSol: .3, rentRefundableSol: .06 };
  const quote = async (inM, outM, raw, di, dout) => ({ ok: true, inUi: Number(raw) / 10 ** di, outUi: inM === 'MINT' ? Number(raw) / 10 ** di * .001 : 0 });
  const val = await liveExit.liveVal({ pos, v: { x: 1000, y: 4.5, fx: 0, fy: .02, price: .001, activeBinId: 1 }, pxUsd: 100, quote, txFee: .000025 });
  assert.strictEqual(val.capitalAsset, 'SOL');
  const expect = (.3 + .06 - 3 * .000025) + 1000 * .001 + (4.5 + .02);
  assert.ok(Math.abs(val.solOut - expect) < 1e-9, 'solOut ' + val.solOut + ' vs ' + expect);
  assert.ok(Math.abs(val.pnlCapital - (expect - 5)) < 1e-9);
  // USDC position keeps the old model
  const upos = { capitalAsset: 'USDC', usdcIn: 500, initialUsdcIn: 500, quoteMint: SOL, mintX: 'MINT', decX: 6, leftoverSol: .3, rentRefundableSol: .06 };
  const uval = await liveExit.liveVal({ pos: upos, v: { x: 0, y: 4, fx: 0, fy: 0, price: .001, activeBinId: 1 }, pxUsd: 100, quote: async (a, b, raw) => ({ ok: true, outUi: Number(raw) / 1e9 * 100 }), txFee: .000025 });
  assert.notStrictEqual(uval.capitalAsset, 'SOL');
  // reposition in SOL mode: budget = this leg's SOL proceeds, carry in SOL
  const opened = []; const old = { name: 'X', pool: 'P', capitalAsset: 'SOL', capitalInSol: 5, usdcIn: 500, initialUsdcIn: 500, openedAt: 't0', strategySettings: { a: 1 } };
  const state = { position: old, history: [] };
  const out = await rep.reposition({ state, val: { solOut: 5.4, usdcOut: 540 }, settings: { MIN_LIQ_USD: 1 }, pxUsd: 100, deps: {
    fetchPool: async () => ({}), sanityReason: () => null,
    closeLeg: async () => ({ usdcOut: 540, solOut: 5.4, row: { feesSol: .01 } }),
    openNew: async (pool, o) => { opened.push(o); state.position = { openedAt: 't1', capitalInSol: o.positionBudgetSol }; return { opened: true }; } } });
  assert.ok(out.done && out.reopened); assert.strictEqual(opened[0].capitalAsset, 'SOL'); assert.ok(Math.abs(opened[0].positionBudgetSol - 5.4) < 1e-12);
  assert.ok(Math.abs(state.position.realizedPnlCarrySol - .4) < 1e-12); assert.strictEqual(state.position.initialCapitalInSol, 5);
  assert.ok(Math.abs(state.position.realizedPnlCarryUsd - 40) < 1e-9);
  // live balance check under SOL capital: fee reserve + one position in SOL, USDC not required
  const lc = require('./live-control');
  const ok = lc.evaluateBalances({ sol: 6, usdc: 0, capitalAsset: 'SOL', positionUsd: 500, solUsd: 100 });
  assert.ok(ok.ok, JSON.stringify(ok)); assert.ok(Math.abs(ok.minSol - 5.05) < 1e-9); assert.strictEqual(ok.minUsdc, 0);
  assert.ok(!lc.evaluateBalances({ sol: 5, usdc: 1000, capitalAsset: 'SOL', positionUsd: 500, solUsd: 100 }).ok);
  assert.ok(!lc.evaluateBalances({ sol: 50, usdc: 0, capitalAsset: 'SOL', positionUsd: 500, solUsd: 0 }).ok);   // no SOL price: fail closed
  assert.ok(!lc.evaluateBalances({ sol: 1, usdc: 5 }).ok);                                                      // USDC capital unchanged
  assert.ok(lc.evaluateBalances({ sol: 1, usdc: 50 }).ok);
  // dry run quote carries the live route fee (one constant). PATCH: the fork's constant is 0, so dry run is fee-free; the 50 bps model is still tested explicitly.
  assert.strictEqual(require('./swap-route-config').ROUTE_FEE_BPS, 0);
  const rf = require('./paper-route-fee'), sr = require('./swap-route-config');
  const q = { ok: true, inUi: 100, outUi: 1, outAmount: '1000000000', otherAmountThreshold: '990000000' };
  const a = rf.applyToQuote(q, USDC, SOL, 50); assert.strictEqual(rf.applyToQuote(q, USDC, SOL, sr.ROUTE_FEE_BPS), q);
  assert.ok(Math.abs(a.outUi - 0.995) < 1e-12); assert.strictEqual(a.outAmount, '995000000'); assert.strictEqual(a.otherAmountThreshold, '985050000'); assert.strictEqual(q.outUi, 1);   // input untouched (cache-safe)
  assert.strictEqual(rf.applyToQuote(q, 'AAA', 'BBB', 50).outUi, 1);                      // no SOL/USDC side: no fee account
  assert.strictEqual(rf.applyToQuote({ ok: false }, USDC, SOL, 50).ok, false);
  assert.strictEqual(rf.applyToQuote({ ok: true, skipped: 'zero', outUi: 0 }, USDC, SOL, 50).outUi, 0);
  // POSITION_SOL_OPEN: exact SOL per open (SOL capital), wins over the USD budget, needs it free or opens nothing
  assert.strictEqual(cap.allocation({ free: 10, positionUsdc: 500, positionSol: 3, px: 100, slots: 5 }), 3);
  assert.strictEqual(cap.allocation({ free: 2.9, positionUsdc: 500, positionSol: 3, px: 100, slots: 5 }), 0);
  assert.strictEqual(cap.allocation({ free: 10, positionUsdc: 500, positionSol: 0, px: 100, slots: 5 }), 5);   // 0 = USD budget as before
  // gas buffer recommendation (shown next to the setting): default MAX_NONREFUND_SOL .05 -> needed .128 -> 0.15; floor never below 0.05
  const pc = require('./paper-capital'), rec = pc.recommendGasBuffer({ maxNonrefundSol: 0.05 });
  assert.strictEqual(rec.recommended, 0.15); assert.ok(rec.needed > 0.12 && rec.needed < 0.13); assert.ok(Math.abs(rec.raw - (rec.parts.rentRefundable + rec.parts.rentNonRefundable + rec.parts.txFees)) < 1e-12);
  assert.strictEqual(pc.recommendGasBuffer({ maxNonrefundSol: 0 }).recommended, 0.1); assert.strictEqual(pc.recommendGasBuffer({ maxNonrefundSol: 0.143 }).recommended, 0.25);
  // the new setting is a validated, shared setting
  const ps = require('./paper-settings'); assert.ok(ps.ALLOWED_KEYS.includes('POSITION_SOL_OPEN')); assert.strictEqual(ps.DEFAULTS.POSITION_SOL_OPEN, 0);
  assert.ok(ps.validatePatch({ POSITION_SOL_OPEN: 6, GAS_BUFFER_SOL: 0.15, POSITION_USDC: 450, MAX_POSITIONS: 3 }, ps.cloneDefaults()).ok);
  assert.ok(!ps.validatePatch({ POSITION_SOL_OPEN: -1 }, ps.cloneDefaults()).ok);
  // per-open budget in SOL decides the minimum wallet SOL (POSITION_SOL_OPEN wins over the USD budget; no SOL price needed then)
  const so = lc.evaluateBalances({ sol: 1.1, usdc: 0, capitalAsset: 'SOL', positionUsd: 450, positionSol: 1, solUsd: 0 });
  assert.ok(so.ok, JSON.stringify(so)); assert.ok(Math.abs(so.minSol - 1.05) < 1e-9);
  assert.ok(!lc.evaluateBalances({ sol: 1.0, usdc: 0, capitalAsset: 'SOL', positionUsd: 450, positionSol: 1, solUsd: 73 }).ok);
  // a key in .env shows its PUBLIC address (never the key); an encrypted file takes over
  const ws = require('./wallet-store'), { Keypair } = require('@solana/web3.js'), bs58 = require('bs58').default || require('bs58');
  const kp = Keypair.generate(), dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wk-'));
  const keep = process.env.PRIVATE_KEY; process.env.PRIVATE_KEY = bs58.encode(kp.secretKey);
  try {
    const m = ws.readEnvelopeMeta(dir); assert.strictEqual(m.hasKey, true); assert.strictEqual(m.source, 'env'); assert.strictEqual(m.publicAddress, kp.publicKey.toBase58());
    assert.ok(!JSON.stringify(m).includes(process.env.PRIVATE_KEY));
  } finally { if (keep === undefined) delete process.env.PRIVATE_KEY; else process.env.PRIVATE_KEY = keep; }
  console.log('test-live-sol-capital: OK');
})().catch(e => { console.error(e); process.exit(1); });
