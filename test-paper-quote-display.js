'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const d=require('./paper-quote-pnl'),exit=require('./paper-exit-policy');
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const base=()=>({quoteSymbol:'SOL',depositQuote:100,solUsdEntry:100,entryPrice:10,networkFeesSol:0,rentNonRefundableSol:0,openSwapCostUsd:0,bins:{'1':{x:1,y:90}},feeX:0,feeY:0,lastPrice:11,lastSolUsd:80,usdcIn:10000});
let p=base(),copy=JSON.parse(JSON.stringify(p));let a=d.calculate({pos:p,valueQuote:101,solUsd:100,val:{closeFees:0}}),b=d.calculate({pos:p,valueQuote:101,solUsd:80,val:{closeFees:0}});
near(a.pnlQuote,1);near(b.pnlQuote,1);near(a.pnlQuoteUsd,100);near(b.pnlQuoteUsd,80);near(b.solPriceChangePct,-20);assert.equal(d.format(b),'+1.0000 SOL ($80.00)');
for(const [k,v]of Object.entries(copy))assert.deepStrictEqual(p[k],v,k); // no capital/inventory/risk overwrite
p={...base(),quoteSymbol:'USDC',depositQuote:100};a=d.calculate({pos:p,valueQuote:103.1,solUsd:80,val:{closeFees:0}});near(a.pnlQuote,3.1);near(a.pnlQuoteUsd,3.1);assert.equal(d.format(a),'+3.10 USDC ($3.10)');
p={...base(),entryTokenX:1,entryQuoteY:89.95,entryPrice:10,openSwapCostUsd:7,networkFeesSol:.02,rentNonRefundableSol:.01};a=d.calculate({pos:p,valueQuote:99.95,solUsd:80,val:{closeFees:.01,tokenSwapCostUsd:1}});near(p.embeddedEntrySwapQuote,.05);near(a.pnlQuote,-.1225); // entry token swap counted once, not twice
p=base();p.feesCompoundedQuote=20;p.feeY=.25;a=d.fromPosition(p,{closeFees:0});near(a.pnlQuote,1.25); // compounded fees in inventory are NOT added a second time
p={...base(),pnlQuoteCarry:.2};a=d.calculate({pos:p,valueQuote:100.1,solUsd:80,val:{closeFees:0}});near(a.pnlQuote,.3);
const policy={TP_USD_PCT:20,OOR_RIGHT_CLOSE:true,OOR_RIGHT_CONFIRM_POLLS:2,OOR_RIGHT_MIN_PROFIT_PCT:.5,OOR_RIGHT_MAX_REPOSITIONS:2,MAX_HOURS:12};
p={...base(),openedAt:new Date().toISOString(),minBinId:1,maxBinId:5};Object.assign(p,{lastLive:{pnlQuote:100,pnlQuoteUsd:8000}});
assert.equal(exit.decide({pos:p,val:{quoted:true,pnlUsd:-100,pnlPct:-1},activeBin:2,settings:policy}),null); // huge quote display gain cannot trigger USDC TP
assert.equal(exit.decide({pos:p,val:{quoted:true,pnlUsd:2000,pnlPct:20},activeBin:2,settings:policy}),'TP USDC +20%');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'quote-display-'));
try{
 const line='[2026-11-10 23:45:00 WIB] [PAPER] monitor [N5] TEST-SOL: value=101 SOL pnlUsdc=-1920 pnlUsdcPct=-19.2% pnlQuote=1.00000000 quoteSymbol=SOL pnlQuoteUsd=80.000000 solChangePct=-20\n';
 fs.writeFileSync(path.join(root,'bot.log'),line);const feed=require('./miniapp/activity').events(root);assert(feed[0].text.includes('+1.0000 SOL ($80.00)'));assert(!feed[0].text.includes('-1920'));
 const req=createRequire(path.join(__dirname,'telegram-notify.js')),notices=[];
 const context={require:req,process:{env:{TELEGRAM_CFG_FILE:path.join(root,'tg.json')}},module:{exports:{}},Buffer,console,setTimeout,clearTimeout};
 vm.runInNewContext('var __dirname='+JSON.stringify(__dirname)+';\n'+fs.readFileSync(path.join(__dirname,'telegram-notify.js'),'utf8')+'\nfire=async text=>{globalThis.notices.push(text);return {ok:true};};send=fire;autoCard=false;fireWithChart=async text=>fire(text);dailyDue=()=>true;globalThis.run={notifyOpen,notifyClose,notifyDailySummary,statusFromState};',Object.assign(context,{notices}));
 (async()=>{
  const display={pnlQuote:1,pnlQuoteUsd:80,quoteSymbol:'SOL',displaySolUsdEntry:100,displaySolUsd:80,solPriceChangePct:-20};
  const openContext=require('./paper-history').capture({tvl:12000,created_at:Date.now()/1000-7200,pool_config:{bin_step:100},token_x:{market_cap:500000},token_y:{symbol:'SOL'},fee_tvl_ratio:{'30m':.8},manualWarnings:['pump1h>15%']},{source:'open'});
  await context.run.notifyOpen({...display,name:'TEST-SOL',sizeSol:100,entryQuoteAmount:100,openContext});
  await context.run.notifyClose({...display,name:'TEST-SOL',pnlUsd:-1920,pnlPct:-19.2});
  await context.run.notifyDailySummary({positions:[{name:'TEST-SOL',...display}],quotePnlTotals:{usd:80,quotes:{SOL:1}},pnlTotalUsd:-1920});
  assert(notices[0].includes('🧭 Manual (tombol Open sekarang)'));assert(notices[0].includes('0.80%'));assert(notices[0].includes('pump1h&gt;15%'));assert(notices[0].includes('MC $500.0k'));assert(notices[0].includes('strategi N5'));assert.equal(notices.length,3);assert(notices.every(n=>n.includes('+1.0000 SOL ($80.00)')));assert(notices[1].includes('(−19.20%)'));assert(notices[2].includes('🌙 <b>Ringkasan harian'));
  console.log('OK quote display: SOL/USD separation, USDC stable, fees/costs once, lifetime carry, immutable risk ledger, unchanged USDC TP, quote activity + open/close/daily Telegram (mock sends only).');
 })().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}
