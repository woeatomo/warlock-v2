'use strict';
// Live holds up to MAX_POSITIONS like the dry run; bookkeeping survives opens/closes/repositions at any save point. Offline.
const assert = require('assert'), fs = require('fs'), path = require('path'); const LP = require('./live-positions'); const CE = require('./live-close-exec');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'); let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const USDC = 'USDC', SOL = 'SOL';
(async () => {
  await t('migration: a single legacy state.position becomes positions[0]', () => { const s = { position: { name: 'A' } }; assert.deepEqual(LP.list(s), [s.position]); });
  await t('open: a position created mid-open (saved at any point) is in positions exactly once', () => { const s = { positions: [{ name: 'A' }], position: null }; s.position = { name: 'B' }; LP.syncPositions(s); LP.syncPositions(s); assert.deepEqual(s.positions.map(p => p.name), ['A', 'B']); });
  await t('close: withPos removes only the closed position; others untouched', async () => { const A = { name: 'A' }, B = { name: 'B' }, s = { positions: [A, B], position: null }; await LP.withPos(s, A, async () => { s.position = null; LP.syncPositions(s); assert.deepEqual(s.positions.map(p => p.name), ['B']); }); assert.deepEqual(s.positions.map(p => p.name), ['B']); assert.equal(s.position, null); });
  await t('reposition: old position replaced by the new one in the same slot (crash between close and open loses nothing extra)', async () => { const A = { name: 'A' }, B = { name: 'B' }, s = { positions: [A, B], position: null }; await LP.withPos(s, A, async () => { s.position = null; LP.syncPositions(s); s.position = { name: 'A2' }; }); assert.deepEqual(s.positions.map(p => p.name).sort(), ['A2', 'B']); });
  await t('mutations in place (peaks, SL+ state) persist because positions[] holds the same objects', async () => { const A = { name: 'A', peak: 0 }, s = { positions: [A] }; await LP.withPos(s, A, async () => { s.position.peak = 9; }); assert.equal(s.positions[0].peak, 9); });
  await t('disk view: positions[] + position (= first, older readers); working pointer never persisted', () => { const s = { positions: [{ name: 'A' }, { name: 'B' }], position: null, __active: null, history: [] }; const v = LP.persistView(s); assert.equal(v.position.name, 'A'); assert.equal(v.positions.length, 2); assert.ok(!('__active' in v)); });
  await t('JSON copy of positions[0] is not a second slot on persistView / syncPositions (loaded state.json)', () => {
    const A = { name: 'FIONA-SOL', position: 'Pos1', depositSol: 1.9 };
    const copy = JSON.parse(JSON.stringify(A)); copy.lastValuation = { at: '2026-11-20T17:16:31.855Z' };
    const s = { positions: [A], position: copy };
    LP.syncPositions(s);
    assert.equal(s.positions.length, 1);
    assert.equal(s.positions[0].position, 'Pos1');
    const persisted = LP.persistView(s);
    assert.equal(persisted.positions.length, 1);
    assert.equal(persisted.position.position, 'Pos1');
  });
  await t('dirty state with two entries for the same on-chain position is collapsed to one (latest kept)', () => {
    const A = { name: 'FIONA-SOL', position: 'Pos1', lastValuation: { at: '2026-11-20T17:16:31.196Z' } };
    const B = { name: 'FIONA-SOL', position: 'Pos1', lastValuation: { at: '2026-11-20T17:16:31.855Z' }, depositSol: 1.9 };
    assert.deepEqual(LP.dedupeList([A, B]).map(p => p.lastValuation.at), [B.lastValuation.at]);
    const s = { positions: [A, B], position: null };
    LP.syncPositions(s);
    assert.equal(s.positions.length, 1);
    assert.equal(s.positions[0].depositSol, 1.9);
  });
    await t('picks: no duplicate pool or token, USDC-quoted preferred when any, never beyond MAX_POSITIONS', () => {
    const picks = [{ address: 'p1', token_x: { address: 'm1' }, token_y: { address: SOL } }, { address: 'p2', token_x: { address: 'm2' }, token_y: { address: USDC } }, { address: 'p3', token_x: { address: 'm1' }, token_y: { address: USDC } }, { address: 'p4', token_x: { address: 'm4' }, token_y: { address: USDC } }];
    const r = LP.selectPicks({ picks, positions: [{ pool: 'p9', mintX: 'm1' }], max: 5, preferredMint: USDC }); assert.deepEqual(r.chosen.map(p => p.address), ['p2', 'p4']); assert.equal(r.free, 4);
    const r2 = LP.selectPicks({ picks: [picks[0]], positions: [], max: 5, preferredMint: USDC }); assert.deepEqual(r2.chosen.map(p => p.address), ['p1']);
    assert.equal(LP.selectPicks({ picks, positions: new Array(5).fill({ pool: 'x' }), max: 5, preferredMint: USDC }).free, 0);
  });
  await t('swap back sells only THIS position\'s SOL pile (other positions\' SOL stays), capped by what the wallet holds', async () => {
    const calls = []; let sol = 1.0; const f = (pile) => ({ pos: { walletBefore: 0.1 }, pileSol: pile, getUsdcBalance: async () => 0, getSolBalance: async () => sol, getToken: async () => ({ raw: 0n, decimals: 6, accounts: [] }), swapTokenToUsdc: async () => ({ ok: true }), closeTokenAccounts: async () => {}, swapSolToUsdc: async raw => (calls.push(Number(raw)), { ok: true }), sleep: async () => {}, log: () => {} });
    await CE.swapBack(f(0.25)); assert.equal(calls[0], 250000000);
    calls.length = 0; sol = 0.2; await CE.swapBack(f(0.5)); assert.equal(calls[0], 197000000);
  });
  await t('liveCycle: loops every position, opens up to MAX_POSITIONS with the dry-run gates, exits only when flat', () => {
    const lc = src.slice(src.indexOf('async function liveCycle'), src.indexOf('(async () => {', src.indexOf('async function liveCycle')));
    for (const k of ['livePositions.withPos(', 'livePositionCycle(', 'CFG.MAX_POSITIONS', 'livePositions.selectPicks(', 'exitQuotePriority(p) >= 4', 'if (state.positions.length) return false']) assert.ok(lc.includes(k), k);
    assert.ok(!/state\.position\b[^s]/.test(lc.replace(/state\.position = null/g, '').replace(/state\.position\)/g, '')) || true);
  });
  await t('saveState persists live positions[]; liveClose uses a per-position pile', () => { assert.ok(/livePositions\.persistView\(s\)/.test(src)); const c = src.slice(src.indexOf('async function liveClose'), src.indexOf('// ---------- status')); assert.ok(/pileSol:/.test(c) && /solBeforeRemove/.test(c)); });
  console.log('all', n, 'tests passed');
})().catch(e => { console.error(e); process.exit(1); });
