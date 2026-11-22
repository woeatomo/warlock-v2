'use strict';
// Live screening / open guards / SL-blacklist side effects == dry run (operator rule). Offline, read-only static + shared-module checks.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
const body = (from, endRe) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const m = endRe.exec(src.slice(a + 10)); return src.slice(a, a + 10 + (m ? m.index : 0)); };
const scanSrc = body('async function performScan', /\n(?:async )?function /), openSrc = body('async function liveOpen', /\nasync function /), closeSrc = body('async function liveClose', /\n\/\/ ---------- status/);
t('screening: SL blacklist, cooldown and entry-cost (MAX_NONREFUND_SOL) run for live too (no policy.PAPER gate)', () => {
  for (const key of ['slBlacklist.has(PAPER_DIR', 'entryPolicy.cooldownReason(recentHistory', 'entryCost.rejection(p.entryCostEstimate,policy.MAX_NONREFUND_SOL']) {
    const line = scanSrc.split('\n').find(l => l.includes(key)); assert.ok(line, key + ' missing'); assert.ok(!/policy\.PAPER/.test(line), key + ' is still gated on policy.PAPER');
  }
});
t('screening: candidate order is the same for live and dry run', () => { assert.ok(/\.sort\(\(a,b\)=>screenSource\.priority\(a,b,policy\.CAPITAL_ASSET\)\)/.test(scanSrc)); assert.ok(!/policy\.PAPER\?\(\(a,b\)=>screenSource/.test(scanSrc)); });
t('screening: live gets its own history/open position for cooldown and TVL-drop; liveCycle provides them', () => { assert.ok(/else\{recentHistory=scan\.liveHistory\|\|\[\];recentEntries=recentHistory\.concat\(scan\.liveOpen\|\|\[\]\);\}/.test(scanSrc)); const lc = body('async function liveCycle', /\n\(async \(\) => \{/); assert.ok(/scan\.liveHistory = state\.history/.test(lc) && /scan\.liveOpen = state\.position/.test(lc)); });
t('liveOpen runs the dry-run open guards before anything is sent (blacklist, cooldown, MAX_LIQ_USD, MAX_NONREFUND_SOL)', () => {
  const g = ['slBlacklist.has(PAPER_DIR', 'entryPolicy.cooldownReason(state.history', 'CFG.MAX_LIQ_USD > 0', 'entryCost.rejection(p.entryCostEstimate, CFG.MAX_NONREFUND_SOL'];
  const firstSend = Math.min(...['DLMM.create', 'jupiterSwapLive(', 'send('].map(k => openSrc.indexOf(k)).filter(i => i >= 0));
  for (const k of g) { const i = openSrc.indexOf(k); assert.ok(i >= 0, k + ' missing in liveOpen'); assert.ok(i < firstSend, k + ' must run before any on-chain call'); }
});
t('liveClose records stop-loss mints in the SL blacklist like paperClose; SL+ closes are NOT recorded', () => {
  assert.ok(/slBlacklist\.isStopLoss\(reason\)/.test(closeSrc) && /slBlacklist\.add\(PAPER_DIR/.test(closeSrc));
  const BL = require('./paper-sl-blacklist'); assert.equal(BL.isStopLoss('emergency_stop'), true); assert.equal(BL.isStopLoss('emergency_slplus USDC BEP (peak +7.0%)'), false); assert.equal(BL.isStopLoss('STOP file'), false);
});
t('live history rows work with the shared cooldown / TVL-drop / SL-blacklist code (shape compatibility)', () => {
  const EP = require('./paper-entry-policy'), TD = require('./tvl-drop'), BL = require('./paper-sl-blacklist');
  const pos = { pool: 'POOLADDR', name: 'X-SOL', mintX: 'MINTX', position: 'POS', openedAt: new Date(Date.now() - 600e3).toISOString(), tvlUsd: 50000 };
  const row = { ...pos, closedAt: new Date().toISOString(), reason: 'oor_right_take_profit' };      // exactly what liveClose pushes
  assert.ok(EP.cooldownReason([row], 'POOLADDR', 30), 'cooldown must apply to a just-closed live trade'); assert.equal(EP.cooldownReason([row], 'OTHER', 30), null);
  const ev = TD.evaluatePool({ tvl: 20000, token_x: { address: 'MINTX' }, address: 'POOLADDR', name: 'X-SOL' }, [pos], 45); assert.equal(ev.ok, false, 'TVL-drop filter must see the previous live entry');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'slbl-')); assert.ok(BL.add(d, { mint: 'MINTX', symbol: 'X-SOL', pool: 'POOLADDR', reason: 'emergency_stop', closedAt: row.closedAt, source: 'auto' })); assert.ok(BL.has(d, 'MINTX'));
});
t('liveOpen stores the TVL at entry for the TVL-drop filter', () => { assert.ok(/tvlUsd: p\.tvl, binStep/.test(openSrc)); });
console.log('all', n, 'tests passed');
