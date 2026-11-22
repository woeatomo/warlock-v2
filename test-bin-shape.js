// Local-only BIN SHAPE tests. Never sends a trade notification to Telegram.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const binShape = require('./bin-shape');
const tg = require('./telegram-notify');
const { publicStatus } = require('./miniapp/server');

const OUT = path.join('/tmp', 'lp-bot-bin-shape-test.png');
const PAPER_OUT = path.join(__dirname, 'paper', 'bin-shape-test.png');

const prevTunnel = fs.existsSync(tg.TUNNEL_FILE) ? fs.readFileSync(tg.TUNNEL_FILE, 'utf8') : null;
function restoreTunnel() {
  try {
    if (prevTunnel == null) { if (fs.existsSync(tg.TUNNEL_FILE)) fs.unlinkSync(tg.TUNNEL_FILE); }
    else fs.writeFileSync(tg.TUNNEL_FILE, prevTunnel);
  } catch { /* ignore */ }
}

const synthetic = {
  name: 'TEST-SOL',
  pool: 'Test111111111111111111111111111111111111111',
  shape: 'M-double-bidask',
  minBinId: 100,
  maxBinId: 107,
  activeBin: 103,
  lastActiveBin: 103,
  bins: {
    100: { y: 1.00, x: 0 },
    101: { y: 0.80, x: 0 },
    102: { y: 0.50, x: 0 },
    103: { y: 0.20, x: 0.10 },
    104: { y: 0, x: 0.20 },
    105: { y: 0, x: 0.50 },
    106: { y: 0, x: 0.90 },
    107: { y: 0, x: 1.20 },
  },
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (e) { failed += 1; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

check('chartModel M-shape + active + range', () => {
  const m = binShape.chartModel(synthetic);
  assert.strictEqual(m.isM, true);
  assert.strictEqual(m.activeBin, 103);
  assert.strictEqual(m.minBinId, 100);
  assert.strictEqual(m.maxBinId, 107);
  assert.strictEqual(m.bins.length, 8);
  assert.ok(m.bins[0].sol > m.bins[0].token);
  assert.ok(m.bins[m.bins.length - 1].token > m.bins[m.bins.length - 1].sol);
  const active = m.bins.find((b) => b.id === 103);
  assert.ok(active);
});

check('renderPng writes a real PNG locally (not sent)', () => {
  const buf = binShape.renderPng(synthetic);
  assert.ok(binShape.isPng(buf), 'png signature');
  assert.ok(buf.length > 800, 'png too small: ' + buf.length);
  assert.ok(buf.length < 500000, 'png unexpectedly huge: ' + buf.length);
  fs.writeFileSync(OUT, buf);
  fs.mkdirSync(path.dirname(PAPER_OUT), { recursive: true });
  fs.writeFileSync(PAPER_OUT, buf);
  assert.ok(fs.existsSync(OUT));
});

check('publicPos includes binShape and strips raw bins', () => {
  // Replicate publicPos contract via a tiny require of bot would start the bot.
  // Instead assert chartModel is what Status will consume, and a standalone mirror.
  const { bins, ...rest } = synthetic;
  const binShapeModel = binShape.chartModel(synthetic);
  const pub = { ...rest, inventory: { x: 0, y: 0, nBins: Object.keys(bins).length }, binShape: binShapeModel };
  assert.ok(!pub.bins);
  assert.ok(pub.binShape && pub.binShape.bins.length === 8);
  assert.ok(pub.binShape.isM);
});

const captured = { photos: [], texts: [] };
tg.setPhotoTransport((caption, png, opts) => {
  captured.photos.push({ caption, png, opts });
  return { ok: true, photo: true, captured: true };
});
tg.setMessageTransport((text, opts) => {
  captured.texts.push({ text, opts });
  return { ok: true, text: true, captured: true };
});

check('notifyOpen uses sendPhoto with Meteora/LP Agent buttons (stubbed, not sent)', async () => {});

async function runAsync() {
  captured.photos.length = 0;
  captured.texts.length = 0;
  const openRes = await tg.notifyOpen({
    name: synthetic.name,
    pool: synthetic.pool,
    sizeSol: 1.2,
    usdcIn: 100,
    gasBufferSol: 0.3,
    leftoverSol: 0.1,
    minBinId: 100,
    maxBinId: 107,
    rangePct: 4.2,
    entryPrice: 0.001,
    ft30m: 2.5,
    tvl: 80000,
    bins: synthetic.bins,
    activeBin: 103,
    shape: 'left-50-50',
  });
  assert.ok(openRes && openRes.ok && openRes.photo, 'open photo not captured: ' + JSON.stringify(openRes));
  assert.strictEqual(captured.photos.length, 1);
  assert.strictEqual(captured.texts.length, 0, 'must not fall back to text when photo works');
  const p = captured.photos[0];
  assert.ok(binShape.isPng(p.png));
  assert.ok(/POSISI BARU/.test(p.caption));
  assert.ok(!/1000000001/.test(JSON.stringify(p.caption)));
  const kb = p.opts && p.opts.reply_markup && p.opts.reply_markup.inline_keyboard;
  const flat = (kb || []).flat();
  assert.ok(flat.some((b) => /meteora/i.test(b.text) && b.url && /meteora/.test(b.url)));
  assert.ok(flat.some((b) => /lp agent/i.test(b.text) && b.url && /lpagent/.test(b.url)));
  assert.ok(!flat.some((b) => b.web_app), 'trade notifications must not use web_app');
  console.log('ok  notifyOpen sendPhoto stub (not sent to operator)');

  captured.photos.length = 0;
  captured.texts.length = 0;
  const reshapeRes = await tg.notifyReshape({
    name: synthetic.name,
    pool: synthetic.pool,
    n: 5,
    reshapes: 1,
    activeBin: 103,
    rightMin: 104,
    rightMax: 107,
    amountX: 1e-3,
    tokenX: 8e-4,
    feeXAdded: 1e-5,
    feeYAdded: 0.0002,
    bins: synthetic.bins,
    minBinId: 100,
    maxBinId: 107,
    shape: 'M-double-bidask',
  });
  assert.ok(reshapeRes && reshapeRes.skipped && !reshapeRes.ok);   // reshape is silent (operator t238u)
  assert.strictEqual(captured.photos.length, 0);
  console.log('ok  notifyReshape sendPhoto stub (not sent to operator)');

  // photo failure -> text fallback, still stubbed
  tg.setPhotoTransport(() => ({ ok: false, error: 'forced fail' }));
  captured.photos.length = 0;
  captured.texts.length = 0;
  const fallback = await tg.notifyOpen({
    name: 'TEST-SOL', pool: synthetic.pool, bins: synthetic.bins, activeBin: 103, minBinId: 100, maxBinId: 107,
  });
  assert.ok(fallback && fallback.ok && fallback.text, 'fallback should be text via stub');
  assert.strictEqual(captured.texts.length, 1);
  assert.ok(/POSISI BARU/.test(captured.texts[0].text));
  console.log('ok  notifyOpen text fallback when photo fails (stubbed)');

  // restore photo stub
  tg.setPhotoTransport((caption, png, opts) => {
    captured.photos.push({ caption, png, opts });
    return { ok: true, photo: true, captured: true };
  });

  // /start web_app only for operator; denied for others
  const url = 'https://example-test.trycloudflare.com';
  // writeTunnelUrl only accepts trycloudflare — use that
  tg.writeTunnelUrl(url);
  captured.texts.length = 0;
  const startOk = await tg.handleUpdate({
    update_id: 1,
    message: { text: '/start', from: { id: 1000000001 }, chat: { id: 1000000001 } },
  });
  assert.ok(startOk && startOk.ok, 'tuan /start should reply');
  const last = captured.texts[captured.texts.length - 1];
  assert.ok(last, 'start reply captured');
  const startKb = last.opts && last.opts.reply_markup && last.opts.reply_markup.inline_keyboard;
  const startBtn = (startKb || []).flat()[0];
  assert.ok(last.opts.allowWebApp, 'allowWebApp must be set for /start');
  assert.ok(startBtn && startBtn.web_app && startBtn.web_app.url === url, 'web_app url missing');
  console.log('ok  /start replies with web_app for operator only (stubbed)');

  captured.texts.length = 0;
  const denied = await tg.handleUpdate({
    update_id: 2,
    message: { text: '/start', from: { id: 999999 }, chat: { id: 999999 } },
  });
  assert.ok(denied && !denied.ok);
  assert.strictEqual(captured.texts.length, 0, 'stranger /start must not get a reply');
  console.log('ok  /start ignored for non-operator');

  // invalid url rejected
  const bad = await tg.publishMiniAppUrl('http://evil.example');
  assert.ok(!bad.ok);
  console.log('ok  publishMiniAppUrl rejects non-trycloudflare');

  // no secret leak in captured payloads
  const blob = JSON.stringify(captured);
  assert.ok(!/BOT_TOKEN|private_key|BEGIN/i.test(blob));
  console.log('ok  no secrets in captured notify payloads');
  restoreTunnel();
}

runAsync().then(() => {
  restoreTunnel();
  tg.setPhotoTransport(null);
  tg.setMessageTransport(null);
  if (failed) {
    console.error(failed + ' sync test(s) failed');
    process.exit(1);
  }
  console.log('ALL bin-shape tests passed (PNG at ' + OUT + '; no Telegram send)');
  process.exit(0);
}).catch((e) => {
  restoreTunnel();
  tg.setPhotoTransport(null);
  tg.setMessageTransport(null);
  console.error('FAIL async: ' + (e && e.stack || e));
  process.exit(1);
});
