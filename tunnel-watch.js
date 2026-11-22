// Spawn cloudflared quick tunnel to the mini app and publish the trycloudflare URL
// to the operator's Telegram chat menu + /start command on every change.
// Never logs or stores the bot token.
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const telegram = require('./telegram-notify');

const CLOUDFLARED = process.env.CLOUDFLARED || path.join(process.env.HOME || '/home/box', '.local/bin/cloudflared');
const TARGET = process.env.TUNNEL_TARGET || 'http://127.0.0.1:8787';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function wib() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }).replace(',', '') + ' WIB';
}

function log(msg) {
  process.stderr.write('[' + wib() + '] [lp-tunnel] ' + msg + '\n');
}

function extractUrl(chunk) {
  const m = String(chunk).match(URL_RE);
  return m ? m[0].replace(/\/$/, '') : '';
}

let current = '';
let publishing = Promise.resolve();

function onUrl(url) {
  if (!url || url === current) return;
  current = url;
  log('public url ' + url);
  publishing = publishing.then(() => telegram.publishMiniAppUrl(url)).then((res) => {
    if (res && res.changed) {
      log('menu button updated' + (res.ok ? '' : ' (telegram call had an error)'));
    } else if (res && !res.ok) {
      log('publish skipped or failed');
    }
  }).catch(() => {
    log('publish failed');
  });
}

function startCloudflared() {
  if (!fs.existsSync(CLOUDFLARED)) {
    log('cloudflared missing at ' + CLOUDFLARED);
    process.exit(1);
  }
  const args = ['tunnel', '--url', TARGET, '--no-autoupdate', '--protocol', 'http2'];
  log('starting cloudflared ' + args.join(' ') + ' (binary present)');
  const child = spawn(CLOUDFLARED, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH || '/home/box/.local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/home/box',
      // Do not inherit token/key even if the parent leaked them.
    },
  });
  let buf = '';
  const onData = (d) => {
    const text = d.toString('utf8');
    buf += text;
    if (buf.length > 20000) buf = buf.slice(-8000);
    const url = extractUrl(buf);
    if (url) onUrl(url);
    for (const line of text.split(/\n+/)) {
      const L = line.trim();
      if (!L) continue;
      if (URL_RE.test(L) || /ERR|error|failed|registered|connIndex|protocol|Unable|inf/i.test(L)) {
        log('cf: ' + L.slice(0, 240));
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code, signal) => {
    log('cloudflared exited code=' + code + (signal ? ' signal=' + signal : '') + '; retry in 3s');
    current = '';
    setTimeout(() => startCloudflared(), 3000);
  });
  child.on('error', (e) => {
    log('cloudflared spawn error: ' + ((e && e.message) || 'error'));
  });
  if (!process.listenerCount('SIGTERM')) {
    const stop = () => { try { child.kill('SIGTERM'); } catch { /* ignore */ } };
    process.on('SIGTERM', () => { stop(); process.exit(0); });
    process.on('SIGINT', () => { stop(); process.exit(0); });
  }
}

if (require.main === module) {
  startCloudflared();
}

module.exports = { extractUrl, URL_RE };
