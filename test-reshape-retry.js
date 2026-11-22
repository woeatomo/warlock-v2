'use strict';
// 22 Nov 2026: a failed reshape token re-add is retried every poll until it succeeds (never abandoned), re-planned from the
// current active bin after the hold, with the add slippage widened 1% per failed poll (5% .. 15%). Offline mocks only.
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = require('./live-reshape-exec');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
class BN { constructor(v) { this.v = BigInt(v); } toString() { return String(this.v); } }
const ST = { Spot: 0, BidAsk: 1 };
const mk = (failTimes) => {
  const seen = []; let calls = 0;
  const dlmm = { refetchStates: async () => {}, addLiquidityByStrategyChunkable: async (p) => { calls++; seen.push({ slippage: p.slippage, min: p.strategy.minBinId, max: p.strategy.maxBinId }); if (calls <= failTimes) throw new Error('Simulation failed. ExceededAmountSlippageTolerance'); return [{}]; } };
  const pos = { name: 'greg-SOL', origMaxBinId: -468, maxBinId: -468, reshapePending: { amountRaw: '1000', rightMin: -503, rightMax: -468, shape: 'BIDASK', polls: 0 } };
  const args = { pos, positionKey: 'K', slippage: 1, dlmm, StrategyType: ST, BN, wallet: { publicKey: 'W' }, send: async () => {}, sleep: async () => {} };
  return { pos, args, seen };
};
(async () => {
  await t('bot.js: no abandon limit, log says it keeps retrying', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    assert.ok(/RESHAPE_PENDING_MAX_POLLS = Infinity;/.test(src));
    assert.ok(src.includes('retry next poll until success'));
  });
  await t('20 failed polls in a row: never abandoned, still pending, counter grows', async () => {
    const m = mk(1e9);
    for (let i = 1; i <= 20; i++) {
      const rs = await R.resumePendingCapped({ ...m.args, activeBinId: -500 - i }, { holdPolls: 3, maxPolls: Infinity });
      assert.equal(rs.abandoned, undefined); assert.equal(rs.polls, i);
    }
    assert.ok(m.pos.reshapePending); assert.equal(m.pos.reshapePending.polls, 20); assert.equal(m.pos.reshapeAbandoned, undefined);
  });
  await t('slippage widens 1% per failed poll from 5%, capped at 15%', async () => {
    const m = mk(1e9);
    for (let i = 1; i <= 14; i++) await R.resumePendingCapped({ ...m.args, activeBinId: -505 }, { holdPolls: 3, maxPolls: Infinity });
    const s = [...new Set(m.seen.map((x) => x.slippage))];
    assert.equal(s[0], 5); assert.equal(Math.max(...s), 15); assert.ok(s.every((v, i) => i === 0 || v >= s[i - 1]));
  });
  await t('after the hold every retry is re-planned from the current active bin', async () => {
    const m = mk(1e9);
    for (let i = 1; i <= 3; i++) await R.resumePendingCapped({ ...m.args, activeBinId: -505 }, { holdPolls: 3, maxPolls: Infinity });
    await R.resumePendingCapped({ ...m.args, activeBinId: -510 }, { holdPolls: 3, maxPolls: Infinity });
    const a = m.pos.reshapePending.rightMin;
    await R.resumePendingCapped({ ...m.args, activeBinId: -520 }, { holdPolls: 3, maxPolls: Infinity });
    assert.notEqual(m.pos.reshapePending.rightMin, a, 're-planned again when the price moved further');
  });
  await t('fails 7 times, succeeds on the 8th poll -> re-add done, pending cleared', async () => {
    const m = mk(7 * 3);   // resumePending tries 3 sends per poll
    let rs;
    for (let i = 1; i <= 8; i++) { rs = await R.resumePendingCapped({ ...m.args, activeBinId: -505 }, { holdPolls: 3, maxPolls: Infinity }); if (rs.resumed) break; }
    assert.equal(rs.resumed, true); assert.equal(m.pos.reshapePending, null);
  });
  console.log(`PASS ${n} reshape retry tests`);
})().catch((e) => { console.error(e); process.exit(1); });
