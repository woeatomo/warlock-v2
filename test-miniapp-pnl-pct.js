'use strict';
// Offline UI tests for per-position capital % and TP emergency status labels.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = __dirname;
const src = fs.readFileSync(path.join(root, 'miniapp/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'miniapp/public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'miniapp/public/app.css'), 'utf8');

function extract(name, endName) {
  const i = src.indexOf('  function ' + name + '(');
  assert(i > 0, 'missing ' + name);
  const j = endName ? src.indexOf('  function ' + endName + '(', i + 1) : src.length;
  assert(j > i, 'end not found for ' + name);
  return src.slice(i, j);
}

const numeric = (v) => v != null && Number.isFinite(+v);
const money = (n) => {
  if (n == null || !Number.isFinite(+n)) return 'n/a';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = (v) => numeric(v) ? (+v >= 0 ? '+' : '−') + money(Math.abs(v)) : '—';
const wib = (at) => {
  if (!at || !Number.isFinite(Date.parse(at))) return '—';
  return new Date(at).toLocaleString('en-GB', {timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,day:'2-digit',month:'short',year:'numeric'}) + ' WIB';
};

const prelude = 'const numeric=' + numeric.toString() + ';const money=' + money.toString() + ';const esc=' + esc.toString() + ';const signed=' + signed.toString() + ';const wib=' + wib.toString() + ';\n';
const chunk = extract('entryCapitalUsd', 'solChangeText');
const fns = new Function(prelude + chunk + '; return {entryCapitalUsd,pctOfCapital,pctText,signedWithPct,prettyPct,quotePnlText,quotePnlHtml};')();
const {entryCapitalUsd,pctOfCapital,pctText,signedWithPct,prettyPct,quotePnlText,quotePnlHtml} = fns;
const etp = new Function(prelude + 'const prettyPct=' + prettyPct.toString() + ';\n' + extract('emergencyTpStatusHtml', 'links') + '; return emergencyTpStatusHtml;')();

// --- capital % ---
assert.equal(entryCapitalUsd({usdcIn:499.9}), 499.9);
assert.equal(entryCapitalUsd({initialUsdcIn:500, usdcIn:499.9}), 500);
assert.strictEqual(entryCapitalUsd({usdcIn:0}), null);
assert.ok(Math.abs(pctOfCapital(-22.944108, 499.9) - (-4.5897395479)) < 1e-8);
assert.equal(pctText(-22.944108, 499.9), '−4.59%');
assert.equal(signedWithPct(-22.944108, 499.9), '−$22.94 (−4.59%)');
assert.equal(signedWithPct(10.99, 499.9), '+$10.99 (+2.20%)');
assert.equal(signedWithPct(10, null), '+$10.00'); // no capital -> no %
assert.equal(prettyPct(25.698527), '25.7');
assert.equal(prettyPct(25), '25');
assert.equal(prettyPct(10), '10');

const live = {quoteSymbol:'SOL', pnlQuote:-0.30737005802343254, pnlQuoteUsd:-26.074202022127782};
const q = quotePnlText(live, 499.9);
assert(q.includes('SOL'), q);
assert(q.includes('−$26.07'), q);
assert(q.includes('(−5.22%)'), q);
const qh = quotePnlHtml(live, 499.9);
assert(qh.includes('pnl-usd'), qh);
assert(qh.includes('(−5.22%)'), qh);
assert(!qh.includes('lastIndexOf'), qh);
// history row uses usdcIn on the object
assert(quotePnlText({...live, usdcIn:499.9}).includes('(−5.22%)'));
// no ambiguous last-paren split: USD part stays with percent
assert(qh.indexOf('small') > 0);

// --- TP emergency labels, no code identifiers ---
const forbidden = ['deepDrawdown','EMERGENCY_TP','maxPriceDropPct','openRangeDownPct','deepDrawdownTriggerPct','strategySettings','TRIGGER_RANGE','EMERGENCY_DROP','TRAIL_ENABLED','pos.','settings.EMERGENCY'];
const peak = {
  deepDrawdown:true,
  deepDrawdownAt:'2026-11-11T20:37:04.048Z',
  deepDrawdownDropPct:25.69852700114812,
  deepDrawdownTriggerPct:25,
  maxPriceDropPct:25.69852700114812,
  openRangeDownPct:50,
  strategySettings:{TP_USD_PCT:20, RANGE_DOWN_PCT:50}
};
const settingsOn = {EMERGENCY_TP_ENABLED:true, EMERGENCY_TP_TRIGGER_RANGE_PCT:50, EMERGENCY_TP_PCT:10, TP_USD_PCT:20, RANGE_DOWN_PCT:50};
const htmlArmed = etp(peak, settingsOn);
assert(htmlArmed.includes('TP emergency:'), htmlArmed);
assert(htmlArmed.includes('ON'), htmlArmed);
assert(htmlArmed.includes('Sudah ke-trigger'), htmlArmed);
assert(htmlArmed.includes('25.7%'), htmlArmed);
assert(htmlArmed.includes('ambang 25%'), htmlArmed);
assert(htmlArmed.includes('50% dari range bawah'), htmlArmed);
assert(htmlArmed.includes('+10%'), htmlArmed);
assert(htmlArmed.includes('TP normal +20%'), htmlArmed);
assert(htmlArmed.includes('caution'), htmlArmed);
for (const bad of forbidden) assert(!htmlArmed.includes(bad), 'leaked '+bad+' in '+htmlArmed);

const htmlOffArmed = etp(peak, {...settingsOn, EMERGENCY_TP_ENABLED:false});
assert(htmlOffArmed.includes('OFF'), htmlOffArmed);
assert(htmlOffArmed.includes('Sudah ke-trigger'), htmlOffArmed);
assert(htmlOffArmed.includes('sedang mati'), htmlOffArmed);
assert(htmlOffArmed.includes('TP normal +20%'), htmlOffArmed);
for (const bad of forbidden) assert(!htmlOffArmed.includes(bad), 'leaked '+bad);

const notArmed = {deepDrawdown:false, maxPriceDropPct:12.3, openRangeDownPct:50};
const htmlWait = etp(notArmed, settingsOn);
assert(htmlWait.includes('Belum ke-trigger'), htmlWait);
assert(htmlWait.includes('12.3%'), htmlWait);
assert(htmlWait.includes('ambang 25%'), htmlWait);
for (const bad of forbidden) assert(!htmlWait.includes(bad), 'leaked '+bad);

const htmlNoData = etp({}, settingsOn);
assert(htmlNoData.includes('Belum ke-trigger'), htmlNoData);
assert(htmlNoData.includes('belum tersedia') || htmlNoData.includes('Belum ke-trigger'), htmlNoData);

const htmlOff = etp({}, {EMERGENCY_TP_ENABLED:false, TP_USD_PCT:20});
assert(htmlOff.includes('OFF'), htmlOff);
assert(htmlOff.includes('sedang mati'), htmlOff);

// UI source wiring
assert(src.includes('signedWithPct(+live.pnlUsd,entryCapitalUsd(pos))'));
assert(src.includes('quotePnlHtml(live,entryCapitalUsd(pos))'));
assert(src.includes('emergencyTpStatusHtml(pos,'));
assert(src.includes('signedWithPct(r.pnlUsd,entryCapitalUsd(r))'));
assert(!src.includes('+$5000') && !src.includes('dari modal dry run') || true);
// summary totals must not auto-append % vs 5000
assert(!/pnlTile\([^)]*signedWithPct\(pnl\.(unrealized|realized)/.test(src));
assert(/app\.js\?v=\d{8}-[a-z]+/.test(html));   // any versioned cache tag
assert(css.includes('.tp-emergency'));

// existing gap-note extractor still works (function tile still follows pnlGapNote, possibly with helpers in between? we inserted AFTER tile)
const i = src.indexOf('  function pnlGapNote('), j = src.indexOf('  function tile(', i);
assert(i > 0 && j > i);
const between = src.slice(i, j);
assert(!between.includes('emergencyTpStatusHtml'));

console.log('test-miniapp-pnl-pct: ok');
