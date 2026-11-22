'use strict';
// Mini App "Sembunyiin PnL receh" (operator t240u): hides breakeven-class rows (|PnL%| < 0.1% in the capital token) and dust; FIONA -0.043% hidden, DCTY +0.57% shown.
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
const grab = (re) => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const numericSrc = grab(/const numeric\s*=[^;]+;|function numeric\([^)]*\)\{[^}]*\}/);
const fn = new Function(`${numericSrc}\n${grab(/function isSolRow\(r\)\{[^}]*\}/)}\n${grab(/function isReceh\(r\)\{[\s\S]*?\n  \}/)}\nreturn isReceh;`)();
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8'));
const rows = require('./miniapp/live-view').enrichRows(fx, { solUsd: 72.09 });
const by = (n) => rows.find((r) => r.name === n);
assert.strictEqual(fn(by('FIONA-SOL')), true, 'FIONA -0.043% is receh (BE)');
assert.strictEqual(fn(by('DCTY-SOL')), false, 'DCTY +0.57% stays');
assert.strictEqual(fn({ capitalAsset: 'USDC', pnlUsd: 0.05, pnlPct: 0.5, usdcIn: 10 }), true, 'USDC dust < $0.10');
assert.strictEqual(fn({ capitalAsset: 'USDC', pnlUsd: -2, pnlPct: -2, usdcIn: 100 }), false);
assert.strictEqual(fn({ capitalAsset: 'SOL', pnlCapital: 0.0012, capitalInSol: 1 }), false, '+0.12% SOL is not BE');
assert.ok(/!hide\|\|!isReceh\(r\)/.test(src) && /addEventListener\('change',renderClosed\)/.test(src), 'toggle wired to the filter');
const html = fs.readFileSync(path.join(__dirname, 'miniapp/public/index.html'), 'utf8'); assert.ok(/id="hide-dust"/.test(html) && /0\.1% \(BE\)/.test(html));
console.log('test-hide-receh: OK (FIONA hidden, DCTY shown, dust hidden, toggle wired; totals come from the server, not the filtered list)');
