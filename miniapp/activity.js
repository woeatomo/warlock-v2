'use strict';
const fs = require('fs');
const path = require('path');
const quotePnl=require('../paper-quote-pnl');
// Read only a bounded log tail. Never return raw logs, URLs, stack traces, or startup env.
function readTail(file, bytes = 65536) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - bytes);
    const b = Buffer.alloc(Math.min(size, bytes));
    fs.readSync(fd, b, 0, b.length, start);
    const text = b.toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function reasonId(s) {
  return String(s).replace(/quote not SOL/g, 'quote bukan SOL')
    .replace(/fee\/tvl/g, 'fee/TVL').replace(/tvl</g, 'TVL di bawah ')
    .replace(/age</g, 'umur di bawah ').replace(/pump/gi, 'lonjakan harga')
    .replace(/vol1h low/g, 'volume 1 jam rendah').replace(/vol spike/gi, 'lonjakan volume')
    .replace(/blacklisted/g, 'masuk blacklist').replace(/bin_step outside/g, 'bin step di luar')
    .replace(/no SOL liquidity/g, 'likuiditas SOL kosong').replace(/rugcheck/gi, 'RugCheck')
    .replace(/pass basic filters/g, 'lolos filter awal');
}
// Shorten long base58 strings (pool/mint/wallet/tx ids) and drop RPC/URL text: the feed is display-only.
function scrub(s) {
  return String(s).replace(/https?:\/\/\S+/g, '[tautan]').replace(/\brpc=\S+/gi, 'rpc=[disembunyikan]')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,90}\b/g, (a) => a.slice(0, 4) + '…' + a.slice(-4));
}
// Live bot (bot.js, LIVE mode) writes the root bot.log without the [PAPER] tag and in its own wording.
function liveLine(msg) {
  let x;
  if ((x = msg.match(/^CLOSE (.*?) reason=(.*?) pnl=([\w.-]+)% value=([\w.-]+) SOL/))) return { kind: 'close', text: `Tutup ${x[1]} · ${reasonId(x[2])} · PnL ${x[3]}% · nilai ${x[4]} SOL` };
  if ((x = msg.match(/^monitor ([^\[:][^:]*): value=([\w.-]+) SOL pnl=([\w.-]+)%(?: fees=([\w.-]+))?(?:.*?inRange=(\w+))?/))) return { kind: 'monitor', name: x[1], text: `Pantau ${x[1]} · ${x[2]} SOL · PnL ${x[3]}%${x[4] ? ' · fee ' + x[4] + ' SOL' : ''}${x[5] ? (x[5] === 'true' ? ' · in range' : ' · out of range') : ''}` };
  if ((x = msg.match(/^open plan (.*?): (.*)$/))) return { kind: 'open', text: `Buka posisi live ${x[1]} · ${x[2]}` };
  if ((x = msg.match(/^OPEN (ditolak|TERTUNDA):? (.*?)[: ] ?(.*)$/))) return { kind: 'skip', text: `${x[1] === 'ditolak' ? 'Buka ditolak' : 'Buka ditunda'} ${x[2]} — ${reasonId(x[3])}` };
  if ((x = msg.match(/^open error:?\s*(.*)$/))) return { kind: 'error', text: 'Gagal buka posisi · ' + x[1] };
  if ((x = msg.match(/^tx (\S+(?: \d+\/\d+)?) confirmed/))) return { kind: 'info', text: `Transaksi ${x[1]} terkonfirmasi` };
  if ((x = msg.match(/^closed\. wallet ([\d.]+) SOL/))) return { kind: 'close', text: `Posisi tertutup · saldo wallet ${x[1]} SOL` };
  if ((x = msg.match(/^reconcile \(([^)]*)\):?\s*(.*)$/))) return { kind: 'info', text: `Rekonsiliasi on-chain (${x[1]}) · ${x[2]}` };
  if ((x = msg.match(/^SL blacklist add (\S+)/))) return { kind: 'skip', text: `Masuk blacklist SL · ${x[1]}` };
  if ((x = msg.match(/^resuming the interrupted close of (\S+)/))) return { kind: 'close', text: `Melanjutkan penutupan ${x[1]}` };
  if ((x = msg.match(/^http (?:api\.)?([a-z0-9-]+)\.[^ ]* failed \((\d+)\/(\d+)\): (\d{3})?/i))) return { kind: 'error', text: `API ${x[1]} gagal${x[4] ? ' (' + x[4] + (x[4] === '429' ? ' rate limit' : '') + ')' : ''} · percobaan ${x[2]}/${x[3]}` };
  if (/^ohlcv gecko fail/.test(msg)) return { kind: 'error', text: 'Data OHLCV GeckoTerminal gagal · filter lonjakan pakai data yang ada' };
  if (/^a position is about to exit/.test(msg)) return { kind: 'idle', text: 'Ada posisi yang akan keluar · belum membuka posisi baru' };
  if (/^start: wallet /.test(msg)) return { kind: 'info', text: 'Bot live mulai / restart' };
  if ((x = msg.match(/^(position cycle error|cycle error) ?([^ (:]*)/))) return { kind: 'error', text: `Gangguan siklus ${x[2] ? 'posisi ' + x[2] : 'bot'} · posisi ditahan, coba lagi` };
  if ((x = msg.match(/^pending sell (\S+) failed/))) return { kind: 'error', text: `Jual token ${x[1]} tertunda · dicoba lagi` };
  if ((x = msg.match(/^(reshape claim failed|reshape error|reshape token add send failed|empty position cleanup failed|token->SOL failed|WARN spot add failed)/))) return { kind: 'error', text: `Gangguan: ${x[1]} · bot mencoba lagi` };
  return null;
}
function events(paperDir, opts = {}) {
  const live = !!opts.live, out = [], seenMonitor = new Set();
  const file = live ? path.join(path.dirname(paperDir), 'bot.log') : path.join(paperDir, 'bot.log');
  for (const line of readTail(file, live ? 131072 : 65536).split('\n')) {
    const m = line.match(/^\[([\d-]+ [\d:]+ WIB)\](?: \[PAPER\])?\s*(.*)$/);
    if (!m) continue;
    const msg = m[2]; let text = '', kind = 'info', x;
    if(msg.includes('reason=oor_right_reposition_leg'))continue;
    const lv = live ? liveLine(msg) : null;
    if (lv) { if (/private.?key|secret|token=|Bearer|TELEGRAM_BOT_TOKEN/i.test(lv.text)) continue; out.push({ atWib: m[1], kind: lv.kind, text: scrub(lv.text).slice(0, 400), ...(lv.name ? { _mon: lv.name } : {}) }); continue; }
    if(msg.startsWith('REPOSITION KANAN #')){text='Reposition kanan '+msg.slice('REPOSITION KANAN '.length);kind='reshape';}
    else if(msg.startsWith('capital deposit applied:')){text='Tambah modal dry run · '+msg.slice('capital deposit applied:'.length);kind='info';}
    else if(msg.startsWith('manual open ')||msg.startsWith('manual close ')||msg.startsWith('manual switch ')){text='Aksi manual paper · '+msg;kind='info';}
    else if (msg.startsWith('screen source fallback:')) {
      text = 'Sumber screening fallback · ' + msg.slice('screen source fallback: '.length); kind = 'error';
    } else if ((x = msg.match(/^scan: (\d+) pools fetched, (\d+) pass basic filters; rejects=(.*)$/))) {
      let rejects = '';
      try { rejects = Object.entries(JSON.parse(x[3])).map(([k,v]) => `${reasonId(k)}: ${v}`).join(' · '); } catch {}
      text = `Scan ${x[1]} pool · ${x[2]} lolos awal${rejects ? ' — ' + rejects : ''}`; kind = 'scan';
    } else if ((x = msg.match(/^scan final: (\d+) pass all filters/))) {
      text = `${x[1]} pool lolos semua filter keamanan`; kind = 'scan';
    } else if (msg.startsWith('near-threshold ')) {
      text = 'Kandidat mendekati batas: ' + msg.slice(msg.indexOf('): ') + 3); kind = 'candidate';
    } else if ((x = msg.match(/^skip ([^:]{1,200}): (.*)$/))) {
      // Drop links and reject any unexpected key-related log. Messages remain display-only.
      text = `Lewati ${x[1]} — ${reasonId(x[2])}`; kind = 'skip';
    } else if (/no candidate passes all filters/.test(msg)) {
      text = 'Menunggu peluang · belum ada kandidat yang lolos semua filter'; kind = 'idle';
    } else if ((x = msg.match(/PAPER OPEN \[[^\]]+\] ([^:]+): spent ([\d.]+) USDC/))) {
      text = `Buka posisi paper ${x[1]} · budget ${x[2]} USDC (token + quote + buffer gas)`; kind = 'open';
    } else if (/CLOSE /.test(msg)) {
      x = msg.match(/CLOSE (.*?) reason=(.*?) pnlUsd=([\d.-]+)/);
      if (x) { text = `Tutup ${x[1]} · ${reasonId(x[2])} · PnL $${x[3]}`; kind = 'close'; }
    } else if (/jupiter quote/i.test(msg) && !/failed/.test(msg)) {
      x = msg.match(/quote[^:]*:\s*(.*?)(?:, (?:haircut|swapCost)|$)/i);
      text = 'Simulasi swap Jupiter · ' + (x ? x[1] : 'quote diperbarui'); kind = 'swap';
    } else if (/compound-on-reshape:/.test(msg)) {
      x = msg.match(/([\d.]+) (?:SOL|quote) fees added/);
      text = `Compound fee ${x ? x[1] + ' quote' : ''} ke bin kiri · tanpa menarik likuiditas kiri`; kind = 'reshape';
    } else if (/RESHAPE #/.test(msg)) {
      x = msg.match(/RESHAPE #(\d+) (.*?): right=([^ ]+)/);
      text = x ? `Reshape #${x[1]} ${x[2]} · range kanan ${x[3]} · bentuk M · fee dikompon` : 'Reshape posisi ke bentuk M'; kind = 'reshape';
    } else if (/reshape (?:skipped|aborted)/i.test(msg)) {
      text = 'Reshape ditunda · batas range atau buffer gas belum memenuhi'; kind = 'skip';
    } else if (/monitor \[/.test(msg) && /pnlUsdc=/.test(msg)) {
      x=msg.match(/monitor \[.*?\] (.*?):.*pnlUsdc=([\d.-]+).*pnlUsdcPct=([\d.-]+)%/);
      if(x){text=`Pantau ${x[1]} · close → USDC PnL $${x[2]} (${x[3]}%)`;kind='monitor';}
    } else if (/monitor \[/.test(msg)) {
      x = msg.match(/monitor \[.*?\] (.*?): value=([\d.]+) SOL pnl=([\d.-]+)%/);
      if (x) { text = `Pantau ${x[1]} · ${x[2]} SOL · PnL ${x[3]}%`; kind = 'monitor'; }
    } else if (/error|failed|fatal/i.test(msg) && !/telegram/.test(msg)) {
      text = 'Gangguan data / siklus · bot akan mencoba lagi'; kind = 'error';
    } else if (/paper window ended/.test(msg)) {
      text = 'Window paper selesai · tidak membuka posisi baru'; kind = 'close';
    }
    const display=msg.match(/\bpnlQuote=([\d.-]+) quoteSymbol=(SOL|USDC) pnlQuoteUsd=([\d.-]+)/);
    if(display&&['open','close','monitor','reshape'].includes(kind)){
      const label=quotePnl.format({pnlQuote:+display[1],quoteSymbol:display[2],pnlQuoteUsd:+display[3]});
      if(kind==='monitor'){const name=msg.match(/monitor \[.*?\] (.*?):/);text=`Pantau ${name?.[1]||'posisi'} · PnL ${label}`;}
      else if(kind==='close'){const name=msg.match(/CLOSE (.*?) reason=/);text=`Tutup ${name?.[1]||'posisi'} · PnL ${label}`;}
      else if(kind==='open')text+=` · PnL ${label}`;
      else text=`Reposition kanan · PnL ${label}`;
    }
    if (!text || /private.?key|secret|token=|Bearer|TELEGRAM_BOT_TOKEN/i.test(text)) continue;
    text = (live ? scrub(text) : text.replace(/https?:\/\/\S+/g, '[tautan]')).slice(0, 1400);
    out.push({ atWib: m[1], kind, text });
  }
  // Live monitor lines repeat every cycle: keep only the newest per position so scans stay visible.
  const rev = out.reverse().filter((e) => { if (!e._mon) return true; if (seenMonitor.has(e._mon)) return false; seenMonitor.add(e._mon); delete e._mon; return true; });
  return rev.slice(0, 50);
}
module.exports = { readTail, events, reasonId, scrub, liveLine };
