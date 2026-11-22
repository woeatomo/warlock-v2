'use strict';
// Offline tests for TP Emergency SL+ (12 Nov 2026): after TP emergency v1 is armed and PnL touched ARM%, close when PnL <= LOCK% for N polls.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const X=require('./paper-exit-policy'),{decide}=X;
const base={EMERGENCY_DROP:.20,MAX_HOURS:1e6,TP_USD_PCT:20,OOR_RIGHT_CLOSE:true,TRAIL_ENABLED:false,QUOTE_FAILURE_POLLS:10,EMERGENCY_TP_ENABLED:true,EMERGENCY_TP_TRIGGER_RANGE_PCT:50,EMERGENCY_TP_PCT:10};
const ON={...base,EMERGENCY_SLPLUS_ENABLED:true,EMERGENCY_SLPLUS_ARM_PCT:5,EMERGENCY_SLPLUS_LOCK_PCT:0.1,EMERGENCY_SLPLUS_CONFIRM_POLLS:3};
const STEP=100,binFor=drop=>Math.floor(Math.log(1-drop/100)/Math.log(1+STEP/1e4));
const mk=()=>({openedAt:new Date().toISOString(),binStep:STEP,entryActiveBin:0,minBinId:-200,maxBinId:5,capitalAsset:'USDC',strategySettings:{RANGE_DOWN_PCT:50}});
const DEEP=binFor(25); // price -25% => TP emergency v1 armed (range -50%, trigger 50%)
// path of [activeBin, pnlPct]; returns {r, pos, i}
function run(path_,settings=ON,{quoted=true,pos=mk(),startPoll=1}={}){let i=startPoll-1,r=null;for(const [b,pct] of path_){i++;r=decide({pos,val:{pnlPct:pct,pnlUsd:pct*5,quoted,usdcOut:500+pct*5},activeBin:b,settings,pollId:i});if(r)return {r,pos,i};}return {r:null,pos,i};}
let n=0;const t=(name,fn)=>{fn();n++;console.log('ok',name);};
const hung=[[DEEP,-7],[DEEP,-3],[-5,2],[-3,6.9],[0,8.7],[-2,5],[-8,2.5],[-14,0.8],[-14,0.05],[-14,-0.06],[-14,-0.06],[-14,-0.04],[-15,-0.9]];
t('HUNG-like path: v1 armed -> touches +5 -> 3 polls <= +0.1 -> emergency_slplus',()=>{const x=run(hung);assert.match(x.r,/^emergency_slplus USDC \+0\.1% \(peak \+8\.7%\)$/);assert.equal(x.i,11);assert.ok(x.pos.slPlusArmed&&x.pos.deepDrawdown);assert.equal(x.pos.slPlusPeakPct,8.7);});
t('without SL+ the same path does not close (control)',()=>{const x=run(hung,{...ON,EMERGENCY_SLPLUS_ENABLED:false});assert.equal(x.r,null);});
t('missing keys = disabled (old settings unchanged)',()=>{assert.equal(run(hung,base).r,null);});
t('not armed when TP emergency v1 never triggered (price only -20%)',()=>{const b=binFor(20);assert.equal(run([[b,-3],[0,8.7],[-1,0],[-1,0],[-1,-0.5],[-1,-1]]).r,null);});
t('not armed when PnL never touched +5 (peak 4.9)',()=>{assert.equal(run([[DEEP,-7],[0,4.9],[-3,0],[-3,0],[-3,0],[-3,-1]]).r,null);});
t('touch exactly +5 arms (boundary)',()=>{const x=run([[DEEP,-7],[0,5],[-1,0],[-1,0],[-1,0]]);assert.match(x.r,/^emergency_slplus/);});
t('exactly +0.1 counts as low (<=), +0.11 does not',()=>{assert.match(run([[DEEP,-7],[0,6],[-1,0.1],[-1,0.1],[-1,0.1]]).r,/^emergency_slplus/);assert.equal(run([[DEEP,-7],[0,6],[-1,0.11],[-1,0.11],[-1,0.11],[-1,0.11]]).r,null);});
t('dip to +1% (above lock) never closes',()=>{assert.equal(run([[DEEP,-7],[0,7],[-1,1],[-1,1],[-1,1],[-1,1],[-1,1]]).r,null);});
t('2 low polls then recovery resets counter; later 3 consecutive close',()=>{const p=[[DEEP,-7],[0,7],[-1,0],[-1,0],[-1,0.9],[-1,0],[-1,0],[-1,0]];const x=run(p);assert.match(x.r,/^emergency_slplus/);assert.equal(x.i,8);});
t('same pollId repeated (reshape re-evaluation) does not double count',()=>{const pos=mk();for(const [b,p] of [[DEEP,-7],[0,7]])decide({pos,val:{pnlPct:p,pnlUsd:p*5,quoted:true},activeBin:b,settings:ON,pollId:pos.__p=(pos.__p||0)+1});
 for(let k=0;k<5;k++)assert.equal(decide({pos,val:{pnlPct:0,pnlUsd:0,quoted:true},activeBin:-1,settings:ON,pollId:99}),null);assert.equal(pos.slPlusLowPolls,1);});
t('unquoted (estimate) polls also arm and close, like emergency_stop',()=>{const x=run(hung,ON,{quoted:false});assert.match(x.r,/^emergency_slplus/);});
t('stop loss -20 still wins over SL+',()=>{const x=run([[DEEP,-7],[0,7],[-5,-21]]);assert.equal(x.r,'emergency_stop');});
t('emergency TP +10 still wins when PnL recovers (no SL+ interference)',()=>{const x=run([[DEEP,-7],[0,6],[-1,2],[0,10.2]]);assert.match(x.r,/^emergency_tp USDC \+10%/);});
t('lock >= arm disables the rule (misconfiguration)',()=>{assert.equal(run(hung,{...ON,EMERGENCY_SLPLUS_LOCK_PCT:5}).r,null);assert.equal(X.slPlusCfg({...ON,EMERGENCY_SLPLUS_LOCK_PCT:6}).on,false);});
t('confirm polls = 1 closes at first low poll',()=>{const x=run([[DEEP,-7],[0,7],[-1,0]],{...ON,EMERGENCY_SLPLUS_CONFIRM_POLLS:1});assert.match(x.r,/^emergency_slplus/);assert.equal(x.i,3);});
t('stays armed after pnl falls and recovers; non-finite pnl ignored',()=>{const pos=mk();const x=run([[DEEP,-7],[0,7],[-1,2]],ON,{pos});assert.ok(pos.slPlusArmed);assert.equal(decide({pos,val:{pnlPct:NaN,quoted:true},activeBin:0,settings:ON,pollId:50}),null);});
// positions already open when the rule is added: arm from the recorded peak ONLY if the peak was recorded after v1 armed
t('retro-arm: open position with peak >= +5 recorded AFTER v1 armed -> armed on next poll, closes after 3 low polls',()=>{
 const pos={...mk(),deepDrawdown:true,deepDrawdownAt:'2026-11-12T01:00:00.000Z',peakPnlUsd:37.85,peakPnlCapital:37.85,peakPnlPctUsdc:7.57,peakPnlAt:'2026-11-12T02:00:00.000Z'};const x=run([[-5,0.33],[-5,0.05],[-5,0.0],[-5,-0.2]],ON,{pos});assert.match(x.r,/^emergency_slplus USDC \+0\.1% \(peak \+7\.6%\)$/);});
t('retro-arm: peak recorded BEFORE v1 armed never arms (would close a drawn-down position at a loss)',()=>{
 const pos={...mk(),deepDrawdown:true,deepDrawdownAt:'2026-11-12T02:00:00.000Z',peakPnlUsd:37.85,peakPnlCapital:37.85,peakPnlPctUsdc:7.57,peakPnlAt:'2026-11-12T01:00:00.000Z'};const x=run([[DEEP,-6],[DEEP,-6],[DEEP,-6],[DEEP,-6]],ON,{pos});assert.equal(x.r,null);assert.ok(!pos.slPlusArmed);});
t('retro-arm: position without v1 never arms even with a high peak',()=>{const pos={...mk(),peakPnlUsd:45,peakPnlCapital:45,peakPnlPctUsdc:9,peakPnlAt:'2026-11-12T02:00:00.000Z'};assert.equal(run([[-1,0],[-1,0],[-1,0]],ON,{pos}).r,null);});
// BEP floor (second protection): once armed, PnL <= FLOOR for FLOOR_POLLS polls closes immediately (no waiting for the lock's CONFIRM polls)
const FL={...ON,EMERGENCY_SLPLUS_FLOOR_PCT:0,EMERGENCY_SLPLUS_FLOOR_POLLS:1};
t('floor: first poll <= BEP after arming closes immediately with a BEP reason',()=>{const x=run([[DEEP,-7],[0,7],[-1,3],[-3,-0.3]],FL);assert.match(x.r,/^emergency_slplus USDC BEP \(peak \+7\.0%\)$/);assert.equal(x.i,4);});
t('floor control: the same path without floor keys does not close (needs 3 low polls)',()=>{assert.equal(run([[DEEP,-7],[0,7],[-1,3],[-3,-0.3]],ON).r,null);});
t('floor: fast crash after the peak is closed at the first poll <= BEP, before SL -20',()=>{const x=run([[DEEP,-7],[0,6],[-10,-9],[-12,-20.5]],FL);assert.match(x.r,/^emergency_slplus USDC BEP/);assert.equal(x.i,3);});
t('floor: without it the same crash path ends in emergency_stop (why the layer exists)',()=>{const x=run([[DEEP,-7],[0,6],[-10,-9],[-12,-20.5]],ON);assert.equal(x.r,'emergency_stop');});
t('floor: not active before arming (peak only 4.9)',()=>{assert.equal(run([[DEEP,-7],[0,4.9],[-3,-0.3]],FL).r,null);});
t('floor: not active without TP emergency v1',()=>{const b=binFor(20);assert.equal(run([[b,-3],[0,8],[-1,-0.3]],FL).r,null);});
t('floor: +0.05 (between floor 0 and lock 0.1) is handled by the lock after 3 polls',()=>{const x=run([[DEEP,-7],[0,7],[-1,0.05],[-1,0.05],[-1,0.05]],FL);assert.match(x.r,/^emergency_slplus USDC \+0\.1% /);assert.equal(x.i,5);});
t('floor: exactly 0 counts (<=), +0.01 does not',()=>{assert.match(run([[DEEP,-7],[0,7],[-1,0]],FL).r,/BEP/);assert.equal(run([[DEEP,-7],[0,7],[-1,0.01]],FL).r,null);});
t('floor polls = 2 needs two consecutive; recovery resets',()=>{const F2={...FL,EMERGENCY_SLPLUS_FLOOR_POLLS:2};assert.equal(run([[DEEP,-7],[0,7],[-1,-0.3],[-1,0.5]],F2).r,null);assert.match(run([[DEEP,-7],[0,7],[-1,-0.3],[-1,-0.4]],F2).r,/BEP/);});
t('floor >= lock is ignored (misconfiguration): lock still works, floor never fires',()=>{const bad={...ON,EMERGENCY_SLPLUS_FLOOR_PCT:0.5,EMERGENCY_SLPLUS_FLOOR_POLLS:1};assert.equal(X.slPlusCfg(bad).floorOn,false);assert.equal(run([[DEEP,-7],[0,7],[-1,0.3]],bad).r,null);});
t('floor: custom level shows in the reason (+ sign) and unquoted polls count',()=>{const F={...ON,EMERGENCY_SLPLUS_FLOOR_PCT:-0.5,EMERGENCY_SLPLUS_FLOOR_POLLS:1};const x=run([[DEEP,-7],[0,7],[-1,-0.6]],F,{quoted:false});assert.match(x.r,/^emergency_slplus USDC \+-0\.5% /);});
t('floor: stop loss -20 still wins when PnL gaps straight below',()=>{assert.equal(run([[DEEP,-7],[0,6],[-12,-21]],FL).r,'emergency_stop');});
t('floor reason is not a stop loss and has a history label',()=>{const r='emergency_slplus USDC BEP (peak +7.0%)';assert.equal(require('./paper-sl-blacklist').isStopLoss(r),false);assert.match(require('./paper-history').closeReason({reason:r,capitalAsset:'USDC'}),/^TP Emergency SL\+ \(kunci profit setelah TP emergency aktif\) USDC BEP \(peak \+7\.0%\)$/);});
t('retro-arm + floor: open position armed from recorded peak closes at its first poll <= BEP',()=>{const pos={...mk(),deepDrawdown:true,deepDrawdownAt:'2026-11-12T01:00:00.000Z',peakPnlUsd:37.85,peakPnlCapital:37.85,peakPnlPctUsdc:7.57,peakPnlAt:'2026-11-12T02:00:00.000Z'};const x=run([[-5,0.33],[-5,4.3],[-5,-0.2]],FL,{pos});assert.match(x.r,/BEP/);assert.equal(x.i,3);});
// reason is a profit protection, not a stop loss
const BL=require('./paper-sl-blacklist'),H=require('./paper-history');
t('reason is NOT classified as stop loss (no SL blacklist)',()=>{assert.equal(BL.isStopLoss('emergency_slplus USDC +0.1% (peak +8.7%)'),false);assert.equal(BL.isStopLoss('emergency_stop'),true);});
t('history label',()=>{const a=H.closeReason({reason:'emergency_slplus USDC +0.1% (peak +8.7%)',capitalAsset:'USDC'});assert.match(a,/^TP Emergency SL\+ \(kunci profit setelah TP emergency aktif\) USDC \+0\.1% \(peak \+8\.7%\)$/);
 const b=H.closeReason({reason:'emergency_slplus USDC +0.1% (peak +8.7%) (recalc)',capitalAsset:'USDC'});assert.ok(!/recalc/.test(b));assert.equal(H.closeReason({reason:'emergency_tp USDC +10%'}).startsWith('TP emergency'),true);});
// settings schema
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slp-'));const S=require('./paper-settings');const v=S.currentValues(dir);
t('settings defaults: ON, 7, 5, 3, floor 0 x2 (22 Nov)',()=>{assert.equal(v.EMERGENCY_SLPLUS_ENABLED,true);assert.equal(v.EMERGENCY_SLPLUS_ARM_PCT,7);assert.equal(v.EMERGENCY_SLPLUS_LOCK_PCT,5);assert.equal(v.EMERGENCY_SLPLUS_CONFIRM_POLLS,3);assert.equal(v.EMERGENCY_SLPLUS_FLOOR_PCT,0);assert.equal(v.EMERGENCY_SLPLUS_FLOOR_POLLS,2);});
t('settings validation: ranges enforced, valid patch accepted',()=>{
 for(const bad of [{EMERGENCY_SLPLUS_CONFIRM_POLLS:0},{EMERGENCY_SLPLUS_CONFIRM_POLLS:2.5},{EMERGENCY_SLPLUS_ARM_PCT:0},{EMERGENCY_SLPLUS_LOCK_PCT:-9},{EMERGENCY_SLPLUS_ENABLED:'yes'},{EMERGENCY_SLPLUS_FLOOR_POLLS:0},{EMERGENCY_SLPLUS_FLOOR_POLLS:1.5},{EMERGENCY_SLPLUS_FLOOR_PCT:-9}]){const r=S.validatePatch(bad,v);assert.ok(!r.ok||(r.rejected&&r.rejected.length),JSON.stringify(bad));}
 const ok=S.validatePatch({EMERGENCY_SLPLUS_ARM_PCT:6,EMERGENCY_SLPLUS_LOCK_PCT:0.5,EMERGENCY_SLPLUS_CONFIRM_POLLS:4,EMERGENCY_SLPLUS_ENABLED:false},v);assert.ok(ok.ok,JSON.stringify(ok));});
// Reset-to-default must restore exactly the current configuration (TP 13, TP emergency, SL+ incl. BEP floor, anti-PvP SKIP_ALL)
t('reset button: custom values -> resetSettings -> all current defaults come back',()=>{
 const d2=fs.mkdtempSync(path.join(os.tmpdir(),'slp-reset-'));
 const r1=S.applySettings(d2,{TP_USD_PCT:25,EMERGENCY_TP_PCT:15,EMERGENCY_SLPLUS_ARM_PCT:8,EMERGENCY_SLPLUS_LOCK_PCT:1,EMERGENCY_SLPLUS_CONFIRM_POLLS:7,EMERGENCY_SLPLUS_FLOOR_PCT:0.5,EMERGENCY_SLPLUS_FLOOR_POLLS:4,EMERGENCY_SLPLUS_ENABLED:false,ANTI_PVP_MODE:'OFF'},{updatedBy:'test'});assert.ok(r1.ok,JSON.stringify(r1));
 const c=r1.values;assert.equal(c.TP_USD_PCT,25);assert.equal(c.EMERGENCY_SLPLUS_ENABLED,false);assert.equal(c.ANTI_PVP_MODE,'OFF');
 const r2=S.resetSettings(d2,{updatedBy:'test'});assert.ok(r2.ok);const w=r2.values;
 const want={TP_USD_PCT:13,EMERGENCY_DROP:.2,EMERGENCY_TP_ENABLED:true,EMERGENCY_TP_TRIGGER_RANGE_PCT:50,EMERGENCY_TP_PCT:10,EMERGENCY_SLPLUS_ENABLED:true,EMERGENCY_SLPLUS_ARM_PCT:7,EMERGENCY_SLPLUS_LOCK_PCT:5,EMERGENCY_SLPLUS_CONFIRM_POLLS:3,EMERGENCY_SLPLUS_FLOOR_PCT:0,EMERGENCY_SLPLUS_FLOOR_POLLS:2,ANTI_PVP_MODE:'KEEP_BIGGEST',SL_BLACKLIST_ENABLED:true,TRAIL_ENABLED:false};
 for(const k of Object.keys(want))assert.deepStrictEqual(w[k],want[k],k);
 assert.ok(w.TP_USD_PCT>w.EMERGENCY_TP_PCT,'normal TP must stay above emergency TP');
});
// live and paper must share the same take profit: legacy TP (used by the live path) always follows TP_USD_PCT
t('legacy TP always follows TP_USD_PCT (live == paper), also after a direct TP patch and after reset',()=>{
 const d3=fs.mkdtempSync(path.join(os.tmpdir(),'slp-tp-'));
 const a=S.applySettings(d3,{TP_USD_PCT:17},{updatedBy:'test'});assert.ok(a.ok);assert.equal(a.values.TP,0.17);assert.equal(a.values.TP_USD_PCT,17);
 const b=S.applySettings(d3,{TP_USD_PCT:17,TP:0.5},{updatedBy:'test'});assert.ok(b.ok);assert.equal(b.values.TP,0.17,'a direct TP value in the same patch cannot diverge from TP_USD_PCT');
 const c=S.resetSettings(d3,{updatedBy:'test'});assert.equal(c.values.TP_USD_PCT,13);assert.equal(c.values.TP,0.13);
 assert.equal(JSON.parse(fs.readFileSync(path.join(d3,'settings.json'),'utf8')).values.TP,0.13,'file on disk is consistent too');
});
// HUNG-SOL #2 correction: row, cash, receipt, idempotence, calendar
const R=require('./paper-reconcile'),CAL=require('./paper-pnl-calendar');
function fakeState(){const h={name:'HUNG-SOL',pool:R.HUNG.pool,position:R.HUNG.position,openedAt:R.HUNG.openedAt,closedAt:R.HUNG.closedAt,usdcIn:499.9,usdcOut:R.HUNG.oldUsdcOut,legUsdcOut:R.HUNG.oldUsdcOut,
  pnlUsd:R.HUNG.oldPnlUsd,pnlPct:-21.77,reason:'emergency_stop',entryPrice:0.00000693995872879159,binStep:200,entryActiveBin:-251,depositQuote:5.724790216,capitalAsset:'USDC',riskPolicyVersion:'net-usdc-v2-quote-wait10'};
 const other={name:'X',pool:'p',position:'q',openedAt:'2026-11-12T01:00:00.000Z',closedAt:'2026-11-12T02:00:00.000Z',usdcIn:500,usdcOut:510,pnlUsd:10,reason:'oor_right_take_profit'};
 return {books:{N5:{virtual:{usdc:4366.510127331379},history:[other,h]}},accountingCorrections:[]};}
(async()=>{
 const st=fakeState(),before=CAL.fromHistory(st.books.N5.history,null);
 const rec=await R.apply(st),h=st.books.N5.history[1],cash=st.books.N5.virtual.usdc-4366.510127331379;
 assert.equal(rec.id,R.HUNG_ID);assert.ok(Math.abs(rec.cashDeltaUsdc-108.60686245209736)<1e-9);assert.ok(Math.abs(cash-rec.cashDeltaUsdc)<1e-9,'cash moved by exactly the pnl delta');
 assert.equal(h.pnlUsd,-0.2239);assert.ok(Math.abs(h.usdcOut-499.6761)<1e-9,String(h.usdcOut));assert.equal(h.legUsdcOut,h.usdcOut);assert.equal(h.exitWib,'2026-11-12 10:29:08 WIB');assert.equal(h.closedAt,'2026-11-12T03:29:08.000Z');
 assert.equal(h.hold,'1h 27m');assert.equal(h.reshapes,3);assert.equal(h.lastActiveBin,-265);assert.equal(h.corrected,true);assert.match(h.reason,/^emergency_slplus USDC \+0\.1% \(peak \+8\.7%\) \(recalc\)$/);
 assert.match(h.closeReasonText,/^TP Emergency SL\+ /);assert.equal(h.correction.original.reason,'emergency_stop');assert.equal(h.correction.original.pnlUsd,R.HUNG.oldPnlUsd);
 assert.ok(Math.abs(h.pnlPct-(100*-0.2239/499.9))<1e-9);assert.equal(h.netPnlUsd,h.pnlUsd);assert.equal(h.pnlCapital,h.pnlUsd);assert.equal(BL.isStopLoss(h.reason),false);
 assert.equal(st.accountingCorrections.length,1);assert.equal(await R.apply(st),null,'idempotent: second apply is a no-op');assert.equal(st.accountingCorrections.length,1);assert.ok(Math.abs(st.books.N5.virtual.usdc-4366.510127331379-rec.cashDeltaUsdc)<1e-9);
 const after=CAL.fromHistory(st.books.N5.history,null);assert.ok(Math.abs((after.total-before.total)-rec.cashDeltaUsdc)<1e-3,'calendar total moves by exactly the cash delta');
 assert.equal(Object.keys(after.days).join(),'2026-11-12');assert.equal(after.trades,before.trades);assert.equal(before.days['2026-11-12'].losses,1);assert.equal(after.days['2026-11-12'].losses,0,'corrected -0.22 (-0.045%) is breakeven since t228u (|PnL%|<0.1%)');assert.equal(after.days['2026-11-12'].be,1);assert.equal(after.days['2026-11-12'].wins,1);assert.ok(Math.abs(after.days['2026-11-12'].minus-(-0.2239))<1e-9);
 // baseline guard: tampered row is refused, nothing mutated
 const bad=fakeState();bad.books.N5.history[1].pnlUsd=-100;await assert.rejects(()=>R.apply(bad),/baseline changed/);assert.equal(bad.books.N5.virtual.usdc,4366.510127331379);
 // different existing correction is refused
 const dup=fakeState();dup.books.N5.history[1].correction={id:'other'};await assert.rejects(()=>R.apply(dup),/different correction/);
 n++;console.log('ok HUNG correction: row, cash delta, receipt, label, idempotent, guards, calendar');
 console.log('all',n,'tests passed');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
