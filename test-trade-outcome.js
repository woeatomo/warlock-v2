'use strict';
// Breakeven ("receh", like LP Agent; operator 20 Nov t228u): |PnL %| < 0.1% in the capital token is neither win nor loss and is left out of
// the win rate, but its PnL stays in every realized total. FIONA (−0.043% SOL) becomes BE.
const assert = require('assert'), fs = require('fs'), path = require('path');
const O = require('./trade-outcome'), hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8'));
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
(async () => {
  const f = hist.find((h) => h.name === 'FIONA-SOL'), d = hist.find((h) => h.name === 'DCTY-SOL');
  assert.strictEqual(O.outcome(f), 'be'); assert.strictEqual(O.outcome(d), 'win');
  assert.strictEqual(O.outcome({ capitalAsset: 'SOL', pnlCapital: -0.001, capitalInSol: 1 }), 'loss');          // −0.1% exactly: a loss
  assert.strictEqual(O.outcome({ capitalAsset: 'SOL', pnlCapital: 0.00099, capitalInSol: 1 }), 'be');
  assert.strictEqual(O.outcome({ capitalAsset: 'USDC', pnlUsd: 0.4, usdcIn: 500 }), 'be');                         // 0.08% USDC
  assert.strictEqual(O.outcome({ capitalAsset: 'USDC', pnlUsd: -0.6, usdcIn: 500 }), 'loss');
  assert.strictEqual(O.outcome({ realizedSol: 0.05 }), 'win'); assert.strictEqual(O.outcome({ pnlUsd: 0 }), 'be');
  const t = O.tally(hist); assert.deepStrictEqual(t, { wins: 1, losses: 0, be: 1, trades: 2, winRate: 100 }); assert.strictEqual(O.wlText(t), '1W · 0L · 1 BE');
  ok('rule: |PnL%| < 0.1% (capital token) = BE; FIONA BE, DCTY win; win rate 1/(1+0) = 100%; "1W · 0L · 1 BE"');
  const cal = require('./paper-pnl-calendar').fromHistory(hist, null), day = cal.days['2026-11-20'];
  assert.strictEqual(day.wins, 1); assert.strictEqual(day.losses, 0); assert.strictEqual(day.be, 1); assert.ok(Math.abs(day.pnlSol - 0.005226) < 1e-6, 'BE PnL still in the total');
  ok('calendar day: 1W 0L 1BE, day PnL still includes the BE trade');
  const agg = require('./pnl-period').aggregate(hist, 'day', 0, { solUsd: 72.09, now: Date.parse('2026-11-20T12:00:00Z') });
  assert.strictEqual(agg.trades, 2); assert.strictEqual(agg.wins, 1); assert.strictEqual(agg.losses, 0); assert.strictEqual(agg.be, 1); assert.strictEqual(agg.winRate, 100);
  assert.ok(Math.abs(agg.pnlSol - 0.005226) < 1e-6, agg.pnlSol);
  ok('Telegram period card data: 1W 0L 1BE, win rate 100%, PnL +0.005226 SOL');
  const cap = require('./tg-format').periodHtml(agg, { lang: 'id' });
  assert.ok(/1W · 0L · 1 BE/.test(cap) && /win rate 100%/.test(cap) && /BE = \|PnL\| &lt; 0\.1%/.test(cap), cap);
  ok('Telegram period caption shows W/L/BE and the win rate without BE');
  const bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  assert.ok(/require\('\.\/trade-outcome'\)\.tally\(closed\)/.test(bot) && /winRate: wl\.winRate/.test(bot));
  ok('dry run summary (bot.js bookStats) uses the same rule');
  console.log('all', n, 'breakeven tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
