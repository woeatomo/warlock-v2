'use strict';
const assert=require('assert');const {fetchUniverse,ft,row}=require('./pool-screen-source');
(async()=>{
let calls=[];
const get=async (url)=>{
 const u=new URL(url);calls.push(u);
 if(u.hostname==='api2.hawksight.co')return {pools:[],total:0};
 const page=Number(u.searchParams.get('page')),filter=u.searchParams.get('filter_by')||'';
 if(filter.includes('fee_tvl_ratio_30m>='))return {data:[{address:'ELIGIBLE'+page}],total:101,pages:2};
 if(filter.includes('token_y='))return {data:[{address:'NEAR'}],total:200,pages:2};
 return {data:[{address:'TOPFEE'}],total:140000,pages:1400};
};
const out=await fetchUniverse(get,{MIN_LIQ_USD:10000,MIN_FT:1,FT_WINDOW:'30m'});
assert.deepEqual(out.pools.map(p=>p.address),['ELIGIBLE1','ELIGIBLE2','TOPFEE','NEAR']);
assert.equal(out.coverage.eligiblePages,2);assert.equal(out.hawkfiVerified,false);assert.equal(out.source,'meteora-fallback');
assert(out.sourceReason.includes('24h'));assert.equal(calls.filter(u=>u.searchParams.get('filter_by')?.includes('fee_tvl_ratio_30m>=')).length,2);
assert.equal(ft({fee_tvl_ratio:{'30m':2.138847032698487}}),2.138847032698487);assert.equal(ft({fee_tvl_ratio:{'30m':null}}),null);
const r=row({token_x:{market_cap:3000000},token_y:{symbol:'USDC'},created_at:Date.now()-3600000,pool_config:{base_fee_pct:1,bin_step:80},fee_tvl_ratio:{'30m':27.54},fees:{'30m':1200}},['quote USDC','age<24h']);
assert.equal(r.quote,'USDC');assert.equal(r.baseFeePct,1);assert.equal(r.fees30mUsd,1200);assert(Math.abs(r.ageH-1)<.01);
await assert.rejects(fetchUniverse(async()=>({data:[],pages:51,total:5100}),{MIN_LIQ_USD:10000,MIN_FT:1,FT_WINDOW:'30m'}),/safety limit/);
console.log('OK source: complete eligible pagination, top-fee discovery, explicit HawkFi fallback, 30m units, quote/age metadata, fail-closed bounds.');
})().catch(e=>{console.error(e);process.exitCode=1});
