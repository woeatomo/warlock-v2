'use strict';
// The Huang-SOL stop loss is voided (would have been filtered by the v1.8 turnover guard): row + its events leave the book, cash restored, equity identity unchanged, receipt keeps the originals. Synthetic state only.
const assert = require('assert'); const R = require('./paper-reconcile');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const H = R.HUANG_VOID;
const row = (o = {}) => ({ name: 'X-SOL', pool: 'P0', position: 'Q0', openedAt: '2026-11-12T10:00:00.000Z', closedAt: '2026-11-12T11:00:00.000Z', pnlUsd: 10, pnlQuoteUsd: 8, usdcIn: 500, usdcOut: 510, reason: 'oor_right_take_profit', ...o });
const huangRow = () => row({ name: H.name, pool: H.pool, position: H.position, openedAt: H.openedAt, closedAt: H.closedAt, pnlUsd: H.pnlUsd, pnlQuoteUsd: -156.7, usdcIn: 499.9, usdcOut: 345.8, reason: 'emergency_stop' });
const mkState = () => { const hist = [row(), row({ name: 'Huang-SOL', pool: H.pool, position: 'FIRSTLEG', openedAt: '2026-11-12T16:44:17.190Z', closedAt: '2026-11-12T16:47:10.671Z', pnlUsd: 1.26, reason: 'oor_right_reposition_limit' }), huangRow()];
  const dep = 5000, sum = hist.reduce((s, r) => s + r.pnlUsd, 0);
  return { books: { N5: { virtual: { usdc: dep + sum + 0.4, totalDepositedUsdc: dep }, positions: [], position: null, history: hist,
    rightRepositionEvents: [{ name: 'Huang-SOL', at: '2026-11-12T16:45:50.372Z', number: 1 }, { name: 'Huang-SOL', at: '2026-11-12T19:11:14.000Z', number: 1 }, { name: 'Huang-SOL', at: '2026-11-12T19:16:57.696Z', number: 2 }, { name: 'Y-SOL', at: '2026-11-12T19:12:00.000Z', number: 1 }],
    reshapes: [{ name: 'Huang-SOL', at: '2026-11-12T16:46:00.000Z' }, { name: 'Huang-SOL', at: '2026-11-12T18:53:07.460Z' }, { name: 'Huang-SOL', at: '2026-11-12T19:18:38.825Z' }, { name: 'Y-SOL', at: '2026-11-12T19:00:00.000Z' }] } }, accountingCorrections: [] }; };
t('removes ONLY the second (SL) Huang row; the first Huang trade and others stay; cash +154.07; equity identity unchanged (even with a pre-existing 0.40 gap)', () => {
  const st = mkState(), b = st.books.N5, gap0 = R.bookEquityGap(b), cash0 = b.virtual.usdc;
  const rc = R.applyHuangVoid(st, '2026-11-13T00:00:00Z');
  assert.ok(rc && rc.id === R.HUANG_VOID_ID); assert.equal(b.history.length, 2); assert.deepEqual(b.history.map(r => r.position), ['Q0', 'FIRSTLEG']);
  assert.ok(Math.abs(b.virtual.usdc - (cash0 + 154.07175788543174)) < 1e-9); assert.ok(Math.abs(R.bookEquityGap(b) - gap0) < 1e-9);
  assert.equal(rc.historyBefore, 3); assert.equal(rc.historyAfter, 2); assert.ok(Math.abs(rc.realizedPnlAfter - rc.realizedPnlBefore - 154.07175788543174) < 1e-9);
});
t('removes only the events inside the SL trade life (2 reposition + 2 reshape); the first trade\'s and other tokens\' events stay', () => {
  const st = mkState(), b = st.books.N5; R.applyHuangVoid(st);
  assert.deepEqual(b.rightRepositionEvents.map(e => e.at), ['2026-11-12T16:45:50.372Z', '2026-11-12T19:12:00.000Z']); assert.deepEqual(b.reshapes.map(e => e.at), ['2026-11-12T16:46:00.000Z', '2026-11-12T19:00:00.000Z']);
});
t('receipt keeps the full original row + removed events; idempotent (second call = null, nothing changes)', () => {
  const st = mkState(), rc = R.applyHuangVoid(st); assert.equal(rc.removed.row.position, H.position); assert.equal(rc.removed.row.pnlUsd, H.pnlUsd); assert.equal(rc.removed.rightRepositionEvents.length, 2); assert.equal(rc.removed.reshapes.length, 1 + 1);
  assert.equal(st.accountingCorrections.length, 1); const snap = JSON.stringify(st); assert.equal(R.applyHuangVoid(st), null); assert.equal(JSON.stringify(st), snap);
});
t('row not present -> null; baseline changed -> refuses (throws) and leaves the state untouched', () => {
  const none = mkState(); none.books.N5.history = none.books.N5.history.filter(r => r.position !== H.position); assert.equal(R.applyHuangVoid(none), null);
  const bad = mkState(); bad.books.N5.history[2].pnlUsd = -100; const snap = JSON.stringify(bad); assert.throws(() => R.applyHuangVoid(bad), /baseline changed/); assert.equal(JSON.stringify(bad), snap);
  const corr = mkState(); corr.books.N5.history[2].correction = { id: 'other' }; assert.throws(() => R.applyHuangVoid(corr), /different correction/);
});
t('wired into the startup chain (apply) and exported', async () => { const src = require('fs').readFileSync(require('path').join(__dirname, 'paper-reconcile.js'), 'utf8'); assert.ok(/f=applyHuangVoid\(state,at\)(,[a-z]=apply\w+\(state,at\))*;return ([a-z]\|\|)*f\|\|e/.test(src)); assert.equal(typeof R.applyHuangVoid, 'function'); });
console.log('all', n, 'tests passed');
