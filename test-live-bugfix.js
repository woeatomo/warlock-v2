'use strict';
// live-bugfix (20 Nov 2026): one test per fixed audit finding (H1-H4, M1-M3, M5-M8, affordability). Fakes only: nothing signed, no RPC, no live files.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const S = require('./live-safety'), O = require('./live-open-exec'), R = require('./live-reshape-exec'), SR = require('./swap-route-config');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const BN = class { constructor(v) { this.v = typeof v === 'string' ? BigInt(v) : BigInt(Math.floor(Number(v))); } };
const ST = { Spot: 'Spot', BidAsk: 'BidAsk' };
const fnBody = (name) => { const i = src.indexOf(name); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n}\n', i)); };
(async () => {
  // ---------- H3 ----------
  await t('H3 atomic state write: tmp + rename, previous good file kept as .bak, never a half-written state.json', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lbf-')), f = path.join(d, 'state.json');
    S.atomicWriteJson(f, { a: 1 }); assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 1 });
    S.atomicWriteJson(f, { a: 2 }); assert.deepEqual(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')), { a: 1 }); assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 2 });
    assert.equal(fs.readdirSync(d).filter(x => x.endsWith('.tmp')).length, 0);
    fs.rmSync(d, { recursive: true });
  });
  await t('H3 strict load: missing -> new; corrupt -> .bak (flagged); corrupt and no .bak -> refuses (never an empty state that forgets positions)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lbf-')), f = path.join(d, 'state.json'), fresh = () => ({ positions: [] });
    assert.equal(S.readStateStrict(f, fresh).source, 'new');
    fs.writeFileSync(f, '{"positions":[{"position":"P1"}]}'); S.atomicWriteJson(f, { positions: [{ position: 'P1' }], n: 2 });
    fs.writeFileSync(f, '{"positions":[{"posi');   // torn write
    const r = S.readStateStrict(f, fresh); assert.equal(r.source, 'bak'); assert.equal(r.state.positions[0].position, 'P1'); assert.ok(r.error);
    fs.unlinkSync(f + '.bak'); assert.throws(() => S.readStateStrict(f, fresh), e => e.code === 'STATE_UNREADABLE');
    fs.rmSync(d, { recursive: true });
  });
  await t('H3 wiring: live saveState uses atomicWriteJson; live start uses readStateStrict and exits instead of starting empty', () => {
    assert.ok(/else liveSafety\.atomicWriteJson\(file, s\)/.test(fnBody('function saveState')));
    assert.ok(/liveSafety\.readStateStrict\(path\.join\(DIR, 'state\.json'\)/.test(src)); assert.ok(/STATE_UNREADABLE|process\.exit\(1\)/.test(src.slice(src.indexOf('H3 (live-bugfix): an unreadable'))));
  });
  // ---------- H1 ----------
  await t('H1 ghost position: account gone + closePending -> booking finished from recorded close txs; gone without close -> 3 polls then booked as closed outside the bot', () => {
    const c = fnBody('async function livePositionCycle');
    assert.ok(/catch \(e\) \{[\s\S]*accountExists\(new PublicKey\(pos\.position\)\)[\s\S]*if \(ex !== false\) throw e;/.test(c), 'only a definitive "account does not exist" is acted on');
    assert.ok(/closePendingReason\) \{[^\n]*finishGhostClose/.test(c)); assert.ok(/missingPolls < 3/.test(c) && /bookClosedOutside/.test(c));
    assert.ok(/onSig: sig => \{ pos\.closeSigs\.push\(sig\); saveState/.test(fnBody('async function liveClose(')), 'close signatures persisted before confirmation');
    assert.ok(/clearCloseMarks\(pos\);\n  const row/.test(fnBody('async function liveCloseSol')));
  });
  await t('H1 isAccountMissing recognises SDK / RPC "missing" errors only', () => { assert.ok(S.isAccountMissing(new Error('Account does not exist 7xKX'))); assert.ok(!S.isAccountMissing(new Error('429 Too Many Requests'))); });
  // ---------- H2 ----------
  await t('H2 send(): status-poll RPC errors keep polling (no false "not sent"); signature handed to the caller before confirmation', () => {
    const c = fnBody('async function send(');
    assert.ok(/opts\.onSig/.test(c)); assert.ok(/catch \(e\) \{[^\n]*\n[^\n]*180_000/.test(c)); assert.ok(/err\.sig = sig/.test(c));
  });
  await t('H2 open: planned position kept in state.pendingOpens before the first send; an error with the account on chain is recorded and booked', () => {
    const c = fnBody('async function openDepositTracked');
    assert.ok(/pendingOpens\.push\(\{ position: draft\.position/.test(c)); assert.ok(/accountExists\(posKp\.publicKey\)/.test(c)); assert.ok(/ex === true[\s\S]*recordPosition\(\)/.test(c));
    assert.ok(!/secretKey/.test(c), 'no key material in state');
    assert.equal((src.match(/await openDepositTracked\(/g) || []).length, 2, 'SOL and USDC pool opens');
  });
  await t('H2 reconcile plan: funded unknown -> adopt; our empty pending -> cleanup; unknown empty -> report only; known missing -> listed', () => {
    const p = S.reconcilePlan({ onchain: [{ position: 'A', hasLiquidity: true }, { position: 'B', hasLiquidity: false }, { position: 'C', hasLiquidity: false }, { position: 'K', hasLiquidity: true }, { position: 'D', hasLiquidity: true }],
      known: [{ position: 'K' }, { position: 'GONE' }], pending: [{ position: 'B', draft: {} }, { position: 'D', draft: { name: 'd' } }, { position: 'Z', at: '2020-01-01' }] });
    assert.deepEqual(p.adopt.map(x => x.position), ['A', 'D']); assert.equal(p.adopt[1].pending.draft.name, 'd'); assert.equal(p.adopt[0].pending, null);
    assert.deepEqual(p.emptyPending.map(x => x.position), ['B']); assert.deepEqual(p.unknownEmpty.map(x => x.position), ['C']); assert.deepEqual(p.missing, ['GONE']); assert.deepEqual(p.stalePending.map(x => x.position), ['Z']);
  });
  await t('H2 adopted record is fully managed (exit rules have their fields) and valued now; never closed by the reconcile', () => {
    const r = S.adoptRecord({ position: 'A', pool: 'P', name: 'X-SOL', mintX: 'M', decX: 6, quoteMint: 'So11111111111111111111111111111111111111112', minBinId: -10, maxBinId: 0, activeBinId: -2, binStep: 100, price: 1e-6, valueQuote: 0.8, rentRefundableSol: 0.057, pxUsd: 200, strategySettings: { SL: 1 } });
    assert.equal(r.capitalAsset, 'SOL'); assert.ok(Math.abs(r.capitalInSol - 0.857) < 1e-9); assert.equal(r.depositSol, 0.8); assert.equal(r.walletTokenRaw, '0'); assert.equal(r.adopted, true); assert.equal(r.entryActiveBin, -2); assert.deepEqual(r.strategySettings, { SL: 1 });
    const c = fnBody('async function reconcileLive'); assert.ok(!/closePosition|removeLiquidity|liveClose\(/.test(c.replace(/emptyLivePositionCleanup\(state, pseudo\)/, '')), 'no close of unknown positions');
    assert.ok(/reconcileLive\(state, \{ why:/.test(src) && /RECONCILE_EVERY_MS = 30 \* 60_000/.test(src));
  });
  // ---------- H4 ----------
  await t('H4 live open computes the entry cost on its own range (like paperOpenSingle) before the MAX_NONREFUND_SOL check', () => {
    const c = fnBody('async function liveOpen(');
    const iCost = c.indexOf('quotePaperEntryCost(dlmm, minBinId, maxBinId)'), iRej = c.indexOf('entryCost.rejection(p.entryCostEstimate');
    assert.ok(iCost > 0 && iRej > iCost, 'cost computed first'); assert.ok(c.indexOf('planEntry') < iCost);
    assert.ok(/strategy\.skip\(g\) \? fastEntryCost/.test(c));
    const ec = require('./paper-entry-cost'); assert.ok(ec.rejection(undefined, 0.01), 'undefined estimate still rejects (that was the bug)');
  });
  // ---------- M1 ----------
  await t('M1 wallet tokens: only this position\'s own amount counts (stray / old leftovers ignored), interrupted close growth counted', () => {
    assert.equal(S.ownedWalletTokenRaw({ walletTokenRaw: '0' }, 5_000_000n), 0n);                      // a stray bag of the same mint: not ours
    assert.equal(S.ownedWalletTokenRaw({ walletTokenRaw: '300' }, 5_000n), 300n);
    assert.equal(S.ownedWalletTokenRaw({ walletTokenRaw: '300', closeWalletTokenBefore: '5000' }, 5_900n), 1200n);   // +900 from the remove
    assert.equal(S.ownedWalletTokenRaw({ walletTokenRaw: '300', closePosTokenRaw: '900' }, 5_900n), 1200n);
    assert.equal(S.ownedWalletTokenRaw({ walletTokenRaw: '9000' }, 100n), 100n);                     // capped at the balance
    const c = fnBody('async function liveValuation'); assert.ok(/liveSafety\.ownedWalletTokenRaw\(pos, raw\)/.test(c));
    assert.ok(/getToken: async \(\) => \(lastTok = await ownTokenForSale\(pos\)\)/.test(fnBody('async function liveCloseSol')), 'close sells only its own tokens');
  });
  const mkR = (o = {}) => { const calls = []; let tok = o.tokStart ?? 7_000_000n;
    const dlmm = { claimSwapFee: async () => (calls.push(['claim']), [{}]),
      removeLiquidity: async () => { calls.push(['remove']); if (o.failRemove === 'build') throw new Error('rpc 429'); return [{ a: 1 }, { b: 2 }]; },
      addLiquidityByStrategyChunkable: async p => { calls.push(['add', p.totalXAmount.v, p.totalYAmount.v]); if (o.failAdd && p.totalXAmount.v > 0n) throw new Error('rpc'); return [{}]; } };
    let sends = 0;
    const send = async (tx, s, l) => { calls.push(['send', l]); if (/reshape-remove/.test(l)) { sends++; if (o.failRemove === 'second' && sends === 2) throw new Error('expired'); tok += 500_000n; } };
    const pos = { decX: 6, position: 'POS', origMaxBinId: -251, minBinId: -286, walletBefore: 0.05, leftoverSol: 0.01, walletTokenRaw: '0', ...(o.pos || {}) };
    const d = { feeX: { toString: () => '0' }, feeY: { toString: () => '0' }, positionBinData: [{ binId: -256, positionXAmount: '500000' }, { binId: -255, positionXAmount: '500000' }] };
    return { calls, pos, args: { pos, positionKey: 'K', lbPosition: { positionData: d }, slippage: 1, dlmm, positionData: d, activeBinId: -258, settings: { COMPOUND_ENABLED: true, RESHAPE_SHAPE: 'BIDASK' }, txFee: 0.000025, StrategyType: ST, BN, wallet: { publicKey: 'W' }, send, getTokenRaw: async () => tok, getSolBalance: async () => 0.2, sleep: async () => {}, log: () => {}, retries: 1 } }; };
  await t('M1 reshape: withdrawn tokens become this position\'s wallet tokens until re-added; re-add success / resume brings them back to 0', async () => {
    const m = mkR(); const r = await R.reshape(m.args); assert.ok(r.ok); assert.equal(m.pos.walletTokenRaw, '0');
    const f = mkR({ failAdd: true }); const r2 = await R.reshape(f.args); assert.equal(r2.ok, false); assert.equal(f.pos.walletTokenRaw, '1000000'); assert.equal(f.pos.reshapePending.amountRaw, '1000000');
    const g = mkR(); g.pos.walletTokenRaw = f.pos.walletTokenRaw; g.pos.reshapePending = f.pos.reshapePending; await R.resumePending(g.args); assert.equal(g.pos.walletTokenRaw, '0');
  });
  await t('reshape remove fails half way: what reached the wallet is owned + queued for re-add, errors returned (no throw, no compound)', async () => {
    const m = mkR({ failRemove: 'second' }); const r = await R.reshape(m.args);
    assert.equal(r.ok, false); assert.ok(r.errors.some(e => /^remove:/.test(e))); assert.equal(r.compounded, 0);
    assert.ok(m.calls.some(c => c[0] === 'add' && c[1] === 500000n), 'the half that landed is re-added'); assert.equal(m.pos.walletTokenRaw, '0');
    const b = mkR({ failRemove: 'build' }); const rb = await R.reshape(b.args); assert.equal(rb.ok, false); assert.equal(b.pos.reshapePending, null); assert.equal(b.pos.walletTokenRaw, '0');
  });
  // ---------- M2 ----------
  await t('M2 close books the SOL its own txs moved (meta pre/post of the fee payer); wallet delta only when it agrees with the estimate', () => {
    assert.equal(S.lamportDelta({ meta: { preBalances: [1_000_000_000, 5], postBalances: [1_500_000_000, 5] } }), 500_000_000); assert.equal(S.lamportDelta({}), null);
    assert.ok(S.walletDeltaTrusted(0.05, 0.04, 1)); assert.ok(!S.walletDeltaTrusted(0.55, 0.04, 1), 'a 0.5 SOL deposit in between is not PnL'); assert.ok(!S.walletDeltaTrusted(NaN, 0, 1));
    const c = fnBody('async function finishLiveClose'); assert.ok(/closeSigsLamports\(pos\.closeSigs\)/.test(c) && /metaRecv != null \? metaRecv : walletRecv/.test(c)); assert.ok(/pos\.closeReceivedSol == null/.test(c), 'computed once, survives a restart');
    assert.ok(/liveSafety\.walletDeltaTrusted\(real, solOut - capIn, capIn\)/.test(fnBody('async function liveCloseSol')));
  });
  // ---------- M3 ----------
  await t('M3 unsold tokens booked at an estimate (not a 100% loss) and the row is corrected with the real sale', () => {
    const c = fnBody('async function liveCloseSol'); assert.ok(/pendingTokenEstimateSol = Number\(ownedRaw\) \/ 10 \*\* dec \* v\.price \* 0\.99/.test(c)); assert.ok(/receivedSol \+ tokenSol \+ pendingTokenEstimateSol/.test(c));
    const row = { capitalInSol: 1, solOut: 0.9, solPile: 0.9, pnlCapital: -0.1, netPnlSol: -0.1, realizedSol: -0.1, pnlPct: -10, pnlUsd: -20, netPnlUsd: -20, usdcOut: 180, legUsdcOut: 180, pendingTokenEstimateSol: 0.3 };
    const d = S.adjustRowForSale(row, 0.25, 200); assert.ok(Math.abs(d + 0.05) < 1e-12); assert.ok(Math.abs(row.solOut - 0.85) < 1e-12); assert.ok(Math.abs(row.pnlPct + 15) < 1e-9); assert.ok(Math.abs(row.pnlUsd + 30) < 1e-9); assert.equal(row.pendingTokenEstimateSol, 0); assert.equal(row.swapBackComplete, true);
  });
  // ---------- M5 ----------
  const mkO = (actives, o = {}) => { const calls = []; let k = 0; return { calls, dlmm: {
    getActiveBin: async () => ({ binId: actives[Math.min(k++, actives.length - 1)] }),
    initializePositionAndAddLiquidityByStrategy: async () => (calls.push('init'), {}), addLiquidityByStrategy: async () => (calls.push('add'), {}),
    createExtendedEmptyPosition: async () => (calls.push('ext'), {}), addLiquidityByStrategyChunkable: async () => (calls.push('chunk'), [{}]) },
    send: async (tx, s, l) => { calls.push('send ' + l); }, ...o }; };
  const oargs = (f, plan, created = [], extra = {}) => ({ dlmm: f.dlmm, plan, actualSol: 1, posKp: { publicKey: 'PK' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, lamports: 1e9, slippage: 1, onCreated: async x => created.push(x), ...extra });
  await t('M5 open: price ran above the range before the first send -> still deposits (SOL-only is valid); still in range -> opens', async () => {
    const plan = { minBinId: -100, maxBinId: -50, split: 0.5, wide: false };
    const logs = [];
    const f = mkO([-40]); const r = await O.openDeposit(oargs(f, plan, [], { log: m => logs.push(m) }));
    assert.ok(r.complete); assert.ok(f.calls.includes('init') && f.calls.includes('add'));
    assert.ok(logs.some(l => /active bin -40 is above the range -100\.\.-50/.test(l) && /anyway/.test(l)));
    const g = mkO([-50]); const r2 = await O.openDeposit(oargs(g, plan)); assert.ok(r2.complete); assert.ok(g.calls.includes('init'));
  });
  await t('M5 wide open / reposition reopen: price ran above after the empty position was created -> still adds both legs', async () => {
    const plan = { minBinId: -200, maxBinId: -50, split: 0.5, wide: true }, created = [], logs = [];
    const f = mkO([-60, -30]); const r = await O.openDeposit(oargs(f, plan, created, { log: m => logs.push(m) }));
    assert.ok(r.complete); assert.equal(r.depositedLamports, 1e9);
    assert.ok(f.calls.includes('ext') && f.calls.includes('chunk'));
    assert.equal(created.length, 2);
    assert.ok(logs.some(l => /active bin -30 is above the range -200\.\.-50/.test(l) && /anyway/.test(l)));
  });
  // ---------- M6 ----------
  await t('M6 pending sell: slippage 3% -> max 8% (never 30%), backoff 1 min -> 1 h, notify after 3 failures then every 6 h', () => {
    const ps = {}; let now = 1e12; const seen = [];
    for (let i = 0; i < 12; i++) { const p = S.pendingSellPlan(ps, now); assert.ok(p.due); seen.push(p.slippageBps); const f = S.pendingSellFailed(ps, now); if (i < 2) assert.equal(f.notify, false); if (i === 2) assert.equal(f.notify, true); if (i > 2 && i < 8) assert.equal(f.notify, false); assert.equal(S.pendingSellPlan(ps, now + 1).due, false); now += f.nextInMs; }
    assert.equal(seen[0], 300); assert.equal(Math.max(...seen), 800); assert.ok(S.pendingSellFailed({ tries: 20 }, 0).nextInMs <= 3600_000);
    const c = src.slice(src.indexOf('M6 (live-bugfix)'), src.indexOf('Supervised live test')); assert.ok(/plan\.slippageBps/.test(c) && !/3000\)/.test(c)); assert.ok(/ps\.ownedRaw/.test(c));
  });
  // ---------- M7 ----------
  await t('M7 DLMM instance cached per pool (refreshed before tx building); fee-account lookup cached, RPC errors never cached', async () => {
    assert.ok(/const dlmm = await dlmmFor\(pos\.pool\);/.test(fnBody('async function liveValuation'))); assert.ok(/dlmmFor\(p\.address, \{ fresh: true \}\)/.test(fnBody('async function liveOpen(')));
    let calls = 0, fail = true; const conn = { getMultipleAccountsInfo: async (keys) => { calls++; if (fail) throw new Error('429'); return keys.map(() => null); } };
    const so = 'So11111111111111111111111111111111111111112', mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    assert.deepEqual(await SR.swapFeeParams(conn, mint, so), {}); assert.deepEqual(await SR.swapFeeParams(conn, mint, so), {}); assert.equal(calls, 2, 'error not cached');
    fail = false; await SR.swapFeeParams(conn, mint, so); await SR.swapFeeParams(conn, mint, so); assert.equal(calls, 3, 'answer cached');
    const c = S.ttlCache(50, 2); c.set('a', 1); assert.equal(c.get('a'), 1); await new Promise(r => setTimeout(r, 60)); assert.equal(c.get('a'), undefined);
  });
  // ---------- M8 ----------
  await t('M8 screening: one pool\'s error skips that pool only', () => {
    const i = src.indexOf('for (const p of c.slice(0,40)) { try {'); assert.ok(i > 0);
    assert.ok(/\} catch \(e\) \{ skip\(`\$\{p\.name\} [^\n]*'screen error: '/.test(src.slice(i, i + 12000)));
  });
  // ---------- affordability ----------
  await t('affordability: no open attempts once the wallet cannot fund budget + reserve', () => {
    assert.ok(S.canAffordOpen({ free: 1.0, budgetSol: 1 })); assert.ok(!S.canAffordOpen({ free: 0.97, budgetSol: 1 })); assert.ok(!S.canAffordOpen({ free: NaN, budgetSol: 1 }));
    assert.ok(/liveSafety\.canAffordOpen\(\{ free, budgetSol: budget \}\)[^\n]*break;/.test(fnBody('async function liveCycle')));
  });
  await t('loaded state: the disk "position" copy is never re-added as a second position', () => { assert.ok(/state\.positions = livePositions\.dedupeList\(livePositions\.list\(state\)\); state\.position = null; state\.__active = null;   \/\/ the loaded file/.test(fnBody('async function liveCycle'))); });
  // ---------- screening-fix ----------
  await t('screening: live writes paper/screening.json (the file the Mini App reads) after every scan and after the background reasons; a write error never breaks the scan', () => {
    const c = src.slice(src.indexOf('async function performScan'), src.indexOf('let lastRefreshAttempt'));
    assert.ok(/try\{writeScreening\(scan\.last\);\}catch\(e\)\{log\(/.test(c)); assert.ok(!/if\(policy\.PAPER\)\{\s*fs\.mkdirSync\(PAPER_DIR/.test(c), 'no paper-only guard on the write');
    assert.ok(/if\(!screenDiagBusy\)\{/.test(c)); assert.ok(/writeScreening\(snap\)/.test(c));
    assert.ok(/const SCREENING_FILE = \(\) => path\.join\(PAPER_DIR, 'screening\.json'\)/.test(src));
    assert.ok(/function scanRequested\(\) \{[^\n]*scan\.last\.requestId !== r\.id/.test(src), 'live answers the Mini App re-scan request');
  });
  await t('screening: a scan that answered the re-scan request (same requestId, same policy) is no longer "stale / waiting"', () => {
    const SRf = require('./paper-screen-refresh'), d = fs.mkdtempSync(path.join(os.tmpdir(), 'lbf-'));
    const req = SRf.request(d, { manual: true, userId: 1 }); const values = {};
    assert.equal(SRf.status(d, values, { requestId: 'old', policyKey: SRf.signature(values) }).stale, true);
    assert.equal(SRf.status(d, values, { requestId: req.id, policyKey: SRf.signature(values) }).stale, false);
    fs.rmSync(d, { recursive: true });
  });
  await t('screening: settings MAX_PUMP24H_PCT=200 (legacy MAX_PUMP_24H=5 unused) and the bot CFG (MAX_PUMP_24H=2) give the same policy signature: no permanent "Scan lama"', () => {
    const SRf = require('./paper-screen-refresh');
    const values = { MAX_PUMP24H_PCT: 200, MAX_PUMP_24H: 5 }, cfg = { MAX_PUMP24H_PCT: 200, MAX_PUMP_24H: 2 };
    assert.equal(SRf.signature(values), SRf.signature(cfg)); assert.equal(SRf.policy(values).MAX_PUMP_24H, 2);
    assert.notEqual(SRf.signature({ MAX_PUMP24H_PCT: 300 }), SRf.signature(cfg), 'a real change still triggers a re-scan');
  });
  console.log(`all ${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
