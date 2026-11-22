'use strict';
// One-time dust cleanup for the bot's own live wallet (the key stored with `node set-wallet-key.js`).
// Swaps every non-SOL, non-USDC token balance in the wallet to SOL via Jupiter, then closes the empty token accounts.
// SAFETY: a mint that an OPEN position still tracks (walletTokenRaw > 0) is never touched; only the stray above it is sold.
// Run from the bot folder: node clean-dust.js (dry run) / CLEAN_DUST_LIVE=1 node clean-dust.js (send). DRY RUN by default: set CLEAN_DUST_LIVE=1 to send.
require('./env-config').load(__dirname);
const fs = require('fs');
const { Connection, PublicKey, Transaction, VersionedTransaction } = require('@solana/web3.js');
const { createCloseAccountInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const walletStore = require('./wallet-store');
const rpcConfig = require('./rpc-config');
const jup = require('./jupiter-config');
const swapRoute = require('./swap-route-config');
const livePositions = require('./live-positions');

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LIVE = process.env.CLEAN_DUST_LIVE === '1';
const SLIPPAGE_BPS = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, opt = {}, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(opt.timeoutMs || 15000) });
      if (!r.ok) { const body = await r.text().catch(() => ''); throw new Error(`${r.status} ${url.slice(0, 100)} ${body.replace(/\s+/g, ' ').slice(0, 200)}`); }
      return r.json();
    } catch (e) { lastErr = e; await sleep(600 * (i + 1)); }
  }
  throw lastErr;
}
const jupGetJSON = jup.wrap(getJSON, m => console.log(m));

async function swapTokenToSol(conn, keypair, mint, raw, decimals) {
  const q = await swapRoute.swapQuote({ connection: conn, getJSON: jupGetJSON, inputMint: mint, outputMint: SOL, amount: raw, slippageBps: SLIPPAGE_BPS });
  if (!q || !q.outAmount) throw new Error('no Jupiter quote for ' + mint);
  const outUi = Number(q.outAmount) / 1e9;
  console.log(`  quote: ${mint.slice(0, 12)}... -> ${outUi.toFixed(6)} SOL (in ${Number(raw) / 10 ** decimals})`);
  if (!LIVE) { console.log('  DRY RUN: swap not sent'); return { ok: true, dry: true, outUi }; }
  const s = await jupGetJSON('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: { ...q, inAmount: String(q.inAmount), outAmount: String(q.outAmount) },
      ...swapRoute.swapBodyParams(q),
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  const vtx = VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, 'base64'));
  vtx.sign([keypair]);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const sig = await conn.sendRawTransaction(vtx.serialize(), { maxRetries: 5 });
  const c = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (c.value && c.value.err) throw new Error('swap tx error ' + JSON.stringify(c.value.err));
  console.log('  tx confirmed', sig);
  return { ok: true, outUi, sig };
}

(async () => {
  const secretsDir = process.env.LP_SECRETS_DIR || require('path').join(__dirname, 'secrets');
  const keypair = walletStore.loadKeypair(secretsDir);
  const owner = keypair.publicKey;
  console.log('wallet:', owner.toBase58(), '| LIVE:', LIVE);
  const conn = rpcConfig.connection('confirmed');
  const solBefore = await conn.getBalance(owner);
  console.log('SOL before:', (solBefore / 1e9).toFixed(6));

  // Open positions: never sell tokens an open position still tracks.
  const st = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'state.json'), 'utf8'));
  const openTracked = new Map();
  for (const p of livePositions.list(st)) {
    if (p && p.mintX) openTracked.set(p.mintX, BigInt(p.walletTokenRaw || 0));
  }
  console.log('open positions tracking tokens:', [...openTracked.entries()].map(([m, r]) => m.slice(0, 12) + '... raw=' + r.toString()).join(', ') || 'none');
  // SCOPE (perintah King): HANYA debu bekas LP Warlock, yaitu mint yang pernah ada di history live bot. Bukan token lain (mis. NVDAx/TTWO).
  const warlockMints = new Set((st.history || []).map(h => h && h.mintX).filter(Boolean));
  console.log('mint bekas LP Warlock (history):', warlockMints.size);

  // All token accounts (classic SPL + Token-2022) in the wallet.
  const accounts = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await conn.getParsedTokenAccountsByOwner(owner, { programId });
    for (const a of res.value) {
      const info = a.account.data.parsed.info;
      const raw = BigInt(info.tokenAmount.amount);
      if (raw <= 0n) continue;
      accounts.push({ pubkey: a.pubkey, mint: info.mint, raw, decimals: info.tokenAmount.decimals, programId, ui: info.tokenAmount.uiAmountString });
    }
  }
  console.log('dust accounts with balance:', accounts.length);

  let sold = 0, skipped = 0, solGained = 0;
  for (const a of accounts) {
    if (a.mint === USDC || a.mint === SOL) { console.log('skip (USDC/SOL):', a.mint.slice(0, 12) + '...', a.ui); skipped++; continue; }
    if (!warlockMints.has(a.mint)) { console.log('skip (bukan bekas LP Warlock):', a.mint.slice(0, 12) + '...', a.ui); skipped++; continue; }
    const tracked = openTracked.get(a.mint);
    let sellRaw = a.raw;
    if (tracked != null && tracked > 0n) {
      // Open position tracks some of this mint: only the stray above it is sold.
      sellRaw = a.raw - tracked;
      if (sellRaw <= 0n) { console.log('skip (all tracked by open position):', a.mint.slice(0, 12) + '...', a.ui); skipped++; continue; }
      console.log(`mint ${a.mint.slice(0, 12)}... balance ${a.ui}, tracked ${tracked}, selling stray ${Number(sellRaw) / 10 ** a.decimals}`);
    } else {
      console.log(`mint ${a.mint.slice(0, 12)}... balance ${a.ui} (stray, no open position)`);
    }
    try {
      const r = await swapTokenToSol(conn, keypair, a.mint, sellRaw, a.decimals);
      if (r.ok) { sold++; solGained += r.outUi || 0; }
    } catch (e) {
      console.log('  SWAP FAILED, skipped:', String(e && e.message || e).slice(0, 200));
      skipped++;
      continue;
    }
    // Close the token account if it is now empty (rent back to the wallet).
    if (LIVE) {
      try {
        await sleep(2000);
        const bal = await conn.getTokenAccountBalance(a.pubkey);
        if (bal.value.amount === '0') {
          const tx = new Transaction().add(createCloseAccountInstruction(a.pubkey, owner, owner, [], a.programId));
          tx.feePayer = owner;
          tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
          tx.sign(keypair);
          const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
          await conn.confirmTransaction(sig, 'confirmed');
          console.log('  token account closed, rent back:', sig);
        } else {
          console.log('  account still has balance after swap, not closed:', bal.value.uiAmountString);
        }
      } catch (e) { console.log('  close account failed (non-fatal):', String(e && e.message || e).slice(0, 160)); }
    }
  }
  const solAfter = await conn.getBalance(owner);
  console.log('---');
  console.log('swapped:', sold, '| skipped:', skipped, '| SOL gained from swaps: ~' + solGained.toFixed(6));
  console.log('SOL after:', (solAfter / 1e9).toFixed(6), '| wallet SOL delta:', ((solAfter - solBefore) / 1e9).toFixed(6));
  if (!LIVE) console.log('DRY RUN only. Set CLEAN_DUST_LIVE=1 to send the swaps.');
})().catch(e => { console.error('CLEANUP FAILED:', e); process.exit(1); });
