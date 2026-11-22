'use strict';
const assert=require('assert'),ex=require('./paper-exit-policy'),ep=require('./paper-entry-policy'),ph=require('./paper-history'),ps=require('./paper-settings');
const now=Date.parse('2026-11-11T09:07:01Z'),pos={openedAt:'2026-11-10T21:06:36Z'};
const base={MAX_HOURS:12};
// default == old behaviour: close at any PnL once age >= MAX_HOURS
assert.equal(ex.staleCheck(pos,{pnlPct:-4.006},{...base},now).reason,'max age 12h');
assert.equal(ex.staleCheck(pos,{pnlPct:-4.006},{...base,STALE_CLOSE_ENABLED:true,STALE_EXIT_MODE:'ANY'},now).reason,'max age 12h');
assert.equal(ex.staleCheck({openedAt:'2026-11-10T21:10:00Z'},{pnlPct:-4},base,now).close,false); // 11.95h
assert.equal(ex.staleCheck(pos,{pnlPct:-4},{...base,STALE_CLOSE_ENABLED:false},now).close,false);
assert.equal(ex.staleCheck(pos,{pnlPct:-4},{...base,STALE_EXIT_MODE:'BEP'},now).close,false);
assert.equal(ex.staleCheck(pos,{pnlPct:0.1},{...base,STALE_EXIT_MODE:'BEP'},now).reason,'max age 12h (stale BEP BEP)');
assert.equal(ex.staleCheck(pos,{pnlPct:-4},{...base,STALE_EXIT_MODE:'MINUS',STALE_EXIT_PCT:5},now).reason,'max age 12h (stale MINUS -5%)');
assert.equal(ex.staleCheck(pos,{pnlPct:-6},{...base,STALE_EXIT_MODE:'MINUS',STALE_EXIT_PCT:5},now).close,false);
assert.equal(ex.staleCheck(pos,{pnlPct:4},{...base,STALE_EXIT_MODE:'PROFIT',STALE_EXIT_PCT:5},now).close,false);
assert.equal(ex.staleCheck(pos,{pnlPct:5},{...base,STALE_EXIT_MODE:'PROFIT',STALE_EXIT_PCT:5},now).reason,'max age 12h (stale PROFIT +5%)');
// decide: SL still wins over stale; stale reason returned
const p2=()=>({openedAt:pos.openedAt,minBinId:-638,maxBinId:-564,entryActiveBin:-608});
assert.equal(ex.decide({pos:p2(),val:{pnlPct:-4.006,quoted:false},activeBin:-608,settings:{...base,EMERGENCY_DROP:.2},now}),'max age 12h');
assert.equal(ex.decide({pos:p2(),val:{pnlPct:-21,quoted:true},activeBin:-608,settings:{...base,EMERGENCY_DROP:.2},now}),'emergency_stop');
assert.equal(ex.decide({pos:p2(),val:{pnlPct:-4,quoted:true},activeBin:-608,settings:{...base,EMERGENCY_DROP:.2,STALE_CLOSE_ENABLED:false},now}),null);
// history text
assert.match(ph.closeReason({reason:'max age 12h'}),/Stale close: umur ≥ 12 jam · tutup langsung/);
assert.match(ph.closeReason({reason:'max age 12h (stale BEP BEP)'}),/syarat BEP/);
// defaults keep old behaviour
assert.equal(ps.DEFAULTS.STALE_CLOSE_ENABLED,true);assert.equal(ps.DEFAULTS.STALE_EXIT_MODE,'ANY');assert.equal(ps.DEFAULTS.MAX_HOURS,12);
// archive: closed after cutoff stays visible, closed before cutoff archived
const pol={from:'2026-11-10T13:00:00Z',cutoff:'2026-11-11T00:42:38.899Z',repeatPools:['P']};
assert.equal(ep.archived({usdcIn:508.9,pool:'P',openedAt:'2026-11-10T21:06:36Z',closedAt:'2026-11-11T09:07:01Z'},pol),false);
assert.equal(ep.archived({usdcIn:1125,pool:'P',openedAt:'2026-11-10T16:47:59Z',closedAt:'2026-11-10T17:05:04Z'},pol),true);
console.log('OK stale: default ANY = old behaviour, OFF, MINUS/BEP/PROFIT, SL precedence, history text, archive only pre-cutoff closes');
