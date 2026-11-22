'use strict';
// Live reposition -> Telegram: reposition card (tries, ranges, MC), failed-reopen alert, reshape silent (operator t238u), 21:00 summary SOL + BE. Mock transports only.
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = require('./live-reposition-exec'), F = require('./tg-format'), T = require('./telegram-notify');
const sent = []; T.setMessageTransport((text, opts) => { sent.push({ text, opts }); return { ok: true }; }); T.setPhotoTransport((caption, png, opts) => { sent.push({ caption, png, opts }); return { ok: true }; }); T.setAutoCard(false);
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
const old = () => ({ name: 'FIONA-SOL', pool: 'DQpF5ixcj1nCs8moBT4RgLDz9dJKjsA2ssBr3FYxGNCr', mintX: 'B34nXKzCgsJb9ChLuSHPRpXLE3WFSWyeT8Cqkzzmpump', binStep: 80, capitalAsset: 'SOL', capitalInSol: 1, usdcIn: 72.06, minBinId: -507, maxBinId: -421, entryPrice: 3.4923e-5, entryActiveBin: -421, openedAt: new Date().toISOString() });
async function run(openResults) {
  const state = { position: old(), history: [] }, calls = []; let i = 0;
  const deps = { log: () => {}, fetchPool: async () => ({}), sanityReason: () => null, closeLeg: async () => ({ solOut: 0.99957, usdcOut: 72.06, row: { name: 'FIONA-SOL', closedAt: new Date().toISOString() } }),
    openNew: async () => { const r = openResults[i++]; if (r === 'ok') { state.position = { minBinId: -501, maxBinId: -415, entryActiveBin: -415, entryPrice: 3.6e-5, nBins: 87 }; return { ok: true }; } return { skipped: r }; },
    reasonText: 'OOR kanan', notify: (kind, e) => calls.push({ kind, e }) };
  const rr = await R.reposition({ state, val: { usdcOut: 72.06, pnlPct: -0.04 }, settings: { MIN_LIQ_USD: 1 }, pxUsd: 72.09, deps });
  await new Promise((r) => setTimeout(r, 20)); return { rr, calls };
}
(async () => {
  const err = 'deposit failed: active bin -415 moved above the range -502..-416';
  let { rr, calls } = await run([err, 'ok']);
  assert.ok(rr.reopened && calls.length === 1 && calls[0].kind === 'reposition'); const e = calls[0].e;
  assert.deepStrictEqual(e.tries, [err, 'ok']); assert.ok(e.oldMinBinId === -507 && e.minBinId === -501 && e.maxBinId === -415 && Math.abs(e.pnlCapital + 0.00043) < 1e-9 && e.capitalAsset === 'SOL');
  ok('reposition notifies once, with both reopen attempts, old + new range, SOL leg result');
  ({ rr, calls } = await run([err, err]));
  assert.ok(!rr.reopened && calls.length === 1 && calls[0].kind === 'reopen_failed' && calls[0].e.tries.length === 2 && Math.abs(calls[0].e.proceedsSol - 0.99957) < 1e-9);
  ok('failed reopen (after the retry) -> reopen_failed alert with the SOL back in the wallet');
  ({ calls } = await run(['some other error']));
  assert.ok(calls.length === 1 && calls[0].kind === 'reopen_failed' && calls[0].e.tries.length === 1); ok('non-retryable refusal: one attempt, alert');
  // texts
  const ctx = { ...calls[0].e, supply: 984154705, refPrice: 3.4923e-5, refBin: -421, solUsd: 72.09 };
  const h = F.repositionHtml({ ...ctx, tries: [err, 'ok'], minBinId: -501, maxBinId: -415, activeBin: -415 });
  assert.ok(/REPOSITION #1\/2 · FIONA\/SOL/.test(h) && /MC \$1\.25M – \$2\.48M/.test(h) && /percobaan 2/.test(h) && /−0\.000430 SOL/.test(h), h);
  const fh = F.repositionFailedHtml(ctx); assert.ok(/REOPEN GAGAL/.test(fh) && /0\.9996 SOL<\/b> kembali di wallet/.test(fh), fh);
  ok('reposition text: MC range from supply + bin price, retry outcome; alert says the SOL is in the wallet');
  sent.length = 0; await T.notifyRepositionFailed({ ...ctx, paper: false }); await T.notifyReposition({ ...ctx, tries: ['ok'], minBinId: -502, maxBinId: -416, paper: false });
  assert.ok(sent.length === 2 && sent.every((m) => m.opts.parse_mode === 'HTML') && /REOPEN GAGAL/.test(sent[0].text || sent[0].caption)); ok('notifyReposition / notifyRepositionFailed send HTML');
  // reshape silent (operator t238u): no message, no card, live or dry run
  sent.length = 0; const rs = await T.notifyReshape({ name: 'DCTY-SOL', pool: 'x', reshapes: 3, bins: { 1: { x: 1, y: 1 } } }); await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.length === 0 && rs.skipped); assert.ok(!/telegram|notify/i.test(fs.readFileSync(path.join(__dirname, 'live-reshape-exec.js'), 'utf8')));
  const bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'), blk = bot.slice(bot.indexOf('// Reshape / compound: same trigger'), bot.indexOf('// Reshape / compound: same trigger') + 6000);
  assert.ok(blk.length > 1000 && !/telegram\./.test(blk)); ok('reshape is silent: notifyReshape sends nothing, the live reshape path never calls telegram');
  // 21:00 summary: SOL first + W/L/BE
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8'));
  const agg = require('./pnl-period').aggregate(fx, 'day', 0, { solUsd: 72.09, now: Date.parse('2026-11-20T11:00:00Z') });
  const sh = F.dailySummaryHtml({ todayAgg: agg, capitalAsset: 'SOL', equitySol: 10.09, equityUsd: 727.6, freeCapitalSol: 10.09, openCount: 0, maxPositions: 7 });
  assert.ok(/<b>\+0\.005226 SOL<\/b>/.test(sh) && /1W · 0L · 1 BE/.test(sh) && /win rate 100%/.test(sh) && /Equity <b>10\.0900 SOL/.test(sh), sh); ok('21:00 summary: SOL first, W · L · BE, win rate without BE');
  console.log(`test-tg-reposition-notify: ${n} OK`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
