'use strict';
// (1) "Open sekarang" is enabled for every candidate that is not already open; filter-type rejections become manual-override warnings, safety rejections stay hard.
// (2) top-up / edit-modal accept SOL (converted to USDC at the SOL price). (3) PnL calendar has a USD/SOL toggle.
const assert = require('assert'), fs = require('fs'), path = require('path'); const refresh = require('./paper-screen-refresh');
const app = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, 'miniapp/public/index.html'), 'utf8'), bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
t('open button disabled only when not allowed or already held (no reason-based lock)', () => {
  assert.ok(app.includes("${(paperAllowed||state.liveRunning)&&!held?'':'disabled'}")); assert.ok(!/tvl>\|Cooldown\|pump24/.test(app));   // LIVE too: the live flow explains (bot not ready / slots full) on press
});
t('manual override: filter-type rejections go through skipSoft; safety rejections still hard skip()', () => {
  for (const w of ["skipSoft(p,p.name,'SL blacklist')", 'skipSoft(p,tag,cooldown)', 'skipSoft(p, tag, ev.why)', 'skipSoft(p, tag, ot.why)', 'skipSoft(p,tag,why)', 'skipSoft(p, tag, pvp.why)', 'skipSoft(p,tag,pump24.why)', 'skipSoft(p, tag, od.why)']) assert.ok(bot.includes(w), w);
  for (const w of ['skip(tag, m.why)', 'skip(tag, rs.why)', 'skip(tag, ins.why)', 'skip(tag, fromReport.why)', 'skip(tag, ev.why); continue; }\n        top =']) { /* hard ones */ }
  for (const w of ['skip(tag, m.why)', 'skip(tag, rs.why)', 'skip(tag, ins.why)']) assert.ok(bot.includes(w), 'still hard: ' + w);
  assert.ok(/const skipSoft = \(p, tag, why\) => \{ if \(opts\.targetAddress === p\.address && opts\.allowOverride\)/.test(bot), 'only the manually targeted pool with the confirmed override');
});
t('reason categories are stable (cooldown minutes, TVL numbers, twin ids do not break the acknowledged-warning match)', () => {
  assert.strictEqual(refresh.category('Cooldown pool: tunggu 12 menit (batas 30 menit sejak close)'), refresh.category('Cooldown pool: tunggu 3 menit (batas 30 menit sejak close)'));
  assert.strictEqual(refresh.category('TVL turun 51.1% sejak entry terakhir ($32k → $15k) ≥ maks 45%'), 'tvl turun'); assert.strictEqual(refresh.category('anti PvP: kembar dengan 9W8Z…pump (PUSSY) +1 lain'), 'anti pvp');
  assert.strictEqual(refresh.category('Non-refundable 0.100000 SOL (2 bin array baru; rent 0.1 + tx 0.0) > maks 0.050000 SOL'), 'non-refundable'); assert.strictEqual(refresh.category('token tua: umur 500j > maks 400j'), 'token tua');
  assert.strictEqual(refresh.category('pump24h=300%'), 'pump24h'); assert.strictEqual(refresh.category('fee/tvl30m<0.6%'), 'fee/tvl');
});
t('top-up and edit-modal have a USDC/SOL unit switch; SOL is converted at the SOL price (ledger stays USDC)', () => {
  for (const p of ['funding', 'modal']) assert.ok(new RegExp('data-unit-for="' + p + '"[\\s\\S]*?data-unit="SOL"').test(html), p);
  assert.ok(/amountUsd\('funding',\$\('funding-amount'\)\.value\)/.test(app) && /amountUsd\('modal',raw\)/.test(app)); assert.ok(/Math\.round\(n\*px\*1e6\)\/1e6/.test(app));
});
t('PnL calendar has a USD/SOL toggle that drives cells, month total, all-time total and the day sheet', () => {
  assert.ok(/data-cal-unit="USD"/.test(app) && /data-cal-unit="SOL"/.test(app)); assert.ok(/x\.pnlSol\?\?0/.test(app) && /d\.totalSol\?\?0/.test(app) && /day\.profitSol\?\?0/.test(app) && /r\.pnlSol\?\?0/.test(app));
});
console.log('all', n, 'tests passed');
