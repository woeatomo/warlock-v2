/* Warlock Mini App: "Tampilan" tab (woeatomo fork). Wallpaper upload/remove plus glass, blur and dim sliders with live preview.
   Cosmetic only. Writes use the same Telegram initData + single-use CSRF as the other settings. */
(function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var st = { csrf: null, saved: null, defaults: { glass: 0.6, blur: 10, dim: 0.55 }, limits: null, hasBg: false, bgVersion: 0, busy: false };

  function initData() { return (tg && tg.initData) || ''; }

  function apply(p, hasBg, bgVersion) {
    root.style.setProperty('--glass', String(p.glass));
    root.style.setProperty('--glass-blur', p.blur + 'px');
    root.style.setProperty('--bg-dim', String(p.dim));
    if (hasBg !== undefined) {
      root.style.setProperty('--bg-img', hasBg ? "url('/bg?v=" + (bgVersion || 0) + "')" : 'none');
    }
  }

  async function call(method, path, body) {
    var opts = { method: method, headers: { 'X-Telegram-Init-Data': initData() } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(Object.assign({}, body, { initData: initData(), csrf: st.csrf }));
    }
    var res = await fetch(path, opts);
    var json = await res.json().catch(function () { return { ok: false, error: 'respon tidak valid' }; });
    if (json && json.csrf) st.csrf = json.csrf;
    if (res.status === 429 && body) {   // one write per 0.75 s on the server: wait and send once more
      await new Promise(function (r) { setTimeout(r, 900); });
      opts.body = JSON.stringify(Object.assign({}, body, { initData: initData(), csrf: st.csrf }));
      res = await fetch(path, opts);
      json = await res.json().catch(function () { return { ok: false, error: 'respon tidak valid' }; });
      if (json && json.csrf) st.csrf = json.csrf;
    }
    if (res.status === 403 && body && /csrf/i.test(String(json && json.reason))) {   // token expired: fetch a fresh one and retry once
      await load(false);
      opts.body = JSON.stringify(Object.assign({}, body, { initData: initData(), csrf: st.csrf }));
      res = await fetch(path, opts);
      json = await res.json().catch(function () { return { ok: false, error: 'respon tidak valid' }; });
      if (json && json.csrf) st.csrf = json.csrf;
    }
    return { status: res.status, json: json || {} };
  }

  function note(text, err) {
    var el = $('ap-note'); if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('ap-err', !!err);
  }

  function current() {
    return {
      glass: +$('ap-glass').value / 100,
      blur: +$('ap-blur').value,
      dim: +$('ap-dim').value / 100,
    };
  }

  function labels() {
    $('ap-glass-v').textContent = $('ap-glass').value + '%';
    $('ap-blur-v').textContent = $('ap-blur').value + 'px';
    $('ap-dim-v').textContent = $('ap-dim').value + '%';
  }

  function fill(p) {
    $('ap-glass').value = Math.round(p.glass * 100);
    $('ap-blur').value = Math.round(p.blur);
    $('ap-dim').value = Math.round(p.dim * 100);
    labels();
  }

  function paintThumb() {
    var t = $('ap-thumb'); if (!t) return;
    t.style.backgroundImage = st.hasBg ? "url('/bg?v=" + st.bgVersion + "')" : 'none';
    t.classList.toggle('ap-empty', !st.hasBg);
    $('ap-thumb-label').textContent = st.hasBg ? '' : 'Belum ada wallpaper';
    $('ap-del').disabled = !st.hasBg;
  }

  function dirty() {
    if (!st.saved) return false;
    var c = current();
    return Math.abs(c.glass - st.saved.glass) > 1e-6 || Math.abs(c.blur - st.saved.blur) > 1e-6 || Math.abs(c.dim - st.saved.dim) > 1e-6;
  }

  function syncSaveBtn() { var b = $('ap-save'); if (b) b.disabled = st.busy || !dirty(); }

  async function load(paint) {
    try {
      var r = await call('GET', '/api/appearance');
      if (!r.json.ok) return;
      st.saved = r.json.prefs; st.hasBg = !!r.json.hasBg; st.bgVersion = r.json.prefs.bgVersion || 0;
      if (r.json.defaults) st.defaults = r.json.defaults;
      if (paint !== false) { apply(st.saved, st.hasBg, st.bgVersion); if ($('ap-glass')) { fill(st.saved); paintThumb(); syncSaveBtn(); } }
    } catch (e) { /* keep CSS defaults */ }
  }

  // Shrink on the phone before upload: long side max 1600 px, JPEG. Keeps uploads small and the Mini App fast.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var q = 0.85, out = c.toDataURL('image/jpeg', q);
          while (out.length > 4.5e6 && q > 0.45) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
          URL.revokeObjectURL(url); resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Gambar tidak bisa dibaca')); };
      img.src = url;
    });
  }

  function busy(on) {
    st.busy = on;
    ['ap-pick', 'ap-del', 'ap-reset'].forEach(function (id) { var b = $(id); if (b) b.disabled = on || (id === 'ap-del' && !st.hasBg); });
    syncSaveBtn();
  }

  function haptic(kind) { try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* ignore */ } }

  function bind() {
    ['ap-glass', 'ap-blur', 'ap-dim'].forEach(function (id) {
      $(id).addEventListener('input', function () { labels(); apply(current()); syncSaveBtn(); });
    });

    $('ap-save').addEventListener('click', async function () {
      busy(true); note('Menyimpan…');
      var r = await call('POST', '/api/appearance', current());
      busy(false);
      if (r.json.ok) { st.saved = r.json.prefs; syncSaveBtn(); note('Tersimpan ✓'); haptic('success'); }
      else { note('Gagal: ' + (r.json.error || r.json.reason || r.status), true); haptic('error'); }
    });

    $('ap-reset').addEventListener('click', async function () {
      if (!confirm('Kembalikan transparansi, blur dan gelap wallpaper ke default? Wallpaper tidak dihapus.')) return;
      busy(true); note('Mereset…');
      var r = await call('POST', '/api/appearance/reset', { confirmed: true });
      busy(false);
      if (r.json.ok) { st.saved = r.json.prefs; fill(st.saved); apply(st.saved); syncSaveBtn(); note('Kembali ke default ✓'); haptic('success'); }
      else { note('Gagal: ' + (r.json.error || r.json.reason || r.status), true); haptic('error'); }
    });

    $('ap-pick').addEventListener('click', function () { $('ap-file').click(); });

    $('ap-file').addEventListener('change', async function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { note('File harus berupa gambar', true); return; }
      busy(true); note('Memproses gambar…');
      try {
        var data = await shrink(f);
        note('Mengupload (' + Math.round(data.length * 0.75 / 1024) + ' KB)…');
        var r = await call('POST', '/api/appearance/bg', { image: data });
        if (r.json.ok) {
          st.hasBg = true; st.bgVersion = r.json.prefs.bgVersion; st.saved = Object.assign({}, st.saved, { bgVersion: st.bgVersion });
          apply(current(), true, st.bgVersion); paintThumb(); note('Wallpaper diganti ✓'); haptic('success');
        } else { note('Gagal: ' + (r.json.error || r.json.reason || r.status), true); haptic('error'); }
      } catch (err) { note('Gagal: ' + (err && err.message), true); haptic('error'); }
      busy(false);
    });

    $('ap-del').addEventListener('click', async function () {
      if (!confirm('Hapus wallpaper? Tampilan kembali ke warna polos.')) return;
      busy(true); note('Menghapus…');
      var r = await call('POST', '/api/appearance/bg/delete', { confirmed: true });
      busy(false);
      if (r.json.ok) { st.hasBg = false; st.bgVersion = r.json.prefs.bgVersion; apply(current(), false); paintThumb(); note('Wallpaper dihapus ✓'); haptic('success'); }
      else { note('Gagal: ' + (r.json.error || r.json.reason || r.status), true); haptic('error'); }
    });
  }

  function start() { if ($('ap-glass')) bind(); load(true); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
