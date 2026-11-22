'use strict';
const assert=require('assert'),c=require('./paper-pnl-calendar');
assert.equal(c.dayKey('2026-11-11T23:59:59Z'),'2026-11-11');assert.equal(c.dayKey('2026-11-12T00:00:00Z'),'2026-11-12'); // 00:00 UTC = 07:00 WIB
const pol={from:'2026-11-10T13:00:00Z',cutoff:'2026-11-11T00:42:38.899Z',repeatPools:['P']};
const h=[{closedAt:'2026-11-10T10:00:00Z',openedAt:'2026-11-10T15:00:00Z',pnlUsd:5},{closedAt:'2026-11-11T01:00:00Z',openedAt:'2026-11-11T00:00:00Z',pnlUsd:-2},
 {closedAt:'2026-11-10T17:05:00Z',openedAt:'2026-11-10T16:47:00Z',pnlUsd:-96,usdcIn:1125,pool:'P'}, /* archived */
 {closedAt:'2026-11-11T09:07:01Z',openedAt:'2026-11-10T21:06:36Z',pnlUsd:-20.39,usdcIn:508.9,pool:'P'}]; /* closed after cutoff: visible */
const r=c.fromHistory(h,pol);
assert.deepEqual(Object.keys(r.days).sort(),['2026-11-10','2026-11-11']);
assert.equal(r.days['2026-11-10'].trades,1);assert.equal(r.days['2026-11-11'].trades,2);assert.equal(r.trades,3);assert.equal(r.total,-17.39);
assert.equal(c.mode({PAPER:'1',DRY_RUN:'1',LIVE_CONFIRMED:'0'},true).label,'DRY RUN');
assert.equal(c.mode({PAPER:'0',DRY_RUN:'0',LIVE_CONFIRMED:'1'},true).label,'DRY RUN');
assert.equal(c.mode({PAPER:'0',DRY_RUN:'0',LIVE_CONFIRMED:'1'},false).label,'LIVE');
assert.equal(c.mode({},false).label,'DRY RUN');
console.log('OK pnl calendar: UTC day boundaries (07:00 WIB reset), archive policy, totals, DRY RUN/LIVE badge');
