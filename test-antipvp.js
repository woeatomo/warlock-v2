'use strict';
const assert = require('assert');
const a = require('./anti-pvp'), rug = require('./antirug');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const pool = (mint, symbol, name, tvl, createdSec, addr) => ({ address: addr || mint + '-pool', tvl, created_at: createdSec, token_x: { address: mint, symbol, name } });
const NX = 'nxPqZ4F7ux8Vph5NFu25rEP6Kx9Gr1U6Fmj36Rjpump', DK = 'DKYcjobF7HPtL9RyQBRdeRQ2iWvizpfbgWwPWNXdpump';
const nxUsdc = pool(NX, 'Dacity', 'Dacity Coin', 50000, 1791717000, 'GJMc-usdc'), nxSol = pool(NX, 'Dacity', 'Dacity Coin', 60000, 1791718000, 'xxxx-sol');
const dk = pool(DK, 'DacityCoin', 'DacityCoin', 40000, 1792069000, '5Dc4-sol');
t('normalize Dacity / DacityCoin / $DACITY / Dacity Coin', () => {
  for (const s of ['Dacity', 'DacityCoin', '$DACITY', 'Dacity Coin', 'DACITY token']) assert.strictEqual(a.normKey(s), 'dacity');
  assert.strictEqual(a.normKey('kai'), 'kai'); assert.strictEqual(a.normKey('Coin'), 'coin'); assert.strictEqual(a.normKey('X'), null);
});
t('Dacity vs DacityCoin are twins (KEEP_BIGGEST keeps the bigger nx, rejects DK)', () => {
  const entries = [nxUsdc, nxSol, dk].map(a.fromPool);
  const rNx = a.evaluate({ self: a.fromPool(nxUsdc), entries, mode: 'KEEP_BIGGEST' });
  assert.strictEqual(rNx.ok, true); assert.strictEqual(rNx.twins.length, 1); assert.strictEqual(rNx.twins[0].mint, DK);
  const rDk = a.evaluate({ self: a.fromPool(dk), entries, mode: 'KEEP_BIGGEST' });
  assert.strictEqual(rDk.ok, false); assert.match(rDk.why, /^anti PvP: kembar dengan nxPq…pump \(Dacity, lebih besar\)/);
});
t('same CA in different pools is NOT a twin', () => {
  for (const mode of ['KEEP_BIGGEST', 'SKIP_ALL']) {
    const r = a.evaluate({ self: a.fromPool(nxSol), entries: [nxUsdc, nxSol].map(a.fromPool), mode });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.twins.length, 0);
  }
});
t('SKIP_ALL rejects every twin, including the oldest', () => {
  const entries = [nxUsdc, dk].map(a.fromPool);
  const r1 = a.evaluate({ self: a.fromPool(nxUsdc), entries, mode: 'SKIP_ALL' }), r2 = a.evaluate({ self: a.fromPool(dk), entries, mode: 'SKIP_ALL' });
  assert.strictEqual(r1.ok, false); assert.strictEqual(r2.ok, false); assert.match(r1.why, /kembar dengan DKYc…pump/);
});
t('OFF never rejects', () => { assert.strictEqual(a.evaluate({ self: a.fromPool(dk), entries: [nxUsdc].map(a.fromPool), mode: 'OFF' }).ok, true); });
t('small-liquidity clones (< minLiq) are ignored; DexScreener pairs counted', () => {
  const clone = a.fromDexPair({ chainId: 'solana', baseToken: { address: 'AZ46clone', symbol: 'DACITY', name: 'Dacity coin' }, liquidity: { usd: 500 }, pairCreatedAt: 1791716854000 });
  assert.strictEqual(a.evaluate({ self: a.fromPool(nxUsdc), entries: [clone], mode: 'SKIP_ALL' }).ok, true);
  const big = a.fromDexPair({ chainId: 'solana', baseToken: { address: 'OLDbig', symbol: '$DACITY', name: 'x' }, liquidity: { usd: 90000 }, pairCreatedAt: 1791000000000 });
  const r = a.evaluate({ self: a.fromPool(nxUsdc), entries: [big], mode: 'KEEP_BIGGEST' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.kept, 'OLDbig');
  assert.strictEqual(a.fromDexPair({ chainId: 'bsc', baseToken: { address: 'b' } }), null);
});
t('tie on liquidity -> older wins; same age and liquidity -> CA order, deterministic', () => {
  const x = pool('AAA', 'TWIN', 'Twin', 20000, 1790000000), y = pool('BBB', 'twin', 'Twin', 90000, 1790000000);
  const e = [x, y].map(a.fromPool);
  assert.strictEqual(a.evaluate({ self: a.fromPool(x), entries: e }).ok, false);
  assert.strictEqual(a.evaluate({ self: a.fromPool(y), entries: e }).ok, true);
});
t('master toggle gates all optional filters, keeps per-filter values', () => {
  const on = a.filterFlags({ FILTERS_ENABLED: true, PUMP1H_FILTER_ENABLED: true, PUMP24H_FILTER_ENABLED: false, RUGCHECK_ENABLED: true, TOP_HOLDERS_ENABLED: true, CHECK_INSIDERS: true, ANTI_PVP_MODE: 'SKIP_ALL' });
  assert.deepStrictEqual(on, { master: true, pump1h: true, pump24h: false, rugcheck: true, topHolders: true, insiders: true, oldDump: true, tvlDrop: true, antiPvp: 'SKIP_ALL' });
  const off = a.filterFlags({ FILTERS_ENABLED: false, PUMP1H_FILTER_ENABLED: true, RUGCHECK_ENABLED: true, CHECK_INSIDERS: true, ANTI_PVP_MODE: 'SKIP_ALL' });
  assert.deepStrictEqual(off, { master: false, pump1h: false, pump24h: false, rugcheck: false, topHolders: false, insiders: false, oldDump: false, tvlDrop: false, antiPvp: 'OFF' });
  assert.strictEqual(a.filterFlags({}, { RUGCHECK: false, CHECK_TOP_HOLDERS: true }).rugcheck, false); // env RUGCHECK=0 still respected
  assert.strictEqual(a.filterFlags({}).antiPvp, 'KEEP_BIGGEST');
});
t('insider evaluation from RugCheck insiderNetworks / topHolders.insider', () => {
  const rep = (cur, extra = {}) => ({ token: { supply: 1000 }, graphInsidersDetected: 50, insiderNetworks: cur.map((c, i) => ({ id: 'n' + i, size: 3, type: 'transfer', tokenAmount: c, currentHolding: c, activeAccounts: 3 })), topHolders: [{ pct: 5, insider: false }], ...extra });
  const bad = rug.evaluateInsiders(rep([69, 57, 41, 95]), { MAX_INSIDER_PCT: 25 });
  assert.strictEqual(bad.ok, false); assert.match(bad.why, /^insider network=26\.2%>25% supply \(4 jaringan, 50 wallet\)/);
  assert.strictEqual(rug.evaluateInsiders(rep([100, 50]), { MAX_INSIDER_PCT: 25 }).ok, true);
  assert.strictEqual(rug.evaluateInsiders(rep([]), { MAX_INSIDER_PCT: 25 }).pct, 0);
  const flagged = rug.evaluateInsiders({ token: { supply: 1000 }, topHolders: [{ pct: 20, insider: true }, { pct: 10, insider: true }] }, { MAX_INSIDER_PCT: 25 });
  assert.strictEqual(flagged.ok, false);
  assert.strictEqual(rug.evaluateInsiders({ error: 'HTTP 429' }).ok, false);
  const unk = rug.evaluateInsiders({ token: { supply: 1000 }, topHolders: [] }); assert.strictEqual(unk.ok, true); assert.strictEqual(unk.unknown, true);
  assert.strictEqual(rug.evaluateInsiders(rep([300])).ok, false); // default 25%
});
t('KEEP_BIGGEST = biggest liquidity wins, NOT the oldest (Max case: 65h/$29k twin vs 11h/$203k real token)', () => {
  const real = a.fromPool(pool('5qaP', 'Max', 'Max', 203000, 1790700000)), twin = a.fromDexPair({ chainId: 'solana', baseToken: { address: 'HPSp', symbol: 'Max', name: 'Max' }, liquidity: { usd: 29000 }, pairCreatedAt: 1790300000000 });
  const r = a.evaluate({ self: real, entries: [twin], mode: 'KEEP_BIGGEST' }); assert.strictEqual(r.ok, true); assert.strictEqual(r.kept, '5qaP');
  const r2 = a.evaluate({ self: twin, entries: [real], mode: 'KEEP_BIGGEST' }); assert.strictEqual(r2.ok, false); assert.match(r2.why, /lebih besar/);
  assert.strictEqual(a.evaluate({ self: real, entries: [twin], mode: 'SKIP_ALL' }).ok, false);   // SKIP_ALL unchanged
});
t('an ancient (1 year) tiny twin does not block the real token; an ancient BIGGER one still does', () => {
  const real = a.fromPool(pool('FZxH', 'PUSSY', 'Pussy', 109000, 1790500000));
  const ancientSmall = a.fromDexPair({ chainId: 'solana', baseToken: { address: '9W8Z', symbol: 'PUSSY', name: 'x' }, liquidity: { usd: 10000 }, pairCreatedAt: 1750000000000 });
  const ancientBig = a.fromDexPair({ chainId: 'solana', baseToken: { address: 'H4Hc', symbol: 'PUSSY', name: 'x' }, liquidity: { usd: 7239000 }, pairCreatedAt: 1750000000000 });
  assert.strictEqual(a.evaluate({ self: real, entries: [ancientSmall], mode: 'KEEP_BIGGEST' }).ok, true);
  assert.strictEqual(a.evaluate({ self: real, entries: [ancientSmall, ancientBig], mode: 'KEEP_BIGGEST' }).ok, false);
});
console.log(`test-antipvp: ${n} passed`);
