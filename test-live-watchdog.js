'use strict';
// Live must come back by itself after a reboot / crash: runs the watchdog logic test (fake pm2, temp dir).
const { execFileSync } = require('child_process'), path = require('path');
const out = execFileSync('bash', [path.join(__dirname, 'test-live-watchdog.sh')], { encoding: 'utf8', timeout: 60000 });
if (!/test-live-watchdog: OK/.test(out)) { console.error(out); process.exit(1); }
console.log('test-live-watchdog (js): OK');
