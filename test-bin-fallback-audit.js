'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),u=require('./paper-usdc'),display=require('./paper-quote-pnl'),client=require('./paper-quote-client'),exit=require('./paper-exit-policy');
const near=(a,b,eps=1e-9)=>assert(Math.abs(a-b)<eps,`${a} != ${b}`);
// Execute the production bin conversion itself, not a duplicate implementation.
const src=fs.readFileSync(__dirname+'/bot.js','utf8');const ctx={bnUi:(x,d)=>Number(x)/10**d};
vm.runInNewContext(src.slice(src.indexOf('function convertBinsForActive('),src.indexOf('function shareInActive('))+'globalThis.fns={convertBinsForActive,sumXY,markValue};',ctx);
const bins={};for(let id=-653;id<=-579;id++){const binPrice=1.01**id*.001;bins[id]={binPrice,x:id> -584?1000:0,y:id<= -584?.1:0};}
const invariant=Object.fromEntries(Object.entries(bins).map(([id,b])=>[id,b.y+b.x*b.binPrice]));
const pb={xAmount:1000000,_decX:6,xUi:1,yUi:1},pool=new Map([[-579,pb],[-584,pb]]);
let current=bins;for(let round=0;round<100;round++)for(const active of [-590,-584,-579,-578,-654]){current=ctx.fns.convertBinsForActive(current,active,pool);for(const[id,b]of Object.entries(current)){near(b.y+b.x*b.binPrice,invariant[id]);if(+id<active)assert.equal(b.x,0);if(+id>active)assert.equal(b.y,0);}}
const top=ctx.fns.convertBinsForActive(bins,-579,pool);assert(Object.entries(top).every(([id,b])=>+id===-579||b.x===0));assert(top[-579].x>0);near(1.01**-579*.001,.0000031472017194579557,1e-18);
(async()=>{
 const pos={name:'Pepetide-SOL',quoteSymbol:'SOL',depositSol:13.457374256,depositQuote:13.457374256,solUsdEntry:82.02,lastSolUsd:82.0,entryPrice:.000002994454448041206,lastPrice:.0000031472017194579557,entryTokenX:293324.257637,entryQuoteY:12.560215972266667,decX:6,mintX:'token',bins:{'-579':{x:49935.54044711341,y:13.31095116099231}},feeY:.006929842613161547,feeX:3550.1887993759947,networkFeesSol:.000075,rentRefundableSol:.06148464,rentNonRefundableSol:0,openSwapCostUsd:-1.7285294638310023};
 const book={virtual:{usdc:0,sol:.23844036}},before=JSON.stringify(book),snap={price:pos.lastPrice,pxUsd:82,estimatedTokenSwapFeeRate:.02};
 const val=await u.exitQuote({pos,book,snap,quote:async()=>({ok:false,error:'429'})});assert(!val.quoted);near(val.estimatedSolSwapFeeRate,.0005);
 const mark=ctx.fns.markValue(pos.bins,snap.price,pos.feeX,pos.feeY);near(mark,13.486211382656487);
 const fixed=display.calculate({pos,valueQuote:mark,solUsd:82,val});assert(fixed.pnlQuote>.018&&fixed.pnlQuote<.019,JSON.stringify(fixed));
 const tokenMark=(49935.54044711341+pos.feeX)*snap.price*82,nativeMark=val.solPile*82;
 const old=display.calculate({pos,valueQuote:mark,solUsd:82,val:{...val,tokenSwapCostUsd:tokenMark*.013,solSwapCostUsd:nativeMark*.013}});assert(old.pnlQuote<-.15&&old.pnlQuote>-.151);
 assert.equal(JSON.stringify(book),before);assert.equal(pos.entryQuoteAmount,13.457374256); // native buffer never counted as lost LP principal
 assert.equal(exit.decide({pos:{...pos,openedAt:new Date().toISOString(),minBinId:-653,maxBinId:-579},val:{...val,pnlPct:100},activeBin:-579,settings:{TP_USD_PCT:20,MAX_HOURS:12}}),null);
 console.log(`OK Pepetide replay: same mark ${mark.toFixed(6)} SOL; old haircut PnL ${old.pnlQuote.toFixed(6)} SOL; fee-only fallback ${fixed.pnlQuote.toFixed(6)} SOL; quote remains unverified, no false TP.`);
 let time=0,count=0,mode='ok',retry='40';const starts=[];
 const q=client.create({now:()=>time,wait:async ms=>{time+=ms;},fetch:async url=>{count++;starts.push(time);if(mode==='429')return {ok:false,status:429,headers:{get:()=>retry}};const raw=new URL(url).searchParams.get('amount');return {ok:true,status:200,json:async()=>({inAmount:raw,outAmount:raw})};}});
 await q.quote('a','b',100n,6,6,100);await q.quote('a','b',100n,6,6,100);assert.equal(count,1);
 await q.quote('a','b',101n,6,6,100);assert(starts[1]-starts[0]>=1500);
 mode='429';await q.quote('a','b',102n,6,6,100);const after=count;assert.equal(q.status().blockedUntil-time,40000);
 await Promise.all(Array.from({length:20},(_,i)=>q.quote('a','b',BigInt(i+200),6,6,100)));assert.equal(count,after);
 time+=40001;retry='0';await q.quote('a','b',999n,6,6,100);assert.equal(q.status().blockedUntil-time,60000);
 time+=60001;mode='ok';await q.quote('a','b',998n,6,6,100);assert.equal(q.status().failures,0);
 console.log('OK actual bin math: negative ids, decimal factor, X→Y rising / Y→X falling, invariant over 500 crossings; quote queue pacing/cache/Retry-After/exponential backoff prevents request storms.');
})().catch(e=>{console.error(e);process.exitCode=1;});
