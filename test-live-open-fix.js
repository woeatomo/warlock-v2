'use strict';
// live-open-fix (20 Nov 2026, DCTY 14:09 WIB): the BidAsk leg of a MIXED 50:50 open failed with Custom 6004 (ExceededBinSlippageTolerance)
// because it was built on a stale active bin; the position stayed Spot-only. Offline: a fake DLMM records calls, nothing is signed.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const strategy = require('./paper-strategy'), { planEntry } = require('./live-geometry'), O = require('./live-open-exec');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const BN = class { constructor(v) { this.v = Number(v); } }; const ST = { Spot: 'Spot', BidAsk: 'BidAsk' };
const CFG = { RANGE_DOWN_PCT: 50, LOWER_BINS: 0, RANGE_UP_PCT: 0, UPPER_BUFFER_BINS: 0, OPEN_SHAPE: 'MIXED', OPEN_SPOT_PCT: 50 };
const E6004 = label => new Error(`${label} failed 2Xsr {"InstructionError":[7,{"Custom":6004}]}`);
// fail: { 'add-bidask': [chunkIndexThatFails, howManyTimes] }
function fake({ fail = {}, chunks = 2, unknown = false } = {}) {
  const calls = [], left = Object.fromEntries(Object.entries(fail).map(([k, v]) => [k, v[1]]));
  let fresh = 0;
  const dlmm = {
    refetchStates: async () => { fresh++; calls.push('refetch'); },
    getActiveBin: async () => ({ binId: -355 }),
    createExtendedEmptyPosition: async () => (calls.push('ext'), { tx: 'ext' }),
    initializePositionAndAddLiquidityByStrategy: async p => (calls.push(`build init ${p.strategy.strategyType} ${p.totalYAmount.v} slip=${p.slippage} fresh=${fresh}`), { tx: 'init' }),
    addLiquidityByStrategy: async p => (calls.push(`build add ${p.strategy.strategyType} ${p.totalYAmount.v} slip=${p.slippage} fresh=${fresh}`), { tx: 'add' }),
    addLiquidityByStrategyChunkable: async p => { calls.push(`build chunk ${p.strategy.strategyType} ${p.totalYAmount.v} ${p.strategy.minBinId}..${p.strategy.maxBinId} slip=${p.slippage} fresh=${fresh}`); return Array.from({ length: chunks }, (_, j) => ({ tx: 'c' + j })); },
  };
  const send = async (tx, signers, label) => {
    const base = label.replace(/ \d+\/\d+$/, ''), j = /(\d+)\/\d+$/.test(label) ? +label.match(/(\d+)\/\d+$/)[1] - 1 : 0;
    if (fail[base] && fail[base][0] === j && left[base] > 0) { left[base]--; calls.push('FAIL ' + label); if (unknown) { const e = new Error(label + ' not confirmed after 180 s'); e.unknownStatus = true; throw e; } throw E6004(label); }
    calls.push('send ' + label);
  };
  return { calls, dlmm, send };
}
const plan = planEntry({ strategy, binStep: 80, activeBinId: -355, policy: CFG, maxBins: 1400 });   // DCTY: 87 bins -441..-355, extended position
const args = (f, extra = {}) => ({ dlmm: f.dlmm, plan, actualSol: 0.9, posKp: { publicKey: 'PK' }, wallet: { publicKey: 'W' }, send: f.send, BN, StrategyType: ST, lamports: 1e9, slippage: 1, onCreated: async () => {}, retryDelayMs: 0, ...extra });
(async () => {
  await t('plan = dry run plan for the same settings: DCTY 87 bins -441..-355, wide, split 0.5 (Spot 0.45 + BidAsk 0.45 SOL on the SAME bins)', async () => {
    assert.equal(plan.minBinId, -441); assert.equal(plan.maxBinId, -355); assert.ok(plan.wide); assert.equal(plan.split, 0.5);
    const f = fake(), r = await O.openDeposit(args(f));
    assert.ok(r.complete); assert.equal(r.depositedLamports, 900000000); assert.deepStrictEqual(r.missing, []);
    const builds = f.calls.filter(c => c.startsWith('build chunk'));
    assert.deepStrictEqual(builds.map(c => c.split(' ').slice(2, 5).join(' ')), ['Spot 450000000 -441..-355', 'BidAsk 450000000 -441..-355']);
  });
  await t('every leg is built on a fresh pool state and with >= 5% bin slippage (SLIPPAGE_PCT=1 was 2 bins at bin step 80)', async () => {
    const f = fake(); await O.openDeposit(args(f));
    const builds = f.calls.filter(c => c.startsWith('build'));
    assert.ok(builds.every(c => /slip=5 /.test(c)), builds.join('\n'));
    for (const b of builds) { const i = f.calls.indexOf(b); assert.equal(f.calls[i - 1], 'refetch', 'refetch right before ' + b); }
    const f2 = fake(); await O.openDeposit(args(f2, { slippage: 8 })); assert.ok(f2.calls.filter(c => c.startsWith('build')).every(c => /slip=8 /.test(c)));
  });
  await t('DCTY case: 6004 on BidAsk chunk 1 -> rebuilt on a fresh active bin and sent again -> complete Spot+BidAsk', async () => {
    const logs = [], f = fake({ fail: { 'add-bidask': [0, 1] } }), r = await O.openDeposit(args(f, { log: m => logs.push(m) }));
    assert.ok(r.complete, f.calls.join('\n')); assert.equal(r.depositedLamports, 900000000);
    assert.equal(f.calls.filter(c => /^build chunk BidAsk/.test(c)).length, 2);
    assert.ok(f.calls.includes('send add-bidask 1/2') && f.calls.includes('send add-bidask 2/2'));
    assert.ok(logs.some(l => /add-bidask not landed \(1\/3\)/.test(l)));
  });
  await t('6004 on a LATER chunk: no rebuild (chunk 1 landed; a rebuild would deposit it twice) -> incomplete, missing leg marked partial', async () => {
    const f = fake({ fail: { 'add-bidask': [1, 1] } }), r = await O.openDeposit(args(f));
    assert.equal(r.complete, false); assert.equal(f.calls.filter(c => /^build chunk BidAsk/.test(c)).length, 1);
    assert.equal(r.depositedLamports, 450000000); assert.deepStrictEqual(r.missing.map(m => [m.name, m.partial]), [['bidask', true]]);
  });
  await t('at most 3 tries per leg; then incomplete with the leg reported missing (not partial)', async () => {
    const f = fake({ fail: { 'add-bidask': [0, 9] } }), r = await O.openDeposit(args(f));
    assert.equal(r.complete, false); assert.equal(f.calls.filter(c => /^build chunk BidAsk/.test(c)).length, O.LEG_TRIES);
    assert.deepStrictEqual(r.missing.map(m => [m.name, m.partial, m.lam]), [['bidask', false, 450000000]]); assert.ok(/6004/.test(r.missing[0].error));
  });
  await t('Spot leg failing after create: BidAsk not attempted, both reported missing', async () => {
    const f = fake({ fail: { 'add-spot': [0, 9] } }), r = await O.openDeposit(args(f));
    assert.equal(r.complete, false); assert.equal(r.depositedLamports, 0); assert.deepStrictEqual(r.missing.map(m => m.name), ['spot', 'bidask']);
    assert.ok(!f.calls.some(c => /BidAsk/.test(c)));
  });
  await t('unknown status (may have landed) is never resent', async () => {
    const f = fake({ fail: { 'add-bidask': [0, 1] }, unknown: true }), r = await O.openDeposit(args(f));
    assert.equal(r.complete, false); assert.equal(f.calls.filter(c => /^build chunk BidAsk/.test(c)).length, 1);
  });
  await t('narrow position: 6004 on create+Spot is retried (atomic, nothing created), BidAsk follows', async () => {
    const p2 = planEntry({ strategy, binStep: 200, activeBinId: -100, policy: CFG, maxBins: 1400 }); assert.ok(!p2.wide);
    const f = fake({ fail: { 'open-spot': [0, 1] } }), r = await O.openDeposit(args(f, { plan: p2 }));
    assert.ok(r.complete, f.calls.join('\n')); assert.equal(f.calls.filter(c => /^build init/.test(c)).length, 2); assert.ok(f.calls.includes('send add-bidask'));
  });
  await t('bot.js: partial-shape open is sent to Telegram (SOL and USDC pools), quiet when complete', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    assert.equal((src.match(/notifyPartialShape\(p, dep, (LAMPORTS_PER_SOL|1e6)/g) || []).length, 2);
    const body = src.slice(src.indexOf('function notifyPartialShape('), src.indexOf('function notifyTg('));
    const sent = [], ctx = { notifyTg: m => sent.push(m) }; vm.createContext(ctx); vm.runInContext(body + ';this.f=notifyPartialShape;', ctx);
    ctx.f({ name: 'DCTY-SOL' }, { complete: true, depositedLamports: 9e8, missing: [] }, 1e9, 'SOL'); assert.equal(sent.length, 0);
    ctx.f({ name: 'DCTY-SOL' }, { complete: false, depositedLamports: 449279237, missing: [{ name: 'bidask', lam: 450720763, partial: false, error: 'add-bidask 1/2 failed ' + 'x'.repeat(70) + ' {"Custom":6004}' }] }, 1e9, 'SOL');
    assert.equal(sent.length, 1); assert.ok(/DCTY-SOL/.test(sent[0]) && /Bid-Ask 0\.4507 SOL/.test(sent[0]) && /Masuk 0\.4493 SOL/.test(sent[0]) && /6004/.test(sent[0]), sent[0]);
  });
  await t('tonight DCTY (20 Nov 23:54 WIB): after Spot landed, active moved 1 bin above -545..-459 -> BidAsk still deposited into the same bins', async () => {
    const dcty = planEntry({ strategy, binStep: 80, activeBinId: -459, policy: CFG, maxBins: 1400 });
    assert.equal(dcty.minBinId, -545); assert.equal(dcty.maxBinId, -459); assert.ok(dcty.wide); assert.equal(dcty.split, 0.5);
    const logs = [], f = fake();
    let nAct = 0;
    f.dlmm.getActiveBin = async () => ({ binId: ++nAct <= 2 ? -459 : -458 });
    const r = await O.openDeposit(args(f, { plan: dcty, actualSol: 1.9, log: m => logs.push(m) }));
    assert.ok(r.complete, f.calls.join('\n')); assert.equal(r.depositedLamports, 1900000000); assert.deepStrictEqual(r.missing, []);
    const builds = f.calls.filter(c => c.startsWith('build chunk'));
    assert.ok(builds.some(c => /Spot 950000000 -545\.\.-459/.test(c)), builds.join('\n'));
    assert.ok(builds.some(c => /BidAsk 950000000 -545\.\.-459/.test(c)), builds.join('\n'));
    assert.ok(f.calls.includes('send add-bidask 1/2') && f.calls.includes('send add-bidask 2/2'));
    assert.ok(logs.some(l => /active bin -458 is above the range -545\.\.-459/.test(l) && /anyway/.test(l)), logs.join('\n'));
    assert.ok(!logs.some(l => /not deposited/.test(l)));
  });
  await t('same path as an OOR-right reposition reopen: active already above the new range, both legs still deposit', async () => {
    const dcty = planEntry({ strategy, binStep: 80, activeBinId: -459, policy: CFG, maxBins: 1400 });
    const logs = [], f = fake();
    f.dlmm.getActiveBin = async () => ({ binId: -450 });   // 9 bins above -459, like a reopen that lagged the pump
    const r = await O.openDeposit(args(f, { plan: dcty, actualSol: 1.9, log: m => logs.push(m) }));
    assert.ok(r.complete); assert.equal(r.depositedLamports, 1900000000);
    assert.ok(f.calls.includes('send add-spot 1/2') && f.calls.includes('send add-bidask 1/2'));
    assert.ok(logs.some(l => /active bin -450 is above the range -545\.\.-459/.test(l)));
  });
  await t('DCTY + 6004 on first BidAsk chunk while active is already above the range: retry still completes', async () => {
    const dcty = planEntry({ strategy, binStep: 80, activeBinId: -459, policy: CFG, maxBins: 1400 });
    const logs = [], f = fake({ fail: { 'add-bidask': [0, 1] } });
    f.dlmm.getActiveBin = async () => ({ binId: -458 });
    const r = await O.openDeposit(args(f, { plan: dcty, actualSol: 1.9, log: m => logs.push(m) }));
    assert.ok(r.complete, f.calls.join('\n')); assert.equal(r.depositedLamports, 1900000000);
    assert.equal(f.calls.filter(c => /^build chunk BidAsk/.test(c)).length, 2);
    assert.ok(logs.some(l => /add-bidask not landed \(1\/3\)/.test(l)));
  });
  await t('price moved below the range: SOL-only send is still attempted; if it cannot land, partial alert (token-side impossible)', async () => {
    const dcty = planEntry({ strategy, binStep: 80, activeBinId: -459, policy: CFG, maxBins: 1400 });
    const logs = [], f = fake({ fail: { 'add-spot': [0, 9] } });
    f.dlmm.getActiveBin = async () => ({ binId: -600 });
    const r = await O.openDeposit(args(f, { plan: dcty, actualSol: 1.9, log: m => logs.push(m) }));
    assert.equal(r.complete, false); assert.equal(r.depositedLamports, 0);
    assert.deepStrictEqual(r.missing.map(m => m.name), ['spot', 'bidask']);
    assert.ok(logs.some(l => /active bin -600 is below the range -545\.\.-459/.test(l)));
    assert.ok(f.calls.includes('FAIL add-spot 1/2'));
  });
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
