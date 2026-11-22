'use strict';
// The bot must never carry a hard-coded personal wallet address; the LP Agent link follows the bot's own stored wallet.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{43,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const WELL_KNOWN = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);   // wSOL, USDC mints
t('bot.js has no hard-coded wallet address (only well-known token mints)', () => { const bad = (read('bot.js').match(B58) || []).filter(a => !WELL_KNOWN.has(a)); assert.deepEqual(bad, []); assert.ok(/botWalletAddress\(\)/.test(read('bot.js'))); });
t('README / ecosystem configs carry no wallet address and no LPAGENT_ADDRESS value', () => {
  for (const f of ['README.md', 'ecosystem.sol.config.js', 'ecosystem.sol-live.config.js', 'ecosystem.live.config.js', 'ecosystem.paper.config.js']) { if (!fs.existsSync(path.join(__dirname, f))) continue; const bad = (read(f).match(B58) || []).filter(a => !WELL_KNOWN.has(a)); assert.deepEqual(bad, [], f); assert.ok(!/LPAGENT_ADDRESS\s*[:=]\s*['"][1-9A-HJ-NP-Za-km-z]{32,}/.test(read(f)), f); }
});
t('LP Agent link follows the stored bot wallet; override wins; no wallet -> generic page', () => {
  const tg = require('./telegram-notify');   // load FIRST: the project .env may set LP_SECRETS_DIR at load time
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpa-')); process.env.LP_SECRETS_DIR = dir; delete process.env.LPAGENT_ADDRESS_OVERRIDE; process.env.LPAGENT_ADDRESS = 'STALEOLDADDR' + 'y'.repeat(30);
  assert.equal(tg.lpAgentLink(), 'https://app.lpagent.io/portfolio'); /* stale LPAGENT_ADDRESS must be ignored */
  const { Keypair } = require('@solana/web3.js'); const ws = require('./wallet-store'); const kp = Keypair.generate(); ws.saveKey(JSON.stringify(Array.from(kp.secretKey)), dir);
  assert.ok(tg.lpAgentLink().includes(kp.publicKey.toBase58()), 'must use the stored wallet');
  process.env.LPAGENT_ADDRESS_OVERRIDE = 'OVERRIDE' + 'x'.repeat(30); assert.ok(tg.lpAgentLink().includes('OVERRIDE'));
});
console.log('all', n, 'tests passed');
