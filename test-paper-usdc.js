'use strict';
const assert=require('assert'),u=require('./paper-usdc'),e=require('./paper-exit-policy'),s=require('./paper-settings'),screen=require('./pool-screen-source');
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
(async()=>{
 const token='11111111111111111111111111111111';let calls=[];
 const quote=async(from,to,raw,dec,outDec)=>{calls.push([from,to]);const amount=Number(raw)/10**dec;return {ok:true,inUi:amount,outUi:to===u.SOL?amount/100:amount*(from===u.SOL?100:1)*.99};};
 const book={virtual:{usdc:.1,sol:.2}},base={mintX:token,decX:6,usdcIn:244,bins:{0:{x:10,y:2}},feeX:1,feeY:.1,rentRefundableSol:.05};
 const before=JSON.stringify(book),val=await u.exitQuote({pos:base,book,snap:{price:.01,pxUsd:100},quote});
 near(val.usdcOut,(2+.1+.2+.05-.000075)*100*.99+11*.99);assert(val.quoted);assert.equal(JSON.stringify(book),before);near(val.pnlPct,(val.usdcOut-244)/244*100);
 const usdPos={...base,quoteMint:u.USDC,bins:{0:{x:10,y:200}},feeY:2};
 const usdVal=await u.exitQuote({pos:usdPos,book,snap:{price:1,pxUsd:100},quote});
 near(usdVal.usdcOut,202+(.2+.05-.000075)*100*(1-.0005)+11*.99);   // the ~$25 SOL pile is now estimated (stable-route fee 0.05%) instead of being sent to Jupiter; the token part is still quotedassert(!calls.some(([a,b])=>a===u.USDC&&b===u.USDC));
 const p=await u.planUsdcOpen({cash:500,existingSol:0,capUsd:500,gasBuffer:.3,rentRef:.06,openFees:.00005,solUsd:100,quote});
 assert(p.ok);assert(p.boughtSol>=.3);near(p.usdcSpent+p.usdcIn-p.usdcSpent,p.usdcIn);near(p.depositQuote+p.gasUsdc,p.usdcSpent);near(p.tokenSwapUsdc,0);assert(p.reserve>.24);assert(p.depositQuote<=500);
 const oldCalls=calls.length,adequate=await u.planUsdcOpen({cash:500,existingSol:.35,capUsd:500,gasBuffer:.3,rentRef:.06,openFees:.00005,solUsd:100,quote});
 assert(adequate.ok);near(adequate.boughtSol,0);assert.equal(calls.length,oldCalls);near(adequate.usdcIn,adequate.usdcSpent+35);
 const failed=await u.planUsdcOpen({cash:500,capUsd:500,gasBuffer:.3,rentRef:.06,solUsd:100,quote:async()=>({ok:false})});assert(!failed.ok);
 const fallback=await u.exitQuote({pos:base,book,snap:{price:.01,pxUsd:100},quote:async()=>({ok:false,error:'offline'})});assert(!fallback.quoted);
 assert.equal(s.cloneDefaults().TP_USD_PCT,13,'default normal TP is 13 since v1.6');const settings={...s.cloneDefaults(),TP_USD_PCT:20},now=Date.now(),pos={openedAt:new Date(now-60000).toISOString(),minBinId:0,maxBinId:10};
 assert.equal(settings.TP_USD_PCT,20);assert.equal(settings.OOR_RIGHT_CLOSE,true);assert.equal(settings.TRAIL_ENABLED,false);assert.equal(settings.OOR_MAX_MIN,0);
 const decide=(p,v,active=5,extra={})=>e.decide({pos:p,val:{quoted:true,pnlPct:0,pnlUsd:0,usdcOut:500,...v},activeBin:active,settings:{...settings,...extra},now});
 assert.equal(decide({...pos},{pnlPct:1.4,pnlUsd:7}),null);assert.equal(decide({...pos},{pnlPct:20,pnlUsd:100}),'TP USDC +20%');
 const r={...pos};assert.equal(decide(r,{pnlPct:.3,pnlUsd:1.5},11,{OOR_RIGHT_MIN_BINS:0}),null);assert.equal(decide(r,{pnlPct:.3,pnlUsd:1.5},11,{OOR_RIGHT_MIN_BINS:0}),'oor_right_reposition');   // old behaviour (0 = immediately)
 const w={...pos};decide(w,{pnlPct:.3,pnlUsd:1.5},11);assert.equal(decide(w,{pnlPct:.3,pnlUsd:1.5},11),null);   // default OOR_RIGHT_MIN_BINS=5: 1 bin above the range waits
 const far={...pos};decide(far,{pnlPct:.3,pnlUsd:1.5},15);assert.equal(decide(far,{pnlPct:.3,pnlUsd:1.5},15),'oor_right_reposition');   // 5 bins above (default OOR_RIGHT_MIN_BINS): reposition
 const green={...pos};decide(green,{pnlPct:.5,pnlUsd:2.5},11);assert.equal(decide(green,{pnlPct:.5,pnlUsd:2.5},11),'oor_right_take_profit');
 const limit={...pos,rightRepositions:2};decide(limit,{pnlPct:-2,pnlUsd:-10},15);assert.equal(decide(limit,{pnlPct:-2,pnlUsd:-10},15),'oor_right_reposition_limit');   // limit applies once price is >= OOR_RIGHT_MIN_BINS above the range
 const limitWait={...pos,rightRepositions:2};decide(limitWait,{pnlPct:-2,pnlUsd:-10},11);assert.equal(decide(limitWait,{pnlPct:-2,pnlUsd:-10},11),null);   // only 1 bin above: waits
 const noise={...pos};decide(noise,{},11);decide(noise,{},10);assert.equal(noise.oorRightPolls,0);assert.equal(decide(noise,{},11),null);
 const noquote={...pos};for(let n=1;n<10;n++)assert.equal(decide(noquote,{quoted:false,pnlPct:.6},11),null);assert.equal(decide(noquote,{quoted:false,pnlPct:.6},11),'oor_right_take_profit_fallback');assert.equal(noquote.quoteUnavailablePolls,10);decide(noquote,{},10);assert.equal(noquote.quoteUnavailablePolls,0);
 const waitLimit={...pos,rightRepositions:2};for(let n=1;n<10;n++)assert.equal(decide(waitLimit,{quoted:false,pnlPct:-1},15),null);assert.equal(decide(waitLimit,{quoted:false,pnlPct:-1},15),'oor_right_reposition_limit');   // 5 bins above (OOR_RIGHT_MIN_BINS)
 const same={...pos};for(let n=0;n<3;n++)e.decide({pos:same,val:{quoted:false,pnlPct:0},activeBin:11,settings,now,pollId:1});assert.equal(same.quoteUnavailablePolls,1);assert.equal(same.oorRightPolls,1);
 const reset={...pos};for(let n=0;n<9;n++)decide(reset,{quoted:false},11);assert.equal(decide(reset,{quoted:true,pnlPct:.6},11),'oor_right_take_profit');assert.equal(reset.quoteUnavailablePolls,0);
 assert.equal(decide({...pos},{},10),null); // upper boundary is in range at new entry; no churn
 const peaked={...pos,peakPnlPctUsdc:3,peakPnlUsd:15};assert.equal(decide({...peaked},{pnlPct:2,pnlUsd:10}),null);
 assert.equal(decide({...peaked},{pnlPct:2,pnlUsd:10},5,{TRAIL_ENABLED:true}),'trailing_tp_usdc');
 const left={...pos,oorLeftSince:new Date(now-3600000).toISOString()};assert.equal(decide({...left},{pnlPct:-2,pnlUsd:-10},-1),null);
 assert.equal(decide({...left},{pnlPct:-2,pnlUsd:-10},-1,{OOR_MAX_MIN:30}),'oor_left_timeout');
 assert.equal(decide({...pos},{pnlPct:100,pnlUsd:500,quoted:false}),null);assert.equal(decide({...pos},{},-1,{emergency:true}),null);assert.equal(decide({...pos},{pnlPct:-20,pnlUsd:-100},-1),'emergency_stop');assert.equal(decide({...pos},{pnlPct:-19.999,pnlUsd:-99.99},-1),null); /* default SL -20% since v1.2 (t204) */
 const peakPos={...pos};decide(peakPos,{pnlPct:2,pnlUsd:10});const peakAt=peakPos.peakPnlAt;decide(peakPos,{pnlPct:1,pnlUsd:5});assert.equal(peakPos.peakPnlUsd,10);assert.equal(peakPos.peakPnlAt,peakAt);
 assert(s.validatePatch({TP_USD_PCT:20,OOR_RIGHT_CLOSE:true,TRAIL_ENABLED:false,OOR_MAX_MIN:0}).ok);assert(!s.validatePatch({OOR_RIGHT_CLOSE:'anything'}).ok);
 const fake={tvl:0,fee_tvl_ratio:{'30m':77901236}};assert.equal(screen.sanityReason(fake,10000),'TVL $0');const row=screen.row(fake,[],'passed');assert(row.sanityRejected);assert.equal(row.status,'rejected');assert.equal(row.ft30m,null);
 assert(screen.sanityReason({tvl:10001,fee_tvl_ratio:{'30m':1001}},10000).includes('1000'));
 const a={token_y:{address:u.SOL},fee_tvl_ratio:{'30m':9}},b={token_y:{address:u.USDC},fee_tvl_ratio:{'30m':.6}};assert(screen.priority(a,b)>0);
 console.log('OK paper USDC: both quote close accounting, native rent/gas funding/reuse/failure, 20% TP, right-OOR 2 polls, min net .5%, max 2 repositions, trailing/left timeout disabled, peak persistence, sanity, USDC priority.');
})().catch(err=>{console.error(err);process.exitCode=1});

{const s=require('./pool-screen-source'),zero=s.row({name:'HCAT-SOL',tvl:0,fee_tvl_ratio:{'30m':77901236}},[], 'passed');const rows=s.sortRows([...Array.from({length:80},(_,i)=>({ft30m:100-i,sanityRejected:false})),zero]);assert.equal(rows.length,60);assert.equal(rows.at(-1).name,'HCAT-SOL');assert.equal(rows.at(-1).status,'rejected');assert.equal(rows.at(-1).ft30m,null);assert.deepEqual(rows.at(-1).reasons,['TVL $0']);console.log('OK bad-liquidity rows remain visible at bottom with ratio suppressed, never top/picked.');}
