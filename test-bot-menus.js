'use strict';
// Telegram menus: /start lists the menus, /history + /open + /lang, inline callbacks, PnL cards (real child-process render), language ID/EN, auto card after a close.
// Temp bot dir, fake transports (nothing is sent to Telegram).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-menus-'));
process.env.LP_BOT_DIR = root; process.env.TELEGRAM_ALLOWED_ID = '1000000001'; process.env.TELEGRAM_CHAT_ID = '1000000001'; process.env.PAPER = '1'; process.env.DRY_RUN = '1'; fs.writeFileSync(path.join(root, 'STOP'), '');   // STOP present = DRY RUN mode (no STOP = LIVE: chat wording switches to LIVE)
process.env.TUNNEL_URL_FILE = path.join(root, 'tunnel.json'); fs.writeFileSync(process.env.TUNNEL_URL_FILE, JSON.stringify({ url: 'https://example.trycloudflare.com' }));
const OK = 1000000001, NO = 42;
const closed = (i, pct, extra = {}) => ({ name: 'POOL' + i + '-SOL', pool: 'PoolAddr' + String(i).padStart(4, '0') + 'xxxxxxxxxx', closedAt: new Date(Date.UTC(2026, 10, 19, 10, i)).toISOString(), openedAt: new Date(Date.UTC(2026, 10, 19, 8, i)).toISOString(),
  capitalAsset: 'SOL', capitalInSol: 1, pnlCapital: pct / 100, pnlCapitalPct: pct, pnlUsd: pct * 0.73, usdcIn: 73, usdcOut: 73 + pct * 0.73, solOut: 1 + pct / 100, solUsd: 73, holdHours: 2.2, reason: 'take_profit', quoted: true, paper: true, ...extra });
const hist = []; for (let i = 0; i < 8; i++) hist.push(closed(i, i % 3 === 0 ? -4.2 : 3.1 + i));
const open = { name: 'HOLD-SOL', pool: 'OpenPoolxxxxxxxxxxxxxxxxxxxx', position: 'PosKey1234567890abcdef', openedAt: new Date(Date.now() - 3600e3).toISOString(), capitalAsset: 'SOL', capitalInSol: 1, usdcIn: 73, lastLive: { pnlCapital: 0.02, pnlCapitalPct: 2, pnlUsd: 1.46, quoted: true } };
fs.mkdirSync(path.join(root, 'paper'), { recursive: true });
fs.writeFileSync(path.join(root, 'paper', 'state.json'), JSON.stringify({ books: { N5: { virtual: { lastCapitalSolUsd: 73 }, history: hist, positions: [open] } } }));
fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ history: [closed(50, 2.5, { paper: undefined })], positions: [] }));

const T = require('./telegram-notify'), I = require('./bot-i18n'), H = require('./history-menu');
const msgs = [], photos = [], apis = [];
T.setMessageTransport((text, opts) => { msgs.push({ text, opts }); return { ok: true }; });
T.setPhotoTransport((caption, png, opts) => { photos.push({ caption, png, opts }); return { ok: true }; });
T.setApiTransport((method, payload) => { apis.push({ method, payload }); return { ok: true }; });
const msg = (text, from = OK) => ({ update_id: 1, message: { text, from: { id: from }, chat: { id: from } } });
const cb = (data, from = OK) => ({ update_id: 2, callback_query: { id: 'cq1', from: { id: from }, data, message: { message_id: 77, chat: { id: from }, from: { id: 1 } } } });
const cbPhoto = (data) => ({ update_id: 3, callback_query: { id: 'cq2', from: { id: OK }, data, message: { message_id: 78, chat: { id: OK }, photo: [{ file_id: 'x' }], caption: 'card' } } });
const buttons = (m) => (m.opts.reply_markup.inline_keyboard || []).flat();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- /start lists every menu (Indonesian by default), plus the keyboard
  await T.handleUpdate(msg('/start'));
  let m = msgs.pop(); assert.ok(!/\bTuan\b/i.test(m.text) && !/\bTuan\b/.test(JSON.stringify(m.opts)), m.text); assert.ok(/\/history/.test(m.text) && /\/open/.test(m.text) && /\/lang/.test(m.text) && /\/menu/.test(m.text) && /Mini app/.test(m.text), m.text);
  assert.ok(/Ini menu yang tersedia/.test(m.text)); const ids = buttons(m).map(b => b.callback_data || (b.web_app && 'web')); assert.ok(ids.includes('hs|d|0') && ids.includes('os|d') && ids.includes('lg|en') && ids.includes('web'), ids.join());
  // ---- an unknown user is ignored
  assert.strictEqual((await T.handleUpdate(msg('/history', NO))).skipped, 'ignored'); assert.strictEqual(msgs.length, 0);
  // ---- language: /lang switches, the file is shared, /start follows
  await T.handleUpdate(msg('/lang')); assert.strictEqual(I.getLang(root), 'en'); m = msgs.pop(); assert.ok(/Language: English/.test(m.text) && /Open positions/.test(m.text));
  await T.handleUpdate(msg('/start')); m = msgs.pop(); assert.ok(/Here is what you can do/.test(m.text) && /Close history/.test(m.text));
  // ---- /history: first page of the dry run (6 per page), nav + menu rows
  await T.handleUpdate(msg('/history')); m = msgs.pop();
  assert.ok(/Close history · Dry run · page 1\/2 \(8 trades\)/.test(m.text), m.text);
  let b = buttons(m); assert.strictEqual(b.filter(x => /^hc\|/.test(x.callback_data)).length, 6); assert.ok(b.some(x => x.callback_data === 'hs|d|1') && b.some(x => x.callback_data === 'mn'));
  assert.ok(b.every(x => !x.text || x.text.length <= 32));
  // newest first
  assert.ok(/POOL7 /.test(b.find(x => /^hc\|/.test(x.callback_data)).text) && /SOL · /.test(b.find(x => /^hc\|/.test(x.callback_data)).text));
  // ---- callbacks: page 2 (edit), live list, open list
  apis.length = 0; await T.handleUpdate(cb('hs|d|1')); let e = apis.find(a => a.method === 'editMessageText'); assert.ok(e && /page 2\/2/.test(e.payload.text) && e.payload.message_id === 77);
  assert.ok(apis.some(a => a.method === 'answerCallbackQuery'));
  apis.length = 0; await T.handleUpdate(cb('hs|l|0')); e = apis.find(a => a.method === 'editMessageText'); assert.ok(/Live · page 1\/1 \(1 trades\)/.test(e.payload.text), e.payload.text);
  apis.length = 0; await T.handleUpdate(cb('os|d')); e = apis.find(a => a.method === 'editMessageText'); assert.ok(/Open positions · Dry run \(1\)/.test(e.payload.text)); assert.ok(e.payload.reply_markup.inline_keyboard.flat().some(x => /^oc\|/.test(x.callback_data)));
  // ---- closed card: a real PNG, caption with the numbers
  const hc = b.find(x => /^hc\|/.test(x.callback_data)).callback_data; photos.length = 0;
  await T.handleUpdate(cb(hc)); assert.strictEqual(photos.length, 1); assert.strictEqual(photos[0].png.slice(1, 4).toString(), 'PNG'); assert.ok(photos[0].png.length > 50000);
  assert.ok(/<b>POOL7\/SOL<\/b>/.test(photos[0].caption) && /\+10\.\d\d%/.test(photos[0].caption) && photos[0].opts.parse_mode === 'HTML', photos[0].caption);
  // ---- open card: OPEN snapshot with a refresh button
  const oc = (await H.openMenu(root, 'en', 'd')).reply_markup.inline_keyboard.flat().find(x => /^oc\|/.test(x.callback_data)).callback_data; photos.length = 0;
  await T.handleUpdate(cb(oc)); assert.strictEqual(photos.length, 1); assert.ok(/HOLD\/SOL<\/b> · open position/.test(photos[0].caption), photos[0].caption); assert.ok(photos[0].opts.reply_markup.inline_keyboard.flat().some(x => x.callback_data === oc));
  // ---- vanished trade: a clear message, no photo
  photos.length = 0; msgs.length = 0; await T.handleUpdate(cb('hc|d123456789zzzz')); assert.strictEqual(photos.length, 0); assert.ok(/Not found/.test(msgs.pop().text));
  // ---- Indonesian again through the inline button
  apis.length = 0; await T.handleUpdate(cb('lg|id')); assert.strictEqual(I.getLang(root), 'id'); e = apis.find(a => a.method === 'editMessageText'); assert.ok(/Ini menu yang tersedia/.test(e.payload.text));
  await T.handleUpdate(msg('/riwayat')); assert.ok(/History close · Dry run · hal 1\/2/.test(msgs.pop().text));
  // ---- the commands are registered in both languages
  apis.length = 0; await T.setMyCommands(); const sc = apis.filter(a => a.method === 'setMyCommands'); assert.strictEqual(sc.length, 2); assert.deepStrictEqual(sc[0].payload.commands.map(c => c.command), ['start', 'history', 'open', 'calendar', 'lang', 'menu', 'help']); assert.strictEqual(sc[1].payload.language_code, 'en');
  // ---- profit calendar menu, period cards (with the bin shape of the trade that drove the result), /help
  await T.handleUpdate(msg('/calendar')); m = msgs.pop(); assert.ok(/Profit calendar · Dry run/.test(m.text), m.text);
  await T.handleUpdate(msg('/pnl')); assert.ok(/Profit calendar/.test(msgs.pop().text));   // alias
  const pb = buttons(m).map(x => x.callback_data); for (const x of ['pc|d|day|0', 'pc|d|day|1', 'pc|d|week|0', 'pc|d|week|1', 'pc|d|month|0', 'pc|d|month|1', 'mn', 'ps|l']) assert.ok(pb.includes(x), x);
  photos.length = 0; await T.handleUpdate(cb('pc|d|month|0')); assert.strictEqual(photos.length, 1); assert.ok(photos[0].png.length > 50000 && /Bulanan|Monthly/.test(photos[0].caption), photos[0].caption);
  photos.length = 0; await T.handleUpdate(cb('pc|d|day|1')); assert.strictEqual(photos.length, 1);   // an empty day still gets a card
  await T.handleUpdate(msg('/help')); m = msgs.pop(); assert.ok(/\/calendar/.test(m.text) && /\/help/.test(m.text) && /07:00/.test(m.text) && !/\bTuan\b/.test(m.text));
  // ---- daily card at 07:00 WIB: due from 07:00, once per day, marked before it is sent
  const early = new Date(Date.UTC(2026, 10, 19, 22, 0)), seven = new Date(Date.UTC(2026, 10, 20, 0, 5));
  assert.strictEqual(T.dailyCardDue('d', early), false); assert.strictEqual(T.dailyCardDue('d', seven), true);
  photos.length = 0; const dr = await T.maybeDailyCard(seven); assert.ok(dr.ok && dr.sent >= 1 && /^☀️/.test(photos[0].caption), JSON.stringify(dr));
  assert.strictEqual(T.dailyCardDue('d', seven), false); photos.length = 0; assert.strictEqual((await T.maybeDailyCard(seven)).sent, 0); assert.strictEqual(photos.length, 0);
  // ---- the Menu / Profit calendar buttons under a PnL card (a PHOTO): the menu comes as a new message, never an edit
  apis.length = 0; msgs.length = 0; await T.handleUpdate(cbPhoto('ps|d')); assert.ok(!apis.some(a => a.method === 'editMessageText'), 'must not edit a photo'); m = msgs.pop(); assert.ok(m && /Profit calendar/.test(m.text), 'calendar menu as a new message');
  apis.length = 0; msgs.length = 0; await T.handleUpdate(cbPhoto('mn')); assert.ok(!apis.some(a => a.method === 'editMessageText')); m = msgs.pop(); assert.ok(m && /menu/i.test(m.text));
  // ---- LIVE mode (STOP removed): the chat says LIVE, never dry run / paper
  assert.ok(T.isLiveNow() === false, 'STOP present = dry run'); assert.strictEqual(T.liveWording('[DRY RUN] x'), '[DRY RUN] x');
  fs.unlinkSync(path.join(root, 'STOP'));
  { const x = T.liveWording('📋 [DRY RUN] Status dry run: paper bot, paper/STOP dibuat, Dry Run #2'); assert.ok(T.isLiveNow() && /\[LIVE\] Status live: live bot/.test(x) && /paper\/STOP/.test(x) && !/dry run/i.test(x), 'live wording: ' + x); }
  fs.writeFileSync(path.join(root, 'STOP'), '');   // back to dry run
  // ---- every close = ONE message: the PnL card with the close summary (HTML) as its caption
  msgs.length = 0; photos.length = 0; T.notifyClose({ ...closed(9, 6.5), pnlUsd: 4.7 }); await wait(6000);
  assert.ok(msgs.length === 0 && photos.length === 1 && photos[0].png.length > 50000 && /POOL9\/SOL/.test(photos[0].caption) && photos[0].opts.parse_mode === 'HTML', JSON.stringify({ m: msgs.length, p: photos.length }));
  T.setAutoCard(false); photos.length = 0; msgs.length = 0; T.notifyClose(closed(9, 6.5)); await wait(1500); assert.strictEqual(photos.length, 0); assert.ok(msgs.length === 1 && /POOL9\/SOL/.test(msgs[0].text), 'card off: the text alone');
  console.log('test-bot-menus: OK');
})().catch(e => { console.error(e); process.exit(1); });
