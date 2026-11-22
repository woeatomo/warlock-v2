'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'); const S = require('./paper-settings');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
t('NOTIFY_RESHAPE is a shared setting, default OFF, restored by Reset', () => {
  assert.strictEqual(S.DEFAULTS.NOTIFY_RESHAPE, false); assert.strictEqual(S.FIELDS.NOTIFY_RESHAPE.default, false);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-')); const a = S.applySettings(d, { NOTIFY_RESHAPE: true }, { updatedBy: 't' }); assert.ok(a.ok); assert.strictEqual(a.values.NOTIFY_RESHAPE, true);
  assert.strictEqual(S.resetSettings(d, { updatedBy: 't' }).values.NOTIFY_RESHAPE, false);
});
t('reshape Telegram message is sent only when NOTIFY_RESHAPE is true; open / reposition / close notifications are untouched', () => {
  assert.ok(/if \(CFG\.NOTIFY_RESHAPE === true\) telegram\.notifyReshape\(/.test(src));
  for (const k of ['telegram.notifyOpen(', 'telegram.notifyReposition(', 'telegram.notifyClose', 'telegram.notifyEmergency']) assert.ok(src.includes(k), k);
  assert.ok(!/if \(CFG\.NOTIFY_RESHAPE[^)]*\) telegram\.notify(Open|Reposition|Close)/.test(src));
  assert.ok(/for\(const k of \[[^\]]*'NOTIFY_RESHAPE'/.test(src));
});
console.log('all', n, 'tests passed');
