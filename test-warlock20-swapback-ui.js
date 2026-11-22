'use strict';
// t221u: "Warlock 2.0" everywhere (no "v2.0" in the mini app / bot menus) and the QUOTE SWAP-BACK module text follows the capital asset.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const pub = path.join(__dirname, 'miniapp/public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8'), dashjs = fs.readFileSync(path.join(pub, 'dashboard.js'), 'utf8');
for (const f of ['miniapp/public/index.html', 'miniapp/public/dashboard.js', 'miniapp/public/app.js', 'bot-i18n.js']) assert(!/Warlock v2\.0/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), f + ' still says Warlock v2.0');
assert((html.match(/Warlock 2\.0/g) || []).length >= 4, 'title, header, dashboard card and credit say Warlock 2.0');
assert(/start: '🚀 Warlock 2\.0 siap/.test(fs.readFileSync(path.join(__dirname, 'bot-i18n.js'), 'utf8')));
assert(!dashjs.includes('USDC SWAP-BACK') && dashjs.includes("'QUOTE SWAP-BACK'"));
console.log('ok rename: Warlock 2.0 + QUOTE SWAP-BACK');
const run = (asset) => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1/' }); const w = dom.window;
  w.SWApp = null; w.eval(dashjs);
  const now = new Date().toISOString();
  w.SWDash.render({ values: { CAPITAL_ASSET: asset, MAX_POSITIONS: 7 }, dashboard: { mode: { label: 'LIVE', live: true }, parity: { debt: 0 } }, status: { summary: { updated: now, stats: {} }, positions_open: { positions: [] } } });
  const mod = [...w.document.querySelectorAll('#dash-modules .dash-mod')].find(x => x.textContent.includes('QUOTE SWAP-BACK'));
  assert(mod, 'module rendered'); const t = mod.textContent; w.close(); return t;
};
const sol = run('SOL'), usdc = run('USDC');
assert(/token → SOL/.test(sol) && /gas buffer/.test(sol) && !/→ USDC/.test(sol), 'SOL capital text: ' + sol);
assert(/token → USDC/.test(usdc) && /SOL posisi → USDC/.test(usdc), 'USDC capital text: ' + usdc);
console.log('ok QUOTE SWAP-BACK text follows CAPITAL_ASSET (SOL now, USDC for USDC capital)');
console.log('2 checks passed');
