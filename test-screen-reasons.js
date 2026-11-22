'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const sr = require('./screen-reasons'), antiPvp = require('./anti-pvp');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const SOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const nowS = 1794410000;
const P = { PAPER: true, MIN_FT: 0.6, FT_WINDOW: '30m', MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, MIN_AGE_H: 0.5, MIN_BIN_STEP: 80, MAX_BIN_STEP: 400, MIN_VOL_1H: 1000,
  VOL_SPIKE_1H_OF_24H: 0.5, SL_BLACKLIST_ENABLED: true, MAX_NONREFUND_SOL: 0.05, MAX_PUMP1H: 1.5, MAX_PUMP_24H: 2, RUGCHECK: true, CHECK_TOP_HOLDERS: true,
  MAX_RUGCHECK_SCORE_NORM: 50, MAX_TOP10_HOLD: 0.3, MAX_DEV_HOLD: 0.1, MAX_INSIDER_PCT: 25, MAX_POSITIONS: 10, ANTI_PVP_MODE: 'SKIP_ALL', ANTI_PVP_MIN_LIQ_USD: 10000 };
const flags = antiPvp.filterFlags(P);
const pool = (o) => ({ address: 'POOL', name: 'X-SOL', tvl: 20000, created_at: (nowS - 48 * 3600) * 1000, pool_config: { bin_step: 100 }, token_y: { address: SOL, symbol: 'SOL' }, token_y_amount: 50,
  token_x: { address: 'MINT', symbol: 'X', name: 'X' }, fees: { '30m': 200 }, fee_tvl_ratio: { '30m': 1 }, volume: { '1h': 5000, '24h': 50000 }, ...o });
const okReport = { mintAuthority: null, freezeAuthority: null, risks: [], score_normalised: 1, token: { supply: 1000 }, insiderNetworks: [], topHolders: [{ address: 'a', owner: 'o', pct: 5 }] };
const fails = (l) => l.filter((x) => x.s === 'fail');
t('clean pool: zero fail reasons', () => {
  const p = pool({});
  assert.strictEqual(sr.evaluate(p, { policy: P, nowS, flags, entryCost: { skipCheck: true }, pu: 0.1, pu24: 0.2, report: okReport, pvp: { ok: true, twins: [] } }).length, 0);
});
t('GTA6-like: bin step + every other failure listed, not just the first', () => {
  const p = pool({ name: 'GTA6-SOL', pool_config: { bin_step: 50 }, tvl: 150000, volume: { '1h': 30000, '24h': 40000 } });
  const l = sr.evaluate(p, { policy: P, nowS, flags, pu: 0.2, pu24: 2.13, report: okReport, pvp: { ok: true, twins: [] } });
  const ks = fails(l).map((x) => x.k);
  assert.deepStrictEqual(ks, ['bin_step', 'tvl_max', 'vol_spike', 'pump24h']);
  assert(l.find((x) => x.k === 'pump24h').t === 'Pump 24 jam: 213.0% > maks 200%');
  assert(l.find((x) => x.k === 'bin_step').t === 'Bin step: 50 di luar 80–400');
  assert(l.some((x) => x.k === 'entry_cost' && x.s === 'unchecked'));
});
t('DacityCoin-like: vol spike + manual block + anti PvP + insider (real RugCheck fixture)', () => {
  const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-rugcheck-dacitycoin.json'), 'utf8'));
  const p = pool({ name: 'DacityCoin-USDC', token_y: { address: USDC, symbol: 'USDC' }, token_x: { address: 'DKYcjobF7HPtL9RyQBRdeRQ2iWvizpfbgWwPWNXdpump', symbol: 'DacityCoin', name: 'DacityCoin' }, volume: { '1h': 71614, '24h': 130934 } });
  const pvp = antiPvp.evaluate({ self: antiPvp.fromPool(p), entries: [antiPvp.fromPool(pool({ token_x: { address: 'nxPqZ4F7ux8Vph5NFu25rEP6Kx9Gr1U6Fmj36Rjpump', symbol: 'Dacity', name: 'Dacity Coin' }, tvl: 60000 }))], mode: 'SKIP_ALL' });
  const l = sr.evaluate(p, { policy: P, nowS, flags, sl: { source: 'manual', reason: 'manual_block_manipulation' }, pu: undefined, pu24: undefined, report: rep, pvp });
  const ks = fails(l).map((x) => x.k);
  for (const k of ['vol_spike', 'sl_blacklist', 'anti_pvp', 'insider']) assert(ks.includes(k), k + ' missing: ' + ks);
  assert.match(l.find((x) => x.k === 'sl_blacklist').t, /^Blacklist: blok manual/);
  assert.match(l.find((x) => x.k === 'anti_pvp').t, /kembar dengan nxPq…pump \(Dacity\)/);
  assert.match(l.find((x) => x.k === 'insider').t, /^Insider\/cluster: \d+\.\d% supply > maks 25%/);
  assert(l.some((x) => x.k === 'pump1h' && x.s === 'unchecked') && l.some((x) => x.k === 'pump24h' && x.s === 'unchecked'));
});
t('unchecked shown instead of hidden; disabled filters not shown', () => {
  const l = sr.evaluate(pool({}), { policy: P, nowS, flags });
  for (const k of ['entry_cost', 'anti_pvp', 'pump1h', 'pump24h', 'rugcheck', 'holders', 'insider']) assert(l.some((x) => x.k === k && x.s === 'unchecked'), k);
  const off = sr.evaluate(pool({}), { policy: { ...P, RUGCHECK: false, CHECK_TOP_HOLDERS: false, FILTERS_ENABLED: false }, nowS, flags: antiPvp.filterFlags({ FILTERS_ENABLED: false }), entryCost: { skipCheck: true } });
  assert.strictEqual(off.length, 0);
});
t('rugcheck: each danger risk + score listed; holders + dev; open CA / slots info', () => {
  const rep = { ...okReport, mintAuthority: 'X', risks: [{ name: 'Single holder ownership', level: 'danger', value: '60%' }, { name: 'Low LP', level: 'danger' }, { name: 'meh', level: 'warn' }], score_normalised: 77,
    creator: 'dev', topHolders: [{ address: 'h1', owner: 'dev', pct: 15 }, { address: 'h2', owner: 'o2', pct: 20 }] };
  const l = sr.evaluate(pool({}), { policy: P, nowS, flags, entryCost: { skipCheck: true }, pu: 0, pu24: 0, report: rep, pvp: { ok: true, twins: [] }, open: { samePool: false, caPoolName: 'X-USDC', count: 10, max: 10 } });
  const t2 = l.map((x) => x.t);
  for (const s of ['RugCheck: mint authority aktif', 'RugCheck risiko danger: Single holder ownership (60%)', 'RugCheck risiko danger: Low LP', 'RugCheck skor: 77 ≥ maks 50', 'Top 10 holder: 35.0% > maks 30%', 'Dev/creator: 15.0% > maks 10%', 'CA sama sudah open: X-USDC', 'Slot penuh: 10/10 posisi']) assert(t2.includes(s), s + ' in ' + t2);
});
t('decision path: only the approved old-dump filter changed; removing it + display-only additions yields the original file', () => {
  const orig = process.env.ORIG_BOT, now = path.join(__dirname, 'bot.js');
  if (!orig) { console.log('   (skip: ORIG_BOT not set)'); return; }
  let s = fs.readFileSync(now, 'utf8');
  const cut = (a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert(i >= 0 && j > i, 'markers ' + a.slice(0, 40)); s = s.slice(0, i) + s.slice(j); };
  s = s.replace("const screenReasons = require('./screen-reasons');\n", '').replace("const tvlDrop = require('./tvl-drop');\n", '');
  cut('const pairCache = new Map();', 'const rugCache = new Map();');
  s = s.replace(/^  const diag = new Map\(\), D = .*\n/m, '').replace(/^\s*D\(p\)\.(pvp|pu|pu24|mint) = (pvp|pu|pu24|m);\n/gm, '');
  // Everything after the picks are final (display rows, open rows, background reasons) is display-only: compare up to there.
  const head = (x) => x.slice(0, x.indexOf('  const passed = new Set(')) + x.slice(x.indexOf('\n  return picks;\n}\n', x.indexOf('  const passed = new Set(')));
  s = s.replace("const entryReasons = require('./entry-reasons');\n", '').replace('let screenDiagBusy = false; const entryPassCache = new Map();\n', '');
  // Intentional, approved decision change (t293u): old-token-dump filter + its CFG keys; entry metric field is record-only.
  cut('    if (ff.oldDump && policy.OLD_TOKEN_MODE !== ', '    const m = await mintOk');
  s = s.replace(/^    if \(ff\.oldDump && policy\.OLD_TOKEN_MODE === 'BLOCK_ALL'\).*\n/m, '');
  s = s.replace(/^    if \(ff\.tvlDrop\) \{ const ev = tvlDrop\.evaluatePool.*\n/m, '');
  s = s.replace('let recentHistory=[],recentEntries=[];if(policy.PAPER){try{const book=JSON.parse(fs.readFileSync(F(\'state.json\'),\'utf8\')).books?.[VARIANTS[0].id]||{};recentHistory=book.history||[];recentEntries=recentHistory.concat(multi.positions(book));}catch{}}',
    'let recentHistory=[];if(policy.PAPER){try{recentHistory=JSON.parse(fs.readFileSync(F(\'state.json\'),\'utf8\')).books?.[VARIANTS[0].id]?.history||[];}catch{}}');
  s = s.replace(' tvlDrop=${ff.tvlDrop}(>=${policy.TVL_DROP_MAX_PCT ?? 45}%)', '');
  s = s.replace(",'OLD_DUMP_FILTER_ENABLED','OLD_TOKEN_MODE','OLD_DUMP_MIN_AGE_H','OLD_DUMP_MAX_PUMP24H','TVL_DROP_FILTER_ENABLED','TVL_DROP_MAX_PCT'])CFG[k]=values[k];", "])CFG[k]=values[k];");
  s = s.replace(", entryInsiderPct: ins ? ins.pct : (report && !report.error ? antirug.evaluateInsiders(report, policy).pct : null) });", " });");
  assert.strictEqual(head(s), head(fs.readFileSync(orig, 'utf8')));
});
t('old token dump: antirug + reasons list (skip only when age > X AND pump24h < Y)', () => {
  const ar = require('./antirug');
  assert.deepStrictEqual(ar.evaluateOldDump(100, -0.5, 400, 0), { ok: true });
  assert.deepStrictEqual(ar.evaluateOldDump(547, 0.05, 400, 0), { ok: true });
  assert.strictEqual(ar.evaluateOldDump(547, -0.42, 400, 0).why, 'token tua lagi dump: umur 547j > 400j & dump 24j -42% < 0%');
  assert(!/pump24/.test(ar.evaluateOldDump(547, -0.42, 400, 0).why), 'must not trip the UI hard-block regex /pump24/');
  assert.strictEqual(ar.evaluateOldDump(547, null, 400, 0).ok, false);
  const P2 = { ...P, OLD_DUMP_FILTER_ENABLED: true, OLD_DUMP_MIN_AGE_H: 400, OLD_DUMP_MAX_PUMP24H: 0 };
  const old = pool({ created_at: (nowS - 547 * 3600) * 1000 });
  const l = sr.evaluate(old, { policy: P2, nowS, flags: antiPvp.filterFlags(P2), entryCost: { skipCheck: true }, pu: 0, pu24: -0.42, report: okReport, pvp: { ok: true, twins: [] } });
  assert.deepStrictEqual(fails(l).map((x) => x.t), ['Token tua lagi dump: umur 547j > 400j & dump 24j -42% < 0%']);
  assert(sr.evaluate(old, { policy: P2, nowS, flags: antiPvp.filterFlags(P2) }).some((x) => x.k === 'old_dump' && x.s === 'unchecked'));
  assert(!sr.evaluate(old, { policy: P2, nowS, flags: antiPvp.filterFlags({ ...P2, OLD_DUMP_FILTER_ENABLED: false }), pu24: -0.42 }).some((x) => x.k === 'old_dump'));
  assert(!sr.evaluate(old, { policy: P2, nowS, flags: antiPvp.filterFlags({ ...P2, FILTERS_ENABLED: false }), pu24: -0.42 }).some((x) => x.k === 'old_dump'), 'master OFF');
});
t('settings: MAX_PUMP1H default 13.5%, old-dump defaults + editable (negative allowed)', () => {
  const ps = require('./paper-settings');
  assert.strictEqual(ps.DEFAULTS.MAX_PUMP1H, 0.135);   // 22 Nov default
  assert.strictEqual(ps.DEFAULTS.OLD_DUMP_FILTER_ENABLED, true); assert.strictEqual(ps.DEFAULTS.OLD_DUMP_MIN_AGE_H, 400); assert.strictEqual(ps.DEFAULTS.OLD_DUMP_MAX_PUMP24H, 0);
  const v = ps.validatePatch({ OLD_DUMP_MIN_AGE_H: 720, OLD_DUMP_MAX_PUMP24H: -20, OLD_DUMP_FILTER_ENABLED: false, MAX_PUMP1H: 1.5 });
  assert(v.ok, JSON.stringify(v.rejected));
});
t('entry metrics recorded in snapshot + CSV (insider, vol1h, vol24h, MC, pump1h, pump24h)', () => {
  const ph = require('./paper-history');
  const c = ph.capture({ ...pool({}), token_x: { address: 'M', market_cap: 1234567 }, volume: { '1h': 5000, '24h': 60000 }, pump1h: -0.12, pump24h: 0.8, entryInsiderPct: 7.5 }, { at: new Date(nowS * 1000).toISOString() });
  const row = ph.csv({ openContext: c });
  assert.deepStrictEqual([row.entry_insider_pct, row.entry_vol_1h_usd, row.entry_vol_24h_usd, row.entry_mc_usd, +row.entry_pump_1h_pct.toFixed(6), +row.entry_pump_24h_pct.toFixed(6)], [7.5, 5000, 60000, 1234567, -12, 80]);
  const keys = Object.keys(ph.csv({}));
  assert.deepStrictEqual(keys.slice(-5), ['entry_insider_pct', 'entry_vol_1h_usd', 'entry_vol_24h_usd', 'entry_pump_1h_pct', 'entry_pump_24h_pct'], 'appended at the end');
  const r2 = ph.csv({ openContext: ph.capture({ ...pool({}) }, { source: 'reposition' }) });
  assert.strictEqual(r2.entry_pump_1h_pct, null); assert.strictEqual(r2.entry_insider_pct, null);
});
t('entry reasons (alasan dibuka): PASS log parse + snapshot first, policy at entry, labelled sources', () => {
  const er = require('./entry-reasons');
  const line = '[2026-11-11 18:12:13 WIB] [PAPER]   PASS BUTTHOLE-SOL EAf6sh ft30m=0.96% tvl=$10322 age=2301.4h bs=80 pump1h=59.5% pump24h=71.5% top10=20.2%';
  const pass = er.findPass('x\n' + line + '\n', 'EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ', 'BUTTHOLE-SOL', '2026-11-11T11:12:33.182Z');
  assert.strictEqual(pass.pump1hPct, 59.5); assert.strictEqual(pass.top10Pct, 20.2);
  assert.strictEqual(er.findPass(line, 'EAf6sh', 'BUTTHOLE-SOL', '2026-11-11T12:12:33Z'), null, 'too old');
  const pos = { openedAt: '2026-11-11T11:12:33.182Z', openContext: { source: 'Auto (bot)', snapshot: { ft30mPct: 0.9598, tvlUsd: 10322, ageH: 2301.4, binStep: 80, marketCapUsd: 596862, passedAllFilters: true,
    entryCostEstimate: { nonrefTotalSol: 0.000075, skipCheck: true }, policy: { MIN_FT: 0.6, MIN_LIQ_USD: 10000, MAX_LIQ_USD: 100000, MIN_AGE_H: 0.5, MIN_BIN_STEP: 80, MAX_BIN_STEP: 400, MAX_PUMP1H: 1.5, MAX_PUMP_24H: 2, MAX_TOP10_HOLD: 0.3 } } } };
  const r = er.build(pos, { policy: { MAX_PUMP1H: 1.0, MAX_INSIDER_PCT: 25 }, pass, latest: { insiderPct: 8 } });
  const t2 = r.list.map((x) => x.s + ' ' + x.t);
  for (const x of ['pass Lolos semua filter saat entry', 'pass Fee/TVL 30m: 0.96% ≥ 0.6% (data entry)', 'pass Bin step: 80 (80–400) (data entry)',
    'pass Harga 1 jam: +59.5% ≤ maks 150% (saat entry) (log PASS 2026-11-11 18:12:13 WIB)', 'pass Top 10 holder: 20.2% ≤ maks 30% (log PASS 2026-11-11 18:12:13 WIB)',
    'pass Insider/cluster: 8.0% ≤ maks 25% (scan terbaru, bukan saat entry)']) assert(t2.includes(x), x + '\n' + t2.join('\n'));
  const r2 = er.build({ openContext: { snapshot: { pump1hPct: -12, insiderPct: 7.5, vol1hUsd: 1000, vol24hUsd: 10000, policy: { MAX_PUMP1H: 1, VOL_SPIKE_1H_OF_24H: 0.5 } } } }, {});
  assert(r2.list.some((x) => x.t === 'Harga 1 jam: dump -12.0% ≤ maks 100% (saat entry) (data entry)'));
  assert(r2.list.some((x) => x.t.startsWith('Volume: 1 jam $1.0k = 10% dari 24 jam $10.0k ≤ maks 50%')));
});
t('old token BLOCK_ALL: any age > max blocks regardless of pump; unknown age blocks; DUMP_ONLY keeps old behavior', () => {
  const ar = require('./antirug');
  assert.strictEqual(ar.evaluateOldToken(17521.4, 400).why, 'token tua: umur 17521j > maks 400j');
  assert.deepStrictEqual(ar.evaluateOldToken(399, 400), { ok: true });
  assert.strictEqual(ar.evaluateOldToken(null, 400).why, 'token tua: umur pool tidak diketahui');
  assert(!/pump24/.test(ar.evaluateOldToken(17521, 400).why));
  const PB = { ...P, OLD_DUMP_FILTER_ENABLED: true, OLD_TOKEN_MODE: 'BLOCK_ALL', OLD_DUMP_MIN_AGE_H: 400, OLD_DUMP_MAX_PUMP24H: 0 }, fl = antiPvp.filterFlags(PB);
  const old = pool({ created_at: (nowS - 17521 * 3600) * 1000 });
  const ctx = { policy: PB, nowS, flags: fl, entryCost: { skipCheck: true }, pu: 0.3, pu24: 0.5, report: okReport, pvp: { ok: true, twins: [] } };
  assert.deepStrictEqual(fails(sr.evaluate(old, ctx)).map((x) => x.t), ['Token tua: umur 17521j > maks 400j'], 'pumping old token still blocked');
  assert.deepStrictEqual(fails(sr.evaluate(old, { ...ctx, pu24: undefined })).map((x) => x.t), ['Token tua: umur 17521j > maks 400j'], 'no pump data needed');
  assert.strictEqual(fails(sr.evaluate(pool({ created_at: (nowS - 300 * 3600) * 1000 }), ctx)).length, 0, 'young ok');
  assert.deepStrictEqual(fails(sr.evaluate(pool({ created_at: undefined }), ctx)).map((x) => x.t), ['Token tua: umur pool tidak diketahui']);
  assert.strictEqual(fails(sr.evaluate(old, { ...ctx, flags: antiPvp.filterFlags({ ...PB, OLD_DUMP_FILTER_ENABLED: false }) })).length, 0, 'toggle off');
  const PD = { ...PB, OLD_TOKEN_MODE: 'DUMP_ONLY' };
  assert.strictEqual(fails(sr.evaluate(old, { ...ctx, policy: PD })).length, 0, 'dump-only: pumping old token passes');
  assert.match(fails(sr.evaluate(old, { ...ctx, policy: PD, pu24: -0.4 }))[0].t, /^Token tua lagi dump/);
  const ps = require('./paper-settings');
  assert.deepStrictEqual(ps.FIELDS.OLD_TOKEN_MODE.options, ['BLOCK_ALL', 'DUMP_ONLY']);
  assert.strictEqual(ps.DEFAULTS.OLD_TOKEN_MODE, 'BLOCK_ALL'); assert.strictEqual(ps.FIELDS.OLD_TOKEN_MODE.default, 'BLOCK_ALL');
  assert(ps.validatePatch({ OLD_TOKEN_MODE: 'BLOCK_ALL' }).ok); assert(!ps.validatePatch({ OLD_TOKEN_MODE: 'X' }).ok);
});
t('TVL drop vs last entry: reason lists actual vs threshold; toggle / master off; no previous = pass', () => {
  const td = require('./tvl-drop');
  const ev = td.evaluate(15646.8516959708, 30194.248517380132, 45);
  assert.strictEqual(ev.ok, false);
  assert.strictEqual(ev.why, 'TVL turun 48.2% sejak entry terakhir ($30.2k → $15.6k) ≥ maks 45%');
  const P2 = { ...P, TVL_DROP_FILTER_ENABLED: true, TVL_DROP_MAX_PCT: 45 };
  const fl = antiPvp.filterFlags(P2);
  assert.strictEqual(fl.tvlDrop, true);
  const ctx = { policy: P2, nowS, flags: fl, entryCost: { skipCheck: true }, pu: 0, pu24: 0, report: okReport, pvp: { ok: true, twins: [] }, prevTvl: 30194.248517380132 };
  const p = pool({ tvl: 15646.8516959708 });
  assert.deepStrictEqual(fails(sr.evaluate(p, ctx)).map((x) => x.t), ['TVL turun 48.2% sejak entry terakhir ($30.2k → $15.6k) ≥ maks 45%']);
  assert.strictEqual(fails(sr.evaluate(p, { ...ctx, prevTvl: null })).length, 0, 'no previous entry');
  assert.strictEqual(fails(sr.evaluate(pool({ tvl: 20000 }), { ...ctx, prevTvl: 30000 })).length, 0, 'drop 33% < 45%');
  assert.strictEqual(fails(sr.evaluate(p, { ...ctx, flags: antiPvp.filterFlags({ ...P2, TVL_DROP_FILTER_ENABLED: false }) })).length, 0, 'toggle off');
  assert.strictEqual(fails(sr.evaluate(p, { ...ctx, flags: antiPvp.filterFlags({ ...P2, FILTERS_ENABLED: false }) })).length, 0, 'master OFF');
  const ps = require('./paper-settings');
  assert.strictEqual(ps.DEFAULTS.TVL_DROP_FILTER_ENABLED, true);
  assert.strictEqual(ps.DEFAULTS.TVL_DROP_MAX_PCT, 45);
  assert(ps.validatePatch({ TVL_DROP_FILTER_ENABLED: false, TVL_DROP_MAX_PCT: 50 }).ok);
  assert(!ps.validatePatch({ TVL_DROP_MAX_PCT: 0 }).ok);
});
console.log(`test-screen-reasons: ${n} passed`);
