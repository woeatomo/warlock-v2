'use strict';
// Live open / close must notify in Telegram (they used to be silent): live-shaped rows go through the real notifyOpen / notifyClose.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-notify-'));
process.env.LP_BOT_DIR = root; process.env.TELEGRAM_CHAT_ID = '1'; process.env.TELEGRAM_ALLOWED_ID = '1'; process.env.PAPER = '0'; process.env.DRY_RUN = '0';
fs.mkdirSync(path.join(root, 'paper'), { recursive: true });
const T = require('./telegram-notify');
const msgs = [], photos = [];
T.setMessageTransport((text) => { msgs.push(text); return { ok: true }; });
T.setPhotoTransport((x) => { photos.push(x); return { ok: true }; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  T.notifyOpen({ name: 'DCTY-SOL', pool: '4exs9btspvKHEYtuCFMXXV9snF99UvbFJKtDhAzmgYtz', sizeSol: 0.9, quoteSymbol: 'SOL', depositQuote: 0.9, gasBufferSol: 0.04, leftoverSol: 0.04, minBinId: 100, maxBinId: 187, entryPrice: 0.0001, ft30m: 0.7, tvl: 50000, activeBin: 150, shape: 'open-spot' });
  await wait(1500);
  const all = msgs.concat(photos.map(String)); assert.ok(all.some(m => /🔴 LIVE/.test(m) && /POSISI BARU/.test(m) && /DCTY\/SOL/.test(m) && !/dry run/i.test(m)), 'live open notice: ' + all.join('|'));
  msgs.length = 0; photos.length = 0;
  const row = { name: 'DCTY-SOL', pool: '4exs9btspvKHEYtuCFMXXV9snF99UvbFJKtDhAzmgYtz', mintX: 'M', openedAt: new Date(Date.now() - 3600e3).toISOString(), closedAt: new Date().toISOString(), reason: 'tp', capitalAsset: 'SOL', capitalInSol: 0.9, solOut: 0.95, solUsd: 150, usdcIn: 135, estPnlPct: 5.5, realizedSol: 0.05, pnlUsd: 7.5, depositSol: 0.9 };
  T.notifyClose(row); await wait(6000);
  assert.ok(photos.some(m => /DCTY\/SOL/.test(String(m))), 'live close card with the close text as caption');
  console.log('test-live-notify: OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
