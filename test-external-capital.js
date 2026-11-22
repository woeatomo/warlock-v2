'use strict';
// 21 Nov 2026: a manual / external deposit into a bot position must raise the capital basis
// (not be booked as profit). Replay of tonight's DCTY: operator added ~0.95 SOL Bid-Ask at 23:59 WIB;
// the live poll saw value 1.90 vs depositSol 0.95 and closed on a false 100% / oor_right_take_profit.
// Fakes only: nothing signed, no RPC, no live files.
const assert = require('assert');
const O = require('./live-open-exec');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

const snap = (x, y, price, extra = {}) => ({ x, y, price, principal: y + x * price, ...extra });

(async () => {
  await t('tonight DCTY: after a 0.95 SOL manual Bid-Ask add, basis becomes 1.90, leftover pile shrinks, PnL ~0% (no false TP)', () => {
    const pos = { name: 'DCTY-SOL', depositSol: 0.949881775, leftoverSol: 0.999739001, undepositedCredit: 0.9501182249999999, capitalInSol: 2, spotSol: 0.949881775, bidaskSol: 0, stage: 'spot', quoteSymbol: 'SOL' };
    assert.equal(O.syncExternalCapital(pos, snap(0, 0.94999, 2.66e-5)), null);   // first poll: just track
    const ev = O.syncExternalCapital(pos, snap(0, 1.89988, 2.66e-5));
    assert.equal(ev.kind, 'add');
    assert.ok(Math.abs(ev.jump - 0.94989) < 1e-6, ev.jump);
    assert.ok(Math.abs(pos.depositSol - 1.899771775) < 1e-9, pos.depositSol);
    assert.equal(pos.capitalInSol, 2, 'add came from the reserved pile, budget stays 2 SOL');
    assert.ok(pos.leftoverSol < 0.06 && pos.leftoverSol > 0.04, pos.leftoverSol);
    assert.equal(pos.undepositedCredit, 0);
    assert.equal(pos.stage, 'full');
    const value = 1.89988, pnlPct = 100 * (value / pos.depositSol - 1);
    assert.ok(Math.abs(pnlPct) < 0.05, 'would have been +100% before the fix: ' + pnlPct);
    assert.ok(pnlPct < 0.5, 'OOR_RIGHT_MIN_PROFIT_PCT is 0.5%: must not fire');
  });

  await t('add from new money (no leftover pile): capitalInSol increases too', () => {
    const pos = { name: 'X', depositSol: 1, leftoverSol: 0, capitalInSol: 1, usdcIn: 70, quoteSymbol: 'SOL' };
    O.syncExternalCapital(pos, snap(0, 1, 1));
    const ev = O.syncExternalCapital(pos, snap(0, 1.5, 1), {});
    // need to pass solUsd on the snap for usdcIn
    assert.equal(ev.kind, 'add'); assert.equal(ev.newMoney, 0.5); assert.equal(ev.fromPile, 0);
    assert.equal(pos.depositSol, 1.5); assert.equal(pos.capitalInSol, 1.5);
  });

  await t('new money also lifts usdcIn when solUsd is known', () => {
    const pos = { name: 'X', depositSol: 1, leftoverSol: 0, capitalInSol: 1, usdcIn: 70, quoteSymbol: 'SOL' };
    O.syncExternalCapital(pos, snap(0, 1, 1));
    O.syncExternalCapital(pos, snap(0, 1.5, 1, { solUsd: 70 }));
    assert.equal(pos.usdcIn, 105);
  });

  await t('withdrawal reduces depositSol and capitalInSol (no false SL)', () => {
    const pos = { name: 'X', depositSol: 2, leftoverSol: 0, capitalInSol: 2, quoteSymbol: 'SOL' };
    O.syncExternalCapital(pos, snap(0, 2, 1));
    const ev = O.syncExternalCapital(pos, snap(0, 1.2, 1));
    assert.equal(ev.kind, 'withdraw'); assert.ok(Math.abs(ev.jump + 0.8) < 1e-12);
    assert.equal(pos.depositSol, 1.2); assert.equal(pos.capitalInSol, 1.2);
    const pnlPct = 100 * (1.2 / pos.depositSol - 1);
    assert.ok(Math.abs(pnlPct) < 1e-9);
  });

  await t('price move that only swaps X for Y is ignored', () => {
    const pos = { name: 'X', depositSol: 2, leftoverSol: 0, capitalInSol: 2, quoteSymbol: 'SOL' };
    O.syncExternalCapital(pos, snap(0, 2, 10));
    const ev = O.syncExternalCapital(pos, snap(0.05, 1.5, 10));   // 1.5 + 0.05*10 = 2.0
    assert.equal(ev, null); assert.equal(pos.depositSol, 2);
  });

  await t('tiny jump under 0.02 SOL tolerance is ignored (fees / rounding)', () => {
    const pos = { name: 'X', depositSol: 2, leftoverSol: 0, capitalInSol: 2, quoteSymbol: 'SOL' };
    O.syncExternalCapital(pos, snap(0, 2, 1));
    assert.equal(O.syncExternalCapital(pos, snap(0, 2.01, 1)), null);
    assert.equal(pos.depositSol, 2);
  });

  await t('bot reshape/compound (botLiquidityTouched) raises principal but not the basis', () => {
    const pos = { name: 'X', depositSol: 2, leftoverSol: 0, capitalInSol: 2, quoteSymbol: 'SOL', botLiquidityTouched: true };
    O.syncExternalCapital(pos, snap(0, 2, 1));
    pos.botLiquidityTouched = true;
    const ev = O.syncExternalCapital(pos, snap(0, 2.05, 1));   // compounded 0.05 fees
    assert.equal(ev, null); assert.equal(pos.depositSol, 2); assert.equal(pos.botLiquidityTouched, undefined);
  });

  await t('history correction for tonight\'s closed DCTY: PnL is the wallet-consistent leftover-adjusted result, not +0.95 SOL', () => {
    const row = {
      name: 'DCTY-SOL', position: 'C8jZ5rS5zMN2yTi88PUrtxsYSbgLhAuLodVfqooiQS8F', closedAt: '2026-11-20T16:59:26.401Z',
      depositSol: 0.949881775, leftoverSol: 0.999739001, undepositedCredit: 0.9501182249999999,
      bidaskSol: 0, stage: 'spot', capitalInSol: 2, solOut: 2.9512508669999997, solPile: 2.9512508669999997,
      realizedSol: 0.95125, netPnlSol: 0.9512508669999997, pnlPct: 47.562543349999984, netPnlPct: 47.562543349999984,
      pnlUsd: 65.72266006575998, netPnlUsd: 65.72266006575998, usdcOut: 204.46266006576, usdcIn: 138.74,
      estPnlPct: 100.02, estValueSol: 1.89999, solUsd: 69.28,
      binShape: { bins: [[-545, 0.949881775, 0], [-459, 0.949998225, 0]] },
    };
    // the test uses two bins that sum to the real 1.89988 close principal
    const r = O.correctDctyManualAddHistory({ history: [row] });
    assert.equal(r.changed, true);
    assert.ok(Math.abs(r.added - 0.949998225) < 1e-12);
    assert.ok(Math.abs(row.depositSol - 1.89988) < 1e-12);
    assert.equal(row.correctionNote, O.DCTY_MANUAL_ADD_NOTE);
    assert.ok(Math.abs(r.pnlSol - 0.001252642) < 1e-8, r.pnlSol);
    assert.ok(r.pnlPct > 0 && r.pnlPct < 0.1, r.pnlPct);
    assert.ok(r.pnlUsd > 0 && r.pnlUsd < 0.2, r.pnlUsd);
    assert.equal(row.stage, 'full');
    assert.equal(row.undepositedCredit, 0);
    const again = O.correctDctyManualAddHistory({ history: [row] });
    assert.equal(again.changed, false, 'idempotent');
  });

  await t('bot.js liveValuation applies syncExternalCapital before PnL; reshape marks botLiquidityTouched; startup corrects the DCTY row', () => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const val = src.slice(src.indexOf('async function liveValuation('), src.indexOf('async function liveSwapAllToSol'));
    assert.ok(/syncExternalCapital\(pos/.test(val), 'liveValuation must sync the basis before computing pnl');
    assert.ok(/principal/.test(val) && /depositSol/.test(val));
    assert.ok(/botLiquidityTouched = true/.test(src), 'reshape must ignore its own liquidity change');
    assert.ok(/correctDctyManualAddHistory\(state\)/.test(src), 'startup applies the approved history correction');
    assert.ok(/if \(v && v\.externalCapital\) saveState/.test(src));
  });

  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
