'use strict';
// Sticky RugCheck: a token flagged danger/rugged/high score stays blocked even if RugCheck later answers clean (Huang case). Offline, temp dirs only.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const RS = require('./rug-sticky'); const antirug = require('./antirug'); const S = require('./paper-settings');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rugs-'));
const bad = { rugged: false, score_normalised: 80, risks: [{ level: 'danger', name: 'Creator history of rugged tokens' }], tokenMeta: {}, mintAuthority: null, freezeAuthority: null };
const clean = { rugged: false, score_normalised: 1, risks: [], mintAuthority: null, freezeAuthority: null };
const evalFn = r => antirug.evaluateRugCheck(r, {});
const MINT = 'MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
(async () => {
  await t('evaluator facts the sticky rule relies on: danger -> blocked; clean -> ok', () => { assert.equal(evalFn(bad).ok, false); assert.ok(RS.STICKY_REASON.test(evalFn(bad).why)); assert.equal(evalFn(clean).ok, true); });
  await t('Huang sequence: danger, then a CLEAN report -> still blocked (without sticky it would pass)', async () => {
    const d = dir(); let calls = 0; const seq = [bad, clean, clean]; const fetch = async () => seq[calls++];
    const r1 = await RS.check({ dir: d, mint: MINT, days: 7, symbol: 'Huang', pool: 'P', fetch, evaluate: evalFn }); assert.equal(r1.ok, false); assert.equal(r1.sticky, false);
    const r2 = await RS.check({ dir: d, mint: MINT, days: 7, symbol: 'Huang', pool: 'P', fetch, evaluate: evalFn }); assert.equal(r2.ok, false); assert.equal(r2.sticky, true); assert.match(r2.why, /^rugcheck sticky:/);
    assert.equal(calls, 1, 'sticky must not call the API again');
    assert.equal((await RS.check({ dir: d, mint: MINT, days: 0, symbol: 'Huang', pool: 'P', fetch, evaluate: evalFn })).ok, true, 'days=0 turns it off (control)');
  });
  await t('window: blocked inside N days, free again after, re-flagging refreshes the window', async () => {
    const d = dir(), t0 = Date.parse('2026-11-13T00:00:00Z'); RS.add(d, { mint: MINT, reason: 'rugcheck danger: x' }, t0);
    assert.ok(RS.get(d, MINT, 7, t0 + 6 * 86400000)); assert.equal(RS.get(d, MINT, 7, t0 + 7 * 86400000 + 1), null);
    const fetch = async () => bad; const r = await RS.check({ dir: d, mint: MINT, days: 7, fetch, evaluate: evalFn, now: t0 + 8 * 86400000 }); assert.equal(r.ok, false); assert.ok(RS.get(d, MINT, 7, t0 + 8 * 86400000 + 1000), 'a fresh bad verdict starts a new window');
    assert.equal(RS.read(d).mints[MINT].firstFlaggedAt, new Date(t0).toISOString());
  });
  await t('transient problems and authority flags are NOT sticky (API error / missing report / mint authority)', async () => {
    const d = dir();
    for (const rep of [{ error: 'timeout' }, null, { rugged: false, score_normalised: 1, risks: [], mintAuthority: 'AUTH', freezeAuthority: null }]) { const r = await RS.check({ dir: d, mint: MINT, days: 7, fetch: async () => rep, evaluate: evalFn }); assert.equal(r.ok, false); }
    assert.equal(RS.get(d, MINT, 7), null); assert.deepEqual(RS.list(d), []);
  });
  await t('high score alone and rugged=true are sticky; persistence survives a reload; remove() unblocks', async () => {
    const d = dir(); const hi = { rugged: false, score_normalised: 70, risks: [], mintAuthority: null, freezeAuthority: null };
    await RS.check({ dir: d, mint: 'A'.repeat(44), days: 7, fetch: async () => hi, evaluate: evalFn }); await RS.check({ dir: d, mint: 'B'.repeat(44), days: 7, fetch: async () => ({ ...clean, rugged: true }), evaluate: evalFn });
    assert.equal(RS.list(d).length, 2); delete require.cache[require.resolve('./rug-sticky')]; const RS2 = require('./rug-sticky'); assert.ok(RS2.get(d, 'A'.repeat(44), 7));
    assert.equal(RS2.remove(d, 'A'.repeat(44)), true); assert.equal(RS2.get(d, 'A'.repeat(44), 7), null);
  });
  await t('setting: RUGCHECK_STICKY_DAYS default 7, integer 0..365, restored by Reset', () => { assert.equal(S.DEFAULTS.RUGCHECK_STICKY_DAYS, 7); const f = S.FIELDS.RUGCHECK_STICKY_DAYS; assert.equal(f.default, 7); assert.equal(f.min, 0); assert.equal(f.max, 365);
    const d = dir(); const a = S.applySettings(d, { RUGCHECK_STICKY_DAYS: 0 }, { updatedBy: 't' }); assert.ok(a.ok); assert.equal(S.resetSettings(d, { updatedBy: 't' }).values.RUGCHECK_STICKY_DAYS, 7); assert.equal(S.applySettings(d, { RUGCHECK_STICKY_DAYS: 400 }, { updatedBy: 't' }).ok, false); });
  await t('wiring: the open decision uses rugSticky.check (shared dry run / live screening); the reasons panel shows the sticky block', () => {
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); assert.ok(/rugSticky\.check\(\{ dir: PAPER_DIR, mint: p\.token_x\.address, days: policy\.RUGCHECK_STICKY_DAYS \?\? 7/.test(src)); assert.ok(!/report = await fetchRugCheck\(p\.token_x\.address\);\n      const rc = antirug/.test(src));
    assert.ok(/rugSticky:mint&&policy\.RUGCHECK/.test(src)); assert.ok(/rugScore=/.test(src)); assert.ok(/ctx\.rugSticky && P\.RUGCHECK/.test(fs.readFileSync(path.join(__dirname, 'screen-reasons.js'), 'utf8')));
    const sr = require('./screen-reasons'); assert.equal(typeof sr.evaluate, 'function');
  });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
