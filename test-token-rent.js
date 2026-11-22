'use strict';
// Token-account rent claim: pure rules + claim flow with fakes ONLY. Nothing here touches the chain, a key or a network.
const assert = require('assert'); const R = require('./token-rent'); const fs = require('fs'), path = require('path');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const OWNER = 'OwnerWallet1111111111111111111111111111111111';
const acct = (o = {}) => ({ pubkey: { toBase58: () => o.pk || 'ACC1' }, account: { lamports: o.lamports ?? 2039280, owner: o.program || R.TOKEN_PROGRAM, data: { parsed: { info: { owner: o.owner || OWNER, mint: o.mint || 'MINTX', state: o.state || 'initialized', isNative: !!o.isNative, tokenAmount: { amount: o.amount ?? '0' }, delegate: o.delegate, delegatedAmount: o.delegate ? { amount: o.delegated ?? '0' } : undefined, closeAuthority: o.closeAuthority } } } } });
(async () => {
  await t('only empty, owned, classic-SPL, non-native, non-USDC/wSOL, undelegated accounts are closable', () => {
    assert.ok(R.classify(acct(), OWNER).ok);
    for (const [o, why] of [[{ amount: '1' }, 'has-balance'], [{ owner: 'Other' }, 'owner-mismatch'], [{ program: 'Token2022xxxx' }, 'not-classic-spl'], [{ isNative: true }, 'native-wsol'], [{ mint: R.USDC }, 'usdc-kept'], [{ mint: R.WSOL }, 'wsol-kept'], [{ state: 'frozen' }, 'state-frozen'], [{ delegate: 'D', delegated: '5' }, 'has-delegate'], [{ closeAuthority: 'Evil' }, 'foreign-close-authority'], [{ lamports: 0 }, 'no-lamports']]) { const c = R.classify(acct(o), OWNER); assert.ok(!c.ok && c.why === why, why + ' got ' + JSON.stringify(c)); }
    assert.ok(R.classify(acct({ closeAuthority: OWNER }), OWNER).ok, 'own close authority is fine');
    assert.strictEqual(R.classify({}, OWNER).ok, false);
  });
  const web3 = { PublicKey: class { constructor(v) { this.v = String(v && v.v || v); } toBase58() { return this.v; } }, Transaction: class { constructor() { this.ix = []; } add(i) { this.ix.push(i); return this; } } };
  const spl = { createCloseAccountInstruction: (acc, dest, auth) => ({ acc: acc.v, dest: dest.v, auth: auth.v }) };
  const mkConn = (list) => ({ getParsedTokenAccountsByOwner: async () => ({ value: list }) });
  const kp = { publicKey: new web3.PublicKey(OWNER) };
  await t('scan: counts closable, tallies skipped reasons, totals the rent', async () => {
    const r = await R.scan({ conn: mkConn([acct({ pk: 'A' }), acct({ pk: 'B', amount: '9' }), acct({ pk: 'C', mint: R.USDC })]), owner: OWNER, PublicKey: web3.PublicKey });
    assert.strictEqual(r.count, 1); assert.strictEqual(r.total, 3); assert.deepStrictEqual(r.skipped, { 'has-balance': 1, 'usdc-kept': 1 }); assert.strictEqual(r.totalLamports, 2039280);
  });
  await t('claim: destination and authority are ALWAYS the wallet itself; 6 per tx; simulates all before sending; fresh re-scan', async () => {
    const list = Array.from({ length: 14 }, (_, i) => acct({ pk: 'P' + i }));
    const order = []; const sent = [];
    const r = await R.claim({ conn: mkConn(list), keypair: kp, web3, spl, simulate: async () => { order.push('sim'); return { err: null }; }, send: async (tx) => { order.push('send'); sent.push(tx); return 'SIG' + sent.length; } });
    assert.ok(r.ok); assert.strictEqual(r.closed, 14); assert.strictEqual(sent.length, 3); assert.deepStrictEqual(sent.map(x => x.ix.length), [6, 6, 2]);
    assert.ok(sent.every(x => x.ix.every(i => i.dest === OWNER && i.auth === OWNER)), 'rent always returns to the wallet');
    assert.ok(order.slice(0, 3).every(x => x === 'sim') && order.slice(3).every(x => x === 'send'), 'all simulations before the first send');
    assert.ok(Math.abs(r.reclaimedSol - 14 * 0.00203928) < 1e-9);
  });
  await t('claim: a simulation error aborts BEFORE anything is sent', async () => {
    let sends = 0, k = 0; const r = await R.claim({ conn: mkConn([acct({ pk: 'A' }), acct({ pk: 'B' })]), keypair: kp, web3, spl, simulate: async () => ({ err: ++k === 1 ? { InstructionError: [0, 'x'] } : null }), send: async () => { sends++; return 'S'; } });
    assert.strictEqual(r.ok, false); assert.strictEqual(sends, 0); assert.strictEqual(r.closed, 0);
  });
  await t('claim: first send failure stops and reports exactly what was closed; nothing to do -> ok/0 without sending', async () => {
    const list = Array.from({ length: 13 }, (_, i) => acct({ pk: 'P' + i })); let c = 0;
    const r = await R.claim({ conn: mkConn(list), keypair: kp, web3, spl, simulate: async () => ({ err: null }), send: async () => { if (++c === 2) throw new Error('blockhash expired'); return 'S' + c; } });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.closed, 6); assert.strictEqual(r.signatures.length, 1); assert.ok(/blockhash/.test(r.error));
    let sends = 0; const none = await R.claim({ conn: mkConn([acct({ amount: '5' })]), keypair: kp, web3, spl, simulate: async () => ({}), send: async () => { sends++; } });
    assert.ok(none.ok && none.closed === 0 && sends === 0);
  });
  await t('server wiring: claim is a write route, behind the sensitive wallet gate, needs the CLAIM phrase, refused while live runs/unknown; UI button lives in the wallet menu, labelled Claim Token Account', () => {
    const srv = fs.readFileSync(path.join(__dirname, 'miniapp/server.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, 'miniapp/public/index.html'), 'utf8'), app = fs.readFileSync(path.join(__dirname, 'miniapp/public/app.js'), 'utf8');
    assert.ok(/'\/api\/wallet\/rent\/claim'/.test(srv)); assert.ok(/pathname\.startsWith\('\/api\/wallet'\)/.test(srv), 'sensitive gate covers /api/wallet/*');
    assert.ok(/!== 'CLAIM'/.test(srv)); assert.ok(!/Claim hanya saat live OFF/.test(srv), 'no live-off gate any more'); assert.ok(/protectedMints: liveProtectedMints\(opts\)/.test(srv), 'open live mints are protected instead');
    const wv = html.slice(html.indexOf('id="wallet-key-view"')); assert.ok(/id="btn-rent-scan"/.test(wv) && /id="btn-rent-claim"/.test(wv));
    assert.ok(/window\.prompt\('Ketik CLAIM/.test(app)); assert.ok(/>Claim Token Account<\/button>/.test(html)); assert.ok(!/liveRunning/.test(app.slice(app.indexOf('Claim Token Account'), app.indexOf("$('btn-del-key').onclick"))), 'rent UI no longer depends on live state');
  });
  await t('works any time: mints of positions still open in the live state are never closed (even when empty); others are', async () => {
    const r = await R.scan({ conn: mkConn([acct({ pk: 'A', mint: 'HELD' }), acct({ pk: 'B', mint: 'FREE' })]), owner: OWNER, PublicKey: web3.PublicKey, protectedMints: new Set(['HELD']) });
    assert.strictEqual(r.count, 1); assert.strictEqual(r.accounts[0].mint, 'FREE'); assert.deepStrictEqual(r.skipped, { 'protected-open-position': 1 });
    const sent = []; const c = await R.claim({ conn: mkConn([acct({ pk: 'A', mint: 'HELD' }), acct({ pk: 'B', mint: 'FREE' })]), keypair: kp, web3, spl, protectedMints: new Set(['HELD']), simulate: async () => ({ err: null }), send: async (tx) => { sent.push(tx); return 'S'; } });
    assert.ok(c.ok && c.closed === 1 && sent.length === 1 && sent[0].ix.length === 1 && sent[0].ix[0].acc === 'B');
  });
  console.log('all', n, 'tests passed');
})();
