'use strict';
// Guard for the rule "live and dry run share ONE setting set": fails when a NEW live-only knob or live-only behaviour appears.
const assert = require('assert');
const P = require('./parity-check');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const a = P.analyse(), c = P.compare(a);
t('no NEW live-only strategy knob or behaviour (known debt list is the ceiling)', () => assert.deepStrictEqual(c.added, [], 'NEW live/dry-run divergence: ' + c.added.join(', ')));
t('known debt list has no stale entries (fixed items must be removed from KNOWN_DEBT)', () => assert.deepStrictEqual(c.resolved, [], 'resolved, remove from KNOWN_DEBT: ' + c.resolved.join(', ')));
t('legacy TP used by live is derived from TP_USD_PCT', () => { const S = require('./paper-settings'); const r = S.resetSettings(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'par-')), { updatedBy: 't' }); assert.equal(r.values.TP, +(r.values.TP_USD_PCT / 100).toFixed(6)); });
t('the shared settings overwrite the strategy keys the live path decides with', () => { for (const k of ['TP', 'TP_USD_PCT', 'EMERGENCY_DROP', 'MAX_HOURS', 'MIN_FT', 'MIN_AGE_H', 'MIN_LIQ_USD', 'MAX_PUMP_24H', 'OOR_RIGHT_CLOSE', 'TRAIL_ENABLED', 'MAX_POSITIONS']) assert.ok(a.shared.includes(k), k + ' is not overwritten from the shared settings'); assert.ok(a.sharedCount >= 60, 'shared settings overwrite ' + a.sharedCount + ' CFG keys'); });
t('the guard really fails: a NEW live-only knob and a removed shared exit decision are both detected', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'par-neg-'));
  for (const f of fs.readdirSync(__dirname)) if (/^paper-.*\.js$/.test(f)) fs.copyFileSync(path.join(__dirname, f), path.join(d, f));
  let src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  // inject a live-only strategy knob into the live path
  const i = src.indexOf('async function liveCycle');
  src = src.slice(0, i) + 'const __probe = () => CFG.SOME_LIVE_ONLY_STRATEGY_KNOB;\n' + src.slice(i);
  fs.writeFileSync(path.join(d, 'bot.js'), src);
  const bad = P.compare(P.analyse(d));
  assert.ok(bad.added.includes('key:SOME_LIVE_ONLY_STRATEGY_KNOB'), 'injected live-only knob was not detected: ' + JSON.stringify(bad));
  // removing the shared exit decision from liveCycle must be detected as a NEW divergence
  const src2 = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8').replaceAll('liveExit.decideLiveExit(', 'noop.decideLiveExit(');
  fs.writeFileSync(path.join(d, 'bot.js'), src2);
  assert.ok(P.compare(P.analyse(d)).added.includes('logic:live-exit-is-not-paper-exit-policy'), 'removed shared exit decision was not detected');
});
t('former env-only keys are now shared settings with defaults and are restored by Reset', () => {
  const S = require('./paper-settings'), fs = require('fs'), os = require('os'), path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'par-set-'));
  const a2 = S.applySettings(d, { FT_WINDOW: '1h', MAX_TOP10_HOLD: 0.5, MAX_DEV_HOLD: 0.2, USDC_BUFFER: 5 }, { updatedBy: 't' }); assert.ok(a2.ok, JSON.stringify(a2));
  assert.equal(a2.values.FT_WINDOW, '1h'); assert.equal(a2.values.USDC_BUFFER, 5);
  const r = S.resetSettings(d, { updatedBy: 't' }).values;
  assert.equal(r.FT_WINDOW, '30m'); assert.equal(r.MAX_TOP10_HOLD, 0.30); assert.equal(r.MAX_DEV_HOLD, 0.10); assert.equal(r.USDC_BUFFER, 0.10);
  for (const bad of [{ FT_WINDOW: '3d' }, { MAX_TOP10_HOLD: 5 }, { MAX_DEV_HOLD: 0 }, { USDC_BUFFER: -1 }]) { const v = S.validatePatch(bad, r); assert.ok(!v.ok || (v.rejected && v.rejected.length), JSON.stringify(bad)); }
});
t('bot.js binds every former env-only key to the shared settings (applyPaperSettings)', () => {
  const src = require('fs').readFileSync(__dirname + '/bot.js', 'utf8'); const fn = src.slice(src.indexOf('function applyPaperSettings'), src.indexOf('return values;', src.indexOf('function applyPaperSettings')));
  for (const k of ['FT_WINDOW', 'MAX_TOP10_HOLD', 'MAX_DEV_HOLD', 'USDC_BUFFER', 'RESHAPE', 'RESERVE_SOL', 'POSITION_USD', 'POSITION_SOL']) assert.ok(new RegExp('CFG\\.' + k + '\\s*=').test(fn), k + ' is not bound to the shared settings');
});
t('live position size is budgeted by the shared POSITION_USDC, like dry run', () => {
  const src = require('fs').readFileSync(__dirname + '/bot.js', 'utf8'); const lo = src.indexOf('async function liveOpen'); const body = src.slice(lo, src.indexOf('async function ', lo + 10));
  assert.ok(/Math\.min\(usdcBal,\s*opts\.positionBudgetUsdc\s*\?\?\s*\(CFG\.POSITION_USDC\s*>\s*0\s*\?\s*CFG\.POSITION_USDC\s*:\s*usdcBal\)\)/.test(body), 'liveOpen does not cap by POSITION_USDC');
});
t('parity-check is a REPORT only: it never blocks Go Live and never stops a running live bot (owner decision: no gates)', () => {
  const fs = require('fs'); const bot = fs.readFileSync(__dirname + '/bot.js', 'utf8'), srv = fs.readFileSync(__dirname + '/miniapp/server.js', 'utf8');
  assert.ok(!/REFUSING LIVE START: live masih berbeda dari dry run/.test(bot), 'bot must not refuse to start because of parity');
  assert.ok(/const gatesOpen = false/.test(bot), 'liveCycle must not stop because of parity');
  assert.strictEqual((srv.match(/if \(false \/\* parity-check is a report, never a lock on Live ON \*\//g) || []).length, 2, 'arm and start must not be gated by parity');
  assert.ok(/function liveParityDifferences\(\) \{ try \{ return require\('\.\.\/parity-check'\)\.analyse\(\)\.debt;/.test(srv), 'the report itself stays available');
});
console.log('known divergences still open:', a.debt.length, '->', a.debt.join(', '));
console.log('all', n, 'tests passed');
