'use strict';
// Jupiter quote capacity: one optional JUPITER_API_KEY for dry run AND live, fewer quote calls, a fallback valuation calibrated on the last real quote. Offline (fake fetch).
const assert = require('assert'), fs = require('fs'), path = require('path');
const jup = require('./jupiter-config'), QC = require('./paper-quote-client'), U = require('./paper-usdc');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const KEY = 'TESTKEY-' + 'x'.repeat(24);
const resp = (status, json = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => json });
const okQuote = { inAmount: '1000000', outAmount: '2000000', inputMint: 'A', outputMint: 'B', priceImpactPct: '0.1' };
(async () => {
  await t('no key: nothing is rewritten, no header; a placeholder value counts as no key', () => { delete process.env.JUPITER_API_KEY; jup._reset(); assert.equal(jup.key(), ''); assert.equal(jup.rewrite('https://lite-api.jup.ag/swap/v1/quote?x=1'), 'https://lite-api.jup.ag/swap/v1/quote?x=1'); assert.deepEqual(jup.withKey({ a: 1 }), { a: 1 }); process.env.JUPITER_API_KEY = 'isi_dengan_key'; assert.equal(jup.key(), ''); });
  await t('with key: lite-api URLs go to api.jup.ag with x-api-key; other hosts untouched; describe() never contains the key', () => { process.env.JUPITER_API_KEY = KEY; jup._reset(); assert.equal(jup.rewrite('https://lite-api.jup.ag/swap/v1/swap'), 'https://api.jup.ag/swap/v1/swap'); assert.equal(jup.rewrite('https://api.dexscreener.com/x'), 'https://api.dexscreener.com/x'); assert.equal(jup.withKey({ headers: { a: '1' } }).headers['x-api-key'], KEY); assert.ok(!jup.describe().includes(KEY)); });
  await t('wrap(getJSON): live swap/quote calls use the key; a 401 falls back to the keyless host ONCE and stops using the key', async () => {
    process.env.JUPITER_API_KEY = KEY; jup._reset(); const calls = []; const logs = [];
    const g = jup.wrap(async (url, opt) => { calls.push([url, opt && opt.headers && opt.headers['x-api-key'] ? 'key' : 'nokey']); if (url.startsWith('https://api.jup.ag') && calls.length === 1) throw new Error('401 https://api.jup.ag/..'); return { ok: 1 }; }, m => logs.push(m));
    assert.deepEqual(await g('https://lite-api.jup.ag/swap/v1/quote?a=1', {}, 1), { ok: 1 }); assert.deepEqual(calls.map(c => c[0].split('/')[2] + ':' + c[1]), ['api.jup.ag:key', 'lite-api.jup.ag:nokey']); assert.equal(jup.key(), ''); assert.equal(logs.length, 1); assert.ok(!logs[0].includes(KEY));
    await g('https://lite-api.jup.ag/swap/v1/quote?a=2', {}, 1); assert.equal(calls[2][0].split('/')[2], 'lite-api.jup.ag');
  });
  await t('paper quote client: with key -> api.jup.ag + x-api-key; without -> lite-api; 401/403 -> onKeyRejected + retry keyless; 429 backoff unchanged', async () => {
    const seen = []; let reject = 0; let keyOn = KEY;
    const mk = h => QC.create({ fetch: async (url, o) => { seen.push([url.split('/')[2], !!(o && o.headers && o.headers['x-api-key'])]); return h(url); }, minGapMs: 0, cacheMs: 0, wait: async () => {}, apiKey: () => keyOn, onKeyRejected: () => { reject++; keyOn = ''; } });
    let c = mk(() => resp(200, okQuote)); const r = await c.quote('A', 'B', 1000000n, 6, 6, 300); assert.equal(r.ok, true); assert.deepEqual(seen[0], ['api.jup.ag', true]);
    keyOn = ''; seen.length = 0; await mk(() => resp(200, okQuote)).quote('A', 'B', 1000001n, 6, 6, 300); assert.deepEqual(seen[0], ['lite-api.jup.ag', false]);
    keyOn = KEY; seen.length = 0; c = mk(u => u.startsWith('https://api.jup.ag') ? resp(401) : resp(200, okQuote)); const r2 = await c.quote('A', 'B', 1000002n, 6, 6, 300); assert.equal(r2.ok, true); assert.equal(reject, 1); assert.deepEqual(seen.map(s => s.join(':')), ['api.jup.ag:true', 'lite-api.jup.ag:false']);
    keyOn = ''; c = mk(() => resp(429)); const r3 = await c.quote('A', 'B', 1000003n, 6, 6, 300); assert.equal(r3.ok, false); assert.match(r3.error, /429/); assert.ok(c.status().blockedUntil > 0);
  });
  const base = { capitalAsset: 'USDC', quoteMint: 'So11111111111111111111111111111111111111112', usdcIn: 500, initialUsdcIn: 500, mintX: 'MINTX', decX: 6, bins: { a: { x: 1000, y: 0 } }, feeX: 0, feeY: 0, rentRefundableSol: 0.006, baseFeePct: 2 };   // y=0: the SOL pile is only the leftover buffer (no SOL quote side)
  const px = 100, snap = { price: 0.01, pxUsd: px };
  await t('tiny SOL pile (< $30) is NOT sent to Jupiter; a real pile still is; the position stays "quoted" when only the token is quoted', async () => {
    const calls = []; const quote = async (m, o, raw) => (calls.push(m), { ok: true, outUi: m === 'MINTX' ? 9.5 : Number(raw) / 1e9 * px });
    const small = await U.exitQuote({ pos: { ...base }, book: { virtual: { sol: 0.2 } }, snap, quote, txFee: 0.000025 }); assert.deepEqual(calls, ['MINTX']); assert.equal(small.quoted, true); assert.equal(small.solPileEstimated, true);
    calls.length = 0; const big = await U.exitQuote({ pos: { ...base }, book: { virtual: { sol: 2 } }, snap, quote, txFee: 0.000025 }); assert.deepEqual(calls.sort(), ['MINTX', 'So11111111111111111111111111111111111111112'].sort()); assert.equal(big.solPileEstimated, false);
  });
  await t('fallback is calibrated on the last real quote (recent only); otherwise the generic pool-fee guess', async () => {
    const good = async (m) => ({ ok: true, outUi: 9.0 }), none = async () => ({ ok: false, error: '429' });   // token mark = 1000 * 0.01 * 100 = 1000 -> out 9.0?? mark is 1000, so haircut ~99%: use realistic numbers below
    const pos = { ...base, bins: { a: { x: 1000, y: 0 } } }, mark = 1000 * 0.01 * 1;   // USDC quote unit = SOL price: token*price*(1/px)... computed by the module; only ratios matter here
    const real = await U.exitQuote({ pos: { ...pos }, book: { virtual: { sol: 0 } }, snap, quote: async () => ({ ok: true, outUi: 0 }), txFee: 0.000025 });
    // build a consistent scenario: quote returns 97% of the mark -> haircut 3%
    const markUsd = real.positionValueUsd;
    const q97 = async () => ({ ok: true, outUi: markUsd * 0.97 }); const a = await U.exitQuote({ pos: { ...pos }, book: { virtual: { sol: 0 } }, snap, quote: q97, txFee: 0.000025 });
    assert.ok(a.quoted && Math.abs(a.tokenHaircut - 0.03) < 1e-6, 'haircut ' + a.tokenHaircut);
    const calibrated = await U.exitQuote({ pos: { ...pos, lastTokenHaircut: a.tokenHaircut, lastQuoteAt: Date.now() - 60000 }, book: { virtual: { sol: 0 } }, snap, quote: none, txFee: 0.000025 });
    assert.equal(calibrated.quoted, false); assert.ok(Math.abs(calibrated.tokenFallbackRate - 0.03) < 1e-6, 'uses 3% not the generic 2% pool fee guess... rate=' + calibrated.tokenFallbackRate);
    const stale = await U.exitQuote({ pos: { ...pos, lastTokenHaircut: 0.03, lastQuoteAt: Date.now() - 31 * 60000 }, book: { virtual: { sol: 0 } }, snap, quote: none, txFee: 0.000025 }); assert.ok(Math.abs(stale.tokenFallbackRate - 0.02) < 1e-6, 'stale calibration is ignored');
    const floor = await U.exitQuote({ pos: { ...pos, lastTokenHaircut: 0, lastQuoteAt: Date.now() }, book: { virtual: { sol: 0 } }, snap, quote: none, txFee: 0.000025 }); assert.ok(floor.tokenFallbackRate >= 0.02 * 0.25 - 1e-9, 'never below a quarter of the generic guess');
  });
  await t('wiring: dry run AND live use the same JUPITER_API_KEY; poll scheduling asks Jupiter at most every 30s unless near an exit threshold; calibration data stored', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    assert.ok(/apiKey:\(\)=>jup\.key\(\)/.test(src) && /getJSON:jupGetJSON/.test(src)); assert.equal((src.match(/await jupGetJSON\('https:\/\/lite-api\.jup\.ag\/swap\/v1\/swap'/g) || []).length, 2);
    assert.ok(/entryWaiting\|\|\(pos\.lastQuoteAt&&Date\.now\(\)-pos\.lastQuoteAt<QUOTE_REFRESH_MS\)/.test(src)); assert.ok(/pos\.lastTokenHaircut=val\.tokenHaircut/.test(src));
    assert.ok(/pos\.lastTokenHaircut = val\.tokenHaircut/.test(fs.readFileSync(path.join(__dirname, 'live-exit.js'), 'utf8')));
    assert.ok(/API_KEY/.test(fs.readFileSync(path.join(__dirname, 'env-config.js'), 'utf8')), 'redact() masks *API_KEY variables');
  });
  delete process.env.JUPITER_API_KEY;
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
