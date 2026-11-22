'use strict';
// Live exit decisions == dry-run decisions (same code, same inputs). Offline: no network, no keys, no transactions.
const assert = require('assert'), fs = require('fs'), path = require('path');
const LE = require('./live-exit'), paperUsdc = require('./paper-usdc'), paperExit = require('./paper-exit-policy');
const PX = 100, TX = 0.000025, USDC_IN = 500;
// controllable fake Jupiter: SOL -> USDC at exactly PX (no fee); token -> USDC at price * PX * 0.99
const quote = async (mint, out, raw, inDec, outDec) => { const amt = Number(raw) / 10 ** inDec; const usd = mint === 'So11111111111111111111111111111111111111112' ? amt * PX : amt * 0.00001 * PX * 0.99; return { ok: true, outUi: usd, inUi: amt }; };
const CFG = { EMERGENCY_DROP: 0.2, MAX_HOURS: 12, TP_USD_PCT: 13, OOR_RIGHT_CLOSE: true, TRAIL_ENABLED: false, QUOTE_FAILURE_POLLS: 10, OOR_RIGHT_CONFIRM_POLLS: 2, OOR_RIGHT_MIN_PROFIT_PCT: 0.5, OOR_RIGHT_MAX_REPOSITIONS: 2,
  EMERGENCY_TP_ENABLED: true, EMERGENCY_TP_TRIGGER_RANGE_PCT: 50, EMERGENCY_TP_PCT: 10, STALE_CLOSE_ENABLED: true, STALE_EXIT_MODE: 'ANY', STALE_EXIT_PCT: 5,
  EMERGENCY_SLPLUS_ENABLED: true, EMERGENCY_SLPLUS_ARM_PCT: 3, EMERGENCY_SLPLUS_LOCK_PCT: 0.1, EMERGENCY_SLPLUS_CONFIRM_POLLS: 3, EMERGENCY_SLPLUS_FLOOR_PCT: 0, EMERGENCY_SLPLUS_FLOOR_POLLS: 2 };
const STEP = 100, E = 0;           // binStep 100 (1%), entry active bin 0
const mkPos = () => ({ pool: 'P', name: 'TEST-SOL', mintX: 'MINTX', decX: 6, position: 'POS', minBinId: -200, maxBinId: 5, openedAt: new Date().toISOString(), entryPrice: 0.00001,
  binStep: STEP, entryActiveBin: E, capitalAsset: 'USDC', usdcIn: USDC_IN, initialUsdcIn: USDC_IN, rentRefundableSol: 0, leftoverSol: 0, baseFeePct: 0.3, strategySettings: { RANGE_DOWN_PCT: 50 } });
// choose y (SOL) so that net pnl% hits the target: usdcOut = (y - 3*tx)*PX
const yFor = pct => (USDC_IN * (1 + pct / 100)) / PX + 3 * TX;
const binFor = drop => Math.floor(Math.log(1 - drop / 100) / Math.log(1 + STEP / 1e4));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
(async () => {
  await t('valuation is the SAME function as the dry run (identical numbers for identical holdings)', async () => {
    const pos = mkPos(), v = { x: 1234, y: 4.2, fx: 10, fy: 0.01, price: 0.00001, activeBinId: 0 };
    const live = await LE.liveVal({ pos, v, pxUsd: PX, quote, txFee: TX });
    const paperPos = { ...pos, bins: { a: { x: 1234, y: 4.2 } }, feeX: 10, feeY: 0.01, quoteMint: 'So11111111111111111111111111111111111111112', capitalAsset: 'USDC' };
    const paper = await paperUsdc.exitQuote({ pos: paperPos, book: { virtual: { sol: 0 } }, snap: { price: 0.00001, pxUsd: PX }, quote, txFee: TX });
    for (const k of ['usdcOut', 'pnlUsd', 'pnlPct', 'tokenSwapCostUsd', 'solSwapCostUsd', 'quoted', 'solPile']) assert.deepStrictEqual(live[k], paper[k], k);
  });
  await t('net pnl basis: usdcIn is the denominator (not SOL, not token price)', async () => {
    const pos = mkPos(); const v = { x: 0, y: yFor(5), fx: 0, fy: 0, price: 0.00001, activeBinId: 0 };
    const val = await LE.liveVal({ pos, v, pxUsd: PX, quote, txFee: TX }); assert.ok(Math.abs(val.pnlPct - 5) < 1e-6, String(val.pnlPct)); assert.ok(Math.abs(val.pnlUsd - 25) < 1e-6);
  });
  await t('stop loss -20% is on NET pnl (not token price): price flat but pnl -21% -> emergency_stop', async () => {
    const pos = mkPos(); const r = await LE.decideLiveExit({ pos, v: { x: 0, y: yFor(-21), fx: 0, fy: 0, price: 0.00001, activeBinId: 0 }, pxUsd: PX, quote, txFee: TX, CFG, pollId: 1 }); assert.equal(r.reason, 'emergency_stop');
  });
  await t('token price -30% but net pnl only -3% (fees) -> NO stop (old live rule would have closed)', async () => {
    const pos = mkPos(); const r = await LE.decideLiveExit({ pos, v: { x: 0, y: yFor(-3), fx: 0, fy: 0, price: 0.000007, activeBinId: binFor(30) }, pxUsd: PX, quote, txFee: TX, CFG, pollId: 1 }); assert.equal(r.reason, null);
  });
  await t('TP is TP_USD_PCT (13%), shared with the dry run: +12.9 holds, +13.1 closes', async () => {
    const a = mkPos(); assert.equal((await LE.decideLiveExit({ pos: a, v: { x: 0, y: yFor(12.9), fx: 0, fy: 0, price: 1e-5, activeBinId: 0 }, pxUsd: PX, quote, txFee: TX, CFG, pollId: 1 })).reason, null);
    const b = mkPos(); assert.match((await LE.decideLiveExit({ pos: b, v: { x: 0, y: yFor(13.1), fx: 0, fy: 0, price: 1e-5, activeBinId: 0 }, pxUsd: PX, quote, txFee: TX, CFG, pollId: 1 })).reason, /^TP USDC \+13%/);
  });
  await t('HUNG-like path through the LIVE pipeline: TP emergency armed -> +3% -> BEP -> emergency_slplus (not stop loss)', async () => {
    const pos = mkPos(); const path_ = [[binFor(26), -7], [binFor(26), -3], [-3, 4], [0, 8], [-2, 3], [-8, 1], [-14, 0.05], [-14, -0.06], [-14, -0.06]]; let i = 0, res = null;
    for (const [b, pct] of path_) { i++; res = await LE.decideLiveExit({ pos, v: { x: 0, y: yFor(pct), fx: 0, fy: 0, price: 1e-5, activeBinId: b }, pxUsd: PX, quote, txFee: TX, CFG, pollId: i }); if (res.reason) break; }
    assert.match(res.reason, /^emergency_slplus USDC /); assert.ok(pos.slPlusArmed && pos.deepDrawdown); assert.notStrictEqual(res.reason, 'emergency_stop');
  });
  await t('property: live pipeline and the plain dry-run pipeline give IDENTICAL decisions on 300 random steps', async () => {
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let run = 0; run < 12; run++) {
      const lp = mkPos(), pp = mkPos(); let bin = 0, pct = 0; let li = 0;
      for (let step = 1; step <= 25; step++) {
        bin += Math.round((rnd() - 0.55) * 6); pct += (rnd() - 0.5) * 6; if (pct < -22) pct = -22; li = step;
        const v = { x: 0, y: yFor(pct), fx: 0, fy: 0, price: 1e-5, activeBinId: bin };
        const a = await LE.decideLiveExit({ pos: lp, v, pxUsd: PX, quote, txFee: TX, CFG, pollId: step });
        const val = await paperUsdc.exitQuote({ pos: { ...pp, bins: { a: { x: 0, y: v.y } }, feeX: 0, feeY: 0, quoteMint: 'So11111111111111111111111111111111111111112', capitalAsset: 'USDC' }, book: { virtual: { sol: 0 } }, snap: { price: 1e-5, pxUsd: PX }, quote, txFee: TX });
        const b = paperExit.decide({ pos: pp, val, activeBin: bin, settings: { ...CFG, ...pp.strategySettings }, pollId: step });
        assert.strictEqual(a.reason, b, `run ${run} step ${step}: live=${a.reason} paper=${b}`);
        if (a.reason) break;
      }
    }
  });
  await t('stale (max age 12h) comes from the same staleCheck, no separate live rule', async () => {
    const pos = mkPos(); pos.openedAt = new Date(Date.now() - 13 * 3600e3).toISOString(); const r = await LE.decideLiveExit({ pos, v: { x: 0, y: yFor(1), fx: 0, fy: 0, price: 1e-5, activeBinId: 0 }, pxUsd: PX, quote, txFee: TX, CFG, pollId: 1 });
    assert.match(r.reason, /^max age 12h/);
  });
  await t('liveCycle uses decideLiveExit and no longer has its own price-based stop / fixed TP / fixed max-age rules', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); const lc = src.slice(src.indexOf('async function livePositionCycle'), src.indexOf('(async () => {', src.indexOf('async function liveCycle')));   // per-position part + open loop
    assert.ok(/liveExit\.decideLiveExit\(/.test(lc), 'liveCycle does not call decideLiveExit'); assert.ok(!/antirug\.shouldEmergencyStop/.test(lc), 'old price-based stop still in liveCycle'); assert.ok(!/v\.pnl >= CFG\.TP/.test(lc), 'old fixed TP still in liveCycle'); assert.ok(!/ageH >= CFG\.MAX_HOURS/.test(lc), 'old fixed max age still in liveCycle');
  });
  await t('liveOpen stores everything the exit policy needs (entry snapshot, bin step, entry bin, USDC basis, leftover SOL)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); const lo = src.indexOf('async function liveOpen'); const body = src.slice(lo, src.indexOf('async function ', lo + 10));
    for (const f of ['binStep', 'entryActiveBin', "capitalAsset: solMode ? 'SOL' : 'USDC'", 'capitalInSol: budgetSol', 'initialUsdcIn', 'strategy.snapshot(CFG)', 'leftoverSol', 'baseFeePct']) assert.ok(body.includes(f), 'liveOpen does not store ' + f);
  });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
