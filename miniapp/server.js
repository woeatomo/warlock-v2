require('../env-config').load(require('path').join(__dirname,'..'));
// Paper + (operator-triggered) live control Telegram mini app. Binds localhost by default.
// POST writes require valid operator initData + single-use CSRF. Key material is never logged or returned.
'use strict';

const http = require('http');
const fs = require('fs');
const appearance = require('./appearance-store');   // woeatomo fork: wallpaper + glass settings
const path = require('path');
const settings = require('../paper-settings');
const funding=require('../paper-funding');
const paperRuns=require('../paper-runs');
const liveTest=require('../live-test-session');
const botI18n=require('../bot-i18n');
const commands=require('../paper-commands');
const screenRefresh=require('../paper-screen-refresh');
const walletStore = require('../wallet-store');
const liveControl = require('../live-control');
const tokenRent = require('../token-rent');
const onchainView = require('./onchain-view');
const liveView = require('./live-view');   // LIVE views in the capital asset (SOL first) + lives paired with the open positions
const liveTotalProfit = require('../live-total-profit');
const liveCommands = require('../live-commands');
const entryReasons = require('../entry-reasons');
// operator rule: live must equal dry run. Go Live (arm/start) is refused while the parity check finds any difference (fails closed if the check itself errors).
// ---- token account rent (read-only scan + guarded claim). Never automatic; the claim only runs from an authenticated POST with an explicit phrase.
// Mints the live bot still holds positions in (any side): their token accounts are never closed, even when momentarily empty.
function liveProtectedMints(opts) {
  if (opts.protectedMintsFn) return new Set(opts.protectedMintsFn());
  const set = new Set();
  const live = (opts.liveStatusFn || liveControl.pm2LiveStatus)();
  let st = null;
  try { st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'state.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('state live tidak terbaca, claim ditunda'); }
  if (st) for (const p of require('../live-positions').list(st)) { if (p && p.mintX) set.add(p.mintX); if (p && p.mintY) set.add(p.mintY); }
  if (!st && live.running) throw new Error('state live tidak ditemukan saat live ON, claim ditunda');
  return set;
}
async function rentScan(opts, secretsDir) {
  const meta = walletStore.readEnvelopeMeta(secretsDir);
  if (!meta.hasKey || !meta.publicAddress) return { ok: false, status: 400, error: 'key not stored' };
  if (opts.rentScanFn) return { ok: true, ...(await opts.rentScanFn(meta.publicAddress)) };
  const web3 = require('@solana/web3.js');
  const conn = opts.rpc ? new web3.Connection(opts.rpc, 'confirmed') : require('../rpc-config').connection('confirmed');
  return { ok: true, ...(await tokenRent.scan({ conn, owner: meta.publicAddress, PublicKey: web3.PublicKey, protectedMints: liveProtectedMints(opts) })) };
}
async function rentClaim(opts, secretsDir) {
  if (opts.rentClaimFn) return opts.rentClaimFn();
  const web3 = require('@solana/web3.js'), spl = require('@solana/spl-token');
  const keypair = walletStore.loadKeypair(secretsDir);
  const conn = opts.rpc ? new web3.Connection(opts.rpc, 'confirmed') : require('../rpc-config').connection('confirmed');
  const prep = async tx => { tx.feePayer = keypair.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash; return tx; };
  return tokenRent.claim({
    conn, keypair, web3, spl, protectedMints: liveProtectedMints(opts),
    simulate: async tx => { await prep(tx); const r = await conn.simulateTransaction(tx); return { err: r.value && r.value.err }; },
    send: async tx => { const bh = await conn.getLatestBlockhash('confirmed'); tx.feePayer = keypair.publicKey; tx.recentBlockhash = bh.blockhash; tx.sign(keypair);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const c = await conn.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
      if (c.value && c.value.err) throw new Error('tx error ' + JSON.stringify(c.value.err)); return sig; },
  });
}

function liveParityDifferences() { try { return require('../parity-check').analyse().debt; } catch (e) { return ['parity-check error: ' + e.message]; } }
const telegram = require('../telegram-notify');
const ROOT = process.env.LP_BOT_DIR || '/workspace/lp-bot';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_HOST = process.env.MINIAPP_HOST || '127.0.0.1';
const DEFAULT_PORT = +(process.env.MINIAPP_PORT || 8787);

function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(sanitizeResponse(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sanitizeResponse(obj) {
  const drop = /private[_-]?key|secretKey|secret_key|SOLANA_BOT_PRIVATE_KEY|masterKey|initData|TELEGRAM_BOT_TOKEN/i;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (drop.test(k)) continue;
        o[k] = walk(val);
      }
      return o;
    }
    return v;
  };
  return walk(obj);
}

function sendFile(res, file, contentType, { head, cache } = {}) {
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': cache || 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': cache ? 'public' : 'no-cache',
    'Expires': cache ? new Date(Date.now() + 86400000).toUTCString() : '0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://telegram.org",
  });
  if (head) return res.end();
  res.end(data);
}

function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > maxBytes) {
        reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch { reject(Object.assign(new Error('invalid json'), { code: 'BAD_JSON' })); }
    });
    req.on('error', reject);
  });
}

function initDataFrom(req, body) {
  return (body && (body.initData || body.init_data))
    || req.headers['x-telegram-init-data']
    || '';
}

// Token supply per mint (on-chain getTokenSupply), cached 10 min; refreshed in the background so publicStatus stays synchronous.
// Market cap = total supply x price (SOL per token) x SOL/USD. First poll after a restart shows 'mcap n/a' until the read lands.
const supplyCache = new Map();
let supplyFetcher = null;
function setSupplyFetcher(fn) { supplyFetcher = fn; supplyCache.clear(); }
function tokenSupply(mint) {
  if (!mint) return null;
  const e = supplyCache.get(mint), now = Date.now();
  if (!e || (now - e.at > 600000 && !e.busy)) {
    const rec = e || { at: 0, ui: null }; rec.busy = true; rec.at = now; supplyCache.set(mint, rec);
    Promise.resolve().then(async () => {
      if (supplyFetcher) return supplyFetcher(mint);
      const web3 = require('@solana/web3.js'), conn = require('../rpc-config').connection('confirmed');
      const r = await conn.getTokenSupply(new web3.PublicKey(mint)); return Number(r.value.uiAmountString ?? r.value.uiAmount);
    }).then((ui) => { if (Number.isFinite(ui) && ui > 0) rec.ui = ui; }).catch(() => {}).finally(() => { rec.busy = false; });
  }
  return e && Number.isFinite(e.ui) ? e.ui : null;
}
function binPriceUi(binId, binStep, decX, decY = 9) { return Math.pow(1 + binStep / 1e4, binId) * Math.pow(10, decX - decY); }
// Mcap now and at the range bounds (OOR left = lower edge of the lowest bin, OOR right = upper edge of the highest bin).
function liveMcap(pos, solUsdNow) {
  try {
    const supply = tokenSupply(pos.mintX), step = Number(pos.binStep), dec = Number(pos.decX);
    const px = Number(pos.lastPrice) || (pos.liveBins && Number(pos.liveBins.price)) || Number(pos.entryPrice);
    if (!(supply > 0) || !(solUsdNow > 0) || !(px > 0) || !(step > 0) || !Number.isFinite(dec)) return { ok: false };
    const usd = (p) => supply * p * solUsdNow;
    const lo = binPriceUi(Number(pos.minBinId), step, dec), hi = binPriceUi(Number(pos.maxBinId) + 1, step, dec);
    return { ok: true, nowUsd: usd(px), lowerUsd: usd(lo), upperUsd: usd(hi), supply, priceSol: px, lowerPriceSol: lo, upperPriceSol: hi };
  } catch { return { ok: false }; }
}

// LIVE screening: the bot's scan pins the DRY RUN book's open pools; while LIVE runs the open rows must be the live positions instead,
// each with "alasan dibuka" (entry PASS line in the live bot.log at open time, else the latest scan values, labelled).
let liveLogCache = { at: 0, key: '', text: '' };
function liveLogText(root) {
  try { const f = path.join(root, 'bot.log'), st = fs.statSync(f), key = st.mtimeMs + ':' + st.size;
    if (key !== liveLogCache.key && Date.now() - liveLogCache.at > 30000) { const fd = fs.openSync(f, 'r'), len = Math.min(st.size, 4 * 1024 * 1024), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); liveLogCache = { at: Date.now(), key, text: buf.toString('utf8') }; }
  } catch { /* no live log */ }
  return liveLogCache.text;
}
function liveScreening(scan, ps, root, policy) {
  if (!scan || !Array.isArray(scan.display)) return scan;
  const pools = new Set(ps.map((p) => p.pool)), log = liveLogText(root);
  let rows = scan.display.filter((r) => !(r.isOpen && r.source === 'open-position' && !pools.has(r.address))).map((r) => (r.isOpen && !pools.has(r.address) ? { ...r, isOpen: false, openInfo: undefined } : r));
  const pinned = [];
  for (const pos of ps) {
    const i = rows.findIndex((r) => r.address === pos.pool), row = i >= 0 ? rows.splice(i, 1)[0] : null;
    const latest = row ? { ft30mPct: row.ft30m, tvlUsd: row.tvl, ageH: row.ageH, binStep: row.binStep, marketCapUsd: row.marketCapUsd } : null;
    let info = null; try { info = entryReasons.build(pos, { policy, pass: entryReasons.findPass(log, pos.pool, pos.name, pos.openedAt), latest }); } catch { /* display only */ }
    if (info && !info.source) info.source = pos.openSource === 'manual' ? 'Manual (Mini App)' : pos.openSource === 'scan' ? 'Auto (bot)' : (pos.openSource || null);
    pinned.push({ ...(row || { name: pos.name, address: pos.pool, mintX: pos.mintX, quote: pos.quoteSymbol || 'SOL', quoteMint: pos.quoteMint, ft30m: null, fees30mUsd: null, tvl: null, marketCapUsd: null, binStep: pos.binStep, baseFeePct: pos.baseFeePct ?? null, ageH: null, reasons: ['tidak ada di daftar pool scan ini'], status: 'rejected', source: 'open-position', allReasons: null }), isOpen: true, openInfo: info });
  }
  return { ...scan, display: [...pinned, ...rows] };
}
const isSolQuoted = (p) => !p.quoteMint || p.quoteMint === 'So11111111111111111111111111111111111111112';
// LIVE window: the supervised live-test session when one is set, else open-ended.
function liveWindow(root) {
  const w = { live: true, startedWib: null, endsWib: null };
  try {
    const s = require('../live-test-session').read(root);
    if (s) {
      const fmt = (t) => { const ms = Date.parse(t); return Number.isFinite(ms) && ms < Date.parse('2090-01-01') ? new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' WIB' : null; };
      w.startedWib = fmt(s.startedAt); w.endsWib = fmt(s.expiresAt); w.expired = !!s.expired;
    }
  } catch { /* no session file */ }
  return w;
}

// Live bot files are rewritten every ~10 s cycle (status.json non-atomically). A torn/partial read must not flip the views back to
// dry run for one poll: on a parse error serve the last good parse of that file if it is < 2 min old.
const stableJsonCache = new Map();
function readJsonStable(file, maxAgeMs = 120000) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); stableJsonCache.set(file, { t: Date.now(), v }); return v; }
  catch (e) { const c = stableJsonCache.get(file); if (c && Date.now() - c.t < maxAgeMs && fs.existsSync(file)) return c.v; throw e; }
}
// Live SOL/USD for the LIVE views (the paper summary's price stops updating when the dry run is off). Refreshed in the background at most
// once a minute (Jupiter price, CoinGecko fallback); readers get the cached value at once, 0 when none yet.
const solPx = { px: 0, t: 0, busy: false };
function liveSolUsd() {
  if (!solPx.busy && Date.now() - solPx.t > 60000 && typeof fetch === 'function') {
    solPx.busy = true;
    const get = (u) => fetch(u, { signal: AbortSignal.timeout(6000) }).then(r => (r.ok ? r.json() : null));
    get('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112')
      .then(j => Number(j && j.So11111111111111111111111111111111111111112 && j.So11111111111111111111111111111111111111112.usdPrice) || get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(c => Number(c && c.solana && c.solana.usd) || 0))
      .then(px => { if (px > 0) solPx.px = px; }).catch(() => { /* keep last */ }).finally(() => { solPx.t = Date.now(); solPx.busy = false; });
  }
  return solPx.px;
}
function publicStatus(paperDir) {
  const out = { paper: true, dryRun: true };
  const files = ['status.json', 'summary.json', 'positions_open.json', 'config.json', 'screening.json'];
  for (const name of files) {
    try {
      const p = path.join(paperDir, name);
      if (fs.existsSync(p)) out[name.replace('.json', '')] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* ignore broken journal */ }
  }
  out.screenRefresh=screenRefresh.status(paperDir,settings.currentValues(paperDir),out.screening);
  // LIVE (no STOP file): the open positions come from the live bot's own state.json + status.json (the paper files are the dry run's and go stale).
  try {
    const root = path.dirname(paperDir);
    if (!fs.existsSync(path.join(root, 'STOP'))) {
      const ls = readJsonStable(path.join(root, 'status.json')), lst = readJsonStable(path.join(root, 'state.json'));
      const ps = (lst.positions && lst.positions.length ? lst.positions : (lst.position ? [lst.position] : [])), lives = liveView.pairLives(ps, ls.lives || (ls.live ? [ls.live] : []));   // closed positions drop out at once (status.json keeps the last lives until the next write)
      const sx = liveSolUsd() || Number(ls.solUsd) || Number((ps[0] || {}).lastSolUsd) || Number(out.summary && out.summary.stats && out.summary.stats.solUsd) || Number((ps[0] || {}).solUsdEntry) || 0;
      out.positions_open = { ...(out.positions_open || {}), updated: ls.updated, updatedWib: ls.updatedWib, paper: false, dryRun: false, openCount: ps.length,
        positions: ps.map((pos0, i) => { const l = lives[i] || {}, vs = Number(l.valueSol) || 0, pos = { ...pos0, binShape: pos0.liveBins || null, liveBins: undefined }; return { position: { ...pos, mcap: liveMcap(pos0, sx), meteora: isSolQuoted(pos0) ? onchainView.meteoraView(pos0, onchainView.positionSnapshot(pos0), sx) : null }, live: { ...l, valueUsd: sx ? vs * sx : l.valueUsd, exitUsdc: sx ? vs * sx : l.exitUsdc, pnlQuote: l.pnlSol, pnlQuoteUsd: sx ? (Number(l.pnlSol) || 0) * sx : l.pnlUsd, pnlUsd: sx ? (Number(l.pnlSol) || 0) * sx : l.pnlUsd, quoteSymbol: 'SOL', quoted: l.quoted !== false } }; }),
        position: ps[0] || null, live: lives[0] || null };
      out.paper = false; out.dryRun = false;
      try { out.screening = liveScreening(out.screening, ps, root, { ...settings.currentValues(paperDir), ...((out.screening && out.screening.filters) || {}) }); } catch { /* keep the bot's rows */ }
      try { out.liveManual = { supported: !!(ls.features && ls.features.manualOpen), closeSupported: !!(ls.features && ls.features.manualClose), pending: liveCommands.pending(root).map((r) => ({ id: r.id, type: r.type || 'open', pool: r.pool, name: r.name, at: r.at })), last: liveCommands.done(root, 3).map((r) => ({ id: r.id, pool: r.pool, name: r.name, at: r.at, finishedAt: r.finishedAt, ok: !!(r.result && r.result.ok), error: r.result && (r.result.error || r.result.skipped) || null })) }; } catch { out.liveManual = { supported: false, pending: [], last: [] }; }
      { const hist2 = Array.isArray(lst.history) ? lst.history : [];   // history + Telegram-style rows: the live trades, not the dry run's
        out.summary = { ...(out.summary || {}), closedRecent: liveView.enrichRows(hist2, { rootDir: root, solUsd: sx }).map((h) => ({ ...h, pnlUsd: Number(h.pnlUsd) || 0, paper: false })) }; }
      const hist = Array.isArray(lst.history) ? lst.history : [], hSol = hist.map((h) => Number(h.capitalAsset === 'SOL' && h.pnlCapital != null ? h.pnlCapital : (h.realizedSol != null ? h.realizedSol : h.pnlCapital)) || 0);
      const solCap = hist.some((h) => h && h.capitalAsset === 'SOL') || ps.some((p) => p && p.capitalAsset === 'SOL');
      const wl = require('../trade-outcome').tally(hist);   // |PnL%| < 0.1% (capital token) = breakeven: not a win nor a loss, still in realized
      out.liveSummary = { live: true, be: wl.be, winRate: wl.winRate, capitalAsset: solCap ? 'SOL' : 'USDC', realizedSolUsd: hist.reduce((n, h, i) => n + hSol[i] * (Number(h.solUsd) || sx || 0), 0), solUsd: sx, wins: wl.wins, losses: wl.losses, trades: hist.length, realizedUsd: hist.reduce((n, h) => n + (Number(h.pnlUsd) || 0), 0), closed: hist.length || Number(ls.closedTrades) || 0, realizedSol: hSol.length ? hSol.reduce((n, x) => n + x, 0) : (Number(ls.totalRealizedSol) || 0), walletSol: Number(ls.solBalance),
        rentRefundableSol: ps.reduce((n, x) => n + (Number(x.rentRefundableSol) || 0), 0), openFeesSol: lives.reduce((n, l) => n + (Number(l.feesSol) || 0), 0), openPnlSol: lives.reduce((n, l) => n + (Number(l.pnlSol) || 0), 0),
        openValueSol: lives.reduce((n, l) => n + (Number(l.valueSol) || 0), 0), maxPositions: Number(ls.config && ls.config.maxPositions) || (() => { try { return Number(settings.currentValues(paperDir).MAX_POSITIONS) || null; } catch { return null; } })() };
      Object.assign(out.liveSummary, liveTotalProfit.totalProfit({ realizedSol: out.liveSummary.realizedSol, openPnlSol: out.liveSummary.openPnlSol, walletSol: out.liveSummary.walletSol, solUsd: out.liveSummary.solUsd, openValueSol: out.liveSummary.openValueSol, rentRefundableSol: out.liveSummary.rentRefundableSol, history: hist, positions: ps }));
      // Everything else the views read also switches to the live bot (no dry-run numbers while LIVE runs).
      const L = out.liveSummary, rows = require('../paper-pnl-calendar').liveRows(hist), wins = L.wins, trades = L.trades;
      const realUsd = rows.reduce((n, h) => n + (Number(h.pnlUsd) || 0), 0), eqSol = (Number(ls.solBalance) || 0) + L.openValueSol + L.rentRefundableSol;
      out.summary.closedRecent = liveView.enrichRows(rows, { rootDir: root, solUsd: sx }).map((h) => ({ ...h, pnlUsd: Number(h.pnlUsd) || 0, paper: false }));
      out.summary.stats = { live: true, source: 'live', capitalAsset: 'SOL', variant: 'N5', solUsd: sx || null, trades, tradesAll: trades, wins, losses: L.losses, be: L.be,
        winRate: L.winRate, avgNetPnlUsd: trades ? realUsd / trades : null, totalNetPnlUsd: realUsd, totalNetPnlAllUsd: realUsd, totalNetPnlSol: L.realizedSol, totalNetPnlSolUsd: L.realizedSolUsd, avgNetPnlSol: trades ? L.realizedSol / trades : null,
        archivedCount: 0, archivedPnlUsd: 0, reshapes: ps.reduce((n, p) => n + (Number(p.reshapes) || 0), 0) + hist.reduce((n, h) => n + (Number(h.reshapes) || 0), 0),
        maxPositions: L.maxPositions, equitySol: eqSol, equityUsd: sx ? eqSol * sx : null, positionValueUsd: sx ? (L.openValueSol + L.rentRefundableSol) * sx : null, freeCapitalSol: Number(ls.solBalance) || 0,
        equityPnlSol: L.realizedSol + L.openPnlSol, equityPnlUsd: sx ? (L.realizedSol + L.openPnlSol) * sx : null, quotePnlTotals: { usd: sx ? L.openPnlSol * sx : null, quotes: ps.length ? { SOL: L.openPnlSol } : {} } };
      out.summary.updated = ls.updated; out.summary.updatedWib = ls.updatedWib; out.summary.paper = false;
      out.summary.lastScan = ls.lastScan || lst.lastScan || null;
      out.status = { live: true, paper: false, dryRun: false, updated: ls.updated, updatedWib: ls.updatedWib, lastScan: ls.lastScan || lst.lastScan || null, openCount: ps.length, maxPositions: L.maxPositions };
      out.liveMode = true;
    }
  } catch { /* live files not readable yet: keep the paper view */ }
  const liveMode = !!out.liveMode; delete out.liveMode;
  // Dry-run-only panels (virtual capital, saved dry runs, paper command queue) are empty while LIVE runs.
  out.capital = liveMode ? { live: true } : funding.snapshot(paperDir);
  out.runs = liveMode ? { live: true, runs: [], current: null } : paperRuns.snapshot(paperDir);
  out.commands = liveMode ? { live: true } : commands.snapshot(paperDir);
  out.activity = require('./activity').events(paperDir, { live: liveMode });
  out.activitySource = liveMode ? 'live' : 'paper';
  out.lpAgentUrl = telegram.lpAgentLink();
  out.paused = liveMode ? false : settings.isPaused(paperDir);
  out.window = liveMode ? liveWindow(path.dirname(paperDir)) : {
    startedWib: (out.config && out.config.startedWib) || (out.status && out.status.meta && out.status.meta.startedWib) || null,
    endsWib: (out.config && out.config.endsWib) || (out.status && out.status.meta && out.status.meta.endsWib) || null,
  };
  return sanitizeResponse(out);
}

// ---- Dashboard (front tab): read-only, non-secret aggregates. Parity analysis is cached 60s (it scans source files).
let dashParityCache = { at: 0, v: null };
function dashboardParity() {
  const now = Date.now();
  if (dashParityCache.v && now - dashParityCache.at < 60000) return dashParityCache.v;
  let v;
  try { const p = require('../parity-check'); const a = p.analyse(), c = p.compare(a); v = { ok: a.debt.length === 0, debt: a.debt.length, added: c.added.length, resolved: c.resolved.length, items: a.debt.slice(0, 12) }; }
  catch (e) { v = { ok: false, debt: null, added: null, error: 'parity-check error' }; }
  dashParityCache = { at: now, v };
  return v;
}
// Mode for the Mini App views. The Mini App process itself runs with PAPER=1/DRY_RUN=1, so its own env cannot say LIVE:
// LIVE = the env says live, OR the STOP lock is gone and the live bot's own status.json reports dryRun=false.
function viewMode(paperDir, stopPath) {
  const cal = require('../paper-pnl-calendar');
  let envFile = {}; try { envFile = require('../env-config').read(path.join(__dirname, '..')); } catch { /* defaults */ }
  const stop = liveControl.isStopPresent(stopPath), m = cal.mode({ ...process.env, ...envFile }, stop);
  if (!m.live && !stop) {
    try { const ls = readJsonStable(path.join(path.dirname(paperDir), 'status.json')); if (ls && ls.dryRun === false && ls.paper === false) return { ...m, label: 'LIVE', live: true, source: 'live-bot-status' }; } catch { /* no live status */ }
  }
  return m;
}
function dashLive(paperDir, stopPath) { try { return !!viewMode(paperDir, stopPath).live; } catch { return false; } }
function dashboardData(paperDir, stopPath) {
  const out = {};
  try {
    const cal = require('../paper-pnl-calendar');
    const live = dashLive(paperDir, stopPath);
    let st = {}; try { st = live ? readJsonStable(path.join(path.dirname(paperDir), 'state.json')) : JSON.parse(fs.readFileSync(path.join(paperDir, 'state.json'), 'utf8')); } catch { /* no state yet */ }
    const all = []; if (live) all.push(...cal.liveRows(st.history)); else for (const b of Object.values(st.books || {})) all.push(...(b.history || []));
    out.historySource = live ? 'live' : 'paper';
    const rows = all.filter(h => h && Number.isFinite(Date.parse(h.closedAt))).sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
    let cum = 0;
    const pts = rows.map(h => { const v = Number(cal.pnlUsdOf(h)); cum += Number.isFinite(v) ? v : 0; return { t: h.closedAt, name: String(h.name || h.pair || 'Pool').slice(0, 40), pnl: +(Number.isFinite(v) ? v : 0).toFixed(4), cum: +cum.toFixed(4) }; });
    out.historyCurve = pts.slice(-400); out.historyTrades = pts.length; out.historyTotal = +cum.toFixed(4);
  } catch { out.historyCurve = []; }
  try {
    const m = viewMode(paperDir, stopPath);
    out.mode = { label: m.label, live: !!m.live };
  } catch { out.mode = { label: 'DRY RUN', live: false }; }
  out.parity = dashboardParity();
  return sanitizeResponse(out);
}

function loadBotTokenQuiet() {
  try {
    const env = (process.env.MINIAPP_TEST === '1' && process.env.MINIAPP_TEST_TOKEN) ? process.env.MINIAPP_TEST_TOKEN : '';
    if (env) return env;
  } catch { /* ignore */ }
  try {
    const t = telegram.loadToken();
    if (t) return t;
  } catch { /* ignore */ }
  return '';
}

function createApp(opts = {}) {
  const paperDir = opts.paperDir || process.env.LP_PAPER_DIR || path.join(ROOT, 'paper');
  const token = opts.token || '';
  const secretsDir = opts.secretsDir || walletStore.DEFAULT_SECRETS_DIR;
  const stopPath = opts.stopPath || liveControl.REAL_STOP;
  const noNewPath = opts.noNewPath || liveControl.DEFAULT_NO_NEW;
  const testDefaults = () => { const v = settings.currentValues(paperDir); return { maxPositions: v.MAX_POSITIONS, maxPositionSol: v.POSITION_SOL_OPEN > 0 ? v.POSITION_SOL_OPEN : 1, hours: liveTest.DEFAULTS.hours }; };
  const langRoot = opts.langRoot || ROOT;   // lang.json is shared with the Telegram bot
  const sessionRoot = opts.sessionRoot || ROOT;   // where live-test-session.json lives (the bot reads the same file)
  const appearanceFile = opts.appearanceFile || path.join(__dirname, 'appearance.json');
  const appearanceDir = opts.appearanceDir || PUBLIC_DIR;
  const csrf = settings.createCsrfStore();
  const arm = liveControl.createArmStore({ ttlMs: opts.armTtlMs || liveControl.ARM_TTL_MS });
  const rateLimitMs = opts.rateLimitMs != null ? opts.rateLimitMs : 750;
  const lastPostAt = { t: 0 };
  const failMax = opts.failMax != null ? opts.failMax : 8;
  const failWindowMs = opts.failWindowMs != null ? opts.failWindowMs : 10 * 60 * 1000;
  const lockMs = opts.lockMs != null ? opts.lockMs : 15 * 60 * 1000;
  const fail = { n: 0, windowStart: 0, lockedUntil: 0 };

  function locked() {
    return Date.now() < fail.lockedUntil;
  }
  function noteFail() {
    const now = Date.now();
    if (now - fail.windowStart > failWindowMs) { fail.n = 0; fail.windowStart = now; }
    fail.n += 1;
    if (fail.n >= failMax) fail.lockedUntil = now + lockMs;
  }
  function noteOk() {
    fail.n = 0;
  }

  function botToken() {
    if (token) return token;
    if (opts.loadToken) return opts.loadToken() || '';
    return loadBotTokenQuiet();
  }

  function authInit(req, body, { write, maxAgeSec } = {}) {
    if (locked()) return { ok: false, status: 403, error: 'unauthorized', reason: 'locked out' };
    const v = settings.validateInitData(initDataFrom(req, body), botToken(), { maxAgeSec });
    if (!v.ok) {
      noteFail();
      return { ok: false, status: 403, error: 'unauthorized', reason: v.reason };
    }
    if (write) {
      const nonce = (body && body.csrf) || req.headers['x-csrf-token'];
      const c = csrf.consume(nonce, v.userId);
      if (!c.ok) {
        noteFail();
        return { ok: false, status: 403, error: 'unauthorized', reason: c.reason };
      }
      const now = Date.now();
      if (rateLimitMs > 0 && now - lastPostAt.t < rateLimitMs) {
        return { ok: false, status: 429, error: 'rate limited' };
      }
      lastPostAt.t = now;
    }
    noteOk();
    return { ok: true, userId: v.userId };
  }

  async function notify(kind, payload) {
    if (opts.notifyFn) return opts.notifyFn({ kind, ...payload });
    try {
      const telegram = require('../telegram-notify');
      if (kind === 'update' || kind === 'reset' || kind === 'pause' || kind === 'resume') {
        if (typeof telegram.notifySettingsChange === 'function') return telegram.notifySettingsChange({ kind, ...payload });
      }
      if ((kind === 'key-saved' || kind === 'key-deleted') && typeof telegram.notifyWalletChange === 'function') {
        return telegram.notifyWalletChange({ kind, ...payload });
      }
      if ((kind === 'live-arm' || kind === 'live-start' || kind === 'live-stop' || kind === 'live-no-new') && typeof telegram.notifyLiveChange === 'function') {
        return telegram.notifyLiveChange({ kind, ...payload });
      }
    } catch { /* fail-safe */ }
    return { ok: false, skipped: 'notify unavailable' };
  }

  function audit(line) {
    try { settings.audit(paperDir, line); } catch { /* ignore */ }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return send(res, 200, { ok: true, paper: true });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8', { head: req.method === 'HEAD' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/app.js') {
      return sendFile(res, path.join(PUBLIC_DIR, 'app.js'), 'application/javascript; charset=utf-8', { head: req.method === 'HEAD' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/app.css') {
      return sendFile(res, path.join(PUBLIC_DIR, 'app.css'), 'text/css; charset=utf-8', { head: req.method === 'HEAD' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/dashboard.js') {
      return sendFile(res, path.join(PUBLIC_DIR, 'dashboard.js'), 'application/javascript; charset=utf-8', { head: req.method === 'HEAD' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/i18n.js') {
      return sendFile(res, path.join(PUBLIC_DIR, 'i18n.js'), 'application/javascript; charset=utf-8', { head: req.method === 'HEAD' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/logo.svg') {
      return sendFile(res, path.join(PUBLIC_DIR, 'logo.svg'), 'image/svg+xml', { head: req.method === 'HEAD', cache: 'public, max-age=3600' });
    }
    // Token logo from our own origin (CSP img-src 'self'): cached real logo, else the Warlock W. Public token data only, no auth needed.
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/logo/')) {
      const mint = pathname.slice(6);
      const img = onchainView.MINT_RE.test(mint) ? await Promise.race([onchainView.tokenLogo(mint), new Promise((r) => setTimeout(() => r(undefined), 4000))]) : null;
      if (img && img.buf) { res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.buf.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); return res.end(req.method === 'HEAD' ? undefined : img.buf); }
      return sendFile(res, path.join(PUBLIC_DIR, 'logo.svg'), 'image/svg+xml', { head: req.method === 'HEAD' });   // not found yet: no-store, so the real logo shows once it is cached
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/char-avatar.png') {
      return sendFile(res, path.join(PUBLIC_DIR, 'char-avatar.png'), 'image/png', { head: req.method === 'HEAD', cache: 'public, max-age=86400' });
    }
    // Custom background (woeatomo fork): miniapp/public/bg.jpg|jpeg|png|webp, whichever exists first. None -> 404, the CSS falls back to --bg.
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/bg') {
      const hit = appearance.findBg(appearanceDir);
      if (!hit) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
      return sendFile(res, hit.file, hit.type, { head: req.method === 'HEAD', cache: url.searchParams.has('v') ? 'public, max-age=604800, immutable' : 'public, max-age=300' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/appearance.js') {
      return sendFile(res, path.join(PUBLIC_DIR, 'appearance.js'), 'application/javascript; charset=utf-8', { head: req.method === 'HEAD' });
    }
    // Appearance prefs are cosmetic and public (needed before login to paint the page). A CSRF token is added only for a valid operator initData;
    // without initData no auth attempt is made, so plain page loads never count toward the lockout.
    if (req.method === 'GET' && pathname === '/api/appearance') {
      const out = { ok: true, prefs: appearance.read(appearanceFile), hasBg: !!appearance.findBg(appearanceDir), defaults: appearance.DEFAULTS, limits: appearance.LIMITS };
      if (req.headers['x-telegram-init-data'] || url.searchParams.get('initData')) {
        const gate = authInit(req, { initData: url.searchParams.get('initData') || req.headers['x-telegram-init-data'] });
        if (gate.ok) out.csrf = csrf.issue(gate.userId);
      }
      return send(res, 200, out);
    }

    const freshSec = liveControl.LIVE_INITDATA_MAX_AGE_SEC;

    if (req.method === 'GET' && pathname === '/api/pnl-calendar') {
      const gate = authInit(req, { initData: url.searchParams.get('initData') || req.headers['x-telegram-init-data'] });
      if (!gate.ok) return send(res, gate.status, { ok: false, error: gate.error, reason: gate.reason, locked: locked() });
      const cal = require('../paper-pnl-calendar');
      const md = viewMode(paperDir, stopPath);
      if (md.live) { let hist = []; try { hist = readJsonStable(path.join(path.dirname(paperDir), 'state.json')).history || []; } catch { /* calendar only */ } return send(res, 200, { ok: true, ...liveView.solCalendar(cal.buildLive(path.dirname(paperDir)), hist), mode: md }); }
      return send(res, 200, { ok: true, ...cal.build(paperDir), mode: md });
    }
    if (req.method === 'GET' && (pathname === '/api/settings' || pathname === '/api/status' || pathname === '/api/wallet' || pathname === '/api/live' || pathname === '/api/wallet/rent')) {
      const gate = authInit(req, { initData: url.searchParams.get('initData') || req.headers['x-telegram-init-data'] });
      if (!gate.ok) return send(res, gate.status, { ok: false, error: gate.error, reason: gate.reason, locked: locked() });
      const nonce = csrf.issue(gate.userId);
      if (pathname === '/api/wallet/rent') {
        try {
          const r = await rentScan(opts, secretsDir);
          if (!r.ok) return send(res, r.status || 400, { ok: false, error: r.error, csrf: nonce });
          return send(res, 200, { ...r, csrf: nonce, accounts: undefined, sample: (r.accounts || []).slice(0, 5).map(a => ({ mint: a.mint, sol: a.lamports / 1e9 })) });
        } catch (e) { return send(res, 502, { ok: false, error: 'scan gagal: ' + String(e.message || e).slice(0, 120), csrf: nonce }); }
      }
      if (pathname === '/api/wallet') {
        const meta = walletStore.readEnvelopeMeta(secretsDir);
        let rpc = null; try { rpc = require('../rpc-store').view(secretsDir); } catch { /* shown as unknown */ }   // last 5 characters only
        return send(res, 200, { ok: true, csrf: nonce, hasKey: meta.hasKey, publicAddress: meta.publicAddress, updatedWib: meta.updatedWib, source: meta.source || 'encrypted', rpc });
      }
      if (pathname === '/api/live') {
        const snap = await liveControl.liveSnapshot({ paperDir,
          secretsDir, stopPath, noNewPath,
          getBalances: opts.getBalances,
          liveStatusFn: opts.liveStatusFn,
          rpc: opts.rpc,
        });
        return send(res, 200, { ok: true, csrf: nonce, ...snap, gates: (opts.parityFn || liveParityDifferences)(), testSession: liveTest.read(sessionRoot), testDefaults: testDefaults(), capitalAsset: settings.currentValues(paperDir).CAPITAL_ASSET });
      }
      const values = settings.currentValues(paperDir);
      return send(res, 200, {
        ok: true,
        paper: true,
        csrf: nonce,
        csrfTtlSec: Math.round(settings.CSRF_TTL_MS / 1000),
        values,
        defaults: settings.cloneDefaults(),
        fields: settings.displayValues(values),
        lang: botI18n.getLang(langRoot),
        hints: { gasBuffer: require('../paper-capital').recommendGasBuffer({ maxNonrefundSol: values.MAX_NONREFUND_SOL }) },
        capitalEnabled:liveControl.isStopPresent(stopPath),
        paused: settings.isPaused(paperDir),
        slBlacklist: require('../paper-sl-blacklist').list(paperDir),
        status: pathname === '/api/settings' && url.searchParams.get('status') === '0' ? undefined : publicStatus(paperDir),
        dashboard: pathname === '/api/settings' && url.searchParams.get('status') === '0' ? undefined : dashboardData(paperDir, stopPath),
      });
    }

    if (req.method !== 'POST') {
      return send(res, 404, { ok: false, error: 'not found' });
    }

    let body;
    try { body = await readJson(req, pathname === '/api/appearance/bg' ? 6 * 1024 * 1024 : undefined); }
    catch (e) {
      if (e.code === 'TOO_LARGE') return send(res, 413, { ok: false, error: 'body too large' });
      return send(res, 400, { ok: false, error: 'invalid json' });
    }

    const writeRoutes = new Set([
      '/api/settings', '/api/settings/reset', '/api/pause', '/api/resume', '/api/runs/continue', '/api/runs/activate', '/api/lang', '/api/sl-blacklist/remove',
      '/api/appearance', '/api/appearance/reset', '/api/appearance/bg', '/api/appearance/bg/delete',
      '/api/paper/capital/deposit', '/api/paper/capital/new-run', '/api/paper/open', '/api/paper/close', '/api/paper/scan',
      '/api/wallet', '/api/wallet/delete', '/api/wallet/rent/claim', '/api/wallet/rpc',
      '/api/live/arm', '/api/live/start', '/api/live/stop', '/api/live/open', '/api/live/close',
    ]);
    if (!writeRoutes.has(pathname)) return send(res, 404, { ok: false, error: 'not found' });

    const isSensitive = pathname.startsWith('/api/wallet') || pathname.startsWith('/api/live');
    const gate = authInit(req, body, { write: true, maxAgeSec: isSensitive ? freshSec : undefined });
    if (!gate.ok) return send(res, gate.status, { ok: false, error: gate.error, reason: gate.reason, locked: locked() });
    const meta = { updatedBy: gate.userId };

    try {
      if(pathname.startsWith('/api/paper/')){
        const live=(opts.liveStatusFn||liveControl.pm2LiveStatus)();
        if(pathname!=='/api/paper/scan'&&(!liveControl.isStopPresent(stopPath)||live.running||live.status==='unknown'))return send(res,409,{ok:false,error:'Hanya dry run; aksi dikunci saat live/unknown'});   // a re-scan only reads the market: allowed in live too
        if(pathname==='/api/paper/scan'){
          const result=screenRefresh.request(paperDir,{manual:true,userId:gate.userId,reason:'manual scan request'});
          if(!result.ok)return send(res,429,{ok:false,error:`Scan dibatasi 1/30 detik; tunggu ${result.retryAfterSec} detik`,retryAfterSec:result.retryAfterSec,csrf:csrf.issue(gate.userId)});
          audit(`uid=${gate.userId} action=paper-scan-request id=${result.id}`);
          return send(res,202,{ok:true,status:'queued',id:result.id,csrf:csrf.issue(gate.userId)});
        }
        if(body.confirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi diperlukan'});
        if(pathname==='/api/paper/capital/deposit'){
          let amount;try{amount=funding.amountValue(body.amount);}catch(e){return send(res,400,{ok:false,error:e.message});}
          const result=funding.queueDeposit(paperDir,amount,{updatedBy:gate.userId,requestId:body.requestId});
          audit(`uid=${gate.userId} action=paper-capital-deposit-queued id=${result.id} amount=${result.amount} USDC duplicate=${!!result.duplicate}`);
          return send(res,202,{...result,csrf:csrf.issue(gate.userId)});
        }
        if(pathname==='/api/paper/capital/new-run'){
          let amount;try{amount=paperRuns.amountValue(body.amount);}catch(e){return send(res,400,{ok:false,error:e.message});}
          let st=null;try{st=JSON.parse(fs.readFileSync(path.join(paperDir,'state.json'),'utf8'));}catch{return send(res,409,{ok:false,error:'Paper books unavailable'});}
          let result;try{result=paperRuns.queueNewRun(paperDir,amount,{updatedBy:gate.userId,expectedOldModal:body.expectedOldModal,requestId:body.requestId,state:st});}catch(e){return send(res,409,{ok:false,error:e.message});}
          audit(`uid=${gate.userId} action=paper-new-run-queued id=${result.id} amount=${result.amount} USDC oldModal=${body.expectedOldModal}`);
          return send(res,202,{...result,csrf:csrf.issue(gate.userId)});
        }
        if(body.confirmedTwice!==true)return send(res,400,{ok:false,error:'Konfirmasi kedua diperlukan'});
        if(settings.isPaused(paperDir))return send(res,409,{ok:false,error:'Paper dipause; resume dahulu'});
        let type=pathname.endsWith('/open')?'open':'close';
        const snap=funding.snapshot(paperDir);
        if(!snap.available)return send(res,409,{ok:false,error:'Paper books unavailable'});
        if(type==='open'){
          if((snap.positions||[]).some(p=>p.pool===body.pool))return send(res,409,{ok:false,error:'Pool sudah dibuka'});
          if(body.replaceCurrent===true){
            if(!(snap.positions||[]).some(p=>p.pool===body.expectedPool&&p.openedAt===body.expectedOpenedAt))return send(res,409,{ok:false,error:'Posisi pilihan berubah; refresh dan konfirmasi ulang'});
            type='switch';
          }else if(snap.openCount>=settings.currentValues(paperDir).MAX_POSITIONS)return send(res,409,{ok:false,error:'Slot penuh; pilih posisi yang diganti'});
          let scan;try{scan=JSON.parse(fs.readFileSync(path.join(paperDir,'screening.json')));}catch{}
          const row=[...(scan?.display||[]),...(scan?.candidates||[])].find(p=>p.address===body.pool);
          if(!row)return send(res,409,{ok:false,error:'Pool tidak ada pada daftar screening; scan ulang dahulu'});
          if(row.status!=='passed'&&(!body.overrideFailedFilters||body.overrideConfirmed!==true))return send(res,400,{ok:false,error:'Filter gagal perlu peringatan dan konfirmasi tambahan',reasons:row.reasons});
          if(body.overrideFailedFilters&&body.overrideConfirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi override diperlukan'});
        }
        const result=commands.queue(paperDir,{type,pool:body.pool,openedAt:body.openedAt,expectedPool:body.expectedPool,expectedOpenedAt:body.expectedOpenedAt,overrideFailedFilters:!!body.overrideFailedFilters,confirmedReasons:body.confirmedReasons||[],requestId:body.requestId,updatedBy:gate.userId});
        audit(`uid=${gate.userId} action=paper-manual-${type}-queued id=${result.id} pool=${body.pool}`);
        return send(res,202,{...result,csrf:csrf.issue(gate.userId)});
      }
      if (pathname === '/api/settings') {
        const oldPolicy=screenRefresh.signature(settings.currentValues(paperDir));
        const patch=body.settings||body.values||{},current=settings.currentValues(paperDir);
        if(patch.CAPITAL_ASSET&&patch.CAPITAL_ASSET!==current.CAPITAL_ASSET&&body.capitalAssetConfirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi perubahan aset modal diperlukan'});
        const normalized=settings.fromDisplayPatch(patch);if([...require('../paper-strategy').KEYS,'EMERGENCY_TP_ENABLED','EMERGENCY_TP_TRIGGER_RANGE_PCT','EMERGENCY_TP_PCT','EMERGENCY_SLPLUS_ENABLED','EMERGENCY_SLPLUS_ARM_PCT','EMERGENCY_SLPLUS_LOCK_PCT','EMERGENCY_SLPLUS_CONFIRM_POLLS','EMERGENCY_SLPLUS_FLOOR_PCT','EMERGENCY_SLPLUS_FLOOR_POLLS'].some(k=>normalized[k]!==undefined&&String(normalized[k])!==String(current[k]))&&body.strategyConfirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi perubahan strategy diperlukan; hanya posisi baru'});
        const result = settings.applySettings(paperDir, patch, meta);
        if (!result.ok) return send(res, 400, { ok: false, error: result.error, rejected: result.rejected });
        if(oldPolicy!==screenRefresh.signature(result.values)){screenRefresh.request(paperDir,{userId:gate.userId,reason:'screening settings changed'});result.rescanRequested=true;}
        notify('update', result).catch(() => {});
        return send(res, 200, { ...result, csrf: csrf.issue(gate.userId), paused: settings.isPaused(paperDir) });
      }
      if (pathname === '/api/sl-blacklist/remove') {
        const L=require('../paper-sl-blacklist');
        if(body.confirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi diperlukan',csrf:csrf.issue(gate.userId)});
        if(typeof body.mint!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.mint))return send(res,400,{ok:false,error:'Mint tidak valid',csrf:csrf.issue(gate.userId)});
        const item=L.list(paperDir).find(x=>x.mint===body.mint);
        if(!item||!L.remove(paperDir,body.mint))return send(res,404,{ok:false,error:'Token tidak ada di SL blacklist',csrf:csrf.issue(gate.userId)});
        audit(`uid=${gate.userId} action=sl-blacklist-remove mint=${body.mint} symbol=${item.symbol||''}`);
        return send(res,200,{ok:true,removed:body.mint,slBlacklist:L.list(paperDir),csrf:csrf.issue(gate.userId)});
      }
      if (pathname === '/api/settings/reset') {
        const oldPolicy=screenRefresh.signature(settings.currentValues(paperDir));
        if(settings.currentValues(paperDir).CAPITAL_ASSET!=='USDC'&&body.capitalAssetConfirmed!==true)return send(res,400,{ok:false,error:'Konfirmasi konversi saldo ke USDC diperlukan'});
        const result = settings.resetSettings(paperDir, meta);
        if(oldPolicy!==screenRefresh.signature(result.values)){screenRefresh.request(paperDir,{userId:gate.userId,reason:'screening settings reset'});result.rescanRequested=true;}
        notify('reset', result).catch(() => {});
        return send(res, 200, { ...result, csrf: csrf.issue(gate.userId), paused: settings.isPaused(paperDir) });
      }
      if (pathname === '/api/runs/continue' || pathname === '/api/runs/activate') {
        if (!liveControl.isStopPresent(stopPath)) return send(res, 409, { ok: false, error: 'Live tidak terkunci; aksi dry run ditolak', csrf: csrf.issue(gate.userId) });
        if (body.confirmed !== true) return send(res, 400, { ok: false, error: 'Konfirmasi diperlukan', csrf: csrf.issue(gate.userId) });
        if (pathname === '/api/runs/continue') {
          let c; try { c = paperRuns.continueRun(paperDir); } catch (e) { return send(res, 500, { ok: false, error: 'Lanjut gagal: ' + String(e.message).slice(0, 120), csrf: csrf.issue(gate.userId) }); }
          if (!c.ok) return send(res, 409, { ...c, csrf: csrf.issue(gate.userId) });
          const result = settings.resumeDryRun(paperDir, meta, { restartFn: opts.restartFn || ((opts.skipPm2) ? (() => ({ ok: true, skipped: 'test' })) : settings.defaultRestartFn) });
          audit(`uid=${gate.userId} action=run-continue autosave=${c.autosave} wasPaused=${c.wasPaused} clearedEnded=${c.clearedEnded} extendedWindow=${c.extendedWindow}`);
          notify('resume', result).catch(() => {});
          return send(res, 200, { ...result, ...c, csrf: csrf.issue(gate.userId) });
        }
        let st = null; try { st = JSON.parse(fs.readFileSync(path.join(paperDir, 'state.json'), 'utf8')); } catch { return send(res, 409, { ok: false, error: 'Paper books unavailable', csrf: csrf.issue(gate.userId) }); }
        let q; try { q = paperRuns.queueActivate(paperDir, body.number, { updatedBy: gate.userId, requestId: body.requestId, state: st }); } catch (e) { return send(res, 409, { ok: false, error: e.message, csrf: csrf.issue(gate.userId) }); }
        audit(`uid=${gate.userId} action=paper-activate-run-queued id=${q.id} run=${q.number}`);
        return send(res, 202, { ...q, csrf: csrf.issue(gate.userId) });
      }
      if (pathname.startsWith('/api/appearance')) {
        let r;
        try {
          if (pathname === '/api/appearance') r = appearance.update(appearanceFile, body || {});
          else if (pathname === '/api/appearance/reset') r = appearance.reset(appearanceFile, appearanceDir);
          else if (pathname === '/api/appearance/bg') r = appearance.saveBg(appearanceFile, appearanceDir, body && body.image);
          else r = appearance.deleteBg(appearanceFile, appearanceDir);
        } catch (e) { r = { ok: false, error: 'Gagal menyimpan: ' + String(e.message || e).slice(0, 120) }; }
        if (r.ok && r.hasBg === undefined) r.hasBg = !!appearance.findBg(appearanceDir);
        audit('appearance ' + pathname.replace('/api/appearance', '') + (r.ok ? ' ok' : ' fail'));
        return send(res, r.ok ? 200 : 400, { ...r, csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/lang') {
        const l = botI18n.setLang(langRoot, body && body.lang);
        return send(res, 200, { ok: true, lang: l, csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/pause') {
        const result = settings.pauseDryRun(paperDir, meta);
        notify('pause', result).catch(() => {});
        return send(res, 200, { ...result, csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/resume') {
        const result = settings.resumeDryRun(paperDir, meta, {
          restartFn: opts.restartFn || ((opts.skipPm2) ? (() => ({ ok: true, skipped: 'test' })) : settings.defaultRestartFn),
        });
        notify('resume', result).catch(() => {});
        return send(res, 200, { ...result, csrf: csrf.issue(gate.userId) });
      }

      if (pathname === '/api/wallet') {
        const secret = body && (body.secret || body.key || body.privateKey);
        if (!secret || typeof secret !== 'string') return send(res, 400, { ok: false, error: 'key required' });
        let saved;
        try { saved = walletStore.saveKey(secret, secretsDir); }
        catch (e) { return send(res, 400, { ok: false, error: e.expose ? e.message : 'invalid key' }); }
        // Drop secret from memory as soon as we can
        if (body) { body.secret = undefined; body.key = undefined; body.privateKey = undefined; }
        audit(`uid=${gate.userId} action=wallet-key-saved address=${saved.publicAddress}`);
        notify('key-saved', { publicAddress: saved.publicAddress, updatedWib: saved.updatedWib }).catch(() => {});
        return send(res, 200, { ok: true, hasKey: true, publicAddress: saved.publicAddress, updatedWib: saved.updatedWib, csrf: csrf.issue(gate.userId) });
      }
      // RPC 1/2/3 (same guard as the private key: owner initData + fresh auth + one-time csrf, confirmed in the UI). The URL is never logged
      // or sent back: the answer only has the last 5 characters of each slot.
      if (pathname === '/api/wallet/rpc') {
        const rpcStore = require('../rpc-store'), slot = Number(body && body.slot), clear = !!(body && body.clear);
        if (String(body && body.confirm || '') !== 'RPC') { if (body) body.url = undefined; return send(res, 400, { ok: false, error: 'konfirmasi diperlukan', csrf: csrf.issue(gate.userId) }); }
        let rpc;
        try { rpc = clear ? rpcStore.clear(secretsDir, slot) : rpcStore.save(secretsDir, slot, body && body.url); }
        catch (e) { if (body) body.url = undefined; return send(res, 400, { ok: false, error: e.expose ? e.message : 'RPC tidak disimpan', csrf: csrf.issue(gate.userId) }); }
        if (body) body.url = undefined;
        audit(`uid=${gate.userId} action=rpc-slot-${clear ? 'cleared' : 'saved'} slot=${slot}`);
        return send(res, 200, { ok: true, rpc, applied: 'hot-reload', csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/wallet/rent/claim') {
        if (String(body && body.confirm || '') !== 'CLAIM') return send(res, 400, { ok: false, error: 'type CLAIM to confirm' });
        if (!walletStore.readEnvelopeMeta(secretsDir).hasKey) return send(res, 400, { ok: false, error: 'key not stored' });
        audit(`uid=${gate.userId} action=wallet-rent-claim-start`);
        let r; try { r = await rentClaim(opts, secretsDir); } catch (e) { r = { ok: false, error: String(e.message || e).slice(0, 160), closed: 0 }; }
        audit(`uid=${gate.userId} action=wallet-rent-claim-done ok=${!!r.ok} closed=${r.closed || 0} sol=${r.reclaimedSol || 0}${r.error ? ' error=' + String(r.error).slice(0, 80) : ''}`);
        return send(res, r.ok ? 200 : 502, { ...r, csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/wallet/delete') {
        walletStore.deleteKey(secretsDir);
        audit(`uid=${gate.userId} action=wallet-key-deleted`);
        notify('key-deleted', {}).catch(() => {});
        return send(res, 200, { ok: true, hasKey: false, publicAddress: null, csrf: csrf.issue(gate.userId) });
      }

      if (pathname === '/api/live/arm') {
        const testMode = !!(body && body.mode === 'test');
        const par = (opts.parityFn || liveParityDifferences)(), logicDebt = par.filter(d => !String(d).startsWith('unverified:'));
        if (false /* parity-check is a report, never a lock on Live ON */ && (logicDebt.length || (par.length && !testMode))) return send(res, 400, { ok: false, error: 'live belum sama dengan dry run; Go Live ditolak', differences: par, testPossible: !logicDebt.length, csrf: csrf.issue(gate.userId) });
        let testParams = null;
        if (testMode && par.length) {
          try { testParams = liveTest.validate(body.test || {}, testDefaults()); } catch (e) { return send(res, 400, { ok: false, error: String(e.message), csrf: csrf.issue(gate.userId) }); }
          if (settings.currentValues(paperDir).CAPITAL_ASSET !== 'SOL') return send(res, 400, { ok: false, error: 'Tes terawasi hanya untuk modal SOL', csrf: csrf.issue(gate.userId) });
        }
        const snap = await liveControl.liveSnapshot({ paperDir,
          secretsDir, stopPath, noNewPath,
          getBalances: opts.getBalances,
          liveStatusFn: opts.liveStatusFn,
          rpc: opts.rpc,
        });
        if (!snap.hasKey) return send(res, 400, { ok: false, error: 'key not stored' });
        if (!snap.balanceCheck || !snap.balanceCheck.ok) {
          return send(res, 400, { ok: false, error: 'balance check failed', reasons: snap.balanceCheck && snap.balanceCheck.reasons, sol: snap.sol, usdc: snap.usdc });
        }
        const armId = arm.issue(gate.userId, { address: snap.publicAddress, mode: testParams ? 'test' : 'normal', test: testParams });
        audit(`uid=${gate.userId} action=live-arm address=${snap.publicAddress} sol=${snap.sol} usdc=${snap.usdc}`);
        notify('live-arm', { publicAddress: snap.publicAddress, sol: snap.sol, usdc: snap.usdc }).catch(() => {});
        return send(res, 200, { ok: true, armed: true, armId, expiresInSec: Math.round((opts.armTtlMs || liveControl.ARM_TTL_MS) / 1000), testMode: !!testParams, test: testParams, publicAddress: snap.publicAddress, sol: snap.sol, usdc: snap.usdc, csrf: csrf.issue(gate.userId) });
      }

      // Manual LIVE open (operator): validated here, QUEUED for the live bot, which re-screens and opens through its normal open path. Never signs here.
      if (pathname === '/api/live/open') {
        const rej = (code, error, extra = {}) => { audit(`uid=${gate.userId} action=live-open-rejected pool=${String(body.pool || '').slice(0, 44)} error=${String(error).slice(0, 80)}`); return send(res, code, { ok: false, error, ...extra, csrf: csrf.issue(gate.userId) }); };
        if (body.confirmed !== true || body.confirmedTwice !== true) return rej(400, 'Konfirmasi dua kali diperlukan');
        const root = path.dirname(paperDir), live = (opts.liveStatusFn || liveControl.pm2LiveStatus)();
        if (liveControl.isStopPresent(stopPath) || !live.running) return rej(409, 'LIVE tidak berjalan; open live hanya saat LIVE ON');
        if (fs.existsSync(noNewPath)) return rej(409, 'NO_NEW aktif: bot live tidak membuka posisi baru');
        let ls = {}, lst = {}; try { ls = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8')); lst = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')); } catch { return rej(409, 'State live tidak terbaca'); }
        if (!(ls.features && ls.features.manualOpen)) return rej(409, 'Bot live yang sedang jalan belum memproses open manual; perlu restart sol-lp-live (versi baru sudah disiapkan)');
        const ps = lst.positions && lst.positions.length ? lst.positions : (lst.position ? [lst.position] : []), max = Number(settings.currentValues(paperDir).MAX_POSITIONS) || 1;
        if (ps.some((p) => p.pool === body.pool)) return rej(409, 'Pool ini sudah dibuka');
        if (ps.length >= max) return rej(409, `Slot penuh (${ps.length}/${max}); tutup satu posisi dahulu. Di LIVE tidak ada ganti posisi otomatis.`);
        let scanJ = null; try { scanJ = JSON.parse(fs.readFileSync(path.join(paperDir, 'screening.json'), 'utf8')); } catch { /* none */ }
        const row = [...(scanJ?.display || []), ...(scanJ?.near || []), ...(scanJ?.candidates || [])].find((p) => p.address === body.pool);
        if (!row) return rej(409, 'Pool tidak ada pada daftar screening; scan ulang dahulu');
        if (ps.some((p) => p.mintX && p.mintX === row.mintX)) return rej(409, 'Token (CA) ini sudah dibuka di pool lain');
        const failed = row.status !== 'passed';
        if (failed && (body.overrideFailedFilters !== true || body.overrideConfirmed !== true)) return rej(400, 'Filter gagal: perlu peringatan dan konfirmasi tambahan', { reasons: row.reasons });
        let q; try { q = liveCommands.queue(root, { pool: body.pool, name: row.name, overrideFailedFilters: failed, confirmedReasons: failed ? row.reasons : [], updatedBy: gate.userId, requestId: body.requestId }); } catch (e) { return rej(400, e.message); }
        if (!q.ok) return rej(409, q.error);
        audit(`uid=${gate.userId} action=live-open-queued id=${q.id} pool=${body.pool} name=${row.name} override=${failed} reasons=${JSON.stringify(failed ? row.reasons : []).slice(0, 160)}`);
        return send(res, 202, { ok: true, id: q.id, duplicate: !!q.duplicate, csrf: csrf.issue(gate.userId) });
      }
      // Manual LIVE close (operator): validated here, QUEUED for the live bot, which closes through liveClose (same as automatic exits). Never signs here.
      if (pathname === '/api/live/close') {
        const rej = (code, error) => { audit(`uid=${gate.userId} action=live-close-rejected pool=${String(body.pool || '').slice(0, 44)} error=${String(error).slice(0, 80)}`); return send(res, code, { ok: false, error, csrf: csrf.issue(gate.userId) }); };
        if (body.confirmed !== true || body.confirmedTwice !== true) return rej(400, 'Konfirmasi dua kali diperlukan');
        const root = path.dirname(paperDir), live = (opts.liveStatusFn || liveControl.pm2LiveStatus)();
        if (liveControl.isStopPresent(stopPath) || !live.running) return rej(409, 'LIVE tidak berjalan; tutup live hanya saat LIVE ON');
        let ls = {}, lst = {}; try { ls = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8')); lst = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')); } catch { return rej(409, 'State live tidak terbaca'); }
        if (!(ls.features && ls.features.manualClose)) return rej(409, 'Bot live yang sedang jalan belum memproses tutup manual; perlu restart sol-lp-live');
        const ps = lst.positions && lst.positions.length ? lst.positions : (lst.position ? [lst.position] : []);
        const pos = ps.find((p) => p.pool === body.pool);
        if (!pos) return rej(409, 'Posisi ini sudah tidak terbuka');
        if (body.openedAt && pos.openedAt && String(body.openedAt) !== String(pos.openedAt)) return rej(409, 'Posisi sudah berganti; muat ulang Mini App');
        if (pos.closePendingReason) return rej(409, `Posisi ini sedang ditutup (${pos.closePendingReason})`);
        let q; try { q = liveCommands.queueClose(root, { pool: body.pool, openedAt: pos.openedAt || null, name: pos.name, updatedBy: gate.userId, requestId: body.requestId }); } catch (e) { return rej(400, e.message); }
        if (!q.ok) return rej(409, q.error);
        audit(`uid=${gate.userId} action=live-close-queued id=${q.id} pool=${body.pool} name=${pos.name}`);
        return send(res, 202, { ok: true, id: q.id, duplicate: !!q.duplicate, csrf: csrf.issue(gate.userId) });
      }
      if (pathname === '/api/live/start') {
        const sendRej = (code, obj) => { try { audit(`uid=${gate.userId} action=live-start-rejected error=${String(obj && obj.error).slice(0, 80)} reasons=${JSON.stringify((obj && (obj.reasons || obj.differences)) || []).slice(0, 160)}`); } catch { /* ignore */ } return send(res, code, obj); };
        audit(`uid=${gate.userId} action=live-start-request`);
        const testMode = !!(body && body.mode === 'test');
        const par = (opts.parityFn || liveParityDifferences)(), logicDebt = par.filter(d => !String(d).startsWith('unverified:'));
        if (false /* parity-check is a report, never a lock on Live ON */ && (logicDebt.length || (par.length && !testMode))) return sendRej(400, { ok: false, error: 'live belum sama dengan dry run; Go Live ditolak', differences: par, testPossible: !logicDebt.length, csrf: csrf.issue(gate.userId) });
        let testParams = null;
        if (testMode && par.length) {
          try { testParams = liveTest.validate(body.test || {}, testDefaults()); } catch (e) { return sendRej(400, { ok: false, error: String(e.message), csrf: csrf.issue(gate.userId) }); }
          if (settings.currentValues(paperDir).CAPITAL_ASSET !== 'SOL') return sendRej(400, { ok: false, error: 'Tes terawasi hanya untuk modal SOL', csrf: csrf.issue(gate.userId) });
        }
        const phrase = body && String(body.confirm || body.phrase || '');
        if (phrase !== 'LIVE') return sendRej(400, { ok: false, error: 'type LIVE to confirm' });
        // Live ON from the button is ONE call: owner (initData) + fresh auth + csrf + the typed LIVE phrase are already checked above; the old separate arm step only added a second round trip that the 0.75 s write limit kept rejecting.
        const direct = !!(body && body.direct === true && !testMode);
        const used = direct ? { ok: true, meta: { mode: 'normal' } } : arm.consume(body && body.armId, gate.userId);
        if (!used.ok) return sendRej(400, { ok: false, error: used.reason });
        const sessionParams = used.meta.mode === 'test' ? used.meta.test : null;
        if (!!sessionParams !== !!testParams) return sendRej(400, { ok: false, error: 'arm token mode mismatch' });
        // Second balance check right before start
        const snap = await liveControl.liveSnapshot({ paperDir,
          secretsDir, stopPath, noNewPath,
          getBalances: opts.getBalances,
          liveStatusFn: opts.liveStatusFn,
          rpc: opts.rpc,
        });
        if (!snap.hasKey) return sendRej(400, { ok: false, error: 'key not stored' });
        if (!snap.balanceCheck || !snap.balanceCheck.ok) {
          return sendRej(400, { ok: false, error: 'balance check failed', reasons: snap.balanceCheck && snap.balanceCheck.reasons });
        }
        if (sessionParams) liveTest.create(sessionRoot, { userId: gate.userId, ...sessionParams });   // before STOP goes away: the bot refuses to start without it
        liveControl.clearNoNew(noNewPath);
        liveControl.removeStop(stopPath);
        let started = { ok: true };
        const startFn = opts.startLiveFn || (opts.skipPm2 ? (() => ({ ok: true, skipped: 'test' })) : liveControl.startLivePm2);
        try { started = startFn(); } catch (e) { started = { ok: false, error: 'start failed' }; }
        let dryRunResumed = false;
        if (!started.ok) {   // live did not start: keep live locked; the dry run was never touched
          try { liveControl.writeStop(stopPath); liveTest.clear(sessionRoot); } catch { /* ignore */ }
          dryRunResumed = true;
        } else {
          // Live is ON: the dry run stops. The paper bot closes its virtual positions, saves the run by number (run-N) and prepares run N+1, then idles.
          try { settings.pauseDryRun(paperDir, meta); } catch { /* ignore */ }
          try { fs.writeFileSync(path.join(paperDir, 'ARCHIVE_ON_LIVE'), JSON.stringify({ at: new Date().toISOString(), by: gate.userId }) + '\n', { mode: 0o600 }); } catch { /* ignore */ }
        }
        audit(`uid=${gate.userId} action=live-start address=${snap.publicAddress} started=${!!started.ok}${sessionParams ? ' TEST maxPositions=' + sessionParams.maxPositions + ' maxPositionSol=' + sessionParams.maxPositionSol + ' hours=' + sessionParams.hours : ''} (STOP removed by the confirmed start; no key in env)`);
        notify('live-start', { publicAddress: snap.publicAddress, started: !!started.ok, startError: started.error || null }).catch(() => {});
        return send(res, 200, { ok: true, live: true, testSession: sessionParams ? liveTest.read(sessionRoot) : null, started: !!started.ok, dryRunResumed, startError: started.error || null, publicAddress: snap.publicAddress, stopPresent: liveControl.isStopPresent(stopPath), csrf: csrf.issue(gate.userId) });
      }

      if (pathname === '/api/live/stop') {
        const mode = (body && body.mode) === 'noNew' ? 'noNew' : 'closeAll';
        if (mode === 'noNew') {
          liveControl.writeNoNew(noNewPath);
          audit(`uid=${gate.userId} action=live-no-new (STOP not written; existing positions stay open)`);
          notify('live-no-new', {}).catch(() => {});
          return send(res, 200, { ok: true, mode, noNew: true, stopPresent: liveControl.isStopPresent(stopPath), csrf: csrf.issue(gate.userId) });
        }
        liveControl.writeStop(stopPath);
        try { liveTest.clear(sessionRoot); } catch { /* none */ }
        // The live bot sees STOP within seconds, closes every position itself and exits with code 0 when flat (pm2 stop_exit_codes keeps it stopped).
        // The process is NOT killed here: killing it would leave positions open on chain with nobody managing them.
        let running = false; try { running = !!(opts.liveStatusFn || liveControl.pm2LiveStatus)().running; } catch { running = false; }
        audit(`uid=${gate.userId} action=live-stop-close-all liveRunning=${running} (STOP written; the bot closes positions and exits by itself)`);
        notify('live-stop', { mode, stopped: !running, closing: running }).catch(() => {});
        return send(res, 200, { ok: true, mode, stopPresent: true, closing: running, stopped: !running, csrf: csrf.issue(gate.userId) });
      }
    } catch (e) {
      if (e && (e.code === 'LIVE_STOP_FORBIDDEN' || e.code === 'TEST_STOP_GUARD')) {
        return send(res, 403, { ok: false, error: 'live STOP is forbidden in this context' });
      }
      return send(res, 500, { ok: false, error: 'write failed' });
    }
  }

  return handle;
}

function startServer(opts = {}) {
  const handle = createApp(opts);
  const host = opts.host || DEFAULT_HOST;
  const port = opts.port != null ? opts.port : DEFAULT_PORT;
  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(() => {
      try { send(res, 500, { ok: false, error: 'server error' }); } catch { /* ignore */ }
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (opts.pollTelegram === true) {
        try { const tg = require('../telegram-notify'); tg.startPolling(); setTimeout(() => { tg.setMyCommands().catch(() => {}); }, 5000); const tick = () => { tg.maybeDailyCard().catch(() => {}); }; setTimeout(tick, 20000); setInterval(tick, 60000); } catch { /* poller and daily card are optional */ }
      }
      resolve({ server, host: addr.address, port: addr.port });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer({ pollTelegram: true }).then(({ host, port }) => {
    console.log(`[${settings.wib()}] [PAPER] mini app listening on http://${host}:${port} (localhost default; live controls require owner confirm)`);
  }).catch((e) => {
    console.error('miniapp failed to start: ' + (e && e.message));
    process.exit(1);
  });
}

module.exports = { startServer, createApp, publicStatus, dashboardData, liveMcap, setSupplyFetcher };
