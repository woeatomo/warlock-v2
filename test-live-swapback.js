'use strict';
// Live swap back == dry run (paper-usdc.exitQuote): token->USDC direct, SOL pile (wallet SOL minus wallet SOL before open)->USDC, nothing else.
// SWEEP (dust fix): after the position's own tokens are sold, if no other open position shares the mint (canSweepStray),
// any token balance left of that mint is dust from an earlier close and is sold too.
const assert = require('assert'), fs = require('fs'), path = require('path'); const { swapBack, swapBackSol } = require('./live-close-exec');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const rig = o => { const c = []; let sol = o.sol, usdc = o.usdc; const tokenQueue = o.tokenSeq ? [...o.tokenSeq] : null; const f = { c, pos: { walletBefore: o.before },
  getUsdcBalance: async () => usdc, getSolBalance: async () => sol,
  getToken: async () => {
    if (tokenQueue && tokenQueue.length) { const t = tokenQueue.shift(); return { raw: t.raw, total: t.total != null ? t.total : t.raw, decimals: 6, accounts: [1] }; }
    const raw = o.token ?? 0n; return { raw, total: o.total != null ? o.total : raw, decimals: 6, accounts: [1] };
  },
  swapTokenToUsdc: async (raw, d) => { c.push(['token', raw]); if (o.tokFail) { return { ok: false, error: 'no route' }; } usdc += o.tokUsdc; return { ok: true }; },
  swapTokenToSol: async (raw, d) => { c.push(['token', raw]); if (o.tokFail) { return { ok: false, error: 'no route' }; } sol += o.tokSol ?? 0; return { ok: true }; },
  swapSolToUsdc: async raw => { c.push(['sol', raw]); const ui = Number(raw) / 1e9; sol -= ui; usdc += ui * 150; return { ok: true }; },
  closeTokenAccounts: async () => { c.push(['ata']); }, sleep: async () => {}, log: () => {},
  canSweepStray: o.canSweepStray != null ? o.canSweepStray : null }; return f; };
(async () => {
  await t('order: token->USDC direct, close token account, then SOL pile->USDC (no SOL hop for the token)', async () => { const f = rig({ sol: 0.3, before: 0.1, usdc: 10, token: 1000000n, tokUsdc: 200 }); const r = await swapBack(f);
    assert.deepEqual(f.c.map(x => x[0]), ['token', 'ata', 'sol']); assert.equal(r.complete, true); assert.ok(Math.abs(r.usdcOut - (200 + 0.2 * 150)) < 1e-6); });
  await t('only the position pile is sold: wallet SOL before the position is kept (no fixed reserve)', async () => { const f = rig({ sol: 0.3, before: 0.1, usdc: 0, token: 0n }); await swapBack(f); assert.equal(f.c.length, 1); assert.equal(f.c[0][1], 200000000n); });
  await t('no token left: skip the token swap, still sell the pile', async () => { const f = rig({ sol: 0.5, before: 0.1, usdc: 0, token: 0n }); await swapBack(f); assert.deepEqual(f.c.map(x => x[0]), ['sol']); });
  await t('pile smaller than dust is not swapped; pile below zero (fees > leftover) sells nothing', async () => { const f = rig({ sol: 0.1002, before: 0.1, usdc: 0 }); await swapBack(f); assert.equal(f.c.length, 0); const g = rig({ sol: 0.09, before: 0.1, usdc: 0 }); await swapBack(g); assert.equal(g.c.length, 0); });
  await t('token swap keeps failing: retried 3x, reported incomplete, pile still sold, nothing thrown', async () => { const f = rig({ sol: 0.3, before: 0.1, usdc: 0, token: 5n, tokFail: true }); const r = await swapBack(f); assert.equal(f.c.filter(x => x[0] === 'token').length, 3); assert.equal(r.complete, false); assert.ok(f.c.some(x => x[0] === 'sol')); assert.equal(r.errors.length, 3); });
  await t('liveClose uses it: no LIVE_SOL_RESERVE, no SOL hop for the token; history row carries the same fields as paperClose', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); const a = src.indexOf('async function liveClose'); const body = src.slice(a, src.indexOf('// ---------- status', a));
    assert.ok(/liveCloseExec\.swapBack\(/.test(body)); assert.ok(!/liveSwapAllToSol\(|LIVE_SOL_RESERVE/.test(body));
    for (const k of ['usdcIn', 'usdcOut', 'legUsdcOut', 'pnlUsd', 'pnlPct', 'netPnlUsd', 'netPnlPct', 'pnlCapital']) assert.ok(body.includes(k + ':') || body.includes(k + ','), k); });
  // SWEEP tests
  await t('sweep (swapBackSol): stray dust left after the position tokens are sold is swapped to SOL too', async () => {
    const f = rig({ sol: 1.0, tokenSeq: [{ raw: 1000n, total: 1500n }, { raw: 500n, total: 500n }], canSweepStray: async () => true });
    const r = await swapBackSol(f);
    assert.deepEqual(f.c.filter(x => x[0] === 'token').map(x => x[1]), [1000n, 500n]);
    assert.equal(r.tokenSwapped, 1000); assert.equal(r.straySwapped, 500); assert.equal(r.complete, true); });
  await t('sweep blocked: another open position shares the mint, stray is NOT sold', async () => {
    const f = rig({ sol: 1.0, tokenSeq: [{ raw: 1000n, total: 1500n }, { raw: 500n, total: 500n }], canSweepStray: async () => false });
    const r = await swapBackSol(f);
    assert.deepEqual(f.c.filter(x => x[0] === 'token').map(x => x[1]), [1000n]);
    assert.equal(r.tokenSwapped, 1000); assert.equal(r.straySwapped, 0); assert.equal(r.complete, true); });
  await t('sweep: no stray left after the main swap, nothing extra is swapped', async () => {
    const f = rig({ sol: 1.0, tokenSeq: [{ raw: 1000n, total: 1000n }, { raw: 0n, total: 0n }], canSweepStray: async () => true });
    const r = await swapBackSol(f);
    assert.deepEqual(f.c.filter(x => x[0] === 'token').map(x => x[1]), [1000n]);
    assert.equal(r.straySwapped, 0); assert.equal(r.complete, true); });
  await t('sweep (swapBack USDC): stray dust is swapped to USDC too', async () => {
    const f = rig({ sol: 0.3, before: 0.1, usdc: 0, tokenSeq: [{ raw: 1000n, total: 1500n }, { raw: 500n, total: 500n }], tokUsdc: 10, canSweepStray: async () => true });
    const r = await swapBack(f);
    assert.deepEqual(f.c.filter(x => x[0] === 'token').map(x => x[1]), [1000n, 500n]);
    assert.equal(r.tokenSwapped, 1000); assert.equal(r.straySwapped, 500); assert.equal(r.complete, true); });
  await t('sweep does NOT run when the main token swap fails (pendingSell owns the retry)', async () => {
    const f = rig({ sol: 1.0, tokenSeq: [{ raw: 1000n, total: 1500n }, { raw: 500n, total: 500n }], tokFail: true, canSweepStray: async () => true });
    const r = await swapBackSol(f);
    assert.equal(f.c.filter(x => x[0] === 'token').length, 3); assert.equal(r.straySwapped, 0); assert.equal(r.complete, false); });
  await t('sweep: no canSweepStray passed, behaviour is exactly the old one (no extra swap)', async () => {
    const f = rig({ sol: 1.0, tokenSeq: [{ raw: 1000n, total: 1500n }, { raw: 500n, total: 500n }] });
    const r = await swapBackSol(f);
    assert.deepEqual(f.c.filter(x => x[0] === 'token').map(x => x[1]), [1000n]);
    assert.equal(r.straySwapped, 0); assert.equal(r.complete, true); });
  await t('bot.js wires canSweepStray into both liveClose (USDC) and liveCloseSol (SOL)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const hits = (src.match(/canSweepStray: async \(\) => !\(livePositions\.list\(state\) \|\| \[\]\)\.some\(x => x\.mintX === pos\.mintX && String\(x\.position\) !== String\(pos\.position\)\)/g) || []).length;
    assert.equal(hits, 2); });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
