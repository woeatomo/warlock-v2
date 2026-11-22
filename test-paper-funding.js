// Entirely isolated fake-token tests. Never deposits into production or sends a notification.
'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const funding=require('./paper-funding'),commands=require('./paper-commands'),settings=require('./paper-settings');
const {startServer}=require('./miniapp/server');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-funding-')),paper=path.join(root,'paper');fs.mkdirSync(paper);const stop=path.join(root,'STOP');fs.writeFileSync(stop,'test');
 const pos={pool:'So11111111111111111111111111111111111111112',name:'TEST',usdcIn:499,openedAt:new Date().toISOString(),bins:{'1':{x:1,y:2}}};
 const st={meta:{endsWib:'2026-11-17 11:33:32 WIB'},books:{N5:{virtual:{usdcStart:500,usdc:1,sol:.2},position:pos,history:[]}}},file=path.join(paper,'state.json');
 const save=s=>{fs.writeFileSync(file+'.tmp',JSON.stringify(s));fs.renameSync(file+'.tmp',file);};save(st);
 const initialPos=JSON.stringify(st.books.N5.position);assert(funding.initialize(st));assert.equal(st.books.N5.virtual.totalDepositedUsdc,500);
 for(const bad of [0,-1,10001,Infinity,NaN,true,null,[],{},'','1.1234567'])assert.throws(()=>funding.amountValue(bad));
 assert.equal(funding.entryCash(500,200,.1),200.1);assert.equal(funding.entryCash(500,0,.1),500);
 let audit=[];funding.queueDeposit(paper,100,{updatedBy:1000000001,requestId:'deposit-test-1'});
 assert.equal(funding.applyPending(st,paper,{save,audit:l=>audit.push(l)}),1);assert.equal(st.books.N5.virtual.usdc,101);assert.equal(st.books.N5.virtual.totalDepositedUsdc,600);assert.equal(JSON.stringify(st.books.N5.position),initialPos);
 assert.equal((st.books.N5.virtual.usdc+498)-600,-1); // prior equity 499 - initial 500; deposit creates NO PnL
 assert.equal(funding.queueDeposit(paper,100,{updatedBy:1000000001,requestId:'deposit-test-1'}).duplicate,true);
 fs.copyFileSync(path.join(paper,'capital/applied/deposit-test-1.json'),path.join(paper,'capital/pending/deposit-test-1.json'));
 assert.equal(funding.applyPending(st,paper,{save}),0);assert.equal(st.books.N5.virtual.usdc,101); // crash after state commit
 funding.queueDeposit(paper,25,{updatedBy:1000000001,requestId:'deposit-test-2'});
 assert.throws(()=>funding.applyPending(st,paper,{save:()=>{throw Error('disk full');}}));assert.equal(st.books.N5.virtual.usdc,101);assert.equal(st.capitalDeposits.length,1);
 funding.applyPending(st,paper,{save});assert.equal(st.books.N5.virtual.usdc,126);
 assert.equal(JSON.stringify(st.books.N5.position),initialPos);
 assert(settings.validatePatch({MIN_BIN_STEP:1,MAX_BIN_STEP:500}).ok);for(const patch of [{MIN_BIN_STEP:0},{MAX_BIN_STEP:501},{MIN_BIN_STEP:100.5},{MIN_BIN_STEP:400,MAX_BIN_STEP:100}])assert(!settings.validatePatch(patch).ok);
 settings.applySettings(paper,{MIN_BIN_STEP:50,MAX_BIN_STEP:80},{updatedBy:'test'});assert(settings.applySettings(paper,{MAX_BIN_STEP:70}).ok);assert(!settings.applySettings(paper,{MIN_BIN_STEP:71}).ok);
 let live=false;const token='fake-funding-test-token';const {server,port}=await startServer({port:0,host:'127.0.0.1',paperDir:paper,secretsDir:path.join(root,'throwaway-secrets'),stopPath:stop,token,rateLimitMs:0,failMax:100,skipPm2:true,notifyFn:async()=>{},liveStatusFn:()=>({running:live,status:live?'online':'missing'})});
 const signed=id=>settings.signInitData({user:JSON.stringify({id}),auth_date:String(Math.floor(Date.now()/1000)),query_id:'funding'},token);
 const init=signed(1000000001),base='http://127.0.0.1:'+port;
 const get=async(auth=init)=>{const r=await fetch(base+'/api/settings',{headers:{'x-telegram-init-data':auth}});return {status:r.status,json:await r.json()};};
 const post=async(route,body,auth=init,nonce)=>{const csrf=nonce||(await get(auth)).json.csrf;const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','x-telegram-init-data':auth},body:JSON.stringify({...body,csrf})});return {status:r.status,json:await r.json()};};
 try{
  assert.equal((await get('')).status,403);
  assert.equal((await post('/api/paper/capital/deposit',{amount:100,confirmed:true},signed(999),'bad')).status,403);
  assert.equal((await post('/api/paper/capital/deposit',{amount:100,confirmed:true},init,'bad')).status,403);
  assert.equal((await post('/api/paper/capital/deposit',{amount:10001,confirmed:true})).status,400);
  assert.equal((await post('/api/paper/capital/deposit',{amount:100})).status,400);
  const nonce=(await get()).json.csrf,r=await post('/api/paper/capital/deposit',{amount:100,confirmed:true,requestId:'http-deposit-001'},init,nonce);assert.equal(r.status,202);
  assert.equal(JSON.parse(fs.readFileSync(file)).books.N5.virtual.usdc,126); // API did NOT write books
  assert.equal((await post('/api/paper/capital/deposit',{amount:100,confirmed:true},init,nonce)).status,403);
  live=true;assert.equal((await post('/api/paper/capital/deposit',{amount:1,confirmed:true})).status,409);live=false;
  fs.renameSync(stop,stop+'.saved');assert.equal((await post('/api/paper/capital/deposit',{amount:1,confirmed:true})).status,409);fs.renameSync(stop+'.saved',stop);
  assert.equal((await post('/api/paper/close',{pool:pos.pool,openedAt:pos.openedAt,confirmed:true})).status,400);
  assert.equal((await post('/api/paper/open',{pool:pos.pool,confirmed:true,confirmedTwice:true})).status,409);
  const close=await post('/api/paper/close',{pool:pos.pool,openedAt:pos.openedAt,confirmed:true,confirmedTwice:true,requestId:'http-close-0001'});assert.equal(close.status,202);
  let executed=0;await commands.applyPending(st,paper,{save,execute:async r=>{executed++;assert.equal(r.openedAt,pos.openedAt);return {ok:true};}});assert.equal(executed,1);
  assert.equal((await commands.applyPending(st,paper,{save,execute:async()=>{executed++;}})),0);assert.equal(executed,1);
  assert.equal(JSON.stringify(st.books.N5.position),initialPos);assert(fs.existsSync(stop));
  const refresh=require('./paper-screen-refresh'),scanFile=path.join(paper,'screening.json');
  const oldValues=settings.currentValues(paper),rows=[{address:pos.pool,name:'PASS-SOL',status:'passed',reasons:[]},{address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',name:'FAIL-USDC',status:'rejected',reasons:['bin_step outside 50-70']}];
  fs.writeFileSync(scanFile,JSON.stringify({at:new Date().toISOString(),policy:refresh.policy(oldValues),policyKey:refresh.signature(oldValues),display:rows,candidates:[rows[0]]}));
  const rs=await post('/api/paper/scan',{});assert.equal(rs.status,202);assert.equal((await post('/api/paper/scan',{})).status,429);
  const policyChange=await post('/api/settings',{settings:{MIN_BIN_STEP:80,MAX_BIN_STEP:400}});assert.equal(policyChange.status,200);assert.equal(policyChange.json.rescanRequested,true);
  let stateView=(await get()).json;assert.equal(stateView.status.screenRefresh.stale,true);assert.equal(stateView.status.screenRefresh.usedPolicy.MIN_BIN_STEP,50);assert.equal(stateView.status.screenRefresh.currentPolicy.MIN_BIN_STEP,80);
  assert.equal((await post('/api/paper/scan',{})).status,429); // a settings request must NOT reset manual cooldown
  const pendingRefresh=refresh.read(paper),newValues=settings.currentValues(paper);fs.writeFileSync(scanFile,JSON.stringify({at:new Date().toISOString(),requestId:pendingRefresh.id,policy:refresh.policy(newValues),policyKey:refresh.signature(newValues),display:rows,candidates:[rows[0]]}));
  stateView=(await get()).json;assert.equal(stateView.status.screenRefresh.stale,false);
  const sameId=refresh.read(paper).id;await post('/api/settings',{settings:{TP_USD_PCT:25}});assert.equal(refresh.read(paper).id,sameId); // exit setting does not rescan
  const sw=await post('/api/paper/open',{pool:pos.pool,replaceCurrent:true,expectedPool:pos.pool,expectedOpenedAt:pos.openedAt,confirmed:true,confirmedTwice:true,requestId:'http-switch-001'});assert.equal(sw.status,409);   // multi-position: the same pool cannot be opened twice (no more single-slot "switch")
  const failPool=rows[1].address,params={pool:failPool,replaceCurrent:true,expectedPool:pos.pool,expectedOpenedAt:pos.openedAt,confirmed:true,confirmedTwice:true,overrideFailedFilters:true,confirmedReasons:rows[1].reasons,requestId:'http-switch-002'};
  assert.equal((await post('/api/paper/open',params)).status,400);assert.equal((await post('/api/paper/open',{...params,overrideConfirmed:true})).status,202);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file)).books.N5.position),initialPos); // routes ONLY queued, never closed/opened

 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
 console.log('OK paper funding/manual routes: bounds + min<=max, deposit preserves position, equity-deposit PnL, idempotence/crash rollback, HMAC/allowlist/one-use CSRF/live guard/double confirm, switch/override confirmations, policy-stale flags, immediate rescan request + persistent 1/30s throttle; no live writes/network swaps.');
})().catch(e=>{console.error(e);process.exitCode=1});
