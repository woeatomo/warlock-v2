'use strict';
// Dashboard route card (operator t241u): "WARLOCK 2.0 PIPELINE", recent-trade tiles coloured by the SOL result with the BE rule, USD = SOL PnL x close price.
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/dashboard.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, 'miniapp/public/index.html'), 'utf8');
assert.ok(!/V1\.8/i.test(src) && !/V1\.8/i.test(html) && /'WARLOCK 2\.0 PIPELINE · '/.test(src) && />WARLOCK 2\.0 PIPELINE</.test(html));
const g = (re) => { const m = src.match(re); assert.ok(m, String(re)); return m[0]; };
const fns = new Function(`const num = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v); const capOf = () => null;
${g(/function rowPct\(r\) \{[^\n]*\}/)}
${g(/const isSolR = [^\n]*/)}
${g(/const outcomeOf = [^\n]*/)}
${g(/const toneOf = [^\n]*/)}
${g(/const usdOf = [^\n]*/)}
return { outcomeOf, toneOf, usdOf };`)();
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8'));
const rows = require('./miniapp/live-view').enrichRows(fx, { solUsd: 72.09 }), by = (n) => rows.find((r) => r.name === n);
const d = by('DCTY-SOL'), f = by('FIONA-SOL');
assert.strictEqual(fns.toneOf(d), 'positive', 'DCTY +0.57% green although the old USD basis was -$0.16');
assert.ok(Math.abs(fns.usdOf(d) - 0.4077) < 0.01, 'DCTY USD = SOL PnL x close price ≈ +$0.41: ' + fns.usdOf(d));
assert.strictEqual(fns.outcomeOf(f), 'be'); assert.strictEqual(fns.toneOf(f), 'be');
assert.ok(/m\.closed\.filter\(r => outcomeOf\(r\) === 'win'\)/.test(src), 'wins list by the SOL outcome');
console.log('test-dash-route-tiles: OK (WARLOCK 2.0 PIPELINE, DCTY green ≈ +$0.41, FIONA BE)');
