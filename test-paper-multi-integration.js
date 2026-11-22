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
vm.runInNewContext('var __dirname='+JSON.stringify(__dirname)+';\n'+src+'\nCFG.UPPER_BUFFER_BINS=5;attachBinPrices=(d,b)=>Object.values(b).forEach(v=>v.binPrice=1);writeLiveStatusPointer=async()=>{};fetchMarket=async()=>globalThis.marketSnap;globalThis.setScan=fn=>{scan=fn};globalThis.setManualEvaluator=fn=>{evaluateManualPool=fn};globalThis.originalEvaluator=evaluateManualPool;globalThis.mockRisk=(pool,mintPass=true)=>{fetchPool=async()=>pool;pump1h=async()=>0;pump24h=async()=>0;mintOk=async()=>({ok:mintPass,why:"mint authority set"});CFG.RUGCHECK=false;CFG.CHECK_TOP_HOLDERS=false;CFG.CHECK_INSIDERS=false;};globalThis.setRepositionPool=p=>{fetchPool=async()=>p;};globalThis.seedScan=(picks)=>{scan.picks=picks;scan.last={at:new Date().toISOString(),policyKey:screenRefresh.signature(CFG),requestId:screenRefresh.read(PAPER_DIR)?.id,candidates:picks};};globalThis.failQuotes=()=>{const orig=jupiterQuote;jupiterQuote=async()=>({ok:false,error:"429 test unavailable"});return ()=>{jupiterQuote=orig;};};globalThis.fns={reconcileEntryCosts,paperOpenAll,paperOpenUsdc,paperClose,paperCycle,bookStats,processPaperRequests,applyPaperSettings,tickScreenRefresh,getConfig:()=>({...CFG})};',sandbox);
actual('./paper-settings').applySettings(path.join(temp,'paper'),{MAX_POSITIONS:1,UPPER_BUFFER_BINS:5,OOR_RIGHT_MIN_BINS:0});sandbox.fns.applyPaperSettings();
const state=()=>({books:{N5:{virtual:{usdcStart:500,usdc:500,sol:0},position:null,history:[],reshapes:[]}}});
for(const quoteMint of [USDC,SOL]){
 activeId=100;quoteSymbol=quoteMint===USDC?'USDC':'SOL';market.tokenY.mint.decimals=quoteMint===USDC?6:9;
 const st=state(),p={address:SOL,name:quoteMint===USDC?'MOCK-USDC':'MOCK-SOL',token_x:{address:'11111111111111111111111111111111',decimals:6},token_y:{address:quoteMint},pool_config:{bin_step:100},tvl:10000,fee_tvl_ratio:{'30m':1},fees:{'30m':10}};
 lastPool=p;await sandbox.fns.paperOpenAll(p,st);const book=st.books.N5,pos=book.positions[0];
 assert(pos);assert.equal(pos.quoteMint,quoteMint);assert.equal(pos.maxBinId,105);assert.equal(pos.minBinId,31);assert(pos.bins[100].y>0);assert.equal(pos.bins[100].x,0);assert(pos.bins[105].x>0);const chart=actual('./bin-shape').chartModel(pos);assert(chart.bins.some(b=>b.id>100&&b.token>0));assert(chart.bins.some(b=>b.id<=100&&b.sol>0));assert.equal(chart.quoteSymbol,quoteSymbol);pos.rightRepositions=2;
 const snap={price:1,pxUsd:100,active:{binId:106}};
 if(quoteMint===SOL){delete pos.quoteMint;delete pos.quoteSymbol;delete pos.quoteDecimals;delete pos.depositQuote;delete pos.feesCompoundedQuote;} // legacy GTA6 schema
 st.meta={startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 sandbox.marketSnap={...snap,dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
 await sandbox.fns.paperCycle(st);assert(book.positions[0]);assert.equal(book.positions[0].oorRightPolls,1);await sandbox.fns.paperCycle(st);const rec=book.history[0];
 assert.equal(rec.reason,'oor_right_reposition_limit');assert(Number.isFinite(rec.peakPnlUsd));
 assert.equal(rec.quoteMint,quoteMint);assert.equal(book.positions[0],undefined);assert.equal(book.virtual.sol,0);assert.equal(book.history.length,1);
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
 const book=st.books.N5,originalDate=book.positions[0].openedAt,initialCost=book.positions[0].usdcIn;
 for(let n=1;n<=3;n++){
  activeId=book.positions[0].maxBinId+1;sandbox.marketSnap={price:1,pxUsd:100,active:{binId:activeId},dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
  await sandbox.fns.paperCycle(st);assert(book.positions[0]); // first noise poll does not exit
  await sandbox.fns.paperCycle(st);
  if(n<=2){assert(book.positions[0],JSON.stringify(book.history));assert.equal(book.positions[0].rightRepositions,n);assert.equal(book.positions[0].maxBinId,activeId+5);assert.equal(book.positions[0].openedAt,originalDate);assert.equal(book.positions[0].initialUsdcIn,initialCost);assert.equal(book.history.length,0);assert(book.positions[0].realizedPnlCarryUsd<0);assert.equal(book.positions[0].openSource,'Auto (bot)');assert.equal(book.positions[0].currentLegOpenContext.source,'Reposition');assert.equal(book.positions[0].entryLegs.length,n);}
 }
 assert.equal(book.positions[0],undefined);assert.equal(book.history.length,1);const rec=book.history[0];
 assert.equal(rec.reason,'oor_right_reposition_limit');assert(Math.abs(rec.pnlUsd-(quoteMint===USDC?-1.4205:-15.3077))<.002,JSON.stringify(rec));assert(Math.abs(book.virtual.usdc-(quoteMint===USDC?498.5795:484.6923))<.002);assert.equal(rec.rightRepositions,2);
 const stats=sandbox.fns.bookStats(book,{id:'N5'},null,100);assert(Math.abs(stats.equityPnlUsd-(quoteMint===USDC?-1.4205:-15.3077))<.002);assert.equal(stats.totalDepositedUsdc,500);
}
// Approved retry policy: unavailable quotes / failed token purchase do NOT close or debit the old leg.
for(const quoteMint of [USDC,SOL]){
 activeId=100;quoteSymbol=quoteMint===USDC?'USDC':'SOL';market.tokenY.mint.decimals=quoteMint===USDC?6:9;
 const st=state();lastPool={address:SOL,name:'RETRY-'+quoteSymbol,token_x:{address:'11111111111111111111111111111111',decimals:6},token_y:{address:quoteMint,symbol:quoteSymbol},pool_config:{bin_step:100},tvl:10000,fee_tvl_ratio:{'30m':1},fees:{'30m':10}};
 await sandbox.fns.paperOpenAll(lastPool,st);st.meta={endsAt:new Date(Date.now()+86400000).toISOString()};
 const book=st.books.N5,p=book.positions[0],identity=p.position,cash=book.virtual.usdc,fees=p.networkFeesSol,range=[p.minBinId,p.maxBinId],budget=sandbox.fns.getConfig().POSITION_USDC;
 activeId=p.maxBinId+1;sandbox.marketSnap={price:1,pxUsd:100,active:{binId:activeId},dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
 const restore=sandbox.failQuotes();notices.length=0;
 for(let n=1;n<=11;n++){await sandbox.fns.paperCycle(st);assert.equal(book.positions[0].position,identity);assert.equal(book.history.length,0);assert.equal(book.virtual.usdc,cash);assert.equal(book.positions[0].networkFeesSol,fees);assert.deepEqual([book.positions[0].minBinId,book.positions[0].maxBinId],range);}
 assert.equal(book.positions[0].quoteUnavailablePolls,11);assert.equal(book.positions[0].repositionRetryCount,2);assert.equal(book.positions[0].rightRepositions||0,0);assert(!notices.some(n=>['notifyClose','notifyOpen','notifyReposition'].includes(n)));assert.equal(sandbox.fns.getConfig().POSITION_USDC,budget);assert(book.positions[0].lastLive);
 restore();await sandbox.fns.paperCycle(st);assert.equal(book.positions[0].rightRepositions,1);assert.equal(book.history.length,0);assert.notEqual(book.positions[0].position,identity);assert.equal(book.positions[0].openSource,'Auto (bot)');
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
 await sandbox.fns.processPaperRequests(st);assert(st.books.N5.positions[0]);assert.equal(freshScans,1);assert.equal(st.paperCommands.at(-1).result.ok,true);assert.equal(st.books.N5.positions[0].openSource,'Manual (tombol Open sekarang)');assert.equal(st.books.N5.positions[0].openContext.updatedBy,uid);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st);const still=JSON.stringify(st.books.N5.positions[0]);
 command.queue(path.join(temp,'paper'),{type:'open',pool:lastPool.address,requestId:'vm-open-test-002',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,false);assert.equal(JSON.stringify(st.books.N5.positions[0]),still);
 // Atomic switch: no notifications until commit, rollback keeps ALL old books on failed new quote.
 let current=st.books.N5.positions[0];lastPool={...lastPool,address:USDC,name:'NEW-POOL-USDC'};notices.length=0;
 command.queue(path.join(temp,'paper'),{type:'switch',pool:USDC,expectedPool:current.pool,expectedOpenedAt:current.openedAt,requestId:'vm-switch-0001',updatedBy:uid});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,true);assert.equal(st.books.N5.positions[0].pool,USDC);assert.equal(st.books.N5.history.at(-1).reason.startsWith('manual_switch_to_'),true);assert.deepEqual(notices,['notifyClose','notifyOpen']);assert.equal(st.books.N5.positions[0].openSource,'Manual (Ganti pool)');
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

// Real multi-position opens, per-position exits/repositions, sizing, queue isolation and rollback.
{
 const settings=actual('./paper-settings'),multi=actual('./paper-multi');
 settings.applySettings(path.join(temp,'paper'),{MAX_POSITIONS:5,POSITION_USDC:0,UPPER_BUFFER_BINS:5,OOR_RIGHT_MIN_BINS:0});sandbox.fns.applyPaperSettings();
 const st=state(),b=st.books.N5;b.virtual.usdc=5000;b.virtual.usdcStart=5000;b.virtual.totalDepositedUsdc=5000;
 st.meta={startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 activeId=100;quoteSymbol='USDC';market.tokenY.mint.decimals=6;
 const base={token_y:{address:USDC},pool_config:{bin_step:100},tvl:90000,   // under MAX_LIQ_USD ($100k default)
 fee_tvl_ratio:{'30m':1},fees:{'30m':10}};
 const pool=(i)=>({...base,address:[SOL,USDC,'11111111111111111111111111111111','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'][i],name:'MULTI-'+i,token_x:{address:'1111111111111111111111111111111'+String(i+1),decimals:6}});
 for(let i=0;i<5;i++){
  lastPool=pool(i);const cash=b.virtual.usdc,slots=5-i;
  assert((await sandbox.fns.paperOpenAll(lastPool,st)).opened);
  assert.equal(b.positions.length,i+1);
  assert(Math.abs(b.positions[i].usdcIn-(cash/slots-.1))<.002);
  assert(b.virtual.usdc>=0);assert(b.positions[i].reserveSol>0);
 }
 assert.equal((await sandbox.fns.paperOpenAll(pool(0),st)).skipped,'Slot penuh');
 // Gas belongs to each position, not to a shared last-open buffer.
 assert.equal(b.virtual.sol,0);assert.equal(new Set(b.positions.map(p=>p.pool)).size,5);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st); const closedPos=b.positions[1],untouched=JSON.stringify(b.positions.filter(p=>p!==closedPos));
 sandbox.marketSnap={price:1,pxUsd:100,active:{binId:100},dlmm:market,map:new Map(),stats:{cumulative_metrics:{fees:0}}};
 const command=actual('./paper-commands');
 command.queue(path.join(temp,'paper'),{type:'close',pool:closedPos.pool,openedAt:closedPos.openedAt,requestId:'multi-close-001',updatedBy:1000000001});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,true);
 assert.equal(b.positions.length,4);assert.equal(JSON.stringify(b.positions),untouched);
 const afterClose=sandbox.fns.bookStats(b,{id:'N5'},null,100);assert(Math.abs(afterClose.equityPnlUsd+2.8909)<.01);   // was -0.045 before the route fee was modelled (fee on 5 gas-buffer swaps + 1 pile swap)
 assert.equal((await sandbox.fns.paperOpenAll({...pool(1),address:closedPos.pool,token_x:pool(0).token_x},st)).skipped,'Token (CA) atau pool sudah dibuka');
 // Fixed budgets fail closed when free cash is insufficient (no tiny unintended entry).
 settings.applySettings(path.join(temp,'paper'),{POSITION_USDC:10000});sandbox.fns.applyPaperSettings();
 assert.equal((await sandbox.fns.paperOpenAll(pool(1),st)).skipped,'Saldo USDC tidak cukup');
 settings.applySettings(path.join(temp,'paper'),{POSITION_USDC:0});sandbox.fns.applyPaperSettings();
 // Reopen one slot via queued manual open, then replace a NON-first chosen position.
 sandbox.setManualEvaluator(async()=>pool(1));
 command.queue(path.join(temp,'paper'),{type:'open',pool:pool(1).address,requestId:'multi-open-001',updatedBy:1000000001});
 await sandbox.fns.processPaperRequests(st);assert.equal(b.positions.length,5);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st); const target=b.positions[3],others=JSON.stringify(b.positions.filter(p=>p!==target));
 const replacement={...pool(1),address:'SysvarRent111111111111111111111111111111111',name:'REPLACEMENT',token_x:{address:'11111111111111111111111111111119',decimals:6}};
 sandbox.setManualEvaluator(async()=>replacement);
 command.queue(path.join(temp,'paper'),{type:'switch',pool:replacement.address,expectedPool:target.pool,expectedOpenedAt:target.openedAt,requestId:'multi-switch-001',updatedBy:1000000001});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,true);assert.equal(b.positions.length,5);
 assert.equal(JSON.stringify(b.positions.filter(p=>p.pool!==replacement.address)),others);
 await new Promise(r=>setTimeout(r,50));sandbox.fns.reconcileEntryCosts(st); const conserved=JSON.stringify({v:b.virtual,p:b.positions,h:b.history});
 // Failure in target re-screen cannot touch any position, not even the chosen leg.
 sandbox.setManualEvaluator(async()=>{throw Error('test rejected');});
 command.queue(path.join(temp,'paper'),{type:'switch',pool:target.pool,expectedPool:replacement.address,expectedOpenedAt:b.positions.at(-1).openedAt,requestId:'multi-switch-002',updatedBy:1000000001});
 await sandbox.fns.processPaperRequests(st);assert.equal(st.paperCommands.at(-1).result.ok,false);
 assert.equal(JSON.stringify({v:st.books.N5.virtual,p:st.books.N5.positions,h:st.books.N5.history}),conserved);
 // Only one OOR-right position accumulates confirmation/repositions; other legs stay independent.
 const right=JSON.parse(JSON.stringify(st));const first=right.books.N5.positions[0];
 first.maxBinId=99;first.oorRightPolls=0;
 sandbox.setRepositionPool({...pool(0),name:first.name});sandbox.seedScan([]);
 await sandbox.fns.paperCycle(right);assert.equal(right.books.N5.positions[0].oorRightPolls,1);
 assert(right.books.N5.positions.slice(1).every(p=>p.oorRightPolls===0));
 await sandbox.fns.paperCycle(right);assert.equal(right.books.N5.positions[0].rightRepositions,1);
 assert.equal(right.books.N5.positions[0].openedAt,first.openedAt);assert.equal(right.books.N5.positions.length,5);
 assert(right.books.N5.positions.slice(1).every(p=>(p.rightRepositions||0)===0));
 // Legacy migration is additive, reference-preserving, idempotent and never closes inventory.
 const original={name:'PUSSY-SOL',pool:SOL,openedAt:'2026-11-10T16:07:11.534Z',usdcIn:489.96896,minBinId:-550,maxBinId:-476,bins:{a:{x:2,y:3}},rightRepositions:1};
 const before=JSON.stringify(original),legacy={position:original,virtual:{usdc:4500.1,sol:.23834036},history:[],reshapes:[]};
 multi.migrate(legacy);assert.strictEqual(legacy.positions[0],original);
 const {reserveSol,...rest}=original;assert.equal(JSON.stringify(rest),before);assert.equal(reserveSol,.23834036);assert.equal(legacy.virtual.usdc,4500.1);
 multi.migrate(legacy);assert.equal(legacy.positions.length,1);assert.equal(legacy.positions[0].reserveSol,.23834036);

 // Automatic screen consumption fills multiple slots but never mixes SOL fallback while USDC passes.
 const auto=state();auto.books.N5.virtual={usdcStart:5000,usdc:5000,sol:0,totalDepositedUsdc:5000};auto.meta=st.meta;
 const duplicateMint={...pool(1),token_x:pool(0).token_x};
 const solFallback={...pool(2),token_y:{address:SOL}};
 sandbox.seedScan([pool(0),duplicateMint,solFallback]);await sandbox.fns.paperCycle(auto);
 assert.equal(auto.books.N5.positions.length,1);assert.equal(auto.books.N5.positions[0].quoteMint,USDC);
 assert.equal(auto.lastScan.openResults.length,1);assert(auto.books.N5.virtual.usdc>3900);
 // Independent TP: only the profitable leg closes; all other position identity/ranges survive.
 const independent=JSON.parse(JSON.stringify(st));independent.books.N5.positions[0].usdcIn=1;
 const keep=independent.books.N5.positions.slice(1).map(p=>({pool:p.pool,openedAt:p.openedAt,min:p.minBinId,max:p.maxBinId}));
 sandbox.seedScan([]);await sandbox.fns.paperCycle(independent);
 assert.equal(independent.books.N5.positions.length,4);assert(independent.books.N5.history.at(-1).reason.startsWith('TP USDC'));
 assert.deepEqual(independent.books.N5.positions.map(p=>({pool:p.pool,openedAt:p.openedAt,min:p.minBinId,max:p.maxBinId})),keep);
 assert(independent.books.N5.positions.every(p=>p.lastLive&&p.oorRightPolls===0));
 for(const v of [0,-1,1001,1.5])assert(!settings.validatePatch({MAX_POSITIONS:v}).ok);
 for(const v of [1,5,10])assert(settings.validatePatch({MAX_POSITIONS:v}).ok);
 console.log('OK multi: five isolated positions; equal remaining-slot budgets; fixed-budget insufficient skip; pool/mint dedup; selected close/switch; rollback preserves ALL positions; additive legacy migration.');
}
console.log('OK actual SOL/USDC 2x right reposition then mandatory close: lifetime PnL + costs carried, ONE history trade, original 12h clock retained.');
assert(routes.some(([a,b])=>b==='11111111111111111111111111111111')); // genuinely buys token side
fs.rmSync(temp,{recursive:true,force:true});
console.log('OK real paper open->close integration (SOL and USDC): decimal units, buffered two-sided entry, 2-poll right confirmation, Jupiter buffer funding, rent refunds, gas exactly once, books conserved; no network/send.');
})().catch(e=>{console.error(e);process.exitCode=1});
