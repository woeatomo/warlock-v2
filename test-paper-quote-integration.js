'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user
// Executes real paper open/close functions in a VM with fake market/quotes/notifications.
// No production state, RPC, secrets, or network can be reached.
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),assert=require('assert'),{createRequire}=require('module');
const actual=createRequire(path.join(__dirname,'bot.js')),BN=actual('bn.js');
const {SOL,USDC}=require('./paper-usdc');
(async()=>{
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'paper-quote-integration-'));fs.mkdirSync(path.join(temp,'paper'));
const routes=[];let quoteSymbol='USDC',activeId=100,lastPool=null,failTokenBuy=false;const notices=[];
const market={lbPair:{binStep:100},tokenX:{mint:{decimals:6}},tokenY:{mint:{decimals:6}},clock:{},
 getActiveBin:async()=>({binId:activeId,price:'1',xAmount:new BN(1000000),yAmount:new BN(1000000)}),fromPricePerLamport:v=>v,
 quoteCreatePosition:async()=>({positionCost:.05740608,binArrayCost:0,bitmapExtensionCost:0}),
 initializePositionAndAddLiquidityByStrategy:async()=>({instructions:[]})};
const fakeDlmm={default:{create:async()=>market},StrategyType:{Spot:0,BidAsk:1},POSITION_FEE:.05740608,TOKEN_ACCOUNT_FEE:.00203928,MAX_BINS_PER_POSITION:1400,MAX_RESIZE_LENGTH:91,
 toAmountsBothSideByStrategy:(active,step,min,max,x,y)=>[{binId:max,amountX:x,amountY:y}]};
const fetch=async url=>{const u=new URL(url);let j={};
 if(u.hostname==='api.coingecko.com')j={solana:{usd:100}};
 else if(u.hostname==='lite-api.jup.ag'){
  const a=u.searchParams.get('inputMint'),b=u.searchParams.get('outputMint'),raw=BigInt(u.searchParams.get('amount'));routes.push([a,b]);
  const usd=m=>m===SOL?100:m===USDC?1:quoteSymbol==='SOL'?100:1,dec=m=>m===SOL?9:6;
  if(failTokenBuy&&b==='11111111111111111111111111111111')return {ok:true,json:async()=>({error:'fake no token route'})};
  const out=BigInt(Math.floor(Number(raw)/10**dec(a)*usd(a)/usd(b)*10**dec(b)));
  j={inAmount:String(raw),outAmount:String(out),priceImpactPct:0};
 }else if(u.hostname==='dlmm.datapi.meteora.ag')j={...lastPool,cumulative_metrics:{fees:0}};
 else throw new Error('unexpected network endpoint '+u.hostname);
 return {ok:true,json:async()=>j};};
const sandbox={require:n=>n==='./paper-quote-client'?{create:opts=>actual(n).create({...opts,minGapMs:0,baseBackoffMs:0,cacheMs:0})}:n==='@meteora-ag/dlmm'?fakeDlmm:n==='./telegram-notify'?new Proxy({}, {get:(_,key)=>async()=>{notices.push(key);return {ok:true};}}):actual(n),
 process:{env:{PAPER:'1',DRY_RUN:'1',LP_BOT_DIR:temp},argv:[],exit(){throw new Error('unexpected exit')}},Buffer,console:{log(){}},setTimeout,clearTimeout,AbortSignal,URL,fetch};
let src=fs.readFileSync(path.join(__dirname,'bot.js'),'utf8');src=src.slice(0,src.lastIndexOf('\n(async () => {'));
vm.runInNewContext('var __dirname='+JSON.stringify(__dirname)+';\n'+src+'\nCFG.UPPER_BUFFER_BINS=5;attachBinPrices=(d,b)=>Object.values(b).forEach(v=>v.binPrice=1);writeLiveStatusPointer=async()=>{};fetchMarket=async()=>globalThis.marketSnap;globalThis.setScan=fn=>{scan=fn};globalThis.setManualEvaluator=fn=>{evaluateManualPool=fn};globalThis.originalEvaluator=evaluateManualPool;globalThis.mockRisk=(pool,mintPass=true)=>{fetchPool=async()=>pool;pump1h=async()=>0;pump24h=async()=>0;mintOk=async()=>({ok:mintPass,why:"mint authority set"});CFG.RUGCHECK=false;CFG.CHECK_TOP_HOLDERS=false;CFG.CHECK_INSIDERS=false;};globalThis.fns={reconcileEntryCosts,paperOpenAll,paperOpenUsdc,paperClose,paperCycle,bookStats,processPaperRequests,applyPaperSettings,tickScreenRefresh,getConfig:()=>({...CFG})};',sandbox);
actual('./paper-settings').applySettings(path.join(temp,'paper'),{UPPER_BUFFER_BINS:5,OOR_RIGHT_MIN_BINS:0});sandbox.fns.applyPaperSettings();   // two-sided entry + immediate OOR-right (these tests exercise the token-side bins; v1.7 defaults are 0 / 5)
const state=()=>({books:{N5:{virtual:{usdcStart:500,usdc:500,sol:0},position:null,history:[],reshapes:[]}}});
for(const quoteMint of [USDC,SOL]){
 activeId=100;quoteSymbol=quoteMint===USDC?'USDC':'SOL';market.tokenY.mint.decimals=quoteMint===USDC?6:9;
 const st=state(),p={address:SOL,name:quoteMint===USDC?'MOCK-USDC':'MOCK-SOL',token_x:{address:'11111111111111111111111111111111',decimals:6},token_y:{address:quoteMint},pool_config:{bin_step:100},tvl:10000,fee_tvl_ratio:{'30m':1},fees:{'30m':10}};
 lastPool=p;await sandbox.fns.paperOpenAll(p,st);const book=st.books.N5,pos=book.position||(book.positions||[])[0];   // multi-position books keep positions[]
 assert(pos);assert.equal(pos.quoteMint,quoteMint);assert.equal(pos.maxBinId,105);assert.equal(pos.minBinId,31);assert(pos.bins[100].y>0);assert.equal(pos.bins[100].x,0);assert(pos.bins[105].x>0);const chart=actual('./bin-shape').chartModel(pos);assert(chart.bins.some(b=>b.id>100&&b.token>0));assert(chart.bins.some(b=>b.id<=100&&b.sol>0));assert.equal(chart.quoteSymbol,quoteSymbol);pos.rightRepositions=2;
 const snap={price:1,pxUsd:100,active:{binId:106}};
 if(quoteMint===SOL){delete pos.quoteMint;delete pos.quoteSymbol;delete pos.quoteDecimals;delete pos.depositQuote;delete pos.feesCompoundedQuote;} // legacy GTA6 schema
 st.meta={startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 sandbox.marketSnap={...snap,dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
 await sandbox.fns.paperCycle(st);const bp=(book.positions||[])[0]||((book.positions||[])[0]||book.position);assert(bp);assert.equal(bp.oorRightPolls,1);await sandbox.fns.paperCycle(st);const rec=book.history[0];
 assert.equal(rec.reason,'oor_right_reposition_limit');assert(Number.isFinite(rec.peakPnlUsd));
 assert.equal(rec.quoteMint,quoteMint);assert.equal((book.positions||[]).length,0);assert.equal(book.virtual.sol,0);assert.equal(book.history.length,1);
 // Before the dry run modelled the live route fee (0.5% net quote on every swap leg) cash was 499.985 and PnL -0.015 for both. USDC pool: fee on the gas-buffer + SOL-pile legs (-0.4737); SOL pool under USDC capital: also the whole USDC->SOL entry and SOL->USDC exit (-5.1565, ~1% round trip).
 assert(Math.abs(book.virtual.usdc-(quoteMint===USDC?499.5263:494.8435))<.001,JSON.stringify({quoteMint,cash:book.virtual.usdc,rec}));
 assert(Math.abs(rec.pnlUsd+(quoteMint===USDC?.4737:5.1565))<.001);assert(rec.quoted);
 if(quoteMint===USDC){assert.equal(rec.feesEarnedSol,null);assert.equal(rec.depositQuote>400,true);}
}
// A whole strategy remains ONE trade through two costed right repositions, then mandatory close.
for(const quoteMint of [USDC,SOL]){
 activeId=100;quoteSymbol=quoteMint===USDC?'USDC':'SOL';market.tokenY.mint.decimals=quoteMint===USDC?6:9;
 const st=state();lastPool={address:SOL,name:'REPOSITION-'+quoteSymbol,token_x:{address:'11111111111111111111111111111111',decimals:6},token_y:{address:quoteMint},pool_config:{bin_step:100},tvl:10000,fee_tvl_ratio:{'30m':1},fees:{'30m':10}};
 await sandbox.fns.paperOpenAll(lastPool,st);st.meta={startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 const book=st.books.N5,originalDate=((book.positions||[])[0]||book.position).openedAt,initialCost=((book.positions||[])[0]||book.position).usdcIn;
 for(let n=1;n<=3;n++){
  activeId=((book.positions||[])[0]||book.position).maxBinId+1;sandbox.marketSnap={price:1,pxUsd:100,active:{binId:activeId},dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
  await sandbox.fns.paperCycle(st);assert(((book.positions||[])[0]||book.position)); // first noise poll does not exit
  await sandbox.fns.paperCycle(st);
  if(n<=2){assert(((book.positions||[])[0]||book.position),JSON.stringify(book.history));assert.equal(((book.positions||[])[0]||book.position).rightRepositions,n);assert.equal(((book.positions||[])[0]||book.position).maxBinId,activeId+5);assert.equal(((book.positions||[])[0]||book.position).openedAt,originalDate);assert.equal(((book.positions||[])[0]||book.position).initialUsdcIn,initialCost);assert.equal(book.history.length,0);assert(((book.positions||[])[0]||book.position).realizedPnlCarryUsd<0);}
 }
 assert.equal(((book.positions||[])[0]||book.position),null);assert.equal(book.history.length,1);const rec=book.history[0];
 assert.equal(rec.reason,'oor_right_reposition_limit');assert(Math.abs(rec.pnlUsd-(quoteMint===USDC?-1.4205:-15.3077))<.002,JSON.stringify(rec));assert(Math.abs(book.virtual.usdc-(quoteMint===USDC?498.5795:484.6923))<.002);assert.equal(rec.rightRepositions,2);
 const stats=sandbox.fns.bookStats(book,{id:'N5'},null,100);assert(Math.abs(stats.equityPnlUsd-(quoteMint===USDC?-1.4205:-15.3077))<.002);assert.equal(stats.totalDepositedUsdc,500);
}
// Real bot hot reload + queued top-up: no restart, no state overwrite, no resize of open inventory.
{
 activeId=100;quoteSymbol='USDC';market.tokenY.mint.decimals=6;
 const st=state();lastPool={address:SOL,name:'HOT-USDC',token_x:{address:'11111111111111111111111111111111',decimals:6},token_y:{address:USDC},pool_config:{bin_step:100},tvl:10000,fee_tvl_ratio:{'30m':1}};
 await sandbox.fns.paperOpenAll(lastPool,st);await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st);   // let the async SDK rent correction land first: a top-up must not change the position, but the rent correction legitimately does
 const b=st.books.N5,beforePos=JSON.stringify(b.positions[0]),before=sandbox.fns.bookStats(b,{id:'N5'},null,100);
 fs.writeFileSync(path.join(temp,'STOP'),'test only');actual('./paper-funding').queueDeposit(path.join(temp,'paper'),25,{updatedBy:1000000001,requestId:'vm-topup-test-001'});
 assert.equal(await sandbox.fns.processPaperRequests(st),1);assert.equal(JSON.stringify(b.positions[0]),beforePos);assert.equal(b.virtual.totalDepositedUsdc,525);
 const after=sandbox.fns.bookStats(b,{id:'N5'},null,100);assert(Math.abs(before.equityPnlUsd-after.equityPnlUsd)<.001);assert.equal(Math.round((after.equityUsd-before.equityUsd)*100),2500);
 actual('./paper-settings').applySettings(path.join(temp,'paper'),{MIN_BIN_STEP:50,MAX_BIN_STEP:200,REOPEN_COOLDOWN_MIN:0});   // cooldown off: this block tests the close->manual reopen consumer, not the 30-min reopen cooldown
 sandbox.fns.applyPaperSettings();const cfg=sandbox.fns.getConfig();assert.equal(cfg.MIN_BIN_STEP,50);assert.equal(cfg.MAX_BIN_STEP,200);
 // Actual manual-close/open consumer, including single-position and re-screen checks.
 const command=actual('./paper-commands');const uid=1000000001;
 st.meta={endsAt:new Date(Date.now()+86400000).toISOString()};
 command.queue(path.join(temp,'paper'),{type:'close',pool:b.positions[0].pool,openedAt:b.positions[0].openedAt,requestId:'vm-close-test-001',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.books.N5.positions[0],undefined);assert.equal(st.paperCommands.at(-1).result.ok,true);
 let freshScans=0;sandbox.setManualEvaluator(async()=>{freshScans++;return lastPool;});
 command.queue(path.join(temp,'paper'),{type:'open',pool:lastPool.address,requestId:'vm-open-test-001',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert(st.books.N5.positions[0]);assert.equal(freshScans,1);assert.equal(st.paperCommands.at(-1).result.ok,true);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st);const still=JSON.stringify(st.books.N5.positions[0]);
 command.queue(path.join(temp,'paper'),{type:'open',pool:lastPool.address,requestId:'vm-open-test-002',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,false);assert.equal(JSON.stringify(st.books.N5.positions[0]),still);
 // Atomic switch: no notifications until commit, rollback keeps ALL old books on failed new quote.
 let current=st.books.N5.positions[0];lastPool={...lastPool,address:USDC,name:'NEW-POOL-USDC'};notices.length=0;
 command.queue(path.join(temp,'paper'),{type:'switch',pool:USDC,expectedPool:current.pool,expectedOpenedAt:current.openedAt,requestId:'vm-switch-0001',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,true);assert.equal(st.books.N5.positions[0].pool,USDC);assert.equal(st.books.N5.history.at(-1).reason.startsWith('manual_switch_to_'),true);assert.deepEqual(notices,['notifyClose','notifyOpen']);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st);current=st.books.N5.positions[0];const beforeSwitch=JSON.stringify({v:st.books.N5.virtual,p:current,h:st.books.N5.history});lastPool={...lastPool,address:SOL};failTokenBuy=true;notices.length=0;
 command.queue(path.join(temp,'paper'),{type:'switch',pool:SOL,expectedPool:current.pool,expectedOpenedAt:current.openedAt,requestId:'vm-switch-0002',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);failTokenBuy=false;assert.equal(st.paperCommands.at(-1).result.ok,false);assert.equal(JSON.stringify({v:st.books.N5.virtual,p:st.books.N5.positions[0],h:st.books.N5.history}),beforeSwitch);assert.equal(notices.length,0);
 // Actual targeted evaluator: soft overrides must be acknowledged; hard TVL/mint gates never bypassed.
 const riskPool={...lastPool,token_y_amount:100,created_at:Date.now()/1000-48*3600,volume:{'1h':10000,'24h':100000}};
 sandbox.mockRisk(riskPool);let check=await sandbox.originalEvaluator({pool:SOL});assert.equal(check.address,SOL);
 const lowBin={...riskPool,pool_config:{bin_step:20}};sandbox.mockRisk(lowBin);await assert.rejects(()=>sandbox.originalEvaluator({pool:SOL}));
 check=await sandbox.originalEvaluator({pool:SOL,overrideFailedFilters:true,confirmedReasons:['bin_step outside 50-200']});assert(check.manualWarnings.some(x=>x.startsWith('bin_step')));
 sandbox.mockRisk({...lowBin,fee_tvl_ratio:{'30m':.01}});await assert.rejects(()=>sandbox.originalEvaluator({pool:SOL,overrideFailedFilters:true,confirmedReasons:['bin_step outside 50-200']}),/konfirmasi ulang/);
 sandbox.mockRisk({...riskPool,tvl:0});await assert.rejects(()=>sandbox.originalEvaluator({pool:SOL,overrideFailedFilters:true,confirmedReasons:['TVL $0']}),/wajib/);
 sandbox.mockRisk(riskPool,false);await assert.rejects(()=>sandbox.originalEvaluator({pool:SOL,overrideFailedFilters:true,confirmedReasons:['mint authority set']}),/wajib/);
 const refresh=actual('./paper-screen-refresh');let kicks=0;sandbox.setScan(async()=>{kicks++;});
 refresh.request(path.join(temp,'paper'),{reason:'test settings changed'});sandbox.fns.tickScreenRefresh();assert.equal(kicks,1);
 const rq=refresh.read(path.join(temp,'paper')),cfg2=sandbox.fns.getConfig();fs.writeFileSync(path.join(temp,'paper/screening.json'),JSON.stringify({at:new Date().toISOString(),policyKey:refresh.signature(cfg2),requestId:rq.id}));
 sandbox.fns.tickScreenRefresh();assert.equal(kicks,1);refresh.request(path.join(temp,'paper'),{manual:true,userId:uid});sandbox.fns.tickScreenRefresh();assert.equal(kicks,2);



}
console.log('OK actual SOL/USDC 2x right reposition then mandatory close: lifetime PnL + costs carried, ONE history trade, original 12h clock retained.');
assert(routes.some(([a,b])=>b==='11111111111111111111111111111111')); // genuinely buys token side
fs.rmSync(temp,{recursive:true,force:true});
console.log('OK real paper open->close integration (SOL and USDC): decimal units, buffered two-sided entry, 2-poll right confirmation, Jupiter buffer funding, rent refunds, gas exactly once, books conserved; no network/send.');
})().catch(e=>{console.error(e);process.exitCode=1});
