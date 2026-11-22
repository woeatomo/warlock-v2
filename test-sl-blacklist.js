'use strict';
// Offline tests for SL blacklist (temp dir only).
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const L=require('./paper-sl-blacklist');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slbl-'));let n=0;const t=(m,f)=>{f();n++;console.log('ok',m);};
t('isStopLoss',()=>{assert.ok(L.isStopLoss('emergency_stop'));assert.ok(L.isStopLoss('emergency_stop SL -20% (recalc)'));assert.ok(!L.isStopLoss('emergency_tp USDC +10% (recalc)'));assert.ok(!L.isStopLoss('TP USDC +20%'));assert.ok(!L.isStopLoss('manual_close'));});
t('add/has by mint, idempotent',()=>{assert.equal(L.add(dir,{mint:'MintA111',symbol:'A-SOL',pool:'P1',reason:'emergency_stop'}),true);assert.equal(L.add(dir,{mint:'MintA111',symbol:'A-USDC',pool:'P2'}),false);assert.ok(L.has(dir,'MintA111'));assert.ok(!L.has(dir,'MintB'));assert.equal(L.list(dir).length,1);});
t('other pool of same mint blocked (mint-based)',()=>{assert.ok(L.has(dir,'MintA111'));});
t('remove',()=>{assert.equal(L.remove(dir,'MintA111'),true);assert.ok(!L.has(dir,'MintA111'));assert.equal(L.remove(dir,'MintA111'),false);});
t('corrupt file -> empty, no throw',()=>{fs.writeFileSync(L.file(dir),'{bad');assert.equal(L.list(dir).length,0);});
const S=require('./paper-settings');const sd=fs.mkdtempSync(path.join(os.tmpdir(),'slset-'));const v=S.currentValues(sd);
t('setting default ON + label',()=>{assert.equal(v.SL_BLACKLIST_ENABLED,true);assert.match(S.displayValues(v).SL_BLACKLIST_ENABLED.label,/Jangan buka lagi token yang kena SL/);assert.equal(S.validatePatch({SL_BLACKLIST_ENABLED:false},v).ok,true);});
fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(sd,{recursive:true,force:true});console.log(`PASS ${n} tests`);
