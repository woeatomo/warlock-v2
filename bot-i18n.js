'use strict';
// Indonesian / English texts for the Telegram menus and cards. The chosen language lives in lang.json (bot root), shared with the Mini App.
const fs = require('fs'), path = require('path');
const FILE = 'lang.json';
const DICT = {
  id: {
    start: '🚀 Warlock 2.0 siap. Ini menu yang tersedia:',
    start_list: '📜 /history — History close + generate PnL card\n📈 /open — Posisi open + generate PnL card\n🌐 /lang — Ganti bahasa (ID / EN)\n🗓 /calendar — Profit calendar (kartu PnL harian / mingguan / bulanan)\n🏠 /menu — Tampilkan menu ini lagi\n❓ /help — Bantuan\n🧩 Mini app — Status, Settings, Wallet, Live (tombol di bawah)',
    start_no_url: '⏳ Mini app belum punya URL publik. Coba /start lagi sebentar.',
    btn_miniapp: 'Buka mini app', btn_history: '📜 History close', btn_open: '📈 Posisi open', btn_lang: '🌐 English',
    btn_pnl: '🗓 Profit calendar', btn_today: '📅 Hari ini', btn_yesterday: '📅 Kemarin', btn_thisweek: '📆 Minggu ini', btn_lastweek: '📆 Minggu lalu', btn_thismonth: '🗓 Bulan ini', btn_lastmonth: '🗓 Bulan lalu',
    pnl_title: '🗓 Profit calendar · {mode}\nPilih periode untuk membuat kartu PnL (hari = 07:00–07:00 WIB):',
    caption_period: '{icon} PnL {label} · {title}\n💵 {pnl}\n🔢 {trades} trade ({wl}) · menang {winrate}%\n🏆 Terbaik: {best}\n🔻 Terburuk: {worst}',
    period_day: 'harian', period_week: 'mingguan', period_month: 'bulanan', none: 'tidak ada',
    help_text: '❓ Bantuan Warlock 2.0\n\n🚀 /start — Menu utama + daftar menu\n📜 /history — History close, pilih trade → PnL card\n📈 /open — Posisi open, pilih posisi → PnL card\n🗓 /calendar — Profit calendar: kartu PnL harian, mingguan, bulanan\n🌐 /lang — Ganti bahasa (ID / EN)\n🏠 /menu — Tampilkan menu\n❓ /help — Bantuan ini\n\nℹ️ Kartu PnL juga dikirim otomatis setiap posisi ditutup, dan kartu PnL harian dikirim tiap hari jam 07:00 WIB. Merah = rugi, hijau = profit.',
    btn_dry: '🧪 Dry run', btn_live: '🔴 Live', btn_prev: '⬅️ Lebih baru', btn_next: 'Lebih lama ➡️', btn_menu: '🏠 Menu', btn_refresh: '🔄 Perbarui kartu',
    mode_dry: 'Dry run', mode_live: 'Live',
    menu_title: '📋 Menu Warlock 2.0\nPilih yang mau dilihat:',
    history_title: '📜 History close · {mode} · hal {page}/{pages} ({n} trade)', history_hint: 'Pilih trade untuk membuat PnL card.', history_empty: '📭 Belum ada trade yang ditutup di {mode}.',
    open_title: '📈 Posisi open · {mode} ({n})', open_hint: 'Pilih posisi untuk PnL card (snapshot saat ini).', open_empty: '📭 Tidak ada posisi open di {mode}.',
    caption_closed: '{icon} {name} ditutup · {pnl}\n🕒 {when} · ⏱ {held}\n🧾 {reason}', caption_open: '📈 {name} masih berjalan · {pnl}\n⏱ Sudah {held} · 📸 snapshot terakhir',
    card_fail: '⚠️ Gagal membuat kartu. Coba lagi sebentar.', not_found: '⚠️ Data tidak ditemukan (mungkin sudah berubah). Buka menu lagi.', lang_set: '🌐 Bahasa: Indonesia',
    cmd_start: 'Buka mini app Warlock 2.0', cmd_history: 'History close + PnL card', cmd_open: 'Posisi open + PnL card', cmd_lang: 'Ganti bahasa (ID/EN)', cmd_menu: 'Menu', cmd_calendar: 'Profit calendar: kartu PnL harian/mingguan/bulanan', cmd_help: 'Bantuan',
  },
  en: {
    start: '🚀 Warlock 2.0 is ready. Here is what you can do:',
    start_list: '📜 /history — Close history + generate PnL card\n📈 /open — Open positions + generate PnL card\n🌐 /lang — Switch language (ID / EN)\n🗓 /calendar — Profit calendar (daily / weekly / monthly PnL cards)\n🏠 /menu — Show this menu again\n❓ /help — Help\n🧩 Mini app — Status, Settings, Wallet, Live (button below)',
    start_no_url: '⏳ The mini app has no public URL yet. Try /start again in a moment.',
    btn_miniapp: 'Open mini app', btn_history: '📜 Close history', btn_open: '📈 Open positions', btn_lang: '🌐 Bahasa Indonesia',
    btn_pnl: '🗓 Profit calendar', btn_today: '📅 Today', btn_yesterday: '📅 Yesterday', btn_thisweek: '📆 This week', btn_lastweek: '📆 Last week', btn_thismonth: '🗓 This month', btn_lastmonth: '🗓 Last month',
    pnl_title: '🗓 Profit calendar · {mode}\nPick a period to generate its PnL card (day = 07:00–07:00 WIB):',
    caption_period: '{icon} {label} PnL · {title}\n💵 {pnl}\n🔢 {trades} trades ({wl}) · {winrate}% won\n🏆 Best: {best}\n🔻 Worst: {worst}',
    period_day: 'daily', period_week: 'weekly', period_month: 'monthly', none: 'none',
    help_text: '❓ Warlock 2.0 help\n\n🚀 /start — Main menu + list of menus\n📜 /history — Close history, pick a trade → PnL card\n📈 /open — Open positions, pick one → PnL card\n🗓 /calendar — Profit calendar: daily, weekly and monthly PnL cards\n🌐 /lang — Switch language (ID / EN)\n🏠 /menu — Show the menu\n❓ /help — This help\n\nℹ️ A PnL card is also sent automatically whenever a position closes, and a daily PnL card every day at 07:00 WIB. Red = loss, green = profit.',
    btn_dry: '🧪 Dry run', btn_live: '🔴 Live', btn_prev: '⬅️ Newer', btn_next: 'Older ➡️', btn_menu: '🏠 Menu', btn_refresh: '🔄 Refresh card',
    mode_dry: 'Dry run', mode_live: 'Live',
    menu_title: '📋 Warlock 2.0 menu\nPick what to view:',
    history_title: '📜 Close history · {mode} · page {page}/{pages} ({n} trades)', history_hint: 'Pick a trade to generate its PnL card.', history_empty: '📭 No closed trades in {mode} yet.',
    open_title: '📈 Open positions · {mode} ({n})', open_hint: 'Pick a position for its PnL card (current snapshot).', open_empty: '📭 No open positions in {mode}.',
    caption_closed: '{icon} {name} closed · {pnl}\n🕒 {when} · ⏱ {held}\n🧾 {reason}', caption_open: '📈 {name} is still open · {pnl}\n⏱ Open for {held} · 📸 latest snapshot',
    card_fail: '⚠️ Could not render the card. Try again in a moment.', not_found: '⚠️ Not found (it may have changed). Open the menu again.', lang_set: '🌐 Language: English',
    cmd_start: 'Open the Warlock 2.0 mini app', cmd_history: 'Close history + PnL card', cmd_open: 'Open positions + PnL card', cmd_lang: 'Switch language (ID/EN)', cmd_menu: 'Menu', cmd_calendar: 'Profit calendar: daily/weekly/monthly PnL cards', cmd_help: 'Help',
  },
};
const norm = (l) => (l === 'en' ? 'en' : 'id');
function getLang(root) { try { return norm(JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8')).lang); } catch { return 'id'; } }
function setLang(root, lang) { const l = norm(lang), tmp = path.join(root, FILE + '.tmp'); fs.writeFileSync(tmp, JSON.stringify({ lang: l, updatedAt: new Date().toISOString() }) + '\n'); fs.renameSync(tmp, path.join(root, FILE)); return l; }
function t(lang, key, vars = {}) {
  const s = (DICT[norm(lang)][key] ?? DICT.id[key] ?? key);
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}
// Notification texts are written in Indonesian; English is applied from one phrase list (phrases-en.json, longest phrase first). Menu texts are already bilingual and pass through unchanged.
let phrases = null;
function loadPhrases() { if (phrases) return phrases; try { phrases = JSON.parse(fs.readFileSync(path.join(__dirname, 'phrases-en.json'), 'utf8')).sort((a, b) => b[0].length - a[0].length); } catch { phrases = []; } return phrases; }
function trText(lang, s) {
  if (norm(lang) !== 'en' || !s) return s;
  let out = String(s);
  for (const [a, b] of loadPhrases()) if (out.includes(a)) out = out.split(a).join(b);
  return out;
}
module.exports = { FILE, DICT, getLang, setLang, t, norm, trText };
