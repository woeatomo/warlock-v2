'use strict';
// Capital asset (USDC/SOL) is chosen in the Live menu, one shared setting for dry run + live; the Settings form no longer carries it and saving settings never counts a missing field as a switch.
const assert = require('assert'), fs = require('fs'), path = require('path');
const app = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, 'miniapp/public/index.html'), 'utf8'), css = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.css'), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
t('Live menu has the USDC/SOL selector (inside wallet-live-view), labelled for dry run & live', () => {
  const live = html.slice(html.indexOf('id="wallet-live-view"'), html.indexOf('id="wallet-pnlcal-view"'));
  assert.ok(/data-capital="USDC"/.test(live) && /data-capital="SOL"/.test(live)); assert.ok(/dry run &amp; live/i.test(live));
});
t('Settings form order no longer lists CAPITAL_ASSET; missing field is not a "switch"', () => {
  const order = app.slice(app.indexOf('const order = ['), app.indexOf('const staleGroup')); assert.ok(!/CAPITAL_ASSET/.test(order));
  assert.ok(/switching=patch\.CAPITAL_ASSET!==undefined&&patch\.CAPITAL_ASSET!==/.test(app));
});
t('selector posts the shared setting with the capital confirmation (same endpoint as settings; no live/dry split)', () => {
  assert.ok(/api\('POST', '\/api\/settings', \{ settings: \{ CAPITAL_ASSET: to \}, capitalAssetConfirmed: true \}\)/.test(app)); assert.ok(/renderCapital\(\);\n/.test(app));
});
t('button polish keeps labels (icons via CSS) and covers open-position, screening and capital controls', () => {
  for (const s of ['button[data-closepool]', '.candidate button[data-openpool]', '.scan-caption .btn[data-rescan]', '.pool-actions', '.seg-btn']) assert.ok(css.includes(s), s);
  assert.ok(/Tutup sekarang\$\{state\.liveRunning\?'':' \(paper\)'\}/.test(app) && /Open sekarang/.test(app) && /Scan ulang sekarang/.test(app));
});
console.log('all', n, 'tests passed');
