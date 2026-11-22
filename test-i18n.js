'use strict';
// Mini App language switch: dictionary over text, attributes, dynamic content, dialogs; restore on ID. jsdom only.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><title>Warlock 2.0 — Dry Run / Live</title><body><header><div class="lang-switch"><button data-lang="en">EN</button><button data-lang="id" class="on">ID</button></div></header>' +
  '<h2>Posisi terbuka</h2><p id="a">Memuat portofolio…</p><input id="i" placeholder="Tempel key di sini"><button id="b">Simpan / Ganti key</button><p id="n">Posisi open 3 · saldo bebas 2.5 SOL</p></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window; let confirmed = null; w.confirm = (m) => { confirmed = m; return true; };
w.eval(fs.readFileSync(path.join(__dirname, 'miniapp', 'public', 'i18n.js'), 'utf8'));
const $ = (s) => w.document.querySelector(s), text = (s) => $(s).textContent;
const tick = () => new Promise((r) => setTimeout(r, 20));
(async () => {
  const events = []; w.document.addEventListener('warlock:lang', (e) => events.push(e.detail.lang));
  assert.strictEqual(w.WarlockI18n.lang, 'id'); assert.strictEqual(text('h2'), 'Posisi terbuka');
  $('[data-lang="en"]').click(); await tick();
  assert.strictEqual(w.WarlockI18n.lang, 'en'); assert.deepStrictEqual(events, ['en']);
  assert.strictEqual(text('h2'), 'Open positions'); assert.strictEqual(text('#a'), 'Loading portfolio…'); assert.strictEqual(text('#b'), 'Save / Replace key');
  assert.strictEqual($('#i').getAttribute('placeholder'), 'Paste key here'); assert.ok(/^Open positions 3 /.test(text('#n')) && /2\.5 SOL/.test(text('#n')), text('#n'));
  assert.strictEqual(w.document.documentElement.getAttribute('lang'), 'en'); assert.ok($('[data-lang="en"]').classList.contains('on') && !$('[data-lang="id"]').classList.contains('on'));
  // content the app writes later is translated too (innerHTML re-render and textContent updates)
  const d = w.document.createElement('div'); d.innerHTML = '<b>Belum ada posisi ditutup dalam 24 jam.</b>'; w.document.body.appendChild(d); await tick();
  assert.strictEqual(d.textContent, 'No positions closed in the last 24 hours.');
  $('#a').textContent = 'Gerbang verifikasi: semua tertutup'; await tick(); assert.strictEqual(text('#a'), 'Verification gates: all closed');
  // dialogs
  w.confirm('Matikan live? Posisi live ditutup (jika ada) dan proses live dihentikan.'); assert.strictEqual(confirmed, 'Turn live off? Live positions are closed (if any) and the live process stops.');
  // back to Indonesian restores the originals, including attributes
  $('[data-lang="id"]').click(); await tick();
  assert.strictEqual(text('h2'), 'Posisi terbuka'); assert.strictEqual(text('#b'), 'Simpan / Ganti key'); assert.strictEqual($('#i').getAttribute('placeholder'), 'Tempel key di sini'); assert.strictEqual(text('#n'), 'Posisi open 3 · saldo bebas 2.5 SOL');
  assert.deepStrictEqual(events, ['en', 'id']); w.confirm('Matikan live?'); assert.strictEqual(confirmed, 'Matikan live?');
  // settings labels and status lines that the server / app build in Indonesian
  { const d2 = w.document.createElement('div'); d2.innerHTML = '<label>Jeda buka ulang pool setelah close (0 = off)</label><span>menit</span><p>TP emergency sudah aktif. SL+ aktif begitu PnL menyentuh +3%</p><b>Maksimum posisi terbuka</b><i>Posisi 2/7</i>'; w.document.body.appendChild(d2); w.WarlockI18n.set('en', { silent: true }); await tick();
    assert.strictEqual(d2.querySelector('label').textContent, 'Cooldown before reopening a pool after close (0 = off)'); assert.strictEqual(d2.querySelector('span').textContent, 'min');
    assert.strictEqual(d2.querySelector('p').textContent, 'Emergency TP is active. SL+ activates as soon as PnL reaches +3%'); assert.strictEqual(d2.querySelector('b').textContent, 'Maximum open positions'); assert.strictEqual(d2.querySelector('i').textContent, 'Positions 2/7'); w.WarlockI18n.set('id', { silent: true }); await tick(); }
  // sync from the server does not echo an event back
  w.WarlockI18n.sync('en'); await tick(); assert.strictEqual(w.WarlockI18n.lang, 'en'); assert.deepStrictEqual(events, ['en', 'id']);
  console.log('test-i18n: OK');
})().catch((e) => { console.error(e); process.exit(1); });
