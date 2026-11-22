"use strict";
// One approved paper-only correction; state mutation is invoked/persisted by the bot only.
const u=require('./paper-usdc'),qp=require('./paper-quote-pnl');
const ID='pepetide-20261111-000504-onchain-fee-replay-v1';
async function applyPepetide(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book)return null;
 const h=book.history?.find(r=>r.pool==='2uA94Y3X9dwDduojoj2NRcyZQaYtcoSsHZ4y1UX5P8Rs'&&r.closedAt==='2026-11-10T17:05:04.700Z'&&r.position==='68skbkr4y1iqkzAVHW3x7xPBdif6j24E2TV8W3F9ZxsR');
 if(!h||h.correction?.id===ID||state.accountingCorrections?.some(c=>c.id===ID))return null;
 if(h.correction)throw Error('Pepetide already has a different correction; review required');
 if(Math.abs(h.usdcOut-1115.6798034400297)>1e-8||Math.abs(h.usdcIn-1125.108334)>1e-8)throw Error('Historical Pepetide baseline changed; refusing correction');
 const original=JSON.parse(JSON.stringify(h));
 const p={...h,networkFeesSol:h.networkFeesSol-.000075,bins:{one:{x:h.x,y:h.y}}};
 const val=await u.exitQuote({pos:p,book:{virtual:{sol:h.reserveSol}},snap:{price:h.exitPrice,pxUsd:h.solUsd,estimatedTokenSwapFeeRate:h.baseFeePct/100},quote:async()=>({ok:false,error:'Approved historical on-chain fee replay; no execution quote recovered'})});
 const mark=h.y+(h.feeY||0)+(h.x+(h.feeX||0))*h.exitPrice;
 const display=qp.calculate({pos:p,valueQuote:mark,solUsd:h.solUsd,val});
 const delta=val.usdcOut-h.usdcOut;
 if(!(delta>14&&delta<14.2)||!Number.isFinite(book.virtual?.usdc)||!Number.isFinite(display.pnlQuote))throw Error('Historical reconciliation invariant failed');
 const swapCostUsd=(h.swapCostCarryUsd||0)+(h.openSwapCostUsd||0)+val.tokenSwapCostUsd+val.solSwapCostUsd;
 Object.assign(h,display,{usdcOut:val.usdcOut,legUsdcOut:val.usdcOut,pnlUsd:val.pnlUsd,pnlPct:val.pnlPct,netPnlUsd:val.pnlUsd,netPnlPct:val.pnlPct,netPnlSol:val.pnlUsd/h.solUsd,
  tokenSwapCostUsd:val.tokenSwapCostUsd,solSwapCostUsd:val.solSwapCostUsd,swapCostUsd,swapCostSol:swapCostUsd/h.solUsd,solPile:val.solPile,quoted:false,valuationBasis:val.valuationBasis,
  estimatesNote:'Corrected paper close from recorded holdings/entry and historical active-bin price, estimated SDK pool fee + 5bps native conversion. Not a recovered executable Jupiter quote. Original row preserved under correction.original.',corrected:true});
 book.virtual.usdc+=delta;
 const receipt={id:ID,at,pool:h.pool,closedAt:h.closedAt,cashDeltaUsdc:delta,oldUsdcOut:original.usdcOut,newUsdcOut:h.usdcOut,oldPnlUsd:original.pnlUsd,newPnlUsd:h.pnlUsd,oldPnlQuote:original.pnlQuote,newPnlQuote:h.pnlQuote,newPnlQuoteUsd:h.pnlQuoteUsd,method:'Approved recorded-price/holdings replay; SDK swap fee and native 5bps; original close reason retained'};
 h.correction={...receipt,original};state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}

// Second approved paper-only correction (operator, 11 Nov 2026): HOLD-SOL re-entry recalculated as if EMERGENCY_TP had been
// enabled (range 50% trigger armed at bin -463; TP +10% via on-chain fallback). Values are the exact bot.log monitor
// values at 2026-11-11 12:56:50 WIB (replay point). Original row preserved under correction.original.
const HOLD_ID='hold-sol-20261111-emergency-tp-recalc-v1';
const HOLD={pool:'C1Xwm4e8UEQRmhsmogn3HYoHLqJu7M7FVG7nrtPvqHVH',position:'GevspFr7GWNqDBQBgJRzvg7j4CKHLHP3r9v8EVx5tJUo',closedAt:'2026-11-11T07:40:32.274Z',
 oldUsdcOut:319.8589373256273,oldPnlUsd:-180.04106267437265,
 newClosedAt:'2026-11-11T05:56:50.000Z',newExitWib:'2026-11-11 12:56:50 WIB',pnlUsd:65.7311,pnlPct:13.1488,legExitUsdc:565.4311,
 pnlQuote:0.79354305,pnlQuoteUsd:66.086265,feesUsd:44.4902,activeBin:-450,reshapes:9};
function applyHold(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book)return null;
 const h=book.history?.find(r=>r.pool===HOLD.pool&&r.position===HOLD.position&&r.closedAt===HOLD.closedAt);
 if(!h||h.correction?.id===HOLD_ID||state.accountingCorrections?.some(c=>c.id===HOLD_ID))return null;
 if(h.correction)throw Error('HOLD-SOL already has a different correction; review required');
 if(Math.abs(h.usdcOut-HOLD.oldUsdcOut)>1e-8||Math.abs(h.pnlUsd-HOLD.oldPnlUsd)>1e-8||!Number.isFinite(book.virtual?.usdc))throw Error('HOLD-SOL baseline changed; refusing correction');
 const original=JSON.parse(JSON.stringify(h)),delta=HOLD.pnlUsd-h.pnlUsd;
 if(!(delta>245&&delta<246.5))throw Error('HOLD-SOL reconciliation invariant failed');
 const solUsd=HOLD.pnlQuoteUsd/HOLD.pnlQuote,holdMin=Math.round((Date.parse(HOLD.newClosedAt)-Date.parse(h.openedAt))/60000);
 Object.assign(h,{closedAt:HOLD.newClosedAt,exitWib:HOLD.newExitWib,hold:`${Math.floor(holdMin/60)}h ${holdMin%60}m`,holdHours:+(holdMin/60).toFixed(2),
  exitPrice:h.entryPrice*Math.pow(1+h.binStep/1e4,HOLD.activeBin-h.entryActiveBin),lastActiveBin:HOLD.activeBin,reshapes:HOLD.reshapes,
  reason:'emergency_tp USDC +10% (on-chain fallback) (recalc)',usdcOut:h.usdcOut+delta,legUsdcOut:h.legUsdcOut+delta,
  pnlUsd:HOLD.pnlUsd,pnlPct:HOLD.pnlPct,pnlCapital:HOLD.pnlUsd,pnlCapitalPct:HOLD.pnlPct,netPnlUsd:HOLD.pnlUsd,netPnlPct:HOLD.pnlPct,netPnlSol:HOLD.pnlUsd/solUsd,
  pnlQuote:HOLD.pnlQuote,pnlQuoteUsd:HOLD.pnlQuoteUsd,pnlQuotePct:100*HOLD.pnlQuote/h.depositQuote,solUsd,displaySolUsd:solUsd,feesEarnedUsd:HOLD.feesUsd,
  quoted:false,valuationBasis:'on-chain mark minus estimated swap fees (bot.log monitor 12:56:50 WIB)',corrected:true,
  estimatesNote:'Recalculated paper close (approved): EMERGENCY_TP replay at bot.log monitor 12:56:50 WIB (pnlUsdc/exitUsdc/pnlQuote exact log values, 4-8 dp). Holdings x/y, IL, swap/gas cost fields are from the actual 14:40 close and not recomputed. Not an executed quote. Original row under correction.original.'});
 h.closeReasonText=require('./paper-history').closeReason(h);
 book.virtual.usdc+=delta;
 const receipt={id:HOLD_ID,at,pool:h.pool,closedAt:h.closedAt,originalClosedAt:HOLD.closedAt,cashDeltaUsdc:delta,oldUsdcOut:original.usdcOut,newUsdcOut:h.usdcOut,oldPnlUsd:original.pnlUsd,newPnlUsd:h.pnlUsd,oldPnlQuote:original.pnlQuote,newPnlQuote:h.pnlQuote,newPnlQuoteUsd:h.pnlQuoteUsd,method:'Approved EMERGENCY_TP recalculation (range 50% trigger, TP +10%, on-chain fallback) from bot.log monitor values at 12:56:50 WIB; close reason emergency_tp (recalc)'};
 h.correction={...receipt,original};state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}

// v2 (operator, 11 Nov 2026 ~15:35 WIB): full-history recalc under SL -20% net / EMERGENCY_TP +10% (armed at 50% of open lower
// range) / TP +20%, first event wins. HOLD-SOL: min -19.7609% (12:28:24 WIB) never reached SL -20%; armed 11:29:17 (bin -463);
// first poll >= +10% at 12:52:08 WIB (+10.0905%). Recorded at exactly +10% of TP basis initialUsdcIn 499.9 = +49.99 USDC.
const HOLD_ID_V2='hold-sol-20261111-emergency-tp-recalc-v2';
const V2={closedAt:'2026-11-11T05:52:08.000Z',exitWib:'2026-11-11 12:52:08 WIB',activeBin:-454,pollPnl:50.4425,pollPq:0.61234397,pollPqu:50.977635,feesUsd:41.9004,reshapes:9};
function applyHoldV2(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book)return null;
 if(state.accountingCorrections?.some(c=>c.id===HOLD_ID_V2))return null;
 const h=book.history?.find(r=>r.pool===HOLD.pool&&r.position===HOLD.position&&r.correction?.id===HOLD_ID);
 if(!h)return null;
 const basis=Number(h.initialUsdcIn);
 if(Math.abs(basis-499.9)>1e-9||Math.abs(h.pnlUsd-HOLD.pnlUsd)>1e-9||!Number.isFinite(book.virtual?.usdc))throw Error('HOLD-SOL v1 baseline changed; refusing v2');
 const newPnl=+(basis*0.10).toFixed(6),d2=newPnl-h.pnlUsd,k=newPnl/V2.pollPnl,orig=h.correction.original;
 const v1={pnlUsd:h.pnlUsd,pnlPct:h.pnlPct,usdcOut:h.usdcOut,closedAt:h.closedAt,reason:h.reason,pnlQuote:h.pnlQuote,pnlQuoteUsd:h.pnlQuoteUsd};
 const solUsd=V2.pollPqu/V2.pollPq,holdMin=Math.round((Date.parse(V2.closedAt)-Date.parse(h.openedAt))/60000);
 Object.assign(h,{closedAt:V2.closedAt,exitWib:V2.exitWib,hold:`${Math.floor(holdMin/60)}h ${holdMin%60}m`,holdHours:+(holdMin/60).toFixed(2),
  exitPrice:h.entryPrice*Math.pow(1+h.binStep/1e4,V2.activeBin-h.entryActiveBin),lastActiveBin:V2.activeBin,reshapes:V2.reshapes,feesEarnedUsd:V2.feesUsd,
  usdcOut:h.usdcOut+d2,legUsdcOut:h.legUsdcOut+d2,pnlUsd:newPnl,pnlPct:10,pnlCapital:newPnl,pnlCapitalPct:10,netPnlUsd:newPnl,netPnlPct:10,netPnlSol:newPnl/solUsd,solUsd,displaySolUsd:solUsd,
  pnlQuote:V2.pollPq*k,pnlQuoteUsd:V2.pollPqu*k,pnlQuotePct:100*V2.pollPq*k/h.depositQuote,reason:'emergency_tp USDC +10% (recalc)',
  estimatesNote:'Recalculated paper close (approved v2, full-history recalc SL -20%/EMERGENCY_TP +10%/TP +20%): exactly +10% of TP basis initialUsdcIn 499.9 USDC = +49.99 USDC at first poll >= +10% (bot.log 12:52:08 WIB, +10.0905%); SL -20% never reached (min -19.7609% at 12:28:24). pnlQuote scaled from that poll. Holdings x/y, IL, swap/gas fields from the actual 14:40 close, not recomputed. Not an executed quote. Original row under correction.original; v1 under correction.v1.'});
 h.closeReasonText=require('./paper-history').closeReason(h);
 book.virtual.usdc+=d2;
 const receipt={id:HOLD_ID_V2,supersedes:HOLD_ID,at,pool:h.pool,closedAt:h.closedAt,originalClosedAt:HOLD.closedAt,basisUsdc:basis,cashDeltaUsdc:newPnl-orig.pnlUsd,cashDeltaVsV1Usdc:d2,
  oldUsdcOut:orig.usdcOut,newUsdcOut:h.usdcOut,oldPnlUsd:orig.pnlUsd,v1PnlUsd:v1.pnlUsd,newPnlUsd:newPnl,oldPnlQuote:orig.pnlQuote,newPnlQuote:h.pnlQuote,newPnlQuoteUsd:h.pnlQuoteUsd,
  method:'Approved full-history recalc v2 (SL -20% net, EMERGENCY_TP +10% armed at 50% of open lower range, TP +20%; first event wins). HOLD-SOL: EMERGENCY_TP first at 12:52:08 WIB; exactly +10% of initialUsdcIn 499.9.'};
 h.correction={...receipt,original:orig,v1};state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}

// Third approved paper-only correction (operator t210, 11 Nov 2026): X-SOL closed by paper manual close at 15:45:05 WIB after open
// positions' SL was synced to -20%. Recorded as stop loss at the first bot.log monitor poll <= -20% (15:24:15 WIB, -22.4970%,
// -112.4623 USDC); value recorded at exactly -20% of TP/SL basis usdcIn 499.9 = -99.98 USDC. Original row preserved.
const XSOL_ID='xsol-20261111-sl20-recalc-v1';
const XSOL={pool:'38hkfLZhhtjhn9t49LhCkconQ297ad5fnoZ3Mj7w5wEk',position:'Cvzk4MH5wnRMRwbSXiJZXVMdKyC1n1WRDuMSivyNNvAo',openedAt:'2026-11-11T05:17:47.337Z',closedAt:'2026-11-11T08:45:05.470Z',
 oldPnlUsd:-66.63835315984875,newClosedAt:'2026-11-11T08:24:15.000Z',newExitWib:'2026-11-11 15:24:15 WIB',activeBin:-710,pollPnl:-112.4623,pollPq:-1.38808280,pollPqu:-115.544012,feesUsd:18.4370};
function applyXsol(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book)return null;
 if(state.accountingCorrections?.some(c=>c.id===XSOL_ID))return null;
 const h=book.history?.find(r=>r.pool===XSOL.pool&&r.position===XSOL.position&&r.openedAt===XSOL.openedAt&&r.closedAt===XSOL.closedAt);
 if(!h)return null;
 if(h.correction)throw Error('X-SOL already has a different correction; review required');
 const basis=Number(h.initialUsdcIn||h.usdcIn);
 if(Math.abs(basis-499.9)>1e-9||Math.abs(h.pnlUsd-XSOL.oldPnlUsd)>1e-8||!Number.isFinite(book.virtual?.usdc))throw Error('X-SOL baseline changed; refusing correction');
 const original=JSON.parse(JSON.stringify(h)),newPnl=+(-basis*0.20).toFixed(6),delta=newPnl-h.pnlUsd,k=newPnl/XSOL.pollPnl;
 if(!(delta<-33&&delta>-34))throw Error('X-SOL reconciliation invariant failed');
 const solUsd=XSOL.pollPqu/XSOL.pollPq,holdMin=Math.round((Date.parse(XSOL.newClosedAt)-Date.parse(h.openedAt))/60000);
 Object.assign(h,{closedAt:XSOL.newClosedAt,exitWib:XSOL.newExitWib,hold:`${Math.floor(holdMin/60)}h ${holdMin%60}m`,holdHours:+(holdMin/60).toFixed(2),
  exitPrice:h.entryPrice*Math.pow(1+h.binStep/1e4,XSOL.activeBin-h.entryActiveBin),lastActiveBin:XSOL.activeBin,feesEarnedUsd:XSOL.feesUsd,
  usdcOut:h.usdcOut+delta,legUsdcOut:(h.legUsdcOut??h.usdcOut)+delta,pnlUsd:newPnl,pnlPct:-20,pnlCapital:newPnl,pnlCapitalPct:-20,netPnlUsd:newPnl,netPnlPct:-20,netPnlSol:newPnl/solUsd,solUsd,displaySolUsd:solUsd,
  pnlQuote:XSOL.pollPq*k,pnlQuoteUsd:XSOL.pollPqu*k,pnlQuotePct:100*XSOL.pollPq*k/h.depositQuote,reason:'emergency_stop SL -20% (recalc)',quoted:false,corrected:true,
  valuationBasis:'exactly -20% of basis usdcIn 499.9 (SL recalc)',
  estimatesNote:'Recalculated paper close (approved t210): stop loss -20% at first bot.log monitor poll <= -20% (15:24:15 WIB, -22.4970% / -112.4623 USDC); recorded exactly -20% of basis usdcIn 499.9 = -99.98 USDC. Actual paper close was manual_close 15:45:05 WIB at -66.64 USDC (correction.original). Holdings/swap/gas fields from actual close, not recomputed. Not an executed quote.'});
 h.closeReasonText=require('./paper-history').closeReason(h);
 book.virtual.usdc+=delta;
 const receipt={id:XSOL_ID,at,pool:h.pool,closedAt:h.closedAt,originalClosedAt:XSOL.closedAt,basisUsdc:basis,cashDeltaUsdc:delta,oldUsdcOut:original.usdcOut,newUsdcOut:h.usdcOut,oldPnlUsd:original.pnlUsd,newPnlUsd:newPnl,oldPnlQuote:original.pnlQuote,newPnlQuote:h.pnlQuote,newPnlQuoteUsd:h.pnlQuoteUsd,
  method:'Approved SL -20% recalc (t210): first monitor poll <= -20% at 15:24:15 WIB; recorded exactly -20% of usdcIn 499.9; actual close manual_close 15:45:05 WIB'};
 h.correction={...receipt,original};state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}

// Fourth approved paper-only correction (operator, 12 Nov 2026): HUNG-SOL (entry 09:02 WIB) recalculated under TP Emergency SL+
// (TP emergency v1 armed 09:45:13; PnL first >= +5% at 10:05:23; third consecutive poll <= +0.1% at 10:29:08 WIB -> close).
// Values are the exact bot.log monitor values of that poll (10:29:08 WIB, quoted=false, 3 reshapes done). The row had been closed by
// emergency_stop SL at 11:36:17 WIB (-108.83 USDC). Holdings x/y, IL and swap/gas fields are from the actual close and not recomputed.
const HUNG_ID='hung-sol-20261112-emergency-slplus-recalc-v1';
const HUNG={pool:'cyif7J8nYYYRDuc2ocyagB6s7Wygaho8RNB22E6QyiA',position:'4Qiya7unmJwZHBu3Paw6yuVZbMgUmAt5BydPpTGVEhYD',openedAt:'2026-11-12T02:02:15.704Z',closedAt:'2026-11-12T04:36:17.354Z',
 oldPnlUsd:-108.83076245209736,oldUsdcOut:391.0692375479026,newClosedAt:'2026-11-12T03:29:08.000Z',newExitWib:'2026-11-12 10:29:08 WIB',activeBin:-265,reshapes:3,
 pnlUsd:-0.2239,exitUsdc:499.6761,pnlQuote:-0.00604677,pnlQuoteUsd:-0.502003,feesUsd:29.9060,peakPct:8.7};
function applyHungSlPlus(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book)return null;
 if(state.accountingCorrections?.some(c=>c.id===HUNG_ID))return null;
 const h=book.history?.find(r=>r.pool===HUNG.pool&&r.position===HUNG.position&&r.openedAt===HUNG.openedAt&&r.closedAt===HUNG.closedAt);
 if(!h)return null;
 if(h.correction)throw Error('HUNG-SOL already has a different correction; review required');
 const basis=Number(h.initialUsdcIn||h.usdcIn);
 if(Math.abs(basis-499.9)>1e-9||Math.abs(h.pnlUsd-HUNG.oldPnlUsd)>1e-8||Math.abs(h.usdcOut-HUNG.oldUsdcOut)>1e-8||!Number.isFinite(book.virtual?.usdc))throw Error('HUNG-SOL baseline changed; refusing correction');
 const original=JSON.parse(JSON.stringify(h)),newPnl=HUNG.pnlUsd,delta=newPnl-h.pnlUsd,pct=100*newPnl/basis;
 if(!(delta>108.6&&delta<108.62))throw Error('HUNG-SOL reconciliation invariant failed');
 const solUsd=HUNG.pnlQuoteUsd/HUNG.pnlQuote,holdMin=Math.round((Date.parse(HUNG.newClosedAt)-Date.parse(h.openedAt))/60000);
 Object.assign(h,{closedAt:HUNG.newClosedAt,exitWib:HUNG.newExitWib,hold:`${Math.floor(holdMin/60)}h ${holdMin%60}m`,holdHours:+(holdMin/60).toFixed(2),
  exitPrice:h.entryPrice*Math.pow(1+h.binStep/1e4,HUNG.activeBin-h.entryActiveBin),lastActiveBin:HUNG.activeBin,reshapes:HUNG.reshapes,feesEarnedUsd:HUNG.feesUsd,
  reason:'emergency_slplus USDC +0.1% (peak +'+HUNG.peakPct+'%) (recalc)',usdcOut:h.usdcOut+delta,legUsdcOut:(h.legUsdcOut??h.usdcOut)+delta,
  pnlUsd:newPnl,pnlPct:pct,pnlCapital:newPnl,pnlCapitalPct:pct,netPnlUsd:newPnl,netPnlPct:pct,netPnlSol:newPnl/solUsd,solUsd,displaySolUsd:solUsd,
  pnlQuote:HUNG.pnlQuote,pnlQuoteUsd:HUNG.pnlQuoteUsd,pnlQuotePct:100*HUNG.pnlQuote/h.depositQuote,quoted:false,corrected:true,
  valuationBasis:'bot.log monitor 10:29:08 WIB (on-chain mark minus estimated swap fees, quoted=false) under TP Emergency SL+',
  estimatesNote:'Recalculated paper close (approved, operator 12 Nov 2026): TP Emergency SL+ at the third consecutive poll <= +0.1% (bot.log 10:29:08 WIB, pnlUsdc -0.2239 / exitUsdc 499.6761, exact log values). TP emergency v1 armed 09:45:13; PnL first >= +5% at 10:05:23; peak +8.7%. Actual paper close was emergency_stop SL -20% at 11:36:17 WIB at -108.83 USDC (correction.original). Holdings x/y, IL, swap/gas cost fields are from the actual close and not recomputed. Not an executed quote.'});
 h.closeReasonText=require('./paper-history').closeReason(h);
 book.virtual.usdc+=delta;
 const receipt={id:HUNG_ID,at,pool:h.pool,closedAt:h.closedAt,originalClosedAt:HUNG.closedAt,basisUsdc:basis,cashDeltaUsdc:delta,oldUsdcOut:original.usdcOut,newUsdcOut:h.usdcOut,oldPnlUsd:original.pnlUsd,newPnlUsd:newPnl,oldPnlQuote:original.pnlQuote,newPnlQuote:h.pnlQuote,newPnlQuoteUsd:h.pnlQuoteUsd,
  method:'Approved TP Emergency SL+ recalc (operator 12 Nov 2026): arm +5% after TP emergency v1, close at <= +0.1% for 3 consecutive polls; replay poll 10:29:08 WIB; actual close emergency_stop 11:36:17 WIB'};
 h.correction={...receipt,original};state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}

// Approved by operator (13 Nov 2026): the second Huang-SOL entry (stop loss -$154.07) would have been rejected by the v1.8 fee-turnover guard
// (fee turnover 24h 78% > 60% and TVL $12.7k < $25k), so it is treated as NEVER OPENED: the history row and its reposition/reshape events leave the book and the cash
// is restored (cash + 154.07). The full original row and events are kept inside the receipt (state.accountingCorrections). The SL blacklist entry is NOT touched.
const HUANG_VOID_ID='huang-sol-20261113-void-filtered-by-v18-turnover-v1';
const HUANG_VOID={name:'Huang-SOL',pool:'A6p7EpLCn6naf45Xa3HmBDG5d8ty3vEaAWyqSqf2CnQd',position:'6XG72xcqoRPiXrKigYJzhXAVwAqZL2PG8Q7xVC2MiXnS',openedAt:'2026-11-12T18:52:01.220Z',closedAt:'2026-11-12T19:25:18.480Z',pnlUsd:-154.07175788543174};
const bookEquityGap=b=>{const openCap=(b.positions||[]).concat(b.position?[b.position]:[]).reduce((n,p)=>n+(p.initialUsdcIn||p.usdcIn||0),0);return (b.virtual.usdc+openCap)-(b.virtual.totalDepositedUsdc+(b.history||[]).reduce((n,h)=>n+(+h.pnlUsd||0),0));};
function applyHuangVoid(state,at=new Date().toISOString()){
 const book=state.books?.N5;if(!book||!Array.isArray(book.history))return null;
 if(state.accountingCorrections?.some(c=>c.id===HUANG_VOID_ID))return null;
 const idx=book.history.findIndex(r=>r.name===HUANG_VOID.name&&r.pool===HUANG_VOID.pool&&r.position===HUANG_VOID.position&&r.openedAt===HUANG_VOID.openedAt&&r.closedAt===HUANG_VOID.closedAt);
 if(idx<0)return null;
 const h=book.history[idx];
 if(h.correction)throw Error('Huang-SOL already has a different correction; review required');
 if(Math.abs(h.pnlUsd-HUANG_VOID.pnlUsd)>1e-6||!/^emergency_stop/.test(String(h.reason||''))||!Number.isFinite(book.virtual?.usdc))throw Error('Huang-SOL baseline changed; refusing void');
 const gapBefore=bookEquityGap(book),oldUsdc=book.virtual.usdc,realizedBefore=book.history.reduce((n,r)=>n+(+r.pnlUsd||0),0),historyBefore=book.history.length;
 const inLife=e=>e&&e.name===HUANG_VOID.name&&Date.parse(e.at)>=Date.parse(HUANG_VOID.openedAt)&&Date.parse(e.at)<=Date.parse(HUANG_VOID.closedAt);
 const removedRow=JSON.parse(JSON.stringify(h)),removedRepo=(book.rightRepositionEvents||[]).filter(inLife),removedReshape=(book.reshapes||[]).filter(inLife);
 const cashDelta=-h.pnlUsd;
 book.history.splice(idx,1);
 book.rightRepositionEvents=(book.rightRepositionEvents||[]).filter(e=>!inLife(e));
 book.reshapes=(book.reshapes||[]).filter(e=>!inLife(e));
 book.virtual.usdc=oldUsdc+cashDelta;
 const gapAfter=bookEquityGap(book);
 if(Math.abs(gapAfter-gapBefore)>1e-6){throw Error('Huang-SOL void would break the equity identity; refusing');}
 const receipt={id:HUANG_VOID_ID,at,cashDeltaUsdc:cashDelta,oldUsdc,newUsdc:book.virtual.usdc,historyBefore,historyAfter:book.history.length,realizedPnlBefore:realizedBefore,realizedPnlAfter:realizedBefore-h.pnlUsd,quotePnlRemoved:+(h.pnlQuoteUsd||0),
  rows:[{name:h.name,pool:h.pool,position:h.position,openedAt:h.openedAt,closedAt:h.closedAt,pnlUsd:h.pnlUsd,pnlQuoteUsd:h.pnlQuoteUsd,usdcIn:h.usdcIn,usdcOut:h.usdcOut,reason:h.reason}],
  removed:{row:removedRow,rightRepositionEvents:removedRepo,reshapes:removedReshape},
  method:'Approved (operator, 13 Nov 2026): this entry would have been filtered by the v1.8 fee-turnover guard (turnover 24h 78% > 60% and TVL $12.7k < $25k) and was never to be opened. History row, its reposition/reshape events removed; cash restored by the removed PnL; equity identity unchanged. SL blacklist entry kept.'};
 state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}
// Approved by operator (15 Nov 2026): MAX_PUMP1H was lowered 100% -> 15% at 02:06:17 WIB (5 of 6 stop losses entered with pump 1h > 15%).
// The 19 closed trades whose recorded entry pump 1h was > 15% would have been rejected by that filter, so they are treated as NEVER OPENED,
// exactly like Huang-SOL (13 Nov): rows + their reposition/reshape events leave the book and cash is restored by the removed PnL (+338.78 USDC).
// Equity identity is unchanged; full originals stay in the receipt (state.accountingCorrections). SL blacklist is NOT touched.
// The 31 oldest rows have no pump 1h data and are kept as they are. Rows are matched by exact identity + PnL; anything different -> refuse.
const PUMP1H_VOID_ID='pump1h15-20261115-void-filtered-trades-v1';
const PUMP1H_VOID={maxPump1hPct:15,cutoff:'2026-11-14T19:06:17.000Z',sumPnlUsd:-338.780207,rows:[
 ["Impeach-SOL","6EhtxkQkgVVhe9GuKmaNybRbzinEkkCSv5GMS8XMkdzY","HbbFaBzwVeMMKL2Zy14UF2QQkK2X4PZihCLgLhCvWNxC","2026-11-11T15:48:14.834Z","2026-11-11T20:40:55.111Z",46.14232300000015],
 ["PEAK-SOL","6HHjmQjEdTGJ4vZ6Z84bWiLiRUkJLsGqpTQCTrwvyhLh","5iPKodXvQjAzQSRe7nvbGezswTmJpB3N9RagGQHVmiSE","2026-11-11T19:56:31.308Z","2026-11-12T07:56:41.418Z",-21.44620999999995],
 ["paws-SOL","3aZEvrLzf2VgKAu9D7QLBmRfUcELgnKTpzTaXNgcdZu2","4vmTE9hzDc5wHbdVPSL7nvhXg8ZnoGwaGFWDup4fKwGN","2026-11-12T11:52:07.695Z","2026-11-12T12:06:26.418Z",1.6343420000000606],
 ["NIO-SOL","AsTbb4jVBh1SUEPRHqZ87aM39sdy8DDUZBvCvwBmMyYV","5Xbrad8rZ9mvRn5Sm7VFHmgzJqmriAqZSTAZER6QZhj1","2026-11-12T15:01:58.544Z","2026-11-12T19:43:32.478Z",-0.23818780621593305],
 ["paws-SOL","5WVURqJSLRFNZDVDF2njtjZihRLeALvt5tss3yjt2Vik","B5ZoWdRSsUve3xALEZBiErkEoe2CZzAiFEa8RaSuqheN","2026-11-12T12:12:37.145Z","2026-11-12T19:57:23.604Z",56.064602000000036],
 ["Max-SOL","5nwdWtMHvrcUPJpoXSYWcPQv9wkoNzhCME5XJ4KmktzJ","32tigx3g9MWRzBSdDicNPHVyseLB82CwRyWgbmAdVNzo","2026-11-12T19:23:12.467Z","2026-11-12T23:35:38.600Z",-104.57163733060054],
 ["PUSSY-SOL","HcyYBrZVFDDVBLtLxL5C1HDJND1p86BoNA6m7MjBKE3p","FoDnw1mXzi7AZUYo8s8mfgwAXaQ26vTp3GjnqtYBCTQ1","2026-11-12T20:03:25.204Z","2026-11-13T03:52:18.033Z",-105.30304100000001],
 ["FOOD-SOL","3gH2fgs9XuQiEEnLd7bHp6XqoeHHZgajUeaHAPu1BGQK","9jfxGAADyfUjFdqbMxEzz5Ux284aamzDBbqSq4F153L3","2026-11-13T03:24:27.993Z","2026-11-13T04:06:54.703Z",33.79484300000013],
 ["PEAK-SOL","6HHjmQjEdTGJ4vZ6Z84bWiLiRUkJLsGqpTQCTrwvyhLh","5SbhjZ6byvNNNC1cn7jwH2qJPeH6aEGHz7Tx3pxqRgBB","2026-11-12T18:36:48.535Z","2026-11-13T06:36:54.782Z",-15.118766158121332],
 ["NIO-SOL","AsTbb4jVBh1SUEPRHqZ87aM39sdy8DDUZBvCvwBmMyYV","4JVrCiTyWZsGgHTCvVgTuBCfUSghtQBEYBZgPfpDJh9Z","2026-11-13T04:46:24.946Z","2026-11-13T16:11:20.979Z",50.7238430000001],
 ["timmy-SOL","Apb6s7SHxckEBHuJoKmidjQb6jggR2h8U7dtjZDdwvcV","9CURFLjrWwJakDu7bMbQpPnUSi2fgPVg43UBFSMyQZkC","2026-11-13T20:25:16.284Z","2026-11-13T20:37:07.048Z",17.46090799999996],
 ["timmy-SOL","Apb6s7SHxckEBHuJoKmidjQb6jggR2h8U7dtjZDdwvcV","4Mq9bYCxf1UKXk29w7nXc7i1Xx1fn2sQnZ2K65T1bZ3p","2026-11-13T21:11:26.691Z","2026-11-14T02:18:55.538Z",-4.786590999999987],
 ["FOOD-SOL","3gH2fgs9XuQiEEnLd7bHp6XqoeHHZgajUeaHAPu1BGQK","6sqgK3wWDE7Ko8Yc6xzDEoR4iNQDSYpkeqaNMB6WfoAC","2026-11-14T02:59:37.302Z","2026-11-14T03:15:37.757Z",2.741787000000045],
 ["timmy-SOL","Apb6s7SHxckEBHuJoKmidjQb6jggR2h8U7dtjZDdwvcV","Bgmxr5SD27xtQeAQDggvFu6WF99EjA2uXgskMszYVRap","2026-11-14T03:04:40.488Z","2026-11-14T05:59:58.499Z",22.03469000000007],
 ["tinfoil-SOL","3jzQH81Fd8TbeuUsg2RwCTB9e3NQYQ4xeHyVh7YDXg69","EG8QRVja79856oyLL1Vtz3egknTT4iL88mPizaCWgVKG","2026-11-14T10:15:09.035Z","2026-11-14T11:17:03.727Z",51.331965999999966],
 ["tinfoil-SOL","3jzQH81Fd8TbeuUsg2RwCTB9e3NQYQ4xeHyVh7YDXg69","GjF8p2er6ti7uHbzfo7mWHxtWqTEFTbtaR8DxmPryJGj","2026-11-14T12:02:26.808Z","2026-11-14T13:27:28.795Z",-128.98490620624995],
 ["NIO-SOL","9gAKLMXq27oLVwnkW1tJxCuGEcbS4GZ1w3Ar2DnsLz6W","CxMXYA5RsobmnhHHDqUTUvmS4tC6a9sNYf58Lrua5Tuk","2026-11-14T04:16:45.395Z","2026-11-14T16:06:32.588Z",0.11458500000003369],
 ["GTA$-SOL","CbP3vGtPMfkfumgXiseQroFUzH1F5P6giHs9auVf5ADL","6GEEbEEWvxKyXDaCTkgCFaNP5k9aWdujcArd9mkCtTqj","2026-11-14T14:55:52.043Z","2026-11-14T16:49:17.043Z",-128.9910399989326],
 ["Snoopy-SOL","7Q7Hcj6jKhmtf3YZM6AWHKxLrCq88nvcPKhi2eTtsn7t","135QNnQ9MbTiWtRE5tyGTx53nnbc9NotLVEcZYfFJ6G2","2026-11-14T16:37:34.787Z","2026-11-14T18:11:36.992Z",-111.38371678777935]
].map(([name,pool,position,openedAt,closedAt,pnlUsd])=>({name,pool,position,openedAt,closedAt,pnlUsd}))};
function applyPump1hVoid(state,at=new Date().toISOString(),spec=PUMP1H_VOID){
 const book=state.books?.N5;if(!book||!Array.isArray(book.history))return null;
 if(state.accountingCorrections?.some(c=>c.id===PUMP1H_VOID_ID))return null;
 const same=(r,s)=>r.name===s.name&&r.pool===s.pool&&r.position===s.position&&r.openedAt===s.openedAt&&r.closedAt===s.closedAt;
 const idx=spec.rows.map(s=>book.history.findIndex(r=>same(r,s)));
 if(idx.every(i=>i<0))return null;   // none present (e.g. a fresh dry run): nothing to do
 if(idx.some(i=>i<0))throw Error('pump1h void: '+idx.filter(i=>i<0).length+' of '+spec.rows.length+' rows missing; review required');
 if(new Set(idx).size!==idx.length)throw Error('pump1h void: duplicate row match; review required');
 const sum=spec.rows.reduce((n,s)=>n+s.pnlUsd,0);
 if(Math.abs(sum-spec.sumPnlUsd)>1e-5)throw Error('pump1h void: spec sum mismatch');
 idx.forEach((i,k)=>{const h=book.history[i],s=spec.rows[k],p=Number(h.openContext?.snapshot?.pump1hPct);
  if(h.correction)throw Error('pump1h void: '+h.name+' already has a correction; review required');
  if(Math.abs(h.pnlUsd-s.pnlUsd)>1e-6)throw Error('pump1h void: '+h.name+' baseline changed; refusing');
  if(!(p>spec.maxPump1hPct))throw Error('pump1h void: '+h.name+' entry pump1h '+p+' not above '+spec.maxPump1hPct+'%; refusing');
  if(!(Date.parse(h.closedAt)<Date.parse(spec.cutoff)))throw Error('pump1h void: '+h.name+' closed after the filter change; refusing');});
 if(!Number.isFinite(book.virtual?.usdc))throw Error('pump1h void: cash not numeric');
 // Build the new history/events/cash first; commit only if the equity identity holds (open positions are never touched).
 const gapBefore=bookEquityGap(book),oldUsdc=book.virtual.usdc,historyBefore=book.history.length,realizedBefore=book.history.reduce((n,r)=>n+(+r.pnlUsd||0),0);
 const removedRows=idx.map(i=>JSON.parse(JSON.stringify(book.history[i])));
 const inLife=(e,s)=>e&&e.name===s.name&&Date.parse(e.at)>=Date.parse(s.openedAt)&&Date.parse(e.at)<=Date.parse(s.closedAt);
 const inAny=e=>spec.rows.some(s=>inLife(e,s));
 const removedRepo=(book.rightRepositionEvents||[]).filter(inAny),removedReshape=(book.reshapes||[]).filter(inAny);
 const drop=new Set(idx),newHistory=book.history.filter((_,i)=>!drop.has(i));
 const cashDelta=-removedRows.reduce((n,r)=>n+(+r.pnlUsd||0),0),newUsdc=oldUsdc+cashDelta;
 const gapAfter=bookEquityGap({...book,history:newHistory,virtual:{...book.virtual,usdc:newUsdc}});
 if(Math.abs(gapAfter-gapBefore)>1e-6)throw Error('pump1h void: equity identity changed; refusing');
 book.history=newHistory;
 book.rightRepositionEvents=(book.rightRepositionEvents||[]).filter(e=>!inAny(e));
 book.reshapes=(book.reshapes||[]).filter(e=>!inAny(e));
 book.virtual.usdc=newUsdc;
 const receipt={id:PUMP1H_VOID_ID,at,cashDeltaUsdc:cashDelta,oldUsdc,newUsdc:book.virtual.usdc,historyBefore,historyAfter:book.history.length,realizedPnlBefore:realizedBefore,realizedPnlAfter:realizedBefore+cashDelta,
  quotePnlRemoved:removedRows.reduce((n,r)=>n+(+r.pnlQuoteUsd||0),0),
  rows:removedRows.map(h=>({name:h.name,pool:h.pool,position:h.position,openedAt:h.openedAt,closedAt:h.closedAt,pnlUsd:h.pnlUsd,pnlQuoteUsd:h.pnlQuoteUsd,usdcIn:h.usdcIn,usdcOut:h.usdcOut,reason:h.reason,pump1hPct:h.openContext?.snapshot?.pump1hPct})),
  removed:{rows:removedRows,rightRepositionEvents:removedRepo,reshapes:removedReshape},
  method:'Approved (operator, 15 Nov 2026): MAX_PUMP1H lowered 100% -> 15% at 02:06:17 WIB; these 19 closed trades entered with pump 1h > 15% and would have been filtered, so they are treated as never opened (same method as Huang-SOL 13 Nov). Rows and their reposition/reshape events removed; cash restored by the removed PnL; equity identity unchanged. 31 legacy rows without pump 1h data kept. SL blacklist kept.'};
 state.accountingCorrections=[...(state.accountingCorrections||[]),receipt];
 return receipt;
}
async function apply(state,at=new Date().toISOString()){const a=await applyPepetide(state,at),b=applyHold(state,at),c=applyHoldV2(state,at),d=applyXsol(state,at),e=applyHungSlPlus(state,at),f=applyHuangVoid(state,at),g=applyPump1hVoid(state,at);return g||f||e||d||c||b||a;}
module.exports={PUMP1H_VOID_ID,PUMP1H_VOID,applyPump1hVoid,ID,HOLD_ID,HOLD_ID_V2,XSOL_ID,HUNG_ID,HUNG,HUANG_VOID_ID,HUANG_VOID,applyHuangVoid,bookEquityGap,applyHungSlPlus,apply,applyPepetide,applyHold,applyHoldV2,applyXsol};

