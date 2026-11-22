'use strict';
// Multi-position bookkeeping for live == the dry run (up to MAX_POSITIONS open at once, shared wallet USDC, one SOL pile PER position).
// state.positions is the source of truth; state.position is only the position being worked on inside withPos(). Pure: no IO, no chain.
function list(state) { return Array.isArray(state.positions) ? state.positions : (state.position ? [state.position] : []); }
function samePos(a, b) { return a === b || !!(a && b && a.position && a.position === b.position); }
function indexOfPos(l, p) { return l.findIndex(x => samePos(x, p)); }
// Same on-chain position account must appear once. A loaded state.json has position as a JSON COPY of
// positions[0]; comparing by object identity would push a second FIONA (21 Nov 2026 restart).
function dedupeList(l) {
  const lastById = new Map();
  for (const p of l) if (p && p.position) lastById.set(p.position, p);
  const out = [], seen = new Set();
  for (const p of l) {
    const id = p && p.position;
    if (id) { if (seen.has(id)) continue; seen.add(id); out.push(lastById.get(id)); }
    else if (!out.includes(p)) out.push(p);
  }
  return out;
}
// Keep state.positions in step with state.position at ANY moment (saveState calls this), so a crash after an open/close never loses or duplicates a position.
function syncPositions(state) {
  const a = state.__active, cur = state.position, l = list(state).slice(), i = a ? indexOfPos(l, a) : -1;
  if (a && a !== cur) { if (cur) { if (i >= 0) l[i] = cur; else { const j = indexOfPos(l, cur); if (j >= 0) l[j] = cur; else l.push(cur); } } else if (i >= 0) l.splice(i, 1); }
  else if (cur && indexOfPos(l, cur) < 0) l.push(cur);
  else if (cur) { const j = indexOfPos(l, cur); if (j >= 0) l[j] = cur; }
  state.positions = dedupeList(l); return state.positions;
}
async function withPos(state, pos, fn) {
  state.position = pos; state.__active = pos;
  try { return await fn(); } finally { syncPositions(state); state.position = null; state.__active = null; }
}
// What goes to disk: positions + position (=first, for older readers). The working pointer never persists.
function persistView(state) { const l = syncPositions(state); const { __active, ...rest } = state; return { ...rest, position: l[0] || null, positions: l }; }
function duplicate(positions, pool, mint) { return positions.some(p => p.pool === pool || (!!mint && p.mintX === mint)); }
// Same pick rules as the paper cycle: skip duplicates (same pool or same token), prefer pools quoted in the capital asset when any exist, never exceed MAX_POSITIONS.
function selectPicks({ picks, positions, max, preferredMint }) {
  const eligible = picks.filter(p => !duplicate(positions, p.address, p.token_x?.address));
  const chosen = eligible.some(p => p.token_y?.address === preferredMint) ? eligible.filter(p => p.token_y?.address === preferredMint) : eligible;
  return { chosen, free: Math.max(0, max - positions.length) };
}
module.exports = { list, syncPositions, withPos, persistView, duplicate, selectPicks, samePos, dedupeList };
