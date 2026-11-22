'use strict';
// Offline unit tests for EMERGENCY_TP: after price fell >= (open lower range * TRIGGER_RANGE_PCT) from entry, TP -> EMERGENCY_TP_PCT.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const X=require('./paper-exit-policy'),{decide}=X;
const base={EMERGENCY_DROP:.30,MAX_HOURS:1e6,TP_USD_PCT:20,OOR_RIGHT_CLOSE:true,TRAIL_ENABLED:false,QUOTE_FAILURE_POLLS:10};
const ON={EMERGENCY_TP_ENABLED:true,EMERGENCY_TP_TRIGGER_RANGE_PCT:50,EMERGENCY_TP_PCT:10};
const STEP=100,binFor=drop=>Math.floor(Math.log(1-drop/100)/Math.log(1+STEP/1e4)); // bin offset reaching >= drop%
const mk=(range=50)=>({openedAt:new Date().toISOString(),binStep:STEP,entryActiveBin:0,minBinId:-200,maxBinId:5,capitalAsset:'USDC',strategySettings:{RANGE_DOWN_PCT:range}});
// path of [activeBinOffset, pnlPct]
function run(p,settings,range=50,quoted=true){const pos=mk(range);let i=0;for(const [b,pct] of p){i++;const r=decide({pos,val:{pnlPct:pct,pnlUsd:pct*5,quoted,usdcOut:500+pct*5},activeBin:b,settings:{...base,...settings},pollId:i});if(r)return {r,pct,pos};}return {r:null,pos};}
let n=0;const t=(name,fn)=>{fn();n++;console.log('ok',name);};
const b25=binFor(25),b24=binFor(24),b35=binFor(35),b34=binFor(34);
const deep=[[-5,-2],[b25,-14],[-10,-3],[-2,5],[0,10.2],[2,15],[3,20.5]];
t('range 50: price -25% then recover -> emergency TP +10',()=>{const x=run(deep,ON,50);assert.match(x.r,/^emergency_tp USDC \+10%/);assert.equal(x.pct,10.2);assert.ok(x.pos.deepDrawdown);assert.equal(x.pos.openRangeDownPct,50);assert.ok(Math.abs(x.pos.deepDrawdownTriggerPct-25)<1e-9);});
t('range 50: price only -24% -> normal TP +20',()=>{const x=run([[b24,-12],[0,10.2],[3,20.5]],ON,50);assert.match(x.r,/^TP USDC \+20%/);assert.ok(!x.pos.deepDrawdown);});
t('range 70: -34% does not arm, normal TP 20',()=>{const x=run([[b34,-20],[0,10.5],[3,20.2]],ON,70);assert.match(x.r,/^TP USDC \+20%/);});
t('range 70: -35% arms -> emergency TP 10',()=>{const x=run([[b35,-20],[0,10.5]],ON,70);assert.match(x.r,/^emergency_tp/);assert.ok(Math.abs(x.pos.deepDrawdownTriggerPct-35)<1e-9);});
t('disabled: deep path -> normal TP +20 (flag still tracked)',()=>{const x=run(deep,{...ON,EMERGENCY_TP_ENABLED:false});assert.match(x.r,/^TP USDC \+20%/);assert.ok(x.pos.deepDrawdown);});
t('no keys = disabled',()=>{const x=run(deep,{});assert.match(x.r,/^TP USDC \+20%/);});
t('open range frozen per position (later RANGE_DOWN_PCT setting ignored)',()=>{const x=run([[b25,-10],[0,10.3]],{...ON,RANGE_DOWN_PCT:90},50);assert.match(x.r,/^emergency_tp/);});
t('flag persists',()=>{const pos={...mk(),deepDrawdown:true};assert.match(decide({pos,val:{pnlPct:10.1,quoted:true},activeBin:0,settings:{...base,...ON}}),/^emergency_tp/);});
t('unquoted waits 10 polls then on-chain fallback (same as normal TP)',()=>{const pos={...mk(),deepDrawdown:true};let r;for(let i=1;i<=10;i++){r=decide({pos,val:{pnlPct:11,quoted:false},activeBin:0,settings:{...base,...ON},pollId:i});if(i<10)assert.equal(r,null);}assert.match(r,/on-chain fallback/);});
t('stop loss -30 still wins',()=>{const x=run([[b25,-31]],ON);assert.equal(x.r,'emergency_stop');});
t('fallback range from geometry when no snapshot',()=>{const pos={...mk(),strategySettings:{}};pos.minBinId=-69;assert.ok(Math.abs(X.openRangeDownPct(pos)-49.7)<0.1);});
const replay=process.env.HOLD_SERIES;if(replay&&fs.existsSync(replay)){
 const rows=fs.readFileSync(replay,'utf8').trim().split('\n').map(l=>l.split(' ')).map(a=>({t:a[0],pct:+a[2],q:a[4]==='q=true',a:+a[6].slice(2)}));
 for(const [label,s] of [['disabled',{}],['enabled 50/10',ON]]){const pos={openedAt:new Date().toISOString(),binStep:100,entryActiveBin:-426,minBinId:-495,maxBinId:-421,capitalAsset:'USDC',strategySettings:{RANGE_DOWN_PCT:50}};let hit=null;rows.forEach((row,i)=>{if(hit||row.t<'10:42:51')return;const r=decide({pos,val:{pnlPct:row.pct,quoted:row.q},activeBin:row.a,settings:{...base,...s,OOR_RIGHT_CLOSE:false},pollId:i+1});if(r)hit={r,...row};});
  console.log('replay HOLD-SOL',label,'-> armed',pos.deepDrawdownAt?`yes bin ${pos.deepDrawdownBin} drop ${pos.deepDrawdownDropPct.toFixed(1)}%`:'no','->',hit?`${hit.r} at ${hit.t} WIB pnl=${hit.pct}%`:'no close');}}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'etp-'));const S=require('./paper-settings');const v=S.currentValues(dir);
t('settings defaults: on/50/10, TP 13, SL 20, trailing off',()=>{assert.equal(v.EMERGENCY_TP_ENABLED,true);assert.equal(v.EMERGENCY_TP_TRIGGER_RANGE_PCT,50);assert.equal(v.EMERGENCY_TP_PCT,10);assert.equal(v.TP_USD_PCT,13);assert.equal(v.EMERGENCY_DROP,.2);assert.equal(v.TRAIL_ENABLED,false);});
t('fields/labels',()=>{const f=S.displayValues(v);assert.match(f.EMERGENCY_DROP.label,/Stop Loss/);assert.equal(f.EMERGENCY_DROP.display,20);assert.match(f.EMERGENCY_TP_TRIGGER_RANGE_PCT.label,/range bawah/);assert.equal(S.validatePatch({EMERGENCY_TP_PCT:0},v).ok,false);});
fs.rmSync(dir,{recursive:true,force:true});console.log(`PASS ${n} tests`);
