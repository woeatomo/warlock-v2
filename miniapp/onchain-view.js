'use strict';
// Mini App display helpers (READ-ONLY, no signing, no state writes):
//  1) token logos: Jupiter token search (icon) -> DexScreener (info.imageUrl), image bytes cached in memory and served from our own origin (CSP img-src 'self').
//  2) a Meteora-style view of an open live position from its on-chain account (getPosition): Your Liquidity, claimable fees, PnL — display only,
//     the bot's own exit PnL is untouched. Every read is cached and refreshed in the background so publicStatus stays synchronous.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const IMG_TYPES = /^image\/(png|jpe?g|webp|gif)$/i;   // no SVG: it would be served from our origin
const MAX_BYTES = 400 * 1024;

// ---------- logos ----------
const logoCache = new Map();   // mint -> { at, busy, img: {type, buf} | null, promise }
let logoFetcher = null;        // tests: async (mint) => {type, buf} | null
function setLogoFetcher(fn) { logoFetcher = fn; logoCache.clear(); }
async function httpJson(url, ms = 6000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function safeImageUrl(u) { try { const x = new URL(String(u)); return x.protocol === 'https:' && !/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(x.hostname) ? x.href : null; } catch { return null; } }
async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'follow' });
  const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || !IMG_TYPES.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 0 && buf.length <= MAX_BYTES ? { type, buf } : null;
}
async function defaultLogo(mint) {
  const urls = [];
  try { const j = await httpJson('https://lite-api.jup.ag/tokens/v2/search?query=' + mint); const t = (Array.isArray(j) ? j : []).find((x) => x && x.id === mint); if (t && t.icon) urls.push(t.icon); } catch { /* next source */ }
  try { const d = await httpJson('https://api.dexscreener.com/tokens/v1/solana/' + mint); for (const p of Array.isArray(d) ? d : []) if (p && p.baseToken && p.baseToken.address === mint && p.info && p.info.imageUrl) { urls.push(p.info.imageUrl); break; } } catch { /* fallback W */ }
  for (const u of urls) { const safe = safeImageUrl(u); if (!safe) continue; try { const img = await fetchImage(safe); if (img) return img; } catch { /* try the next one */ } }
  return null;
}
// Resolves to {type, buf} or null (= show the Warlock W). Found: cached 24 h; not found / error: retried after 30 min.
function tokenLogo(mint) {
  if (!MINT_RE.test(String(mint || ''))) return Promise.resolve(null);
  const now = Date.now(), e = logoCache.get(mint);
  if (e && (e.busy || now - e.at < (e.img ? 86400e3 : 1800e3))) return e.busy ? e.promise : Promise.resolve(e.img);
  if (logoCache.size > 500) logoCache.delete(logoCache.keys().next().value);
  const rec = e || { at: 0, img: null }; rec.busy = true;
  rec.promise = Promise.resolve().then(() => (logoFetcher || defaultLogo)(mint)).catch(() => null)
    .then((img) => { rec.img = img && img.buf ? img : null; rec.at = Date.now(); rec.busy = false; return rec.img; });
  logoCache.set(mint, rec);
  return rec.promise;
}

// ---------- on-chain position snapshot ----------
const posCache = new Map();    // position pubkey -> { at, busy, v }
const dlmmCache = new Map();   // pool -> { d, at }
let posFetcher = null;         // tests: async (pos) => {x, y, fx, fy, price, activeBin}
function setPositionFetcher(fn) { posFetcher = fn; posCache.clear(); }
async function defaultPosition(pos) {
  const web3 = require('@solana/web3.js'), DLMM = require('@meteora-ag/dlmm').default || require('@meteora-ag/dlmm');
  let e = dlmmCache.get(pos.pool);
  if (!e) { const conn = require('../rpc-config').connection('confirmed'); e = { d: await DLMM.create(conn, new web3.PublicKey(pos.pool)), at: Date.now() }; dlmmCache.set(pos.pool, e); }
  else { await e.d.refetchStates(); e.at = Date.now(); }
  const d = e.d, p = await d.getPosition(new web3.PublicKey(pos.position)), active = await d.getActiveBin();
  const dX = 10 ** d.tokenX.mint.decimals, dY = 10 ** d.tokenY.mint.decimals, pd = p.positionData;
  return { x: +pd.totalXAmount / dX, y: +pd.totalYAmount / dY, fx: +pd.feeX.toString() / dX, fy: +pd.feeY.toString() / dY, price: +d.fromPricePerLamport(+active.price), activeBin: active.binId };
}
// Latest snapshot (or null until the first read lands). Refreshed at most every 30 s per position, only while the Mini App is being polled.
function positionSnapshot(pos, maxAgeMs = 30000) {
  if (!pos || !pos.position || !pos.pool) return null;
  const now = Date.now(), e = posCache.get(pos.position);
  if (!e || (!e.busy && now - e.at > maxAgeMs)) {
    const rec = e || { at: 0, v: null }; rec.busy = true; rec.at = now; posCache.set(pos.position, rec);
    Promise.resolve().then(() => (posFetcher || defaultPosition)(pos))
      .then((v) => { if (v && [v.x, v.y, v.fx, v.fy, v.price].every(Number.isFinite)) rec.v = { ...v, at: new Date().toISOString() }; })
      .catch(() => {}).finally(() => { rec.busy = false; });
  }
  return e && e.v ? e.v : null;
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Meteora-style numbers for one live SOL-quoted position. Display only.
//  liquidity  = SOL + token in the bins at the current price (Meteora "Your Liquidity", fees excluded)
//  unclaimed  = position fees owed (Meteora "Claimable Fees")
//  claimed    = compound (claimed + re-deposited by reshape) / di wallet (claimed SOL fees still in the wallet pile)
//  PnL        = liquidity + unclaimed + claimed-to-wallet - deposits   (compounded fees are already inside the liquidity)
function meteoraView(pos, snap, solUsd) {
  const sx = num(solUsd) > 0 ? num(solUsd) : null, usd = (s) => (sx ? s * sx : null);
  let src = 'onchain', x, y, fx, fy, price;
  if (snap) ({ x, y, fx, fy, price } = snap);
  else {   // first poll after a restart: the bot's own per-bin snapshot (no fee split yet)
    const b = pos.liveBins; if (!b || !Array.isArray(b.bins)) return null;
    src = 'bot-snapshot'; price = num(b.price) || num(pos.lastPrice); x = b.bins.reduce((n, z) => n + num(z.token), 0); y = b.bins.reduce((n, z) => n + num(z.sol), 0); fx = null; fy = null;
  }
  const liqSol = y + x * price, unSol = fx == null ? null : fy + fx * price;
  const compSol = num(pos.feesCompoundedQuote), compTok = num(pos.feesCompoundedX), walletSol = num(pos.feesClaimedToPileSol);
  const compEq = compSol + compTok * price, claimedEq = compEq + walletSol;
  const deposit = num(pos.depositSol) || num(pos.depositQuote);
  const pnlSol = unSol == null ? null : liqSol + unSol + walletSol - deposit;
  const walletTok = pos.walletTokenRaw != null && Number.isFinite(Number(pos.decX)) ? Number(BigInt(pos.walletTokenRaw)) / 10 ** Number(pos.decX) : 0;
  return {
    source: src, at: snap ? snap.at : (pos.liveBins && pos.liveBins.at) || null, solUsd: sx, price,
    depositSol: deposit, depositUsd: usd(deposit),
    liquidity: { sol: y, token: x, solEq: liqSol, usd: usd(liqSol) },
    unclaimed: unSol == null ? null : { sol: fy, token: fx, solEq: unSol, usd: usd(unSol) },
    claimed: { solEq: claimedEq, usd: usd(claimedEq), compound: { sol: compSol, token: compTok, solEq: compEq, usd: usd(compEq) }, wallet: { sol: walletSol, token: 0, solEq: walletSol, usd: usd(walletSol) } },
    feesEarned: unSol == null ? null : { solEq: unSol + claimedEq, usd: usd(unSol + claimedEq) },
    pnl: pnlSol == null ? null : { sol: pnlSol, usd: usd(pnlSol), pct: deposit > 0 ? 100 * pnlSol / deposit : null },
    walletTokenOutside: walletTok > 0 ? { token: walletTok, solEq: walletTok * price } : null,
  };
}
module.exports = { tokenLogo, setLogoFetcher, positionSnapshot, setPositionFetcher, meteoraView, MINT_RE, safeImageUrl };
