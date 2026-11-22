'use strict';
// Token logo bytes for the Warlock cards (parent process only; the render child never touches the network).
// Jupiter token list, then DexScreener; https only, no IPs/localhost, max 512 KB, PNG/JPEG/GIF only (canvas can't draw WebP). Cached in memory.
const cache = new Map(); let fetcher = null;
function setFetcher(fn) { fetcher = fn; cache.clear(); }
const safe = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && !/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(x.hostname) ? x.href : null; } catch { return null; } };
const kind = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b.slice(0, 3).toString() === 'GIF' ? 'gif' : null);
async function getJson(url, ms) { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function defaultFetch(mint, ms) {
  const urls = [];
  try { const j = await getJson('https://lite-api.jup.ag/tokens/v2/search?query=' + encodeURIComponent(mint), ms); const t = (Array.isArray(j) ? j : []).find((x) => x && x.id === mint); if (t && t.icon) urls.push(t.icon); } catch { /* next */ }
  try { const d = await getJson('https://api.dexscreener.com/tokens/v1/solana/' + encodeURIComponent(mint), ms); for (const p of Array.isArray(d) ? d : []) if (p && p.baseToken && p.baseToken.address === mint && p.info && p.info.imageUrl) { urls.push(p.info.imageUrl); break; } } catch { /* none */ }
  for (const u of urls) { const s = safe(u); if (!s) continue; try { const r = await fetch(s, { signal: AbortSignal.timeout(ms), redirect: 'follow' }); if (!r.ok) continue; const b = Buffer.from(await r.arrayBuffer()); if (b.length && b.length <= 512 * 1024 && kind(b)) return b; } catch { /* next */ } }
  return null;
}
// base64 of the logo, or null (never throws, never waits longer than ms)
async function logoB64(mint, { ms = 3500 } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ''))) return null;
  if (!cache.has(mint)) cache.set(mint, Promise.resolve().then(() => (fetcher || defaultFetch)(mint, ms)).then((b) => (b && kind(b) ? b.toString('base64') : null)).catch(() => null));
  return Promise.race([cache.get(mint), new Promise((r) => setTimeout(() => r(null), ms * 2.5).unref())]);
}
module.exports = { logoB64, setFetcher };
