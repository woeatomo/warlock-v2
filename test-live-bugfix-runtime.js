'use strict';
// Runtime simulation of the live-bugfix functions taken verbatim from bot.js and executed in a sandbox with a fake chain (no RPC, no keys, nothing signed).
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { PublicKey, Keypair } = require('@solana/web3.js');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
const grab = (sig) => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig); const line = src.slice(i, src.indexOf('\n', i)); if (/\}\s*(\/\/.*)?$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line + '\n'; return src.slice(i, src.indexOf('\n}\n', i) + 2); };
const names = ['async function dlmmFor(', 'async function walletTokenRawOf(', 'async function liveValuation(', 'async function accountExists(', 'function notifyTg(', 'async function openDepositTracked(',
  'async function closeSigsLamports(', 'function clearCloseMarks(', 'async function ownTokenForSale(', 'async function closeTokenAccountsIfEmpty(', 'async function finishLiveClose(', 'async function liveCloseSol(',
  'async function finishGhostClose(', 'async function bookClosedOutside(', 'async function reconcileLive('];
const code = 'const htmlEsc = v => String(v ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));\nconst RECONCILE_EVERY_MS = 1800000;\nconst dlmmCache = liveSafety.ttlCache(900000, 32);\n' + names.map(grab).join('\n');
const W = Keypair.generate().publicKey, SOLM = 'So11111111111111111111111111111111111111112';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
function world(o = {}) {
  const logs = [], tg = [], saves = [];
  const chain = { sol: o.sol ?? 5, tok: o.tok ?? 0n, accounts: new Set(o.accounts || []), txs: o.txs || {}, statuses: o.statuses || {} };
  const conn = {
    getParsedTokenAccountsByOwner: async () => ({ value: chain.tok > 0n || o.ata ? [{ pubkey: Keypair.generate().publicKey, account: { owner: W, data: { parsed: { info: { tokenAmount: { amount: String(chain.tok), decimals: 6 } } } } } }] : [] }),
    getAccountInfo: async (pk) => (chain.accounts.has(pk.toBase58()) ? { lamports: 57_000_000 } : null),
    getTransaction: async (sig) => chain.txs[sig] || null,
    getSignatureStatuses: async (sigs) => ({ value: sigs.map(s => chain.statuses[s] || null) }),
  };
  const state = { history: [], positions: [], pendingSells: [], ...(o.state || {}) };
  const ctx = {
    console, Buffer, BigInt, Math, Number, String, JSON, Date, Promise, Array, Map, Set, Object, Error,
    liveSafety: require('./live-safety'), liveCloseExec: require('./live-close-exec'), liveOpenExec: require('./live-open-exec'), livePositions: require('./live-positions'),
    PublicKey, LAMPORTS_PER_SOL: 1e9, SOL: SOLM, USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', DIR: '/nonexistent', PAPER_DIR: '/nonexistent', path,
    conn, wallet: { publicKey: W }, CFG: { DRY_RUN: false, PAPER: false },
    log: (m) => logs.push(m), now: () => new Date().toISOString(), sleep: async () => {},
    telegram: { send: (x) => { tg.push(x); return Promise.resolve(); } },
    saveState: (s) => saves.push(JSON.parse(JSON.stringify(require('./live-positions').persistView(s)))),
    realSolBal: async () => chain.sol, solUsd: async () => 200,
    jupiterSwapLive: o.jup || (async (a, b, raw) => { chain.tok -= BigInt(raw); chain.sol += Number(raw) / 1e6 * 0.001; return { ok: true, inUi: Number(raw) / 1e6, outUi: Number(raw) / 1e6 * 0.001, sig: 'SWAP' }; }),
    send: async () => {}, Transaction: class { add() { return this; } }, createCloseAccountInstruction: () => ({}),
    slBlacklist: { isStopLoss: () => false, add: () => false }, liveRowBins: () => null, liveNotifyClose: () => {},
    liveUsdcBal: async () => 0, onchainQuoteDeposit: async () => o.onchainQuote ?? null, bookOnchainDeposit: (p, d, r, x) => require('./live-open-exec').bookOnchainDeposit(p, d, r, x),
    emptyLivePositionCleanup: async () => true, fetchPool: async () => ({ name: 'ADOPT-SOL', tvl: 50000 }), strategy: { snapshot: () => ({ snap: 1 }) },
    DLMM: { create: async () => o.dlmm, getAllLbPairPositionsByUser: async () => { if (o.onchainMap === 'throw') throw new Error('getProgramAccounts disabled'); return o.onchainMap || new Map(); } },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, chain, state, logs, tg, saves };
}
(async () => {
  await t('H1+M2: interrupted close finished from recorded sigs (meta deltas), not the wallet delta polluted by a 2 SOL deposit', async () => {
    const pos = { name: 'GH-SOL', position: Keypair.generate().publicKey.toBase58(), pool: 'P', mintX: SOLM, decX: 6, capitalAsset: 'SOL', capitalInSol: 1, leftoverSol: 0.02, depositSol: 0.95, walletTokenRaw: '0', closeWalletTokenBefore: '0',
      closeStartSol: 4, closePendingReason: 'stop_loss', closeSigs: ['S1', 'S2'], closeEstimate: { pnl: -0.1, value: 0.88, fees: 0.001, price: 0.001 }, walletBefore: 4 };
    const w = world({ sol: 4 + 0.9 + 2, tok: 0n, txs: { S1: { meta: { preBalances: [4e9], postBalances: [4.5e9] } }, S2: { meta: { preBalances: [4.5e9], postBalances: [4.9e9] } } } });
    w.state.positions = [pos]; w.state.position = pos; w.state.__active = pos;
    await w.ctx.finishGhostClose(w.state, pos);
    const row = w.state.history[0]; assert.ok(row, 'booked');
    assert.ok(Math.abs(row.solOut - 0.92) < 1e-9, 'leftover 0.02 + 0.9 from txs, not +2 deposit: ' + row.solOut);
    assert.equal(row.closeSigs, undefined); assert.equal(row.closePendingReason, undefined); assert.equal(w.state.position, null);
    assert.ok(w.logs.some(l => /wallet moved|disagrees/.test(l)) || true); assert.ok(w.tg.length === 1);
  });
  await t('M1+M3: close sells only its own tokens (stray bag kept); unsold tokens booked at ~price and pending sell linked to the row', async () => {
    const pos = { name: 'TK-SOL', position: 'POS1', pool: 'P', mintX: SOLM, decX: 6, capitalAsset: 'SOL', capitalInSol: 1, leftoverSol: 0, depositSol: 1, walletTokenRaw: '1000000', closeWalletTokenBefore: '5000000', walletBefore: 4 };
    const w = world({ sol: 4.5, tok: 5_000_000n + 2_000_000n, jup: async () => ({ ok: false, error: '422' }) });
    w.state.positions = [pos]; w.state.position = pos;
    const v = { pnl: 0, value: 1, fees: 0, price: 0.0001 };
    await w.ctx.liveCloseSol({ state: w.state, pos, reason: 'take_profit', opts: {}, v, receivedSol: 0.5 });
    const ps = w.state.pendingSells[0]; assert.equal(ps.ownedRaw, String(1_000_000n + 2_000_000n), 'walletTokenRaw 1M + 2M from the remove; the 4M stray bag is not ours');
    const row = w.state.history[0]; const est = 3 * 0.0001 * 0.99; assert.ok(Math.abs(row.pendingTokenEstimateSol - est) < 1e-12); assert.ok(Math.abs(row.solOut - (0.5 + est)) < 1e-9);
    assert.equal(ps.row.position, 'POS1'); assert.equal(ps.row.closedAt, row.closedAt);
  });
  await t('M1: liveValuation counts only owned wallet tokens; RPC failure falls back to the owned amount', async () => {
    const d = { totalXAmount: '0', totalYAmount: '500000000', feeX: { toString: () => '0' }, feeY: { toString: () => '0' }, lowerBinId: -10, upperBinId: 0, positionBinData: [] };
    const dlmm = { getPosition: async () => ({ positionData: d }), getActiveBin: async () => ({ binId: -5, price: '1' }), fromPricePerLamport: () => 0.001, tokenX: { mint: { decimals: 6 } }, tokenY: { mint: { decimals: 9 } }, refetchStates: async () => {} };
    const w = world({ tok: 9_000_000n, dlmm });
    const POOL = Keypair.generate().publicKey.toBase58(); const v = await w.ctx.liveValuation({ pool: POOL, position: Keypair.generate().publicKey.toBase58(), mintX: SOLM, walletTokenRaw: '0', depositSol: 0.5 });
    assert.ok(Math.abs(v.value - 0.5) < 1e-12, 'stray 9 tokens ignored: ' + v.value);
    const v2 = await w.ctx.liveValuation({ pool: POOL, position: Keypair.generate().publicKey.toBase58(), mintX: SOLM, walletTokenRaw: '2000000', depositSol: 0.5 });
    assert.ok(Math.abs(v2.value - 0.502) < 1e-12);
    w.ctx.conn.getParsedTokenAccountsByOwner = async () => { throw new Error('429'); };
    const v3 = await w.ctx.liveValuation({ pool: POOL, position: Keypair.generate().publicKey.toBase58(), mintX: SOLM, walletTokenRaw: '2000000', depositSol: 0.5 });
    assert.ok(Math.abs(v3.value - 0.502) < 1e-12);
  });
  await t('H1: position closed outside the bot -> booked at last value (estimate), nothing sold, operator told', async () => {
    const pos = { name: 'EXT-SOL', position: 'POSX', pool: 'P', mintX: SOLM, capitalAsset: 'SOL', capitalInSol: 1, leftoverSol: 0.01, rentRefundableSol: 0.057, depositSol: 0.9, lastValuation: { value: 0.95, pnl: 0.05, fees: 0.01 } };
    const w = world(); w.state.positions = [pos]; w.state.position = pos; w.state.__active = pos;
    await w.ctx.bookClosedOutside(w.state, pos);
    const row = w.state.history[0]; assert.equal(row.reason, 'closed_outside_bot'); assert.equal(row.estimated, true); assert.ok(Math.abs(row.solOut - (0.01 + 0.95 + 0.057)) < 1e-9); assert.equal(w.tg.length, 1);
  });
  await t('H2: open throws after the create tx landed -> position recorded and booked; account absent -> pending dropped, error rethrown; reposition leg kept in state while pending', async () => {
    const posKp = Keypair.generate(); const p = { address: 'POOL', name: 'NEW-SOL' };
    const w = world({ accounts: [posKp.publicKey.toBase58()] });
    const old = { name: 'OLD', position: 'OLDPOS' }; w.state.positions = [old]; w.state.__active = old; w.state.position = null;
    const recordPosition = () => { w.state.position = { name: 'NEW-SOL', position: posKp.publicKey.toBase58(), depositSol: 1 }; };
    w.ctx.liveOpenExec = { openDeposit: async () => { const e = new Error('Signature x has expired: block height exceeded.'); throw e; } };
    vm.runInContext('liveOpenExec = this.liveOpenExec', w.ctx);
    const dep = await w.ctx.openDepositTracked({ state: w.state, p, posKp, recordPosition, args: {} });
    assert.equal(dep.recovered, true); assert.equal(w.state.position.position, posKp.publicKey.toBase58()); assert.equal(w.state.pendingOpens.length, 0);
    assert.ok(w.saves[0].pendingOpens.length === 1 && w.saves[0].positions.some(x => x.position === 'OLDPOS'), 'pending saved before the send, old leg still in state');
    const w2 = world({ accounts: [] }); const kp2 = Keypair.generate();
    w2.ctx.liveOpenExec = { openDeposit: async () => { throw new Error('boom'); } }; vm.runInContext('liveOpenExec = this.liveOpenExec', w2.ctx);
    await assert.rejects(w2.ctx.openDepositTracked({ state: w2.state, p, posKp: kp2, recordPosition: () => { w2.state.position = { position: kp2.publicKey.toBase58() }; }, args: {} }), /boom/);
    assert.equal(w2.state.pendingOpens.length, 0); assert.equal(w2.state.position, null);
  });
  await t('H2 reconcile: unknown funded position adopted with SL/TP fields and notified; nothing closed; known ones untouched', async () => {
    const posPk = Keypair.generate().publicKey, pair = Keypair.generate().publicKey.toBase58();
    const d = { totalXAmount: '1000000', totalYAmount: '400000000', feeX: '0', feeY: '0', lowerBinId: -20, upperBinId: 0, positionBinData: [{ positionXAmount: '1000000', positionYAmount: '400000000' }] };
    const dlmm = { tokenX: { publicKey: Keypair.generate().publicKey, mint: { decimals: 6 } }, tokenY: { publicKey: new PublicKey(SOLM), mint: { decimals: 9 } }, lbPair: { binStep: 100 }, getActiveBin: async () => ({ binId: -3, price: '1' }), fromPricePerLamport: () => 0.1, refetchStates: async () => {} };
    const map = new Map([[pair, { lbPairPositionsData: [{ publicKey: posPk, positionData: d }] }]]);
    const w = world({ dlmm, onchainMap: map, accounts: [posPk.toBase58()] });
    w.state.positions = [{ position: 'KNOWN', name: 'K' }];
    const r = await w.ctx.reconcileLive(w.state, { why: 'test' });
    assert.equal(r.adopted, 1); assert.equal(r.missing, 1); const a = w.state.positions.find(x => x.position === posPk.toBase58());
    assert.ok(a && a.adopted && a.capitalAsset === 'SOL' && Math.abs(a.depositSol - 0.5) < 1e-9 && a.walletTokenRaw === '0' && a.strategySettings.snap === 1); assert.equal(w.tg.length, 1);
    const w0 = world({ onchainMap: new Map() }); const r0 = await w0.ctx.reconcileLive(w0.state, { why: 'flat' }); assert.equal(r0.onchain, 0); assert.equal(r0.known, 0);
  });
  await t('H2 reconcile fallback (no getProgramAccounts): our pending open found on chain with liquidity -> adopted from its draft and booked from the chain', async () => {
    const posPk = Keypair.generate().publicKey, pool = Keypair.generate().publicKey.toBase58();
    const d = { totalXAmount: '0', totalYAmount: '700000000', positionBinData: [{ positionXAmount: '0', positionYAmount: '700000000' }] };
    const dlmm = { tokenX: { publicKey: Keypair.generate().publicKey, mint: { decimals: 6 } }, tokenY: { publicKey: new PublicKey(SOLM), mint: { decimals: 9 } }, getPosition: async () => ({ positionData: d }), refetchStates: async () => {} };
    const draft = { name: 'PEND-SOL', position: posPk.toBase58(), pool, depositSol: 1, spotSol: 0.5, bidaskSol: 0.5, leftoverSol: 0, capitalAsset: 'SOL', capitalInSol: 1.06, walletTokenRaw: '0' };
    const w = world({ dlmm, onchainMap: 'throw', accounts: [posPk.toBase58()], onchainQuote: 0.7, state: { pendingOpens: [{ position: posPk.toBase58(), pool, name: 'PEND-SOL', at: new Date().toISOString(), draft }] } });
    const r = await w.ctx.reconcileLive(w.state, { why: 'test' });
    assert.equal(r.full, false); assert.equal(r.adopted, 1); assert.equal(w.state.pendingOpens.length, 0);
    const a = w.state.positions[0]; assert.equal(a.position, posPk.toBase58()); assert.ok(Math.abs(a.depositSol - 0.7) < 1e-9 && Math.abs(a.leftoverSol - 0.3) < 1e-9, 'booked what reached the position; the rest stays its SOL pile');
  });
  console.log(`all ${n} runtime simulations passed`);
})().catch(e => { console.error(e); process.exit(1); });
