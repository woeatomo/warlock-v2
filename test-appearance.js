'use strict';
// woeatomo fork: Mini App appearance store (wallpaper + glass prefs). Runs in a temp dir.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const ap = require('./miniapp/appearance-store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-')), file = path.join(dir, 'appearance.json');
assert.deepStrictEqual(ap.read(file), { ...ap.DEFAULTS });                                    // no file -> defaults
let r = ap.update(file, { glass: 0.35, blur: 50, dim: -1 });
assert.ok(r.ok); assert.strictEqual(r.prefs.glass, 0.35); assert.strictEqual(r.prefs.blur, 30); assert.strictEqual(r.prefs.dim, 0);   // clamped
assert.strictEqual(ap.update(file, { glass: 'abc' }).ok, false);
assert.strictEqual(ap.read(file).glass, 0.35);                                                 // persisted
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
assert.strictEqual(ap.saveBg(file, dir, 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64')).ok, false);   // not an image by magic bytes
assert.strictEqual(ap.saveBg(file, dir, '').ok, false);
r = ap.saveBg(file, dir, 'data:image/jpeg;base64,' + jpg.toString('base64'));
assert.ok(r.ok && r.hasBg && r.prefs.bgVersion > 0 && fs.existsSync(path.join(dir, 'bg.jpg')));
r = ap.saveBg(file, dir, png.toString('base64'));                                              // replacing removes the old file
assert.ok(r.ok && fs.existsSync(path.join(dir, 'bg.png')) && !fs.existsSync(path.join(dir, 'bg.jpg')));
assert.strictEqual(ap.findBg(dir).type, 'image/png');
assert.strictEqual(ap.saveBg(file, dir, Buffer.concat([jpg, Buffer.alloc(ap.MAX_IMAGE_BYTES)]).toString('base64')).ok, false);   // too large
r = ap.reset(file, dir); assert.strictEqual(r.prefs.glass, ap.DEFAULTS.glass); assert.ok(r.hasBg);   // reset keeps the wallpaper
r = ap.deleteBg(file, dir); assert.ok(r.ok && !r.hasBg && !ap.findBg(dir));
fs.rmSync(dir, { recursive: true, force: true });
// server wiring
const src = fs.readFileSync(path.join(__dirname, 'miniapp/server.js'), 'utf8');
assert.ok(/'\/api\/appearance', '\/api\/appearance\/reset', '\/api\/appearance\/bg', '\/api\/appearance\/bg\/delete'/.test(src), 'write routes need CSRF');
assert.ok(/pathname === '\/api\/appearance\/bg' \? 6 \* 1024 \* 1024/.test(src), 'upload body limit');
console.log('appearance tests passed');
