'use strict';
// Supervised live test session (operator starts it from the Mini App). It is the ONLY way live may run while verification gates ("unverified:*") are still open.
// Caps operator chooses (defaults = his own settings): at most `maxPositions` positions at once, each at most `maxPositionSol` SOL (budget incl. gas), for `hours` (0 = no time limit).
// When it expires and gates are still open, the bot closes everything and stops. Pure file helpers: no chain, no keys.
const fs = require('fs'), path = require('path');
const FILE = 'live-test-session.json';
const DEFAULTS = { maxPositions: 2, maxPositionSol: 1, hours: 24 };   // the Mini App passes the operator's own settings (MAX_POSITIONS / POSITION_SOL_OPEN) as defaults
const file = (root) => path.join(root, FILE);

// No upper limits: operator edits freely. Only nonsense (zero / negative / not a number) is refused. hours = 0 means no time limit.
function validate(input = {}, defaults = DEFAULTS) {
  const pick = (k) => (input[k] == null || input[k] === '' ? defaults[k] : Number(input[k]));
  const mp = pick('maxPositions'), ms = pick('maxPositionSol'), h = pick('hours');
  if (!Number.isFinite(mp) || mp < 1) throw new Error('maxPositions harus minimal 1');
  if (!(Number.isFinite(ms) && ms > 0)) throw new Error('maxPositionSol harus lebih dari 0');
  if (!Number.isFinite(h) || h < 0) throw new Error('hours harus 0 (tanpa batas waktu) atau lebih');
  return { maxPositions: Math.round(mp), maxPositionSol: ms, hours: h };
}
function read(root, now = Date.now()) {
  try {
    const j = JSON.parse(fs.readFileSync(file(root), 'utf8')), exp = Date.parse(j.expiresAt);
    if (!(exp > 0) || !(j.maxPositions >= 1) || !(j.maxPositionSol > 0)) return null;
    return { ...j, expired: now >= exp, msLeft: Math.max(0, exp - now) };
  } catch { return null; }
}
const active = (root, now) => { const s = read(root, now); return s && !s.expired ? s : null; };
function create(root, { userId, now = Date.now(), ...params } = {}) {
  const p = validate(params), rec = { version: 1, startedAt: new Date(now).toISOString(), expiresAt: p.hours > 0 ? new Date(now + p.hours * 3600e3).toISOString() : '2099-12-31T00:00:00.000Z', ...p, by: userId };
  const tmp = file(root) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file(root));
  return rec;
}
function clear(root) { try { fs.unlinkSync(file(root)); } catch { /* none */ } }
const capBudget = (session, budgetSol) => (session ? Math.min(budgetSol, session.maxPositionSol) : budgetSol);
const maxPositions = (session, configured) => (session ? Math.min(configured, session.maxPositions) : configured);
module.exports = { FILE, DEFAULTS, validate, read, active, create, clear, capBudget, maxPositions };
