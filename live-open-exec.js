'use strict';
// The ORDER of on-chain calls for the entry deposit. It signs nothing itself: every chain call goes through the injected dlmm / send / wallet,
// so the exact sequence (create -> Spot share -> BidAsk share; narrow or extended position) is unit-tested with a fake DLMM.
// Dry run MIXED shape = Spot share first, then BidAsk share (OPEN_SPOT_PCT). A share of 0 is skipped; the shares sum EXACTLY to the planned lamports.
const ADD_MIN_SLIPPAGE_PCT = 5, LEG_TRIES = 3;
const isBinSlippage = e => /"Custom":6004\b|ExceededBinSlippageTolerance/.test(String(e && e.message));
async function openDeposit({ dlmm, plan, actualSol, posKp, wallet, send, BN, StrategyType, lamports = 1e9, slippage, onCreated, log = () => {}, retryDelayMs = 2000 }) {
  const total = Math.floor(actualSol * lamports);
  const spotLam = Math.floor(total * plan.split), bidLam = total - spotLam;
  const parts = [];
  if (spotLam > 0) parts.push({ type: StrategyType.Spot, name: 'spot', lam: spotLam });
  if (bidLam > 0) parts.push({ type: StrategyType.BidAsk, name: 'bidask', lam: bidLam });
  if (!parts.length) throw new Error('nothing to deposit');
  let deposited = 0, complete = true, created = false;   // created = the position exists on chain
  // live-open-fix (20 Nov 2026, DCTY 14:09 WIB: the BidAsk leg failed with Custom 6004 ExceededBinSlippageTolerance and the position stayed Spot-only):
  //  - every leg is built on a FRESH active bin (refetchStates right before the build; the SDK reads lbPair.activeId from its cached state),
  //  - deposits use max(SLIPPAGE_PCT, 5)% bin slippage (SOL-only adds below the price: this only loosens the shape tolerance, like the reshape token add),
  //  - a leg whose FIRST chunk did not land (not sent / failed simulation / 6004) is rebuilt and sent again, at most 3 tries: nothing of that leg is on chain yet,
  //  - a failure on a LATER chunk stops (earlier chunks of the leg landed; a rebuild would deposit them twice).
  const addSlippage = Math.max(Number(slippage) || 0, ADD_MIN_SLIPPAGE_PCT);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const refresh = async () => { try { if (dlmm.refetchStates) await dlmm.refetchStates(); } catch { /* RPC hiccup: the build still uses the last state */ } };
  const retryable = e => !e.unknownStatus && (/Blockhash not found|Simulation failed/i.test(String(e.message)) || isBinSlippage(e));
  const sendLeg = async (label, build, signers) => {
    let last;
    for (let k = 1; k <= LEG_TRIES; k++) {
      let sentChunks = 0;
      try {
        await refresh();
        const built = await build(); const txs = Array.isArray(built) ? built : [built];
        for (const [j, t] of txs.entries()) { await send(t, signers, txs.length > 1 ? `${label} ${j + 1}/${txs.length}` : label); sentChunks++; }
        return;
      } catch (e) {
        last = e;
        if (sentChunks > 0 || !retryable(e) || k === LEG_TRIES) { if (sentChunks > 0) e.partialLeg = true; throw e; }
        log(`  ${label} not landed (${k}/${LEG_TRIES}), rebuilding on a fresh active bin: ${String(e.message).split('\n')[0].slice(0, 160)}`);
        await wait(retryDelayMs);
      }
    }
    throw last;
  };
  const paramsFor = part => ({ positionPubKey: posKp.publicKey, totalXAmount: new BN(0), totalYAmount: new BN(part.lam), strategy: { minBinId: plan.minBinId, maxBinId: plan.maxBinId, strategyType: part.type }, user: wallet.publicKey, slippage: addSlippage });
  // 21 Nov 2026 (operator): do not refuse a deposit when the active bin moved, on first open (scan /
  // manual) AND on an OOR-right reposition reopen. A SOL-only leg into bins at or below the
  // price is valid (Meteora allows it). Price refresh, >=5% slippage and 3x 6004 retries stay.
  // Loops are still limited by OOR_RIGHT_MAX_REPOSITIONS (2). If the price moved BELOW the
  // range, a token-side deposit cannot land: the send may fail, any SOL-only portion that can
  // land is kept, and the existing partial-shape alert fires.
  const noteActiveMoved = async stage => {
    if (typeof dlmm.getActiveBin !== 'function') return;
    let a; try { a = await dlmm.getActiveBin(); } catch { return; /* RPC hiccup: keep the plan */ }
    if (!a || !Number.isFinite(+a.binId)) return;
    if (+a.binId > plan.maxBinId) log(`  note ${stage}: active bin ${a.binId} is above the range ${plan.minBinId}..${plan.maxBinId}; depositing SOL-only into the existing bins anyway`);
    else if (+a.binId < plan.minBinId) log(`  note ${stage}: active bin ${a.binId} is below the range ${plan.minBinId}..${plan.maxBinId}; a token-side deposit cannot land, SOL-only portion will be attempted`);
  };
  const missing = [];
  for (const [i, part] of parts.entries()) {
    const params = paramsFor(part);
    try {
      await noteActiveMoved(i === 0 ? 'open' : 'add-' + part.name);
      if (i === 0) {
        if (!plan.wide) {
          await sendLeg('open-' + part.name, () => dlmm.initializePositionAndAddLiquidityByStrategy(params), [wallet, posKp]); created = true;
        } else {
          const tx0 = await dlmm.createExtendedEmptyPosition(plan.minBinId, plan.maxBinId, posKp.publicKey, wallet.publicKey);
          await send(tx0, [wallet, posKp], 'open-extended-empty'); created = true;
          await onCreated({ depositedLamports: 0 });                       // the position exists on chain: record it before depositing
          await noteActiveMoved('add-' + part.name);
          await sendLeg('add-' + part.name, () => dlmm.addLiquidityByStrategyChunkable(params), [wallet]);
        }
        deposited += part.lam;
        if (!plan.wide) await onCreated({ depositedLamports: deposited }); // narrow: created together with the first deposit
        else await onCreated({ depositedLamports: deposited, update: true });
      } else {
        await sendLeg('add-' + part.name, () => (plan.wide ? dlmm.addLiquidityByStrategyChunkable(params) : dlmm.addLiquidityByStrategy(params)), [wallet]);
        deposited += part.lam;
      }
    } catch (e) {
      if (!created) throw e;                                                // nothing exists on chain yet: the caller aborts
      log(`  WARN ${part.name} add failed, position holds only ${deposited / lamports} SOL: ${e.message}`);
      complete = false;
      for (const q of parts.slice(i)) missing.push({ name: q.name, lam: q.lam, partial: q === part && !!e.partialLeg, error: q === part ? String(e.message).split('\n')[0].slice(0, 200) : 'not attempted' });
      break;
    }
  }
  return { complete, depositedLamports: deposited, totalLamports: total, parts: parts.map(p => ({ name: p.name, lam: p.lam })), missing };
}
// live-pnl-fix (20 Nov 2026): one place that books the deposit (liveOpen + liveOpenUsdcPool). Pure: no IO, log injected.
//  real = quote amount read on chain (null = RPC read failed -> fall back to the bot's own count of landed txs).
//  Sets pos.depositSol (+ depositQuote for USDC pools) and dep.depositedLamports from it; nothing after this overwrites them.
//  The planned quote that never reached the position is still in the wallet: SOL pools credit it to leftoverSol (the position's own SOL pile,
//  which exitSolQuote counts and freeCapitalSol keeps reserved); USDC pools lower usdcIn/initialUsdcIn by it (the USDC was never spent).
const DEPOSIT_TOLERANCE = { SOL: 0.005, USDC: 0.5 };
function bookOnchainDeposit(pos, dep, real, { unit = 1e9, quote = 'SOL', log = () => {} } = {}) {
  if (!pos || !dep) return null;
  const isSol = quote === 'SOL';
  const planned = Number(pos.depositPlanned ?? (isSol ? pos.depositSol : (pos.depositQuote ?? pos.depositSol))) || 0;
  pos.depositPlanned = planned;
  let booked;
  if (real == null || !Number.isFinite(Number(real))) booked = dep.complete ? planned : (Number(dep.depositedLamports) || 0) / unit;
  else if (Math.abs(Number(real) - planned) <= (DEPOSIT_TOLERANCE[quote] ?? 0.005) && Number(real) > 0) booked = planned;   // pool moved a hair in the 1.5 s: keep the planned size
  else booked = Math.max(0, Number(real));
  if (Math.abs(booked - planned) > 1e-9) { dep.complete = false; log(`  deposit on chain ${booked.toFixed(isSol ? 6 : 4)} ${quote} vs planned ${planned.toFixed(isSol ? 6 : 4)}: booking the real amount, ${(planned - booked).toFixed(isSol ? 6 : 4)} ${quote} stays in the wallet as this position's pile`); }
  dep.depositedLamports = Math.round(booked * unit);
  pos.depositSol = booked;
  const undeposited = Math.max(0, planned - booked), credited = Number(pos.undepositedCredit) || 0;
  if (isSol) {
    pos.spotSol = Math.min(Number.isFinite(+pos.spotSol) ? +pos.spotSol : booked, booked); pos.bidaskSol = Math.max(0, booked - pos.spotSol);
    pos.leftoverSol = Math.max(0, (Number(pos.leftoverSol) || 0) + undeposited - credited);
  } else {
    pos.depositQuote = booked;
    pos.spotQuote = Math.min(Number.isFinite(+pos.spotQuote) ? +pos.spotQuote : booked, booked); pos.bidaskQuote = Math.max(0, booked - pos.spotQuote);
    if (Number.isFinite(+pos.usdcIn)) pos.usdcIn = +pos.usdcIn - (undeposited - credited);
    if (Number.isFinite(+pos.initialUsdcIn)) pos.initialUsdcIn = +pos.initialUsdcIn - (undeposited - credited);
  }
  pos.undepositedCredit = undeposited;
  return booked;
}
const EXTERNAL_CAPITAL_TOL = { SOL: 0.02, USDC: 0.5 };
const DCTY_MANUAL_ADD_NOTE = 'dikoreksi: add manual operator tidak dihitung profit (disetujui operator)';
// Compare current inventory to the last snapshot at the CURRENT price, so a price move that
// merely swaps X for Y (or the other way) is not treated as a deposit. A real add/remove
// changes the principal. Bot reshape/compound sets pos.botLiquidityTouched so fee reinvest
// is not booked as new capital.
function syncExternalCapital(pos, snap, { log = () => {} } = {}) {
  if (!pos || !snap || !Number.isFinite(+snap.principal) || !Number.isFinite(+snap.price) || !Number.isFinite(+snap.x) || !Number.isFinite(+snap.y)) return null;
  const botTouched = !!pos.botLiquidityTouched;
  if (pos.botLiquidityTouched) delete pos.botLiquidityTouched;
  const lastX = pos.trackedX, lastY = pos.trackedY;
  const hasLast = Number.isFinite(+lastX) && Number.isFinite(+lastY);
  pos.trackedX = +snap.x; pos.trackedY = +snap.y; pos.trackedPrincipal = +snap.principal; pos.trackedAt = snap.at || new Date().toISOString();
  if (botTouched || !hasLast) return null;
  const jump = +snap.principal - (+lastY + +lastX * +snap.price);
  if (!Number.isFinite(jump)) return null;
  const isSol = (snap.quote || pos.quoteSymbol || (pos.quoteMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 'SOL')) !== 'USDC';
  const basisKey = isSol ? 'depositSol' : (Number.isFinite(+pos.depositQuote) ? 'depositQuote' : 'depositSol');
  const basis = Number(pos[basisKey]) || 0;
  const tol = Math.max(EXTERNAL_CAPITAL_TOL[isSol ? 'SOL' : 'USDC'] ?? 0.02, 0.005 * Math.max(basis, Math.abs(+snap.principal), 0));
  if (jump > tol) {
    const fromPile = isSol ? Math.min(Math.max(0, Number(pos.leftoverSol) || 0), jump) : 0;
    const newMoney = jump - fromPile;
    pos[basisKey] = basis + jump;
    if (basisKey === 'depositQuote') pos.depositSol = pos.depositQuote;
    pos.openCostSol = isSol ? (Number.isFinite(+pos.capitalInSol) ? +pos.capitalInSol + newMoney : (Number(pos.openCostSol) || basis) + jump) : pos.openCostSol;
    if (fromPile) {
      pos.leftoverSol = Math.max(0, (Number(pos.leftoverSol) || 0) - fromPile);
      const credit = Number(pos.undepositedCredit) || 0;
      if (credit > 0) pos.undepositedCredit = (jump >= credit - tol) ? 0 : Math.max(0, credit - fromPile);
    }
    if (newMoney > 0 && Number.isFinite(+pos.capitalInSol)) pos.capitalInSol = +pos.capitalInSol + newMoney;
    if (newMoney > 0 && Number.isFinite(+pos.usdcIn) && Number.isFinite(+snap.solUsd) && +snap.solUsd > 0) pos.usdcIn = +pos.usdcIn + newMoney * +snap.solUsd;
    if (isSol) pos.bidaskSol = (Number(pos.bidaskSol) || 0) + jump;
    pos.externalAddedSol = (Number(pos.externalAddedSol) || 0) + jump;
    if (isSol && (Number(pos.spotSol) || 0) > 0 && (Number(pos.bidaskSol) || 0) > 0) pos.stage = 'full';
    log(`  external ${isSol ? 'SOL' : 'USDC'} added to ${pos.name || 'position'}: +${jump.toFixed(6)} (pile ${fromPile.toFixed(6)}, new ${newMoney.toFixed(6)}); basis now ${(+pos[basisKey]).toFixed(6)}`);
    return { kind: 'add', jump, fromPile, newMoney };
  }
  if (jump < -tol) {
    const red = Math.min(basis, -jump);
    pos[basisKey] = Math.max(0, basis - red);
    if (basisKey === 'depositQuote') pos.depositSol = pos.depositQuote;
    if (isSol && Number.isFinite(+pos.capitalInSol)) pos.capitalInSol = Math.max(0, +pos.capitalInSol - red);
    if (isSol) pos.openCostSol = Number.isFinite(+pos.capitalInSol) ? +pos.capitalInSol : Math.max(0, (Number(pos.openCostSol) || basis) - red);
    pos.externalWithdrawnSol = (Number(pos.externalWithdrawnSol) || 0) + red;
    log(`  external ${isSol ? 'SOL' : 'USDC'} withdrawn from ${pos.name || 'position'}: -${red.toFixed(6)}; basis now ${(+pos[basisKey]).toFixed(6)}`);
    return { kind: 'withdraw', jump: -red };
  }
  return null;
}

function correctDctyManualAddHistory(state) {
  const rows = (state && state.history) || [];
  const row = rows.find(r => r && r.name === 'DCTY-SOL' && r.closedAt === '2026-11-20T16:59:26.401Z' && r.position === 'C8jZ5rS5zMN2yTi88PUrtxsYSbgLhAuLodVfqooiQS8F');
  if (!row || row.correctionNote) return { changed: false, row: row || null };
  const depositBot = Number(row.depositSol) || 0;
  let onchain = 0;
  const bins = row.binShape && row.binShape.bins;
  if (Array.isArray(bins)) onchain = bins.reduce((s, b) => s + (Array.isArray(b) ? Number(b[1]) || 0 : 0), 0);
  if (!(onchain > depositBot)) onchain = Number(row.estValueSol) || 0;
  const added = Math.max(0, onchain - depositBot);
  if (!(added > 0.01)) return { changed: false, row, reason: 'no manual add amount' };
  const prev = {
    depositSol: row.depositSol, leftoverSol: row.leftoverSol, undepositedCredit: row.undepositedCredit,
    bidaskSol: row.bidaskSol, stage: row.stage, solOut: row.solOut, solPile: row.solPile,
    realizedSol: row.realizedSol, netPnlSol: row.netPnlSol, pnlCapital: row.pnlCapital,
    pnlPct: row.pnlPct, netPnlPct: row.netPnlPct, pnlCapitalPct: row.pnlCapitalPct,
    pnlUsd: row.pnlUsd, netPnlUsd: row.netPnlUsd, usdcOut: row.usdcOut, legUsdcOut: row.legUsdcOut,
    estPnlPct: row.estPnlPct, lastLive: row.lastLive, peakPnlUsd: row.peakPnlUsd, peakPnlPctUsdc: row.peakPnlPctUsdc,
  };
  const leftoverWas = Number(row.leftoverSol) || 0;
  const received = (Number(row.solOut) || 0) - leftoverWas;
  const fromPile = Math.min(leftoverWas, added);
  const leftoverNow = leftoverWas - fromPile;
  const solOut = leftoverNow + received;
  const capIn = Number(row.capitalInSol) || 0;
  const pnlSol = solOut - capIn + (Number(row.realizedPnlCarrySol) || 0);
  const basis = Number(row.initialCapitalInSol) || capIn;
  const pnlPct = basis > 0 ? 100 * pnlSol / basis : 0;
  const px = Number(row.solUsd) || 0;
  const pnlUsd = pnlSol * px;
  const usdcOut = solOut * px;
  row.depositSol = depositBot + added;
  row.bidaskSol = (Number(row.bidaskSol) || 0) + added;
  row.leftoverSol = leftoverNow;
  row.undepositedCredit = 0;
  row.stage = 'full';
  row.externalAddedSol = added;
  row.solOut = solOut;
  row.solPile = solOut;
  row.realizedSol = +pnlSol.toFixed(5);
  row.netPnlSol = pnlSol;
  row.pnlCapital = pnlSol;
  row.pnlPct = pnlPct;
  row.netPnlPct = pnlPct;
  row.pnlCapitalPct = pnlPct;
  row.usdcOut = usdcOut;
  row.legUsdcOut = usdcOut;
  row.pnlUsd = pnlUsd;
  row.netPnlUsd = pnlUsd;
  row.estPnlPct = +((((Number(row.estValueSol) || onchain) / row.depositSol) - 1) * 100).toFixed(2);
  row.lastLive = { pnlPct: +pnlPct.toFixed(2) };
  row.lastPnlUsd = pnlUsd;
  row.lastPnlPctUsdc = pnlPct;
  row.peakPnlUsd = pnlUsd;
  row.peakPnlPctUsdc = pnlPct;
  row.correctionNote = DCTY_MANUAL_ADD_NOTE;
  row.correctionPrev = prev;
  return { changed: true, added, fromPile, pnlSol, pnlPct, pnlUsd, solOut, depositSol: row.depositSol };
}

module.exports = { openDeposit, bookOnchainDeposit, syncExternalCapital, correctDctyManualAddHistory, DCTY_MANUAL_ADD_NOTE, DEPOSIT_TOLERANCE, EXTERNAL_CAPITAL_TOL, ADD_MIN_SLIPPAGE_PCT, LEG_TRIES, isBinSlippage };
