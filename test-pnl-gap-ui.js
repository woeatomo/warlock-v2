'use strict';
// UI-only: PnL USDC (exit) vs LP quote PnL gap note, using the live BUTTHOLE-SOL numbers (22:41 WIB).
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
const i = src.indexOf('  function pnlGapNote('), j = src.indexOf('  function tile(', i);
assert(i > 0 && j > i);
const numeric = (v) => v != null && Number.isFinite(+v), money = (v) => '$' + (+v).toFixed(2), signed = (v) => numeric(v) ? (+v >= 0 ? '+' : '−') + money(Math.abs(v)) : '—', esc = (x) => String(x);
const pnlGapNote = new Function('numeric', 'money', 'signed', 'esc', src.slice(i, j) + '; return pnlGapNote;')(numeric, money, signed, esc);
const live = { quoteSymbol: 'SOL', pnlUsd: 9.09824800000007, pnlQuoteUsd: 2.0760807449550143, entryQuoteAmount: 5.672681795999999, displaySolUsdEntry: 83.71, displaySolUsd: 84.75 };
const t = pnlGapNote({ capitalAsset: 'USDC', quoteSymbol: 'SOL' }, live);
assert(t.includes('efek harga SOL $83.71→$84.75 (+1.24%) +$5.90'), t);
assert(t.includes('Beda PnL USDC vs PnL quote +$7.02'), t);
assert(t.includes('+$1.12'), t);
assert.strictEqual(pnlGapNote({ capitalAsset: 'SOL' }, live), '');
assert.strictEqual(pnlGapNote({ capitalAsset: 'USDC' }, { ...live, quoteSymbol: 'USDC' }), '');
assert(!/'\+\(stats\.archivedCount/.test(src), 'archived note must be interpolated, not literal');
console.log('test-pnl-gap-ui: ok');
