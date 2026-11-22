'use strict';
// Bot side of the SOL-first live views (staged with the bot restart): Telegram close text SOL first; status.json drops a closed
// position's valuation; live opens carry their provenance (open source / reason) for History.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-sol-bot-'));
process.env.LP_BOT_DIR = root; process.env.TELEGRAM_CHAT_ID = '1'; process.env.TELEGRAM_ALLOWED_ID = '1'; process.env.PAPER = '0'; process.env.DRY_RUN = '0';
fs.mkdirSync(path.join(root, 'paper'), { recursive: true });
const T = require('./telegram-notify'); const msgs = [];
T.setMessageTransport((text) => { msgs.push(text); return { ok: true }; }); T.setPhotoTransport(() => ({ ok: true })); if (T.setAutoCard) T.setAutoCard(false);
let n = 0; const ok = (m) => { n++; console.log('ok', m); };
(async () => {
  const dcty = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-live-sol-history.json'), 'utf8')).find((r) => r.name === 'DCTY-SOL');
  await T.notifyClose({ ...dcty, paper: false }); await new Promise((r) => setTimeout(r, 50));
  const m = msgs.find((x) => /DCTY\/SOL/.test(x)) || ''; const lines = m.split('\n');   // Warlock 2.0 close text (HTML): SOL main, USD small italic
  assert.ok(/^✅ <b>PROFIT · DCTY\/SOL<\/b>/.test(lines[0]) && lines[1] === '<b>+0.005656 SOL</b>  (+0.57%)  <i>≈ +$0.41</i>', m);
  assert.ok(!/PnL net USDC/.test(m) && /🌾 Fee 0\.002290 SOL/.test(m) && /take profit/.test(m) && !/aturan lama/.test(m), m);
  const ct = require('./miniapp/live-view').closeText(dcty); assert.ok(/take profit/.test(ct) && !/aturan lama/.test(ct));
  ok('Telegram close (modal SOL): "(profit)" by SOL result, "💰 PnL: +0.005656 SOL (+0.57%) · ≈ +$0.41" first, fee in SOL, no USDC line; live close reason text');
  const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  const wp = src.slice(src.indexOf('async function writeLiveStatusPointer('), src.indexOf('async function writePaperStatus('));
  assert.ok(/if \(!ps\.length\) \{ next\.live = null; next\.lives = \[\]; \}/.test(wp) && /keys\.has\(l\.position\)/.test(wp));
  assert.ok(/lives\.push\(\{ \.\.\.live, position: pos\.position \}\)/.test(src));
  ok('status.json: no open position -> live/lives cleared; lives keyed by position');
  const lo = src.slice(src.indexOf('async function liveOpen('), src.indexOf('async function liveOpenUsdcPool'));
  assert.strictEqual((src.match(/walletTokenRaw: '0' \}; liveOpenContext\(state\.position, p, opts\);/g) || []).length, 2); assert.ok(lo.includes('liveOpenContext(state.position, p, opts)'));
  const fn = src.slice(src.indexOf('function liveOpenContext('), src.indexOf('function liveNotifyClose('));
  const paperHistory = require('./paper-history'), CFG = {};
  const f = new Function('paperHistory', 'CFG', fn + '; return liveOpenContext;')(paperHistory, CFG);
  const pos = { capitalAsset: 'SOL', capitalInSol: 1, openedAt: '2026-11-20T09:37:07.045Z' }, pool = { tvl: 16532, fee_tvl_ratio: { '30m': 0.79 }, pool_config: { bin_step: 80 } };
  f(pos, pool, {}); assert.strictEqual(pos.openContext.source, 'Auto bot (scan)'); assert.strictEqual(pos.openContext.snapshot.ft30mPct, 0.79); assert.strictEqual(pos.openReason, 'Lolos screening bot');
  const man = { openedAt: pos.openedAt }; f(man, pool, { source: 'manual' }); assert.strictEqual(man.openContext, undefined);
  const rep = { openedAt: pos.openedAt }; f(rep, pool, { source: 'reposition' }); assert.strictEqual(rep.openContext.source, 'Reposition (auto)');
  ok('live open provenance: scan -> Auto bot (scan) + screening snapshot; manual left to its own context; reposition labelled');
  console.log('all', n, 'bot-side SOL view tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
