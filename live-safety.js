'use strict';
// live-bugfix (20 Nov 2026): pure helpers for the live safety fixes (H1-H4, M1-M3, M6, M7). No chain IO here except
// what callers inject; every function is unit-tested in test-live-bugfix.js.
const fs = require('fs');
const path = require('path');

// ---------- H3: atomic state file ----------
// tmp + fsync + rename; the previous good file is kept as <file>.bak. A crash / full disk can never leave a half-written state.json.
function atomicWriteJson(file, obj, { bak = true } = {}) {
  const data = JSON.stringify(obj, null, 2);
  JSON.parse(data);   // never write something we could not read back
  const tmp = file + '.' + process.pid + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o644);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (bak && fs.existsSync(file)) { try { const cur = fs.readFileSync(file, 'utf8'); JSON.parse(cur); const bt = file + '.bak.tmp'; fs.writeFileSync(bt, cur); fs.renameSync(bt, file + '.bak'); } catch { /* current file unreadable: keep the older .bak */ } }
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* directory fsync not supported: rename is still atomic */ }
}
// Live state loader: missing file -> fresh state; unreadable file -> the .bak (if valid); neither -> throw (the bot must NOT start and forget positions).
function readStateStrict(file, fresh) {
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + '.bak')) { try { return { state: JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), source: 'bak', error: 'state.json missing' }; } catch { /* fall through */ } }
    return { state: fresh(), source: 'new' };
  }
  try { return { state: JSON.parse(fs.readFileSync(file, 'utf8')), source: 'file' }; }
  catch (e) {
    try { const s = JSON.parse(fs.readFileSync(file + '.bak', 'utf8')); return { state: s, source: 'bak', error: e.message }; }
    catch { const err = new Error(`REFUSING LIVE START: ${path.basename(file)} is unreadable (${e.message}) and no valid .bak exists; fix the file by hand, positions may be open on chain`); err.code = 'STATE_UNREADABLE'; throw err; }
  }
}

// ---------- H1: position account gone ----------
const isAccountMissing = (e) => /account does not exist|could not find|not found|AccountNotFound|Invalid account discriminator/i.test(String(e && e.message || e));

// ---------- M1: tokens of THIS position in the wallet ----------
// walletTokenRaw = tokens the position itself put in the wallet (reshape withdrawal / fee X claim not re-added yet).
// closeWalletTokenBefore = wallet balance of the mint just before the close started; what the close withdraws is the growth above it.
function ownedWalletTokenRaw(pos, balRaw) {
  const bal = BigInt(balRaw || 0);
  let own = BigInt(pos.walletTokenRaw || 0);
  if (pos.closeWalletTokenBefore != null) { const grown = bal - BigInt(pos.closeWalletTokenBefore); if (grown > 0n) own += grown; }
  else if (pos.closePosTokenRaw != null) own += BigInt(pos.closePosTokenRaw);   // close started without a wallet read: the position's own token amount at that time
  return own < bal ? own : bal;
}
// Split the SOL a token sale returned between this position (owned share) and stray tokens of the same mint sold with it.
function attributeSale({ ownedRaw, totalRaw, solGained }) {
  const tot = BigInt(totalRaw || 0), own = BigInt(ownedRaw || 0);
  if (tot <= 0n || !(solGained > 0)) return { own: Math.max(0, solGained || 0), stray: 0 };
  const f = Math.min(1, Number(own) / Number(tot));
  return { own: solGained * f, stray: solGained * (1 - f) };
}
// ---------- M3: correct a closed row once its unsold tokens are finally sold ----------
function adjustRowForSale(row, actualSol, pxUsd) {
  if (!row) return null;
  const est = Number(row.pendingTokenEstimateSol) || 0, d = (Number(actualSol) || 0) - est;
  const basisSol = Number(row.initialCapitalInSol || row.capitalInSol) || 0;
  for (const k of ['solOut', 'solPile']) if (Number.isFinite(+row[k])) row[k] = +row[k] + d;
  for (const k of ['pnlCapital', 'netPnlSol']) if (Number.isFinite(+row[k])) row[k] = +row[k] + d;
  if (Number.isFinite(+row.realizedSol)) row.realizedSol = +(+row.realizedSol + d).toFixed(5);
  if (basisSol > 0 && Number.isFinite(+row.pnlCapital)) { const pct = 100 * row.pnlCapital / basisSol; row.pnlPct = row.netPnlPct = row.pnlCapitalPct = pct; }
  if (pxUsd > 0) { const du = d * pxUsd; for (const k of ['pnlUsd', 'netPnlUsd', 'usdcOut', 'legUsdcOut']) if (Number.isFinite(+row[k])) row[k] = +row[k] + du; }
  row.pendingTokenEstimateSol = 0; row.pendingTokenSoldSol = (Number(row.pendingTokenSoldSol) || 0) + (Number(actualSol) || 0); row.swapBackComplete = true; row.pendingSellSettledAt = new Date().toISOString();
  return d;
}
// USDC capital: same correction in USDC (estimate -> real proceeds of the late token sale).
function adjustRowForSaleUsdc(row, actualUsdc) {
  if (!row) return null;
  const est = Number(row.pendingTokenEstimateUsdc) || 0, d = (Number(actualUsdc) || 0) - est;
  for (const k of ['usdcOut', 'legUsdcOut', 'pnlUsd', 'netPnlUsd']) if (Number.isFinite(+row[k])) row[k] = +row[k] + d;
  const basis = Number(row.usdcIn) || 0;
  if (basis > 0 && Number.isFinite(+row.pnlUsd)) row.pnlPct = row.netPnlPct = 100 * row.pnlUsd / basis;
  row.pendingTokenEstimateUsdc = 0; row.pendingTokenSoldUsdc = (Number(row.pendingTokenSoldUsdc) || 0) + (Number(actualUsdc) || 0); row.swapBackComplete = true; row.pendingSellSettledAt = new Date().toISOString();
  return d;
}
// SOL capital open: real pile = budget - what the wallet really spent on the open (rent + deposit + fees). Used only when it is plausible
// (spent covers the deposit, the pile is within the budget, and it differs from the estimate by at most `tol` SOL = a rent estimate gap,
// not someone else's transfer landing in between). rent = spent - deposit (includes the few open tx fees), never above the estimate.
function realOpenPile({ budgetSol, walletBefore, walletAfter, estimateLeftover, depositSol, rentEstimate, tol = 0.02 }) {
  const spent = Number(walletBefore) - Number(walletAfter), est = Number(estimateLeftover) || 0, b = Number(budgetSol), dep = Number(depositSol) || 0;
  if (![spent, b].every(Number.isFinite)) return { use: false, why: 'wallet unreadable', estimate: est };
  const leftover = b - spent;
  if (spent < dep - 1e-6) return { use: false, why: 'wallet spent less than the deposit (incoming transfer?)', spent, estimate: est };
  if (leftover < 0 || leftover > b) return { use: false, why: 'pile outside the budget', spent, estimate: est };
  if (Math.abs(leftover - est) > tol) return { use: false, why: `differs ${(leftover - est).toFixed(6)} SOL from the estimate`, spent, estimate: est };
  const rentEst = Number(rentEstimate); const rent = Math.max(0, Math.min(Number.isFinite(rentEst) && rentEst > 0 ? rentEst : Infinity, spent - dep));
  return { use: true, spent, leftover, rent, estimate: est };
}
// ---------- M6: pending sells: bounded slippage + backoff ----------
const PENDING_SELL = { baseBps: 300, stepBps: 150, maxBps: 800, baseDelayMs: 60_000, maxDelayMs: 60 * 60_000, notifyAt: 3, notifyEveryMs: 6 * 3600_000 };
function pendingSellPlan(ps, now = Date.now(), c = PENDING_SELL) {
  const tries = Number(ps.tries) || 0;
  const due = !(Number(ps.nextTryAt) > now);
  const slippageBps = Math.min(c.maxBps, c.baseBps + tries * c.stepBps);
  const delay = Math.min(c.maxDelayMs, c.baseDelayMs * 2 ** Math.max(0, tries));
  return { due, slippageBps, delay };
}
function pendingSellFailed(ps, now = Date.now(), c = PENDING_SELL) {
  const { delay } = pendingSellPlan(ps, now, c);
  ps.tries = (Number(ps.tries) || 0) + 1; ps.nextTryAt = now + delay; ps.lastFailAt = new Date(now).toISOString();
  const notify = ps.tries >= c.notifyAt && !(Number(ps.notifiedAt) > now - c.notifyEveryMs);
  if (notify) ps.notifiedAt = now;
  return { notify, nextInMs: delay };
}
// ---------- M2: SOL a set of OUR txs moved in/out of the wallet (fee payer = account 0), exact per tx ----------
function lamportDelta(txResp) { const m = txResp && txResp.meta; if (!m || !Array.isArray(m.preBalances) || !Array.isArray(m.postBalances)) return null; return m.postBalances[0] - m.preBalances[0]; }
// The wallet delta since open is only trusted when it agrees with the per-position estimate (an external deposit / withdrawal or another position's
// SOL moving in between would otherwise be booked as this trade's PnL).
function walletDeltaTrusted(real, estimate, capIn) { if (!Number.isFinite(real) || !Number.isFinite(estimate)) return false; return Math.abs(real - estimate) <= Math.max(0.02, 0.02 * (Number(capIn) || 0)); }

// ---------- M7: small TTL cache ----------
function ttlCache(ttlMs, max = 64) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (Date.now() - e.t > (e.ttl ?? ttlMs)) { m.delete(k); return undefined; } return e.v; },
    set(k, v, ttl) { m.set(k, { v, t: Date.now(), ttl }); if (m.size > max) m.delete(m.keys().next().value); return v; },
    delete(k) { m.delete(k); }, clear() { m.clear(); }, get size() { return m.size; },
  };
}

// ---------- H2: reconcile on-chain positions vs state ----------
// onchain: [{ position, pool, hasLiquidity }]; known: state.positions; pending: state.pendingOpens.
function reconcilePlan({ onchain = [], known = [], pending = [] }) {
  const knownSet = new Set(known.map(p => p.position)), pendingByKey = new Map(pending.map(p => [p.position, p]));
  const adopt = [], emptyPending = [], unknownEmpty = [];
  for (const o of onchain) {
    if (knownSet.has(o.position)) continue;
    const pend = pendingByKey.get(o.position);
    if (o.hasLiquidity) adopt.push({ ...o, pending: pend || null });
    else if (pend) emptyPending.push({ ...o, pending: pend });
    else unknownEmpty.push(o);
  }
  const onSet = new Set(onchain.map(o => o.position));
  const missing = known.filter(p => !onSet.has(p.position)).map(p => p.position);
  const stalePending = pending.filter(p => !onSet.has(p.position));
  return { adopt, emptyPending, unknownEmpty, missing, stalePending };
}
// A position the bot did not record (open interrupted after the tx landed, or opened by hand in the same wallet): valued NOW, so its PnL starts at ~0
// and every exit rule (SL / TP / emergency / reshape) manages it from here. A pending-open draft keeps the original budget as the basis instead.
function adoptRecord({ draft, position, pool, name, mintX, decX, quoteMint, quoteDecimals, minBinId, maxBinId, activeBinId, binStep, price, valueQuote, rentRefundableSol, pxUsd, strategySettings, tvlUsd, now = new Date().toISOString() }) {
  const isSolQ = quoteMint === 'So11111111111111111111111111111111111111112';
  if (draft) return { ...draft, adopted: true, adoptedAt: now, adoptReason: 'pending open found on chain' };
  const capital = valueQuote + (isSolQ ? (rentRefundableSol || 0) : 0);
  const base = { pool, name, mintX, decX, position, minBinId, maxBinId, origMinBinId: minBinId, origMaxBinId: maxBinId, openedAt: now, entryPrice: price, entryActiveBin: activeBinId, binStep, tvlUsd: tvlUsd ?? null,
    depositSol: valueQuote, depositPlanned: valueQuote, stage: 'full', rentRefundableSol: isSolQ ? (rentRefundableSol || 0) : (rentRefundableSol || 0), rentPaidSol: rentRefundableSol || 0, leftoverSol: 0, walletTokenRaw: '0',
    strategySettings, openSource: 'adopted', adopted: true, adoptedAt: now, adoptReason: 'found on chain, not in state', shape: 'adopted', quoteMint };
  if (isSolQ) return { ...base, capitalAsset: 'SOL', capitalInSol: capital, quoteSymbol: 'SOL', usdcIn: capital * (pxUsd || 0), initialUsdcIn: capital * (pxUsd || 0), walletBefore: null };
  return { ...base, capitalAsset: 'USDC', quoteSymbol: 'USDC', quoteDecimals: quoteDecimals ?? 6, depositQuote: valueQuote, usdcIn: valueQuote + (rentRefundableSol || 0) * (pxUsd || 0), initialUsdcIn: valueQuote + (rentRefundableSol || 0) * (pxUsd || 0), walletBefore: null };
}
// Affordability: a SOL-capital open needs its budget + the fee reserve free in the wallet (positions' own piles excluded).
function canAffordOpen({ free, budgetSol, extra = 0 }) { return Number.isFinite(free) && budgetSol > 0 && free + 1e-9 >= budgetSol + extra; }

module.exports = { realOpenPile, adjustRowForSaleUsdc, atomicWriteJson, readStateStrict, isAccountMissing, ownedWalletTokenRaw, attributeSale, adjustRowForSale, PENDING_SELL, pendingSellPlan, pendingSellFailed,
  lamportDelta, walletDeltaTrusted, ttlCache, reconcilePlan, adoptRecord, canAffordOpen };
