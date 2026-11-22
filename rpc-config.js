'use strict';
// RPC for dry run, live and the mini app, with up to 3 slots and automatic failover.
// Slot 1 = RPC_URL_1, else the old single setting (a CUSTOM SOLANA_RPC_URL > HELIUS_API_KEY -> mainnet.helius-rpc.com > the public endpoint).
// Slot 2 = RPC_URL_2 (or HELIUS_API_KEY_2), slot 3 = RPC_URL_3 (or HELIUS_API_KEY_3). Slots saved in the mini app (secrets/rpc.env) win and hot-reload. Empty / placeholder (isi_...) / duplicate slots are skipped,
// so 1, 2 or 3 configured slots all work. A request goes to the lowest slot that is not cooling down; a 429 / rate-limit, 5xx, network error
// or timeout puts that slot on a cooldown and the SAME request body is sent to the next slot. When the cooldown ends, slot 1 is used again.
// Re-sending a sendTransaction body to another slot sends the SAME signed bytes (same signature): it can land at most once, so no duplicate effect.
// Keys only live inside the URLs handed to fetch; describe()/slotStatus() show the host only and env-config.redact masks *RPC_URL* / *API_KEY* values.
const PUBLIC = 'https://api.mainnet-beta.solana.com';
const COOLDOWN = { rate: 60_000, error: 30_000 };
const TIMEOUT_MS = 30_000;   // only with 2+ slots (one slot keeps the old behaviour: no client-side timeout)
const clean = v => { const s = String(v || '').trim(); return (!s || /^isi_/i.test(s)) ? '' : s; };
const helius = k => 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(k);
function legacyUrl() {
  const custom = clean(process.env.SOLANA_RPC_URL);
  if (custom && custom.replace(/\/+$/, '') !== PUBLIC) return custom;
  const hk = clean(process.env.HELIUS_API_KEY);
  if (hk) return helius(hk);
  return custom || PUBLIC;
}
// Slots saved from the mini app (Wallet > RPC 1/2/3) live in <LP_SECRETS_DIR>/rpc.env (mode 600, written by rpc-store.js).
// Hot reload: the file is re-checked at most every RELOAD_MS (mtime/size); a slot listed there (even empty = cleared) wins over .env.
const RELOAD_MS = 10_000;
const fileCache = { at: 0, sig: '', vals: {} };
function slotsFile() { return process.env.LP_RPC_FILE || require('path').join(process.env.LP_SECRETS_DIR || '/home/box/.secrets', 'rpc.env'); }
function parseSlotsFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) { const m = line.match(/^\s*(RPC_URL_[123])\s*=\s*(.*?)\s*$/); if (!m) continue; let v = m[2]; if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { v = ''; } } out[m[1]] = String(v); }
  return out;
}
function fileSlots(now = Date.now()) {
  if (now - fileCache.at < RELOAD_MS && fileCache.at) return fileCache.vals;
  fileCache.at = now;
  try { const fs = require('fs'), f = slotsFile(), st = fs.statSync(f), sig = st.mtimeMs + ':' + st.size; if (sig !== fileCache.sig) { fileCache.vals = parseSlotsFile(fs.readFileSync(f, 'utf8')); fileCache.sig = sig; } }
  catch { fileCache.vals = {}; fileCache.sig = ''; }
  return fileCache.vals;
}
// Effective URL of slot n (1..3) and where it comes from: mini app file > .env RPC_URL_n > HELIUS_API_KEY_n (2/3) > old single setting (slot 1).
function slotSource(n) {
  const fv = fileSlots(), k = 'RPC_URL_' + n;
  if (Object.prototype.hasOwnProperty.call(fv, k) && clean(fv[k])) return { url: clean(fv[k]), source: 'miniapp' };
  const cleared = Object.prototype.hasOwnProperty.call(fv, k);
  if (!cleared && clean(process.env[k])) return { url: clean(process.env[k]), source: 'env' };
  if (n > 1 && !cleared && clean(process.env['HELIUS_API_KEY_' + n])) return { url: helius(clean(process.env['HELIUS_API_KEY_' + n])), source: 'env' };
  if (n === 1) { const l = legacyUrl(); return l === PUBLIC ? { url: '', source: 'none', publicFallback: true } : { url: l, source: 'env' }; }
  return { url: '', source: 'none' };
}
// [{ slot: 1..3, url }] configured slots only, in order. The public endpoint is used only when nothing else is configured.
function slots() {
  const out = [], seen = new Set();
  for (const n of [1, 2, 3]) { const u = slotSource(n).url; if (!u || !/^https?:\/\//i.test(u) || seen.has(u)) continue; seen.add(u); out.push({ slot: n, url: u }); }
  if (!out.length) out.push({ slot: 1, url: PUBLIC });
  return out;
}
// Secret parts of the configured URLs (whole URL, query values, long path parts) for log redaction (env-config.redact).
function secretValues() {
  const out = new Set();
  for (const n of [1, 2, 3]) { const u = slotSource(n).url; if (!u || u === PUBLIC) continue; out.add(u);
    try { const x = new URL(u); for (const v of x.searchParams.values()) if (v.length >= 8) out.add(v); for (const seg of x.pathname.split('/')) if (seg.length >= 16) out.add(seg); } catch { /* whole URL only */ } }
  return [...out].sort((a, b) => b.length - a.length);
}
const health = new Map();   // slot -> { until, why, fails, lastOkAt }
const hostOf = (u) => { try { return new URL(u).host; } catch { return '?'; } };
function urlOf(slot) { const x = slots().find(y => y.slot === slot); return x ? x.url : ''; }
function cooling(slot, now = Date.now()) { const h = health.get(slot); return !!(h && h.until > now && h.url === urlOf(slot)); }   // a slot whose URL was changed starts fresh
function markBad(slot, why, ms, now = Date.now()) { const h = health.get(slot) || { fails: 0 }; h.url = urlOf(slot); h.until = now + ms; h.why = why; h.fails = (h.fails || 0) + 1; health.set(slot, h); }
function markOk(slot, now = Date.now()) { const h = health.get(slot); if (h) { h.fails = 0; h.lastOkAt = now; } }
// Order to try: slots not cooling down first (lowest number first), then the cooling ones (soonest back first) as a last resort.
function order(now = Date.now()) {
  const s = slots(), ok = s.filter(x => !cooling(x.slot, now)), bad = s.filter(x => cooling(x.slot, now)).sort((a, b) => health.get(a.slot).until - health.get(b.slot).until);
  return ok.concat(bad);
}
function active(now = Date.now()) { return order(now)[0]; }
function url() { return active().url; }   // back-compat: the URL a plain new Connection(url()) would use now
// fetch for @solana/web3.js Connection ({ fetch }): ignores the endpoint it is given and walks the slots.
function makeFetch({ fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = TIMEOUT_MS, log = null, now = () => Date.now() } = {}) {
  return async function rpcFetch(_endpoint, init = {}) {
    const tries = order(now());
    let lastErr = null, lastRes = null;
    for (let i = 0; i < tries.length; i++) {
      const s = tries[i], last = i === tries.length - 1;
      const ac = new AbortController(), timer = tries.length > 1 ? setTimeout(() => ac.abort(new Error('rpc timeout')), timeoutMs) : null;
      try {
        const { agent, ...rest } = init;   // web3 passes a keep-alive agent built for slot 1's URL; global fetch pools on its own
        const res = await fetchImpl(s.url, { ...rest, signal: ac.signal });
        if (res.status === 429 || res.status >= 500) {
          markBad(s.slot, res.status === 429 ? 'rate-limit 429' : 'http ' + res.status, res.status === 429 ? COOLDOWN.rate : COOLDOWN.error, now());
          if (log) log(`rpc slot ${s.slot} (${hostOf(s.url)}) ${res.status === 429 ? 'rate limited' : 'error ' + res.status}${last ? '' : ', switching to slot ' + tries[i + 1].slot}`);
          lastRes = res; if (!last) { try { if (res.body && res.body.cancel) res.body.cancel().catch(() => {}); } catch { /* ignore */ } continue; } return res;
        }
        markOk(s.slot, now());
        return res;
      } catch (e) {
        const why = /timeout|abort/i.test(String(e && (e.message || e.name))) || ac.signal.aborted ? 'timeout' : 'network';
        markBad(s.slot, why, COOLDOWN.error, now());
        if (log) log(`rpc slot ${s.slot} (${hostOf(s.url)}) ${why}${last ? '' : ', switching to slot ' + tries[i + 1].slot}`);
        lastErr = new Error('rpc ' + why + ' on slot ' + s.slot);   // never the URL (it carries the key)
        if (last) { if (lastRes) return lastRes; throw lastErr; }
      } finally { if (timer) clearTimeout(timer); }
    }
    if (lastRes) return lastRes;
    throw lastErr || new Error('rpc: no slot');
  };
}
// A web3.js Connection that fails over between the slots. The websocket (signature subscriptions) uses slot 1's endpoint;
// confirmations still finish over HTTP (block height / signature status polls go through the failover fetch).
function connection(commitment = 'confirmed', extra = {}) {
  const { Connection } = require('@solana/web3.js');
  return new Connection(slots()[0].url, { commitment, fetch: makeFetch({ log: extra.log || null }), ...extra.config });
}
function slotStatus(now = Date.now()) {
  const s = slots(), act = active(now);
  return [1, 2, 3].map(n => { const x = s.find(y => y.slot === n); if (!x) return { slot: n, configured: false, state: 'empty' };
    const h = health.get(n), cool = cooling(n, now);
    return { slot: n, configured: true, host: hostOf(x.url), state: x.slot === act.slot ? (cool ? 'limited' : 'active') : (cool ? 'limited' : 'standby'), ...(cool ? { why: h.why, backInSec: Math.ceil((h.until - now) / 1000) } : {}) }; });
}
function describe() {
  const s = slots(), u = s[0].url, host = hostOf(u);
  const one = host + (/helius/i.test(host) ? ' (Helius, key aktif)' : (u === PUBLIC ? ' (RPC publik: batas ketat)' : ' (RPC kustom)'));
  return s.length > 1 ? one + ` · ${s.length} slot RPC (failover: ${s.map(x => 'slot ' + x.slot + ' ' + hostOf(x.url)).join(', ')})` : one;
}
function _reloadFile() { fileCache.at = 0; fileCache.sig = ''; fileCache.vals = {}; }
function _reset() { health.clear(); _reloadFile(); }
module.exports = { url, describe, slots, slotSource, slotStatus, secretValues, slotsFile, parseSlotsFile, makeFetch, connection, PUBLIC, COOLDOWN, RELOAD_MS, _reset, _reloadFile };
