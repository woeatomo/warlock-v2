'use strict';
process.env.TELEGRAM_ALLOWED_ID = process.env.TELEGRAM_ALLOWED_ID || '1000000001';   // test-only: these tests act as the allowed user
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {events,readTail}=require('./miniapp/activity');
const {startServer}=require('./miniapp/server');const {signInitData}=require('./paper-settings');
(async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lp-ui-test-'));
fs.writeFileSync(path.join(dir,'bot.log'),'x'.repeat(70000)+'\n[2026-11-10 20:00:00 WIB] [PAPER] scan: 231 pools fetched, 0 pass basic filters; rejects={"fee/tvl30m<1%":167}\n[2026-11-10 20:00:01 WIB] [PAPER] no candidate passes all filters\n[2026-11-10 20:00:02 WIB] [PAPER] private key NOT FOR API\n');
assert(Buffer.byteLength(readTail(path.join(dir,'bot.log')))<=65536);
assert.equal(events(dir).length,2);assert(events(dir)[1].text.includes('231 pool'));assert(!JSON.stringify(events(dir)).includes('NOT FOR API'));
const token='local-test-token-only', {server,port}=await startServer({host:'127.0.0.1',port:0,token,paperDir:process.env.TELEMETRY_PAPER_DIR||dir});
try {
const init=signInitData({user:JSON.stringify({id:1000000001}),auth_date:Math.floor(Date.now()/1000)},token);
const res=await fetch(`http://127.0.0.1:${port}/api/status`,{headers:{'x-telegram-init-data':init}});
assert.equal(res.status,200);const j=await res.json();assert(j.ok);assert(Array.isArray(j.status.activity));assert(j.csrf);
const bad=await fetch(`http://127.0.0.1:${port}/api/status`);assert.equal(bad.status,403);
console.log('OK isolated /api/status: HMAC auth + 403 without initData + bounded redacted activity; events='+j.status.activity.length+', near='+(j.status.status?.lastScan?.near?.length||0));
}finally{server.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
