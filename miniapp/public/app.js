(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0b0b0f'); tg.setBackgroundColor('#0b0b0f'); } catch {} }

  const state = { csrf: null, fields: null, paused: false, armId: null, armTimer: null, paperAllowed:false, actionBusy:false, scanBusy:false,lastManualScanAt:0,replacements:{} };

  const $ = (id) => document.getElementById(id);
  const banner = $('banner');
  function showSheet(el){
    if(!el)return;
    try{
      if(typeof el.showModal==='function'){
        if(!el.open)el.showModal();
        return;
      }
    }catch(e){}
    el.setAttribute('open','');
    el.classList.add('sheet-open');
  }
  function hideSheet(el){
    if(!el)return;
    try{
      if(typeof el.close==='function'&&(el.open||el.hasAttribute('open')))el.close();
    }catch(e){}
    el.removeAttribute('open');
    el.classList.remove('sheet-open');
  }

  function initData() { return (tg && tg.initData) || ''; }

  function showBanner(text, err) {
    banner.textContent = text;
    banner.classList.toggle('hidden', !text);
    banner.classList.toggle('err', !!err);
  }

  async function api(method, path, body) {
    const opts = { signal: AbortSignal.timeout(20000), method, headers: { 'X-Telegram-Init-Data': initData() } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ ...body, initData: initData(), csrf: state.csrf });
    }
    let res = await fetch(path, opts);
    let json = await res.json().catch(() => ({ ok: false, error: 'bad response' }));
    if (json && json.csrf) state.csrf = json.csrf;
    // The server allows one write per 0.75 s (e.g. Live ON = arm then start straight after): wait a moment and send the same call again once.
    if (res.status === 429 && body && !json.retryAfterSec) {
      await new Promise((r) => setTimeout(r, 900));
      if (opts.body) opts.body = JSON.stringify({ ...body, initData: initData(), csrf: state.csrf });
      res = await fetch(path, opts);
      json = await res.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (json && json.csrf) state.csrf = json.csrf;
    }
    return { status: res.status, json };
  }

  // Wallet/Live writes need an initData younger than 5 minutes (server rule). The reason used to show only as "unauthorized".
  function authWhy(json) {
    const r = String((json && (json.reason || json.error)) || '');
    if (/initdata/i.test(r) && /expired/i.test(r)) return 'sesi Telegram sudah lebih dari 5 menit (syarat keamanan untuk wallet/live). Tutup Mini App lalu buka ulang dari Telegram, dan langsung tempel key.';
    if (/csrf/i.test(r)) return 'token halaman kedaluwarsa; tekan sekali lagi.';
    if (/locked out/i.test(r)) return 'terkunci sementara karena terlalu banyak percobaan gagal; tunggu sekitar 15 menit.';
    if (/user not allowed/i.test(r)) return 'akun Telegram ini bukan operator.';
    if (/rate limited/i.test(r)) return 'terlalu cepat; coba lagi sebentar.';
    return r || 'gagal';
  }
  function initAgeSec() { try { const a = Number(new URLSearchParams(initData()).get('auth_date')); return a ? Math.floor(Date.now() / 1000) - a : null; } catch { return null; } }

  // Public wallet address is censored (B9pJ.......rP26); tap it to show or hide the full address.
  const maskAddr = (a) => { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '.......' + a.slice(-4) : a; };
  const addrSpan = (a) => (a ? `<span class="addr" data-addr="${esc(a)}" data-masked="1" role="button" tabindex="0">${esc(maskAddr(a))}</span>` : 'n/a');
  document.addEventListener('click', (e) => { const s = e.target.closest && e.target.closest('.addr'); if (!s) return; const full = s.dataset.addr, masked = s.dataset.masked === '1'; s.textContent = masked ? full : maskAddr(full); s.dataset.masked = masked ? '0' : '1'; });
  // In LIVE mode no "dry run" / "paper" wording stays on the home, status, positions or candidate views (the DRY RUN chooser button and settings texts are left alone).
  function liveSweep() {
    if (!state.liveRunning) return;
    const dm = document.getElementById('dash-mode'); if (dm) dm.classList.add('hidden');
    const sel = ['.badge .mode', '#status-body', '#positions', '#candidates', '#modal-stats', '#runs-list', '#dash-mode', '[id^="dash-"]:not(#dash-mode):not(#dash-live)'];
    for (const el of document.querySelectorAll(sel.join(','))) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const t = n.nodeValue; if (/dry run|paper/i.test(t)) { const r = t.replace(/\bREAL DRY RUN\b/g, 'LIVE RUN').replace(/Dry Run #(\d+)/g, 'Sesi #$1').replace(/dry run|paper/gi, (m) => (m === m.toUpperCase() ? 'LIVE' : 'live')); if (r !== t) n.nodeValue = r; } }
    }
  }
  { const t = setInterval(() => { try { liveSweep(); } catch (_) {} }, 700); if (t && t.unref) t.unref(); }
  // Mode chrome (header badge + dashboard pills) set directly from the server's mode, and remembered so a reopen starts in the last known mode
  // instead of the index.html default "DRY RUN" (that default + the 700 ms text sweep was the DRY RUN blink).
  // RPC slots (host + state only; keys stay in .env on the server): "Slot 1 aktif · Slot 2 siaga · Slot 3 kosong".
  function rpcSlotsText(r) {
    const sl = r && Array.isArray(r.slots) ? r.slots : null; if (!sl) return '—';
    const word = { active: 'aktif', standby: 'siaga', limited: 'limit', empty: 'kosong' };
    return sl.map(x => 'Slot ' + x.slot + ' ' + esc(word[x.state] || x.state) + (x.configured && x.host ? ' (' + esc(x.host) + ')' : '') + (x.state === 'limited' && x.backInSec ? ' ' + x.backInSec + ' dtk' : '')).join(' · ');
  }
  function applyModeChrome(live) {
    live = !!live; window.WarlockLiveMode = live;
    try { localStorage.setItem('sw_last_live', live ? '1' : '0'); } catch (_) {}
    const b = document.querySelector('.badge .mode'); if (b && b.textContent !== (live ? 'LIVE' : 'DRY RUN')) b.textContent = live ? 'LIVE' : 'DRY RUN';
    const dm = document.getElementById('dash-mode'), dl = document.getElementById('dash-live');
    if (dm) { const c = 'dash-pill dry' + (live ? ' hidden' : ' on'); if (dm.className !== c) dm.className = c; }
    if (dl) { const c = 'dash-pill live' + (live ? ' on' : ''); if (dl.className !== c) dl.className = c; }
  }
  try { if (localStorage.getItem('sw_last_live') === '1') { state.liveRunning = true; applyModeChrome(true); } } catch (_) {}

  function money(n) {
    if (n == null || !Number.isFinite(+n)) return 'n/a';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function setMarkup(el, html) { if (el.innerHTML !== html) el.innerHTML = html; }
  // Patch a container in place (keeps the existing DOM nodes, only changes attributes/text that differ) so polls don't rebuild/blink the bin chart.
  function morphNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    morphChildren(a, b);
  }
  function morphChildren(a, b) {
    const next = Array.from(b.childNodes);
    next.forEach((n, i) => { const cur = a.childNodes[i]; if (cur) morphNode(cur, n); else a.appendChild(n); });
    while (a.childNodes.length > next.length) a.removeChild(a.lastChild);
  }
  function patchMarkup(el, html) {
    if (el.__html === html) return; el.__html = html;
    if (!el.firstChild || typeof document === 'undefined') { el.innerHTML = html; return; }
    const t = document.createElement('template'); t.innerHTML = html; morphChildren(el, t.content);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric = (v) => v != null && Number.isFinite(+v);
  const pnlClass = (v) => numeric(v) ? (+v >= 0 ? 'positive' : 'negative') : '';
  const signed = (v) => numeric(v) ? (+v >= 0 ? '+' : '−') + money(Math.abs(v)) : '—';

  function entryCapitalUsd(row){
    const c=row&&(row.initialUsdcIn!=null?row.initialUsdcIn:row.usdcIn);
    return numeric(c)&&+c>0?+c:null;
  }
  function pctOfCapital(pnl,capital){
    if(!numeric(pnl)||!numeric(capital)||!(+capital>0))return null;
    return 100*(+pnl)/(+capital);
  }
  function pctText(pnl,capital){
    const p=pctOfCapital(pnl,capital);
    if(p==null)return '';
    return (p>=0?'+':'−')+Math.abs(p).toFixed(2)+'%';
  }
  function signedWithPct(pnl,capital){
    const s=signed(pnl),p=pctText(pnl,capital);
    return p?s+' ('+p+')':s;
  }
  function prettyPct(n){
    if(!numeric(n))return null;
    const v=+n;
    return Math.abs(v-Math.round(v))<0.05?String(Math.round(v)):v.toFixed(1);
  }
  function quotePnlText(d,capital) {
    if(!numeric(d?.pnlQuote)||!numeric(d?.pnlQuoteUsd))return 'Menunggu PnL quote';
    const q=d.quoteSymbol||'SOL',n=+d.pnlQuote,usd=+d.pnlQuoteUsd;
    const cap=numeric(capital)&&+capital>0?+capital:entryCapitalUsd(d);
    const p=pctText(usd,cap);
    return `${n>=0?'+':'−'}${Math.abs(n).toFixed(q==='USDC'?2:4)} ${q} (${usd<0?'−':''}${money(Math.abs(usd))}${p?' ('+p+')':''})`;
  }
  function quotePnlHtml(d,capital){
    if(!numeric(d?.pnlQuote)||!numeric(d?.pnlQuoteUsd))return esc(quotePnlText(d,capital));
    const q=d.quoteSymbol||'SOL',n=+d.pnlQuote,usd=+d.pnlQuoteUsd;
    const cap=numeric(capital)&&+capital>0?+capital:entryCapitalUsd(d);
    const p=pctText(usd,cap);
    const head=`${n>=0?'+':'−'}${Math.abs(n).toFixed(q==='USDC'?2:4)} ${q}`;
    const usdPart=`(${usd<0?'−':''}${money(Math.abs(usd))}${p?' ('+p+')':''})`;
    return esc(head)+'<small class="pnl-usd"> '+esc(usdPart)+'</small>';
  }
  function solChangeText(d){return numeric(d?.solPriceChangePct)?`SOL sejak entry: ${money(d.displaySolUsdEntry)} → ${money(d.displaySolUsd)} (${d.solPriceChangePct>=0?'+':''}${(+d.solPriceChangePct).toFixed(2)}%)`:'';}
  let lastPayload = null, closedRows = [], statusBusy = false, lastSuccessAt = 0;
  let lpAgentUrl = 'https://app.lpagent.io/portfolio';
  const validCA = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  function ago(at) {
    const ms = Date.parse(at); if (!Number.isFinite(ms)) return '—';
    const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    return m < 60 ? `${m}m lalu` : `${Math.floor(m/60)}j ${m%60}m lalu`;
  }
  function wib(at) {
    if (!at || !Number.isFinite(Date.parse(at))) return '—';
    return new Date(at).toLocaleString('id-ID', {timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) + ' WIB';
  }
  // Display-only: why the USDC exit PnL (Unrealized) differs from the LP net quote PnL on SOL-quoted pools.
  function pnlGapNote(pos,live){
    if((pos.capitalAsset||'USDC')!=='USDC'||(live.quoteSymbol||pos.quoteSymbol)!=='SOL'||![live.pnlUsd,live.pnlQuoteUsd,live.entryQuoteAmount,live.displaySolUsdEntry,live.displaySolUsd].every(numeric))return '';
    const solFx=+live.entryQuoteAmount*(+live.displaySolUsd-+live.displaySolUsdEntry),rest=+live.pnlUsd-+live.pnlQuoteUsd-solFx,pct=(+live.displaySolUsd/+live.displaySolUsdEntry-1)*100;
    return `<p class="meta">Beda PnL USDC vs PnL quote ${esc(signed(+live.pnlUsd-+live.pnlQuoteUsd))}: efek harga SOL $${(+live.displaySolUsdEntry).toFixed(2)}→$${(+live.displaySolUsd).toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(2)}%) ${esc(signed(solFx))} · sisa (basis entry/reposisi, estimasi swap keluar ke USDC) ${esc(signed(rest))}</p>`;
  }
  // The live bot writes paper/screening.json (full rows + reasons) and, a few ms LATER, status.lastScan (counts only). Prefer the screening file
  // for the same scan (within 2 min) so the skipped tokens with their failed filters are listed; lastScan only when it is clearly newer.
  function pickScan(st,summary){const old=(st.status||{}).lastScan||(summary||st.summary||{}).lastScan||{},sc=st.screening;if(!sc)return old;
    const a=Date.parse(sc.at),b=Date.parse(old.at||0);return !Number.isFinite(b)||!Number.isFinite(a)||a>=b-120000?sc:old;}
  function tile(k,v,cls='') {return `<div class="tile"><div class="k">${esc(k)}</div><strong class="${cls}">${esc(v)}</strong></div>`;}
  function tile2(k,v,sub,cls=''){return `<div class="tile"><div class="k">${esc(k)}</div><strong class="${cls}">${esc(v)}</strong>${sub?`<small class="tile-sub">${esc(sub)}</small>`:''}</div>`;}
  // Real token logo served by our own server (/logo/<mint>: Jupiter / DexScreener image, cached), the Warlock W when none is known.
  function tokLogo(mint,cls='tok-logo'){return `<img class="${cls}" src="${mint?'/logo/'+encodeURIComponent(mint):'/logo.svg?v=1'}" alt="" loading="lazy" decoding="async">`;}
  const nameMint=new Map();
  function rememberMint(name,mint){if(name&&mint)nameMint.set(String(name),String(mint));}
  function mintInText(t){let best=null;for(const [n,m] of nameMint)if(String(t||'').includes(n)&&(!best||n.length>best[0].length))best=[n,m];return best?best[1]:null;}
  function tokAmt(n){n=+n||0;return n>=1000?n.toFixed(0):n>=1?n.toFixed(2):n>0?n.toPrecision(3):'0';}
  // Meteora-style tiles (display only; the bot's exit PnL rule is shown in the footer and is unchanged).
  function meteoraTiles(pos,m){
    const sym=String(pos.name||'TOKEN').split('-')[0],sg=(n,d)=>(n>=0?'+':'−')+Math.abs(n).toFixed(d);
    const un=m.unclaimed,cl=m.claimed,wait='menunggu data on-chain';
    const px=numeric(m.depositUsd)&&+m.depositSol>0?+m.depositUsd/+m.depositSol:0;
    if(pos.capitalAsset==='SOL'&&px>0){   // modal SOL: SOL utama, USD kecil (aturan operator)
      const sol=u=>(+u/px).toFixed(6)+' SOL';
      return tile2('Liquidity · Meteora',(m.liquidity.usd/px).toFixed(4)+' SOL',`≈ ${money(m.liquidity.usd)} · ${m.liquidity.sol.toFixed(4)} SOL + ${tokAmt(m.liquidity.token)} ${sym}`)
        +tile2('Modal (deposit)',m.depositSol.toFixed(4)+' SOL','≈ '+money(m.depositUsd)+' harga SOL sekarang')
        +(m.pnl?tile2('PnL · Meteora',`${sg(m.pnl.sol,6)} SOL (${sg(m.pnl.pct??0,2)}%)`,'≈ '+signed(m.pnl.usd),pnlClass(m.pnl.sol)):tile2('PnL · Meteora','—',wait))
        +(m.feesEarned?tile2('Fees earned',m.feesEarned.solEq.toFixed(6)+' SOL',`≈ ${money(m.feesEarned.usd)} · unclaimed + claimed`):tile2('Fees earned','—',wait))
        +(un?tile2('Fees unclaimed',sol(un.usd),`≈ ${money(un.usd)} · ${tokAmt(un.token)} ${sym} + ${un.sol.toFixed(7)} SOL`):tile2('Fees unclaimed','—',wait))
        +tile2('Fees claimed',sol(cl.usd),`≈ ${money(cl.usd)} · compound ${cl.compound.sol.toFixed(6)} SOL + ${tokAmt(cl.compound.token)} ${sym} · di wallet ${cl.wallet.sol.toFixed(6)} SOL`);
    }
    return tile2('Liquidity · Meteora',money(m.liquidity.usd),`${m.liquidity.sol.toFixed(4)} SOL + ${tokAmt(m.liquidity.token)} ${sym}`)
      +tile2('Modal (deposit)',m.depositSol.toFixed(4)+' SOL',numeric(m.depositUsd)?'≈ '+money(m.depositUsd)+' harga SOL sekarang':'')
      +(m.pnl?tile2('PnL · Meteora',`${signed(m.pnl.usd)} (${sg(m.pnl.pct??0,2)}%)`,sg(m.pnl.sol,6)+' SOL',pnlClass(m.pnl.sol)):tile2('PnL · Meteora','—',wait))
      +(m.feesEarned?tile2('Fees earned',money(m.feesEarned.usd),`unclaimed + claimed · ${m.feesEarned.solEq.toFixed(6)} SOL`):tile2('Fees earned','—',wait))
      +(un?tile2('Fees unclaimed',money(un.usd),`${tokAmt(un.token)} ${sym} + ${un.sol.toFixed(7)} SOL`):tile2('Fees unclaimed','—',wait))
      +tile2('Fees claimed',money(cl.usd),`compound ${money(cl.compound.usd)} (${tokAmt(cl.compound.token)} ${sym} + ${cl.compound.sol.toFixed(6)} SOL) · di wallet ${money(cl.wallet.usd)} (${cl.wallet.sol.toFixed(6)} SOL)`);
  }
  function meteoraNote(m){if(!m)return '';return `Liquidity/fees/PnL = definisi Meteora dari akun posisi on-chain${m.source==='onchain'?' (snapshot '+wib(m.at)+')':' (menunggu baca on-chain, sementara dari snapshot bot)'}: PnL = liquidity + fees unclaimed + fees claimed di wallet − modal; fees compound sudah di dalam liquidity.${m.walletTokenOutside?' Token milik posisi di wallet ('+tokAmt(m.walletTokenOutside.token)+') tidak dihitung Meteora.':''}`;}
  function emergencyTpStatusHtml(pos,settings){
    const risk=Object.assign({},settings||{},(pos&&pos.strategySettings)||{});
    const on=risk.EMERGENCY_TP_ENABLED===true;
    const triggerShare=Number(risk.EMERGENCY_TP_TRIGGER_RANGE_PCT??50);
    const etpPct=Number(risk.EMERGENCY_TP_PCT??10);
    const normalTp=Number(risk.TP_USD_PCT??13);
    const armed=!!(pos&&pos.deepDrawdown===true);
    const range=numeric(pos&&pos.openRangeDownPct)?+pos.openRangeDownPct:(numeric(risk.RANGE_DOWN_PCT)?+risk.RANGE_DOWN_PCT:null);
    const thresh=numeric(pos&&pos.deepDrawdownTriggerPct)?+pos.deepDrawdownTriggerPct:(numeric(range)&&Number.isFinite(triggerShare)?range*triggerShare/100:null);
    const drop=numeric(pos&&(pos.maxPriceDropPct??pos.deepDrawdownDropPct))?+(pos.maxPriceDropPct??pos.deepDrawdownDropPct):null;
    const at=pos&&pos.deepDrawdownAt?wib(pos.deepDrawdownAt):null;
    const armLabel=armed?'Sudah ke-trigger':'Belum ke-trigger';
    const armCls=armed?'caution':'';
    let detail;
    if(armed&&on){
      detail='Harga token sempat turun '+(prettyPct(drop)||'—')+'% dari harga entry (ambang '+(prettyPct(thresh)||'—')+'%'+(prettyPct(range)&&prettyPct(triggerShare)?', yaitu '+prettyPct(triggerShare)+'% dari range bawah saat buka ('+prettyPct(range)+'%)':'')+').'+(at?' Tercatat '+at+'.':'')+' Target take profit posisi ini sekarang +'+(prettyPct(etpPct)||'—')+'%, bukan TP normal +'+(prettyPct(normalTp)||'—')+'%.';
    }else if(armed&&!on){
      detail='Penurunan dalam sudah tercatat'+(prettyPct(drop)?' (turun '+prettyPct(drop)+'% dari harga entry)':'')+', tetapi aturan ini sedang mati. Target tetap TP normal +'+(prettyPct(normalTp)||'—')+'%.';
    }else if(!armed&&on&&drop!=null&&thresh!=null){
      detail='Turun terdalam '+prettyPct(drop)+'% dari harga entry. Belum mencapai ambang '+(prettyPct(thresh)||'—')+'%'+(prettyPct(range)&&prettyPct(triggerShare)?' ('+prettyPct(triggerShare)+'% dari range bawah saat buka)':'')+'.';
    }else if(!armed&&on){
      detail='Belum ke-trigger. Data penurunan harga belum tersedia.';
    }else{
      detail='Aturan ini sedang mati. Target tetap TP normal +'+(prettyPct(normalTp)||'—')+'%.';
    }
    return `<div class="tp-emergency"><div class="range-line"><span>TP emergency: <b class="${on?'positive':'negative'}">${on?'ON':'OFF'}</b></span><span class="${armCls}">${esc(armLabel)}</span></div><p class="meta">${esc(detail)}</p></div>`;
  }

  function emergencySlPlusStatusHtml(pos,settings){
    const risk=Object.assign({},settings||{},(pos&&pos.strategySettings)||{});
    const on=risk.EMERGENCY_SLPLUS_ENABLED===true;
    const arm=Number(risk.EMERGENCY_SLPLUS_ARM_PCT??7),lock=Number(risk.EMERGENCY_SLPLUS_LOCK_PCT??5),n=Number(risk.EMERGENCY_SLPLUS_CONFIRM_POLLS??3);
    const v1=!!(pos&&pos.deepDrawdown===true),armed=!!(pos&&pos.slPlusArmed===true);
    const peak=numeric(pos&&pos.slPlusPeakPct)?+pos.slPlusPeakPct:null,lows=+(pos&&pos.slPlusLowPolls)||0;
    const at=pos&&pos.slPlusArmedAt?wib(pos.slPlusArmedAt):null;
    let label,cls='',detail;
    if(!on){label='OFF';detail='Aturan ini sedang mati.';}
    else if(armed){label='SL+ aktif';cls='caution';detail='PnL pernah menyentuh +'+arm+'%'+(peak!=null?' (puncak +'+peak.toFixed(2)+'%)':'')+(at?' · tercatat '+at:'')+'. Posisi ditutup bila PnL ≤ +'+lock+'% selama '+n+' poll berturut-turut'+(lows>0?' (sekarang '+lows+'/'+n+')':'')+'.';}
    else if(v1){label='Menunggu profit';detail='TP emergency sudah aktif. SL+ aktif begitu PnL menyentuh +'+arm+'%, lalu menutup posisi bila PnL ≤ +'+lock+'% selama '+n+' poll berturut-turut.';}
    else{label='Menunggu TP emergency';detail='SL+ baru bisa aktif setelah TP emergency ke-trigger dan PnL menyentuh +'+arm+'%.';}
    {const fl=risk.EMERGENCY_SLPLUS_FLOOR_PCT,fn=Number(risk.EMERGENCY_SLPLUS_FLOOR_POLLS??2);if(on&&fl!==undefined&&fl!==null&&Number.isFinite(+fl)&&+fl<lock)detail+=' Pelindung BEP: langsung tutup bila PnL ≤ '+(+fl===0?'BEP (0%)':'+'+(+fl)+'%')+(fn>1?' selama '+fn+' poll':'')+'.';}
    return `<div class="tp-emergency"><div class="range-line"><span>TP Emergency SL+: <b class="${on?'positive':'negative'}">${on?'ON':'OFF'}</b></span><span class="${cls}">${esc(label)}</span></div><p class="meta">${esc(detail)}</p></div>`;
  }

  function links(pool,mint,extra=false) {
    return `<div class="pool-actions"><button type="button" class="btn copy" data-copy="${esc(validCA(pool)?pool:'')}" ${validCA(pool)?'':'disabled'}>▣ Salin CA</button><button type="button" class="btn chart-link" data-mint="${esc(validCA(mint)?mint:'')}" ${validCA(mint)?'':'disabled title="Mint belum tersedia"'}>Chart ↗</button>${extra && validCA(pool) ? `<a class="small-link" href="https://app.meteora.ag/dlmm/${esc(pool)}" target="_blank" rel="noopener noreferrer">Meteora ↗</a><a class="small-link" href="${esc(lpAgentUrl)}" target="_blank" rel="noopener noreferrer">LP Agent ↗</a>` : ''}</div>`;
  }
  // Real shape from the position's own deposit legs (live: state.json spotSol/bidaskSol); M = reshaped right side.
  function shapeLabel(pos, model, quoteName) {
    const sp = Number(pos.spotSol ?? pos.spotQuote), ba = Number(pos.bidaskSol ?? pos.bidaskQuote), m = model?.isM || /^M-/.test(String(pos.shape || ''));
    let base = sp > 0 && ba > 0 ? 'Spot + Bid-Ask' : sp > 0 ? 'Spot' : ba > 0 ? 'Bid-Ask' : null;
    if (!base) base = pos.shape === 'spot-two-sided' ? 'Spot + Bid-Ask · dua sisi' : pos.shape === 'left-50-50' ? 'Spot + Bid-Ask · sisi ' + quoteName : (model?.shape || 'Spot');
    return base + (m ? ' · M (reshape)' : '');
  }
  function compactUsd(n) { if (!numeric(n)) return 'n/a'; const a = Math.abs(+n); return '$' + (a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : (+n).toFixed(0)); }
  function mcapInfo(pos) {
    const m = pos?.mcap; if (!m || !m.ok) return 'Mcap now: mcap n/a · OOR kiri: mcap n/a · OOR kanan: mcap n/a';
    return `Mcap now: ${compactUsd(m.nowUsd)} · OOR kiri: mcap ${compactUsd(m.lowerUsd)} · OOR kanan: mcap ${compactUsd(m.upperUsd)}`;
  }
  function binChart(pos) {
    const model = pos.binShape;
    if (!model || !Array.isArray(model.bins) || !model.bins.length) return '<div class="empty">Menunggu snapshot distribusi bin…</div>';
    // One bar per bin across the WHOLE position range (bins with nothing in them stay as empty slots), like Meteora's liquidity chart.
    let bins = model.bins.slice(0, 2048); const active = model.activeBin;
    const lo = Number(pos.minBinId), hi = Number(pos.maxBinId);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo && hi - lo < 2048) { const by = new Map(bins.map(b => [Number(b.id), b])); bins = []; for (let id = lo; id <= hi; id++) bins.push(by.get(id) || { id, sol: 0, token: 0 }); }
    const price = numeric(pos.lastPrice) ? +pos.lastPrice : +pos.entryPrice || 1;
    const quoteName = pos.quoteSymbol || 'SOL';
    // Both sides use quote-equivalent values. Up to 400 bins: one bar each; only wider ranges are grouped.
    const k = Math.max(1, Math.ceil(bins.length / 400)), values = [];
    for (let i = 0; i < bins.length; i += k) {
      const g = bins.slice(i, i + k);
      values.push({ id: g[Math.floor(g.length / 2)].id, first: g[0].id, last: g[g.length - 1].id, token: g.reduce((a, x) => a + (+x.token || 0) * price, 0), sol: g.reduce((a, x) => a + (+x.sol || 0), 0), n: g.length });
    }
    const max = Math.max(1e-12, ...values.map(b => b.token + b.sol));
    const solSum = values.reduce((a, b) => a + b.sol, 0), tokSum = values.reduce((a, b) => a + b.token, 0), all = Math.max(1e-12, solSum + tokSum);
    const W = 380, H = 150, L = 10, R = 10, T = 32, B = 28, ch = H - T - B, n = values.length, step = (W - L - R) / n, gap = step >= 6 ? Math.min(3, step * .14) : step * .18, bw = Math.max(.6, step - gap), base = H - B, r = step >= 6 ? Math.min(4, bw / 2) : Math.min(1, bw / 2);
    const mc = pos.mcap && pos.mcap.ok ? pos.mcap : null, stepF = 1 + (Number(pos.binStep) || 0) / 1e4;
    const binMcap = (id) => mc && numeric(mc.lowerUsd) && Number.isFinite(lo) && stepF > 1 ? mc.lowerUsd * Math.pow(stepF, id - lo) : null;
    const mcapNow = mc ? compactUsd(mc.nowUsd) : 'n/a', mcapRange = mc ? `MCAP ${compactUsd(mc.lowerUsd)} – ${compactUsd(mc.upperUsd)}` : 'MCAP n/a';
    const idx = values.findIndex(b => active != null && active >= b.first && active <= b.last);
    let oor = null;
    if (active != null && idx < 0 && values.length) {
      if (active < values[0].first) oor = { side: "kiri", n: values[0].first - active, ax: L };
      else if (active > values[values.length - 1].last) oor = { side: "kanan", n: active - values[values.length - 1].last, ax: W - R };
    }
    const ax = idx >= 0 ? L + (idx + .5) * step : (oor ? oor.ax : null);
    const oorLabel = oor ? "OOR " + oor.side + " +" + oor.n + " bin" : null;
    let bars = '';
    values.forEach((b, i) => {
      const x = L + i * step + gap / 2, sh = b.sol / max * ch, th = b.token / max * ch;
      const bm = binMcap(b.id), tip = `<title>${bm != null ? 'mcap ≈ ' + compactUsd(bm) + ' · ' : ''}${esc(quoteName)} ${b.sol.toFixed(4)} · token ≈ ${b.token.toFixed(4)} ${esc(quoteName)}</title>`;
      const cls = 'bin-bar' + (i === idx ? ' on' : ''), delay = `style="animation-delay:${Math.min(i * 12, 500)}ms"`;
      // Fixed structure (one group, two rects per bar, zero height when empty) so a poll only patches y/height in place.
      const s0 = sh > .3 ? sh : 0, t0 = th > .3 ? th : 0;
      bars += `<g>${tip}<rect class="${cls}" ${delay} x="${x.toFixed(2)}" y="${(base - s0).toFixed(2)}" width="${bw.toFixed(2)}" height="${s0.toFixed(2)}" rx="${t0 ? 0 : r}" fill="url(#bnSol)"/><rect class="${cls}" ${delay} x="${x.toFixed(2)}" y="${(base - s0 - t0).toFixed(2)}" width="${bw.toFixed(2)}" height="${t0.toFixed(2)}" rx="${r}" fill="url(#bnTok)"/></g>`;
    });
    // no lines: the active bin is a soft glowing band plus a marker and a chip
    const chipX = ax != null ? Math.min(W - R - 50, Math.max(L + 50, ax)) : 0;
    const glowBand = ax != null && !oor ? `<rect x="${(ax - step * .9).toFixed(1)}" y="${T - 2}" width="${(step * 1.8).toFixed(1)}" height="${ch + 2}" rx="${(step * .6).toFixed(1)}" fill="url(#bnBand)"/>` : '';
    const marker = ax != null ? `<polygon points="${(ax - 5).toFixed(1)},${T - 12} ${(ax + 5).toFixed(1)},${T - 12} ${ax.toFixed(1)},${T - 3}" fill="#f0edf8" filter="url(#bnGlow)"/><rect x="${(chipX - 50).toFixed(1)}" y="5" width="100" height="16" rx="8" fill="#241a3d" stroke="#8b5cf655"/><text x="${chipX.toFixed(1)}" y="16.5" text-anchor="middle" font-size="9.5" fill="#e9d5ff" font-weight="700">${oor ? esc(oorLabel) : "MCAP NOW " + esc(mcapNow)}</text>` : '';
    const pct = v => Math.round(v / all * 100);
    const legend = `<g font-size="9.5" fill="#a29db5"><circle cx="${L + 4}" cy="${H - 10}" r="3.5" fill="#2dd4bf"/><text x="${L + 12}" y="${H - 6.5}">${esc(quoteName)} ${pct(solSum)}%</text><circle cx="${L + 82}" cy="${H - 10}" r="3.5" fill="#8b5cf6"/><text x="${L + 90}" y="${H - 6.5}">TOKEN ${pct(tokSum)}%</text><text x="${W - R}" y="${H - 6.5}" text-anchor="end">${esc(mcapRange)}</text></g>`;
    const defs = '<defs><linearGradient id="bnSol" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0f766e"/><stop offset=".55" stop-color="#14b8a6"/><stop offset="1" stop-color="#5eead4"/></linearGradient><linearGradient id="bnTok" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5b21b6"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ddd6fe"/></linearGradient><linearGradient id="bnBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9d5ff" stop-opacity=".30"/><stop offset="1" stop-color="#e9d5ff" stop-opacity="0"/></linearGradient><linearGradient id="bnPanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1330"/><stop offset="1" stop-color="#0d0d14"/></linearGradient><filter id="bnGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    const shape = shapeLabel(pos, model, quoteName) + ` · ${values.length} bar${k > 1 ? ' (' + k + ' bin/bar)' : ''}`;
    const reshapeInfo = `Reshape ${Number(pos.reshapes) || 0}x`;   // how many times this position has been reshaped
    return `<div class="shape-head"><span>${esc(shape)} · <b class="reshape-count">${esc(reshapeInfo)}</b></span><span class="mono">Mcap now ${esc(mcapNow)}</span></div><svg class="bin-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribusi likuiditas per bin, ekuivalen ${esc(quoteName)}">${defs}<rect width="${W}" height="${H}" rx="12" fill="url(#bnPanel)" stroke="#8b5cf633"/>${glowBand}${bars}${marker}${legend}</svg>`;
  }
  function entryHistoryRows(r){
    const c=r.openContext||{},s=c.snapshot||{},v=(n,d=2)=>numeric(n)?(+n).toFixed(d):'tidak diketahui';
    const rows=[['Sumber buka',c.source||'tidak diketahui'],['Alasan buka',c.reason||'tidak diketahui'],['Buka',wib(r.openedAt)],['Strategi entry',s.strategy||'tidak diketahui'],['Fee/TVL 30m saat entry',v(s.ft30mPct)+' %'],['TVL saat entry',numeric(s.tvlUsd)?money(s.tvlUsd):'tidak diketahui'],['Umur pool saat entry',v(s.ageH,1)+' jam'],['Bin step entry',v(s.binStep,0)],['MC saat entry',numeric(s.marketCapUsd)?money(s.marketCapUsd):'tidak diketahui'],['Insider/cluster saat entry',numeric(s.insiderPct)?v(s.insiderPct,1)+' % supply':'tidak diketahui'],['Volume 1 jam saat entry',numeric(s.vol1hUsd)?money(s.vol1hUsd):'tidak diketahui'],['Volume 24 jam saat entry',numeric(s.vol24hUsd)?money(s.vol24hUsd):'tidak diketahui'],['Harga 1 jam sebelum entry',numeric(s.pump1hPct)?(s.pump1hPct<0?'dump ':'pump +')+v(s.pump1hPct,1)+' %':'tidak diketahui'],['Harga 24 jam sebelum entry',numeric(s.pump24hPct)?(s.pump24hPct<0?'dump ':'pump +')+v(s.pump24hPct,1)+' %':'tidak diketahui'],['Quote entry',s.quote||'tidak diketahui'],['Filter saat entry',s.passedAllFilters===true?'Lolos semua':s.passedAllFilters===false?'⚠ Tidak lolos':'tidak diketahui'],['Filter gagal',s.failedFilters==null?'tidak diketahui':s.failedFilters.length?s.failedFilters.join('; '):'Tidak ada'],['Waktu screening',s.screenedAt?wib(s.screenedAt):'tidak diketahui'],['Bukti / presisi snapshot',s.evidence||'tidak diketahui'],['Presisi data',s.precision||'tidak diketahui']];
    rows.push(['Non-refundable saat entry',s.entryCostEstimate?.known?s.entryCostEstimate.nonrefTotalSol.toFixed(6)+' SOL · '+s.entryCostEstimate.newBinArrays+' bin array baru':'tidak diketahui']);
    rows.push(['Aset modal saat entry',r.capitalAsset||s.capitalAsset||'USDC']);if(r.capitalAsset==='SOL')rows.push(['Modal awal SOL',r.capitalInSol??s.capitalInSol??'—'],['PnL modal SOL',numeric(r.pnlCapital)?(+r.pnlCapital>=0?'+':'−')+Math.abs(+r.pnlCapital).toFixed(6)+' SOL':'—']);
    if(r.currentLegOpenContext)rows.push(['Leg terakhir',r.currentLegOpenContext.source+' · '+wib(r.currentLegOpenContext.at)]);
    if(r.correction){const x=r.correction;rows.push(['Koreksi',x.id+' · '+wib(x.at)],['PnL quote ASLI (sebelum koreksi)',quotePnlText({...x.original,quoteSymbol:r.quoteSymbol},entryCapitalUsd(r))],['PnL exit USDC ASLI',signedWithPct(x.original.pnlUsd,entryCapitalUsd(r))],['Cash USDC dikembalikan',signed(x.cashDeltaUsdc)],['Metode koreksi',x.method]);}
    return rows;
  }
  function closeTag(r){const x=String(r.reason||'');let m;
    if(x.startsWith('emergency_stop')){m=x.match(/SL -(\d+(?:\.\d+)?)%/);return {t:'SL',c:'#ef4444',l:'Stop Loss '+(m?'-'+m[1]+'%':'(emergency)')};}
    if(x.startsWith('emergency_slplus')){m=x.match(/^emergency_slplus \S+ (BEP|\+-?\d+(?:\.\d+)?%)/);return {t:'TP EMERGENCY SL+',c:'#f59e0b',l:'TP Emergency SL+'+(m?' '+m[1]:'')};}
    if(x.startsWith('emergency_tp')){m=x.match(/\+(\d+(?:\.\d+)?)%/);return {t:'TP EMERGENCY',c:'#f59e0b',l:'TP Emergency'+(m?' +'+m[1]+'%':'')};}
    if(/^TP (USDC|SOL)/.test(x)){m=x.match(/\+(\d+(?:\.\d+)?)%/);return {t:'TP',c:'#22c55e',l:'Take Profit'+(m?' +'+m[1]+'%':'')};}
    if(x==='trailing_tp_usdc')return {t:'TRAIL',c:'#22c55e',l:'Trailing Stop'};
    if(x.startsWith('oor_right'))return {t:'OOR',c:'#8b5cf6',l:'OOR kanan'};
    if(x.startsWith('oor_left'))return {t:'OOR',c:'#8b5cf6',l:'OOR kiri timeout'};
    if(x.startsWith('manual'))return {t:'MANUAL',c:'#64748b',l:'Manual'};
    if(x.startsWith('max age')){m=x.match(/^max age ([\d.]+)h(?: \(stale (\w+) ([^)]+)\))?/);return {t:'STALE',c:'#0ea5e9',l:'Stale '+(m?m[1]+'j':'')+(m&&m[2]?' · '+m[2]+' '+m[3]:' · langsung')};}
    return null;}
  function durText(r){const a=Date.parse(r.openedAt),b=Date.parse(r.closedAt);if(!(Number.isFinite(a)&&Number.isFinite(b)&&b>=a))return r.hold||'—';const m=Math.round((b-a)/60000),h=Math.floor(m/60);return h?h+'j '+(m%60)+'m':m+'m';}
  function formatLiveAge(since,now){const t=Date.parse(since),n=now==null?Date.now():+now;if(!Number.isFinite(t)||!Number.isFinite(n)||n<t)return '';const ms=n-t,hari=Math.floor(ms/864e5);if(hari>=1)return 'Live '+hari+' hari';const jam=Math.floor(ms/36e5);if(jam>=1)return 'Live '+jam+' jam';const menit=Math.floor(ms/6e4);return menit>=1?'Live '+menit+' menit':'Live baru';}
  // LIVE + modal SOL: angka utama SOL, USD kecil abu-abu (aturan operator).
  function isSolRow(r){return r?.displayUnit==='SOL'&&numeric(r?.pnlSol);}
  const solTxt=(n,d=6)=>numeric(n)?(+n>=0?'+':'−')+Math.abs(+n).toFixed(d)+' SOL':'—';
  const pctTxt=n=>numeric(n)?(+n>=0?'+':'−')+Math.abs(+n).toFixed(2)+'%':'—';
  const usdSub=n=>numeric(n)?`<small class="usd-sub">≈ ${esc(signed(n))}</small>`:'';
  function isUsdcCapital(r){return (r?.capitalAsset||'USDC')!=='SOL'&&numeric(r?.pnlUsd);}   // modal utama USDC: hasil utama = net USDC (sudah termasuk swap, gas, rent)
  function closeBadge(r){const g=closeTag(r);return g?`<b style="display:inline-block;background:${g.c};color:#fff;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:800;letter-spacing:.5px;margin-right:6px">${esc(g.t)}</b><b style="color:${g.c}">${esc(g.l)}</b><br>`:'';}
  function isReceh(r){
    const sol=isSolRow(r)||r?.capitalAsset==='SOL',v=sol?(numeric(r?.pnlSol)?+r.pnlSol:+r?.pnlCapital):+r?.pnlUsd;
    const base=sol?(+r?.capitalInSol||0):(+r?.initialUsdcIn||+r?.usdcIn||0),pct=sol?(numeric(r?.pnlSolPct)?+r.pnlSolPct:numeric(r?.pnlCapitalPct)?+r.pnlCapitalPct:base&&Number.isFinite(v)?100*v/base:null):(numeric(r?.pnlPct)?+r.pnlPct:numeric(r?.netPnlPct)?+r.netPnlPct:base&&Number.isFinite(v)?100*v/base:null);
    if(numeric(pct)&&Math.abs(+pct)<0.1)return true;
    return Number.isFinite(v)?Math.abs(v)<(sol?0.0001:0.1):false;
  }
  function renderClosed() {
    // "Sembunyiin PnL receh": hides breakeven-class rows (|PnL%| < 0.1% in the capital token, same rule as W/L/BE) and dust; display only, totals unchanged
    const hide=$('hide-dust').checked,rows=closedRows.filter(r=>!hide||!isReceh(r)),hidden=closedRows.length-rows.length;
    patchMarkup($('closed'), rows.length?rows.map(r=>`<button class="card closed-row" data-trade="${closedRows.indexOf(r)}"><span><strong>${tokLogo(r.mintX||mintInText(r.name),'tok-logo sm')}${esc(r.name||'Pool')}</strong><small>${closeBadge(r)}${esc(wib(r.closedAt))} · ⏱ ${esc(durText(r))} · ${esc(r.closeReasonText||r.reason||'closed')}</small><small>${esc(r.openContext?.source||'tidak diketahui')} · ${esc(r.openContext?.reason||'Alasan buka tidak diketahui')}${r.corrected||r.correctedAt?' · DIKOREKSI (data asli disimpan)':''}</small></span>${isSolRow(r)?`<span class="mono ${pnlClass(r.pnlSol)}">${esc(solTxt(r.pnlSol)+' ('+pctTxt(r.pnlSolPct)+')')}${usdSub(r.pnlSolUsd)}<small>Lihat detail ↗</small></span>`:`<span class="mono ${isUsdcCapital(r)?pnlClass(r.pnlUsd):(numeric(r.pnlQuote)&&numeric(r.pnlQuoteUsd)?pnlClass(r.pnlQuoteUsd):pnlClass(r.pnlUsd))}">${isUsdcCapital(r)?esc(signedWithPct(r.pnlUsd,entryCapitalUsd(r))+' USDC'):(numeric(r.pnlQuote)?quotePnlHtml(r,entryCapitalUsd(r)):esc(signedWithPct(r.pnlUsd,entryCapitalUsd(r))+' USDC (riwayat lama)'))}<small>Lihat detail ↗</small></span>`}</button>`).join(''):(hidden?`<div class="card empty">Semua ${hidden} trade disembunyikan (PnL receh &lt; 0.1%).</div>`:'<div class="card empty">Belum ada posisi ditutup dalam 24 jam.</div>'));
    const hn=$('hide-dust-n');if(hn)hn.textContent=hide&&hidden?` · ${hidden} disembunyikan`:'';
  }
  function portfolioPnl(entries,stats){
    const sum=xs=>xs.every(numeric)?xs.reduce((n,v)=>n+Number(v),0):null;
    const values=entries.map(e=>{const p=e.position||{},v=e.live||p.lastLive||{};return v.pnlUsd??p.lastPnlUsd;});
    const native=entries.map((e,i)=>{const p=e.position||{},v=e.live||p.lastLive||{},px=p.lastSolUsd||stats.solUsd||p.solUsdEntry;
      return p.capitalAsset==='SOL'&&numeric(v.pnlCapital)?+v.pnlCapital:numeric(values[i])&&px>0?+values[i]/px:null;});
    return {unrealizedUsd:sum(values),unrealizedSol:sum(native),realizedUsd:stats.totalNetPnlAllUsd??stats.totalNetPnlUsd??(stats.trades===0?0:null),realizedSol:stats.totalNetPnlSol??(stats.trades===0?0:null)};
  }
  // LIVE "Open sekarang": confirm (extra warning + extra confirm when the bot skipped this token), then QUEUE for the live bot, which re-screens
  // (hard filters always apply) and opens through its normal open path. The Mini App never signs.
  // Manual LIVE close (same path as Grok's manual open): queue a request, the live bot closes through its normal exit executor.
  async function liveManualClose(b,pool){
    const st=lastPayload?.status||{},open=st.positions_open||{},entries=open.positions||(open.position?[{position:open.position,live:open.live}]:[]);
    const e=entries.find(x=>x.position?.pool===pool),pos=e?.position,live=e?.live||{},name=pos?.name||pool.slice(0,6)+'…';
    if(!st.liveManual?.closeSupported){showBanner('Tutup manual LIVE belum aktif di bot live yang sedang jalan: perlu restart sol-lp-live. Belum ada yang dikirim.',true);return;}
    if(!pos){showBanner('Posisi ini sudah tidak terbuka.',true);return;}
    if((st.liveManual.pending||[]).some(x=>x.type==='close'&&x.pool===pool)){showBanner('Permintaan tutup posisi ini sudah antre; tunggu bot live memprosesnya.',true);return;}
    const ask=m=>askConfirm(m.length>250?m.slice(0,249)+'…':m),pp=numeric(live.pnlPct)?' PnL sekarang '+(+live.pnlPct).toFixed(2)+'%.':'';
    state.actionBusy=true;b.disabled=true;
    try{
      if(!await ask(`Tutup posisi LIVE ${name} sekarang?${pp} Likuiditas ditarik dan token dijual ke SOL. Biaya swap/gas berlaku.`))return;
      if(!await ask('Konfirmasi kedua: kirim ke bot live. Bot menutup lewat jalur close yang sama dengan exit otomatis; hasil tampil di aktivitas dan Telegram.'))return;
      const {status,json}=await api('POST','/api/live/close',{pool,openedAt:b.dataset.opened,confirmed:true,confirmedTwice:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Tutup live ditolak');
      showBanner(`Tutup LIVE ${name} antre. Bot live memproses di poll berikutnya (±10 detik); hasil tampil di aktivitas dan Telegram.`);await statusPoll();
    }catch(err){showBanner(err.message,true);}finally{state.actionBusy=false;if(b.isConnected)b.disabled=false;}
  }
  async function liveManualOpen(b,pool){
    const st=lastPayload?.status||{},open=st.positions_open||{},entries=open.positions||[],max=lastPayload?.values?.MAX_POSITIONS??5;
    const scan=pickScan(st),c=(scan.display||scan.near||scan.candidates||[]).find(x=>x.address===pool)||{},name=c.name||pool.slice(0,6)+'…';
    if(!st.liveManual?.supported){showBanner('Open manual LIVE belum aktif di bot live yang sedang jalan: perlu restart sol-lp-live (versi baru sudah disiapkan). Belum ada yang dikirim.',true);return;}
    if(entries.some(x=>x.position?.pool===pool)){showBanner('Pool ini sudah dibuka.',true);return;}
    if(entries.length>=max){showBanner(`Slot penuh (${entries.length}/${max}). Di LIVE tidak ada ganti posisi otomatis: tutup satu posisi dahulu, lalu tekan Open lagi.`,true);return;}
    if((st.liveManual.pending||[]).some(x=>x.pool===pool)){showBanner('Permintaan open pool ini sudah antre; tunggu bot live memprosesnya.',true);return;}
    const failed=c.status!=='passed',reasons=c.reasons||['belum diperiksa penuh'],budget=lastPayload?.values?.POSITION_SOL_OPEN;
    const ask=m=>askConfirm(m.length>250?m.slice(0,249)+'…':m);   // Telegram popups allow max 256 characters
    state.actionBusy=true;b.disabled=true;
    try{
      if(failed){
        if(!await ask(`⚠ LIVE (uang asli): ${name} DISKIP bot. Filter wajib (TVL, quote, RugCheck, mint, insider, holder) tetap dicek. Filter gagal: ${reasons.join('; ')}`))return;
        if(!await ask(`Konfirmasi tambahan: saya paham ${name} gagal filter di atas dan tetap mau open LIVE.`))return;
      }
      if(!await ask(`Open posisi LIVE ${name} sekarang?${numeric(budget)?' Budget '+budget+' SOL,':''} shape/range sesuai setting sekarang. Biaya rent/gas berlaku.`))return;
      if(!await ask('Konfirmasi kedua: kirim ke bot live. Bot re-screen pool lalu open lewat jalur open yang sama dengan auto-open; hasil tampil di aktivitas dan Telegram.'))return;
      const {status,json}=await api('POST','/api/live/open',{pool,overrideFailedFilters:failed,overrideConfirmed:failed,confirmed:true,confirmedTwice:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Open live ditolak');
      showBanner(`Open LIVE ${name} antre. Bot live memproses di siklus berikutnya (±10 detik); hasil tampil di aktivitas.`);await statusPoll();
    }catch(err){showBanner(err.message,true);}finally{state.actionBusy=false;if(b.isConnected)b.disabled=false;}
  }
  function setPositionView(view){
    const names=['open','history','screening','activity'];if(!names.includes(view))return;
    for(const name of names)$(name+'-view')?.classList.toggle('hidden',name!==view);
    document.querySelectorAll('[data-position-view]').forEach(b=>{const active=b.dataset.positionView===view;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
  }
  function costBypass(c,values){
    if(c.entryCostEstimate?.skipCheck)return c.entryCostEstimate.skipReason;
    const step=Number(c.binStep),down=Number(values?.RANGE_DOWN_PCT??50),upper=Number(values?.RANGE_UP_PCT)>0?Math.ceil(Math.log(1+values.RANGE_UP_PCT/100)/Math.log(1+step/1e4)):Number(values?.UPPER_BUFFER_BINS??0);
    if(!(step>0&&down>0&&down<100))return '';
    const n=Math.min(1399-upper,Number(values?.LOWER_BINS)>0?Number(values.LOWER_BINS):Math.ceil(Math.log(1/(1-down/100))/Math.log(1+step/1e4))),coverage=100*(1-Math.pow(1+step/1e4,-n));
    return n+upper>=50&&coverage>=49-1e-9?'DILEWATI: ≥50 bin & target range 50% (toleransi 49%); tidak menunggu rent RPC':'';
  }
  // Range + shape like Meteora shows them: bin count, bin ids, bin step, lower/upper price and the % width (live: from the live state.json position).
  function rangeInfo(pos){
    const lo=Number(pos?.minBinId),hi=Number(pos?.maxBinId),step=Number(pos?.binStep);
    if(!Number.isFinite(lo)||!Number.isFinite(hi))return 'Rentang —';
    const n=hi-lo+1;let out=`${n} bin${Number.isFinite(step)&&step>0?' · bin step '+step:''}`;
    if(Number.isFinite(step)&&step>0){const r=1+step/1e4,dec=Number(pos.decX),scale=Number.isFinite(dec)?Math.pow(10,dec-9):null;
      if(scale!=null){const pLo=Math.pow(r,lo)*scale,pHi=Math.pow(r,hi+1)*scale;out+=` · harga ${pLo.toPrecision(4)} – ${pHi.toPrecision(4)} ${pos.quoteSymbol==='USDC'?'USDC':'SOL'}`;}
      out+=` · lebar ${(100*(1-Math.pow(r,-n))).toFixed(1)}% di bawah batas atas`;}
    return out;
  }
  function shapeInfo(pos){
    const q=pos?.quoteSymbol==='USDC'?'USDC':'SOL',d=q==='SOL'?4:2,sp=Number(pos?.spotSol??pos?.spotQuote),ba=Number(pos?.bidaskSol??pos?.bidaskQuote),pl=Number(pos?.depositPlanned);
    if(!Number.isFinite(sp)&&!Number.isFinite(ba))return 'Bentuk: —';
    const miss=Number.isFinite(pl)&&Number.isFinite(sp)&&Number.isFinite(ba)&&pl-(sp+ba)>1e-6?` · belum masuk ${(pl-sp-ba).toFixed(d)} ${q}`:'';
    return `Bentuk: Spot ${(sp||0).toFixed(d)} ${q} + Bid-Ask ${(ba||0).toFixed(d)} ${q}${miss}`;
  }
  function renderStatus(payload) {
    lastPayload=payload;
    const link=payload.status?.lpAgentUrl;
    if (typeof link==='string' && /^https:\/\/app\.lpagent\.io\/portfolio(?:\?|$)/.test(link)) lpAgentUrl=link;
    const st=payload.status||{}, summary=st.summary||{}, stats=summary.stats||{}, open=st.positions_open||{};
    const capitalUnit=stats.capitalAsset||'USDC',isSolCapital=capitalUnit==='SOL';
    const entries=open.positions||(open.position?[{position:open.position,live:open.live,leftoverSol:open.leftoverSol}]:[]);
    const maxPositions=payload.values?.MAX_POSITIONS??5,slotCount=entries.length,full=slotCount>=maxPositions;
    const pos=entries[0]?.position,live=entries[0]?.live||{};
    const scan=pickScan(st,summary);
    const px=pos?(pos.lastSolUsd||stats.solUsd||pos.solUsdEntry):null;
    const value=numeric(live.valueUsd)?+live.valueUsd:pos&&numeric(px)?(numeric(live.valueSol)?+live.valueSol:(+pos.inventory?.y||0)+(+pos.inventory?.x||0)*(pos.lastPrice||pos.entryPrice||0))*px:null;
    const capital=pos?(+pos.usdcIn||0):0;
    // Mark includes the refundable rent + unspent buffer to match USDC round-trip accounting.
    const mark=pos && numeric(px) && numeric(value)?value+((+open.leftoverSol||0)+(+pos.rentRefundableSol||0))*px:null;
    const unreal=pos?(numeric(live.pnlUsd)?+live.pnlUsd:numeric(mark)?mark-capital:0):0;
    const total=numeric(stats.equityPnlUsd)?+stats.equityPnlUsd:(+stats.totalNetPnlUsd||0)+(+unreal||0);
    const deposited=stats.totalDepositedUsdc??st.capital?.totalDepositedUsdc??stats.virtualStartUsdc??0;
    const paperAllowed=state.paperAllowed&&payload.capitalEnabled!==false;
    const freeCash=stats.virtualUsdc??open.virtualUsdc??st.capital?.virtualUsdc;
    const valued=entries.every(e=>numeric(e.live?.exitUsdc??e.position.lastLive?.exitUsdc??e.position.lastExitUsdc));
    const equityNow=numeric(stats.equityUsd)?+stats.equityUsd:numeric(freeCash)&&valued?+freeCash+entries.reduce((n,e)=>n+Number(e.live?.exitUsdc??e.position.lastLive?.exitUsdc??e.position.lastExitUsdc),0):null;
    if(st.liveSummary&&st.liveSummary.live){state.liveRunning=true;if(!state.liveWallet&&numeric(st.liveSummary.walletSol))state.liveWallet={sol:+st.liveSummary.walletSol,usdc:0};if(state.liveWallet)window.WarlockLiveWallet=state.liveWallet;}
    {const lv=!!(st.liveSummary&&st.liveSummary.live)||stats.live===true;if(lv)applyModeChrome(true);else if(payload.dashboard&&payload.dashboard.mode&&payload.dashboard.mode.live===false)applyModeChrome(false);}
    // LIVE: equity = the real wallet (SOL + USDC) + open positions at exit value, not the paper book.
    let equityShown=equityNow,equitySolShown=stats.equitySol,liveBreak='';
    window.WarlockLiveEquityUsd=null;
    if(state.liveRunning&&state.liveWallet&&numeric(state.liveWallet.sol)){const sx=numeric(stats.solUsd)&&+stats.solUsd>0?+stats.solUsd:(numeric(px)&&+px>0?+px:null);
      if(sx){const posSol=entries.reduce((n,e)=>n+(Number(e.live?.valueSol)||(Number(e.live?.exitUsdc??e.position.lastLive?.exitUsdc??e.position.lastExitUsdc)||0)/sx)+(Number(e.position?.rentRefundableSol)||0),0),walletSol=+state.liveWallet.sol,usdc=numeric(state.liveWallet.usdc)?+state.liveWallet.usdc:0;
        equitySolShown=walletSol+usdc/sx+posSol;equityShown=equitySolShown*sx;window.WarlockLiveEquityUsd=equityShown;
        liveBreak=`<div class="meta live-break">Total sudah termasuk posisi LP · <b>Di wallet ${walletSol.toFixed(2)} SOL${usdc>0.005?' + '+usdc.toFixed(2)+' USDC':''}</b> · <b>Di posisi ${posSol.toFixed(2)} SOL</b> (${entries.length} posisi)</div>`;}}
    const pnl=portfolioPnl(entries,stats),solPnl=n=>numeric(n)?(+n>=0?'+':'−')+Math.abs(+n).toFixed(6)+' SOL':'—';
    const pnlTile=(label,usd,sol)=>`<div class="pnl-stat"><div class="k">${label}</div><strong class="mono ${pnlClass(usd)}">${esc(signed(usd))}</strong>${isSolCapital?`<small class="${pnlClass(sol)}">${esc(solPnl(sol))}</small>`:''}</div>`;
    setMarkup($('status-body'), `<div class="summary-top"><span class="k">EQUITY SAAT INI</span><span class="mode">${state.liveRunning?'LIVE · N5':'PAPER · N5'}</span></div><div class="hero-value mono">${isSolCapital?Number(equitySolShown??0).toFixed(6):money(equityShown)} <span>${capitalUnit}</span><small class="pnl-usd">${isSolCapital?money(equityShown):Number(equitySolShown??0).toFixed(6)+' SOL'}</small></div>${liveBreak}<div class="pnl-split">${pnlTile(isSolCapital?'Unrealized · posisi open':'Unrealized · posisi open (USDC exit)',pnl.unrealizedUsd,pnl.unrealizedSol)}${pnlTile('Realized · sudah ditutup',pnl.realizedUsd,pnl.realizedSol)}</div><p class="meta pnl-note">Unrealized = estimasi exit seluruh posisi open ke USDC (= jumlah "PnL USDC (exit)" di kartu; PnL quote SOL di kartu tidak memasukkan efek naik/turun harga SOL). Realized = semua history termasuk arsip${stats.archivedCount?' ('+stats.archivedCount+' posisi arsip '+signed(stats.archivedPnlUsd)+')':''}. Equity = modal + realized + unrealized.${isSolCapital?' SOL: net modal SOL; posisi USDC ekuivalen SOL pada harga valuasi/close.':''}</p><div class="summary-grid">${tile('Posisi',slotCount+'/'+maxPositions)}${tile('Saldo bebas',isSolCapital?Number(stats.freeCapitalSol||0).toFixed(6)+' SOL':money(freeCash))}${tile('Nilai semua posisi',money(stats.positionValueUsd??(numeric(equityNow)&&numeric(freeCash)?equityNow-freeCash:null)))}${tile('PnL posisi open (quote → USD)',signed(stats.quotePnlTotals?.usd),pnlClass(stats.quotePnlTotals?.usd))}${tile('PnL equity ('+capitalUnit+')',isSolCapital?(numeric(stats.equityPnlSol)?(+stats.equityPnlSol>=0?'+':'−')+Math.abs(+stats.equityPnlSol).toFixed(6)+' SOL':'—'):signed(total),pnlClass(isSolCapital?stats.equityPnlSol:total))}</div><p class="meta">${Object.entries(stats.quotePnlTotals?.quotes||{}).map(([q,n])=>esc(q+'-pool: '+(+n>=0?'+':'−')+Math.abs(n).toFixed(q==='SOL'?4:2)+' '+q)).join(' · ')}<br>Equity = saldo bebas + nilai seluruh posisi, termasuk buffer/rent yang bisa kembali.<br>PnL quote pool ≠ PnL equity. Aturan exit mengikuti aset modal saat entry, bukan setting terbaru.${isSolCapital?'<br>Basis deposit SOL direbase dari deposit USD saat fitur diaktifkan; bukan harga deposit SOL historis.':''}</p><div class="summary-bottom"><span><b class="${payload.paused?'negative':'positive'}">●</b> ${payload.paused?'Paper dipause':'Dry run berjalan'}</span></div>`);
    if(state.liveRunning&&st.liveSummary&&state.liveWallet&&numeric(state.liveWallet.sol)){
      // LIVE status: every number is the real wallet / real positions, nothing from the dry run book.
      const L=st.liveSummary,sx=+L.solUsd||0,wal=+state.liveWallet.sol,usdc=numeric(state.liveWallet.usdc)?+state.liveWallet.usdc:0,rent=+L.rentRefundableSol||0,openVal=+L.openValueSol||0,posSol=openVal+rent,eqSol=wal+usdc/(sx||1)+posSol;
      const usdOf=n=>sx?money(n*sx):'—',sg=n=>(n>=0?'+':'−')+Math.abs(n).toFixed(2)+' SOL',tl=(k,v,c)=>`<div class="tile"><div class="k">${k}</div><strong class="${c||''}">${v}</strong></div>`;
      const pt=(label,sol,usd)=>`<div class="pnl-stat"><div class="k">${label}</div><strong class="mono ${pnlClass(sol)}">${esc(solTxt(sol,4))}</strong>${usdSub(numeric(usd)?usd:(sx?sol*sx:null))}</div>`;
      const profitSol=numeric(L.totalProfitSol)?+L.totalProfitSol:((+L.openPnlSol||0)+(+L.realizedSol||0));
      const profitBasis=numeric(L.capitalBasisSol)&&+L.capitalBasisSol>1e-9?+L.capitalBasisSol:(eqSol-profitSol);
      const profitPct=numeric(L.totalProfitPct)?+L.totalProfitPct:(profitBasis>1e-9?100*profitSol/profitBasis:null);
      const profitUsd=numeric(L.totalProfitUsd)?+L.totalProfitUsd:(sx?profitSol*sx:null);
      const profitTone=numeric(profitPct)&&Math.abs(profitPct)>=0.005?pnlClass(profitPct):(numeric(profitSol)&&Math.abs(profitSol)>=5e-5?pnlClass(profitSol):'');
      const profitTile=`<div class="tile tile-profit"><div class="k">Total profit</div><strong class="mono ${profitTone}">${esc(profitPct==null?'—':((profitPct>=0?'+':'−')+Math.abs(profitPct).toFixed(2)+'%'))}</strong><div class="tile-amt mono ${pnlClass(profitSol)}">${esc(solTxt(profitSol,4))}${usdSub(profitUsd)}</div><div class="tile-live">${esc(formatLiveAge(L.liveSince)||L.liveAgeText||'')}</div></div>`;
      setMarkup($('status-body'),`<div class="summary-top"><span class="k">EQUITY SAAT INI</span><span class="mode">LIVE · N5</span></div><div class="hero-value mono">${eqSol.toFixed(2)} <span>SOL</span><small class="pnl-usd">${usdOf(eqSol)}</small></div><div class="meta live-break">Total sudah termasuk posisi LP dan rent refundable · <b>Di wallet ${wal.toFixed(2)} SOL${usdc>0.005?' + '+usdc.toFixed(2)+' USDC':''}</b> · <b>Di posisi ${posSol.toFixed(2)} SOL</b> (${slotCount} posisi, termasuk rent refundable ${rent.toFixed(3)} SOL)</div><div class="pnl-split">${pt('Unrealized · posisi open (SOL)',+L.openPnlSol||0)}${pt('Realized · sudah ditutup (SOL)',+L.realizedSol||0,L.realizedSolUsd)}</div><div class="summary-grid">${tl('Posisi',slotCount+'/'+(L.maxPositions||maxPositions))}${tl('Di wallet',wal.toFixed(2)+' SOL')}${tl('Nilai LP (posisi open)',openVal.toFixed(2)+' SOL')}${tl('Rent refundable',rent.toFixed(3)+' SOL')}${tl('Fee earned (open)',(+L.openFeesSol||0).toFixed(4)+' SOL')}${profitTile}${tl('Trade ditutup',String(L.closed||0))}</div><p class="meta">Semua angka dari wallet dan posisi live yang sebenarnya. Rent refundable kembali ke wallet saat posisi ditutup.</p><div class="summary-bottom"><span><b class="positive">●</b> LIVE berjalan · uang asli</span><span>Wallet tersinkron</span></div>`);
    }
    $('funding-form').classList.toggle('hidden',!paperAllowed);renderRuns(st.runs,deposited,paperAllowed,slotCount,freeCash);
    if(state.liveRunning&&st.liveSummary&&state.liveWallet&&numeric(state.liveWallet.sol)){const L=st.liveSummary,wal=+state.liveWallet.sol,posS=(+L.openValueSol||0)+(+L.rentRefundableSol||0);$('funding-stats').textContent=`LIVE · wallet ${wal.toFixed(2)} SOL · di posisi LP ${posS.toFixed(2)} SOL (rent refundable ${(+L.rentRefundableSol||0).toFixed(3)}) · total ${(wal+posS).toFixed(2)} SOL`;}else
    $('funding-stats').textContent=`Modal disetor ${money(deposited)} · saldo bebas ${isSolCapital?Number(stats.freeCapitalSol||0).toFixed(6)+' SOL (top-up USDC dikonversi) ':money(st.capital?.virtualUsdc??stats.virtualUsdc)} · ${st.capital?.pending||0} top-up antre. Budget entry ${payload.values?.POSITION_USDC>0?money(payload.values.POSITION_USDC)+' termasuk gas':'saldo bebas dibagi slot kosong (termasuk gas), tetap cap 5% TVL'}.`;
    const command=(st.commands?.last||[]).at(-1);if(command)$('funding-result').textContent=`Aksi terakhir: ${command.type} · ${command.result?.ok?'berhasil':command.result?.error||'antre'}`;
    $('position-count').textContent=`Posisi ${slotCount}/${maxPositions}`;
    const snapshot=open.updated||summary.updated;
    const ageMs=snapshot?Date.now()-Date.parse(snapshot):Infinity;
    $('sync-state').textContent=ageMs> (pos?120000:420000)?'Data tertunda':`Sync ${wib(snapshot)}`;
    $('sync-state').classList.toggle('stale',ageMs>(pos?120000:420000));
    if (entries.length) {
      const cards=entries.map(entry=>{
      rememberMint(entry.position.name,entry.position.mintX);const risk=entry.position.strategySettings||payload.values||{};const pos=entry.position,live=entry.live||pos.lastLive||{},px=pos.lastSolUsd||stats.solUsd||pos.solUsdEntry;
      const value=live.valueUsd??(pos.quoteSymbol==='USDC'?1:px)*((+pos.inventory?.y||0)+(+pos.inventory?.x||0)*(pos.lastPrice||pos.entryPrice||0));
      const unreal=live.pnlUsd??pos.lastPnlUsd??((value||0)+((entry.leftoverSol||0)+(pos.rentRefundableSol||0))*(px||0)-(pos.usdcIn||0));
      const fees=numeric(live.feesUsd)?+live.feesUsd:numeric(px)&&numeric(live.feesSol)?live.feesSol*px:null;
      const active=pos.binShape?.activeBin??live.activeBin??pos.lastActiveBin;
      const inRange=active!=null?active>=pos.minBinId&&active<=pos.maxBinId:live.inRange;
      return `<article class="card position"><div class="position-title"><div class="pool-icon">${tokLogo(pos.mintX)}</div><div><h3>${esc(pos.name||'Pool')}</h3><div class="k">SOLANA · METEORA DLMM · modal ${esc(pos.capitalAsset||'USDC')} · ${numeric(pos.baseFeePct)?esc(pos.baseFeePct)+'%':'fee —'} · BIN ${esc(pos.binStep??'—')}</div></div></div><div class="stat-grid">${pos.meteora?meteoraTiles(pos,pos.meteora):tile('Sedang open',money(value))+`<div class="tile"><div class="k">PnL LP net quote${live.quoted===false?' (estimasi)':''}</div><strong class="${pnlClass(live.pnlQuote)}">${quotePnlHtml(live,entryCapitalUsd(pos))}</strong></div>`}${(pos.capitalAsset||'USDC')==='USDC'&&numeric(live.pnlUsd)?`<div class="tile"><div class="k">PnL USDC (exit) · masuk Unrealized</div><strong class="${pnlClass(live.pnlUsd)}">${esc(signedWithPct(+live.pnlUsd,entryCapitalUsd(pos)))}</strong></div>`:''}${pos.meteora?'':tile('Fees earned',money(fees))+tile('Fees pool · 24h',money(pos.poolFees24hUsd))}</div>${pnlGapNote(pos,live)}${links(pos.pool,pos.mintX,true)}<button type="button" class="btn danger" data-closepool="${esc(pos.pool)}" data-opened="${esc(pos.openedAt)}" ${paperAllowed||state.liveRunning?'':'disabled'}>Tutup sekarang${state.liveRunning?'':' (paper)'}</button><div class="range-line"><span class="${inRange?'positive':'negative'}">● ${inRange?'In range':'Out of range'}</span><span>sejak ${esc(ago(pos.openedAt))}</span></div>${emergencyTpStatusHtml(pos,Object.assign({},payload.values||{},risk))}${emergencySlPlusStatusHtml(pos,Object.assign({},payload.values||{},risk))}<div class="chart-wrap">${binChart(pos)}</div><div class="position-foot">${pos.entryCostEstimate?.estimated?'<b>Rent: estimasi konservatif, menunggu koreksi SDK async (bukan biaya nol).</b><br>':''}${esc(solChangeText(live))}<br>PnL exit ${esc(pos.capitalAsset||'USDC')} (aturan risiko): ${pos.capitalAsset==='SOL'&&numeric(live.pnlCapital)?esc((+live.pnlCapital>=0?'+':'−')+Math.abs(+live.pnlCapital).toFixed(6)+' SOL')+' ('+esc(signedWithPct(unreal,entryCapitalUsd(pos)))+')':esc(signedWithPct(unreal,entryCapitalUsd(pos)))}${live.quoted===false?' · estimasi harga on-chain − fee swap':''}<br>${esc(rangeInfo(pos))}<br>${esc(shapeInfo(pos))}<br>${esc(mcapInfo(pos))}<br>${pos.meteora?esc(meteoraNote(pos.meteora))+'<br>':''}Snapshot ${esc(wib(snapshot))}<br>Poll pasar ~10d · ${esc(live.valuationBasis||'Menunggu quote Jupiter')}<br>TP ${esc(pos.capitalAsset||'USDC')} ${esc(risk.TP_USD_PCT??20)}% · OOR kanan ${esc(risk.OOR_RIGHT_CONFIRM_POLLS??2)} poll · quote gagal tunggu ${esc(risk.QUOTE_FAILURE_POLLS??10)} poll, bukan langsung close · close jika ≥${esc(risk.OOR_RIGHT_MIN_PROFIT_PCT??.5)}%, selainnya reposition maks ${esc(risk.OOR_RIGHT_MAX_REPOSITIONS??2)} · peak ${esc(signed(live.peakPnlUsd??pos.peakPnlUsd))}. Reshape ${esc(risk.RESHAPE_ENABLED===false?'off':'setiap '+(risk.RESHAPE_N??5)+' bin turun')} · compound ${esc(risk.COMPOUND_ENABLED===false?'off':'on')}. Buffer/rent/gas termasuk; swap paper saja.</div></article>`;
      });
      patchMarkup($('positions'),cards.join(''));
    } else {
      patchMarkup($('positions'), '<div class="card empty waiting"><div class="waiting-icon">◈</div><strong>Menunggu entry yang aman</strong><p>Bot tetap scan. Bentuk bins tampil otomatis<br>saat posisi '+(state.liveRunning?'live':'paper')+' terbuka.</p>'+'<span class="mode">Tidak ada posisi · bukan bot berhenti</span></div>');
    }
    const near=scan.display||scan.near||[];for(const c of near)rememberMint(c.name,c.mintX);for(const r of summary.closedRecent||[])rememberMint(r.name,r.mintX);
    const candidateHeading=$('candidates').previousElementSibling?.querySelector('h2');
    if(candidateHeading)candidateHeading.textContent='Screening pool · top fees';
    const reasonText=(r)=>String(r).replace(/quote not SOL/g,'quote bukan SOL').replace(/fee\/tvl/g,'fee/TVL').replace(/tvl</g,'TVL di bawah ').replace(/age</g,'umur di bawah ').replace(/bin_step outside/g,'bin step di luar').replace(/pump1h/g,'pump 1j').replace(/pump24h/g,'pump 24j');
    const ageText=(h)=>numeric(h)?(+h<1?Math.floor(h*60)+'m':+h<24?Number(h).toFixed(1)+'j':Number(h/24).toFixed(1)+'hari'):'—';
    if(state.scanAskedAt&&Date.parse(scan.at||0)>=state.scanAskedAt-2000){state.scanAskedAt=0;showBanner('Scan ulang selesai · terakhir scan '+wib(scan.at)+' · '+(scan.fetched??'—')+' pool dipindai, '+(scan.basic??'—')+' lolos filter dasar');}
    patchMarkup($('candidates'), `<div class="scan-caption"><div class="meta"><b>Terakhir scan: ${esc(wib(scan.at))}</b> · ${esc(scan.fetched??'—')} pool · ${esc(scan.basic??'—')} lolos filter dasar</div>${st.screenRefresh?.stale?'<b class="negative">Scan lama, menunggu scan ulang</b><br>':''}<button type="button" class="btn ghost" data-rescan ${(!paperAllowed&&!state.liveRunning)||state.scanBusy||Date.now()-state.lastManualScanAt<30000?'disabled':''}>Scan ulang sekarang</button><br>Scan ${esc(wib(scan.at))} · ${esc(scan.fetched??'—')} pool diperiksa · ${esc(scan.passed??scan.candidates?.length??scan.n??0)} lolos<br><b class="positive">Sumber screening: Meteora datapi 30m</b><br>Filter saat scan ini: fee/TVL ≥${esc(scan.filters?.MIN_FT??payload.values?.MIN_FT??summary.filters?.minFt??'—')}% · TVL ≥${esc(money(scan.filters?.MIN_LIQ_USD??payload.values?.MIN_LIQ_USD??summary.filters?.minLiqUsd))} dan ≤${esc(money(scan.filters?.MAX_LIQ_USD??payload.values?.MAX_LIQ_USD))} · umur ≥${esc(scan.filters?.MIN_AGE_H??payload.values?.MIN_AGE_H??summary.filters?.minAgeH??'—')}j${(+(scan.filters?.MIN_TOKEN_AGE_H??payload.values?.MIN_TOKEN_AGE_H)||0)>0?' · umur token ≥'+esc(scan.filters?.MIN_TOKEN_AGE_H??payload.values?.MIN_TOKEN_AGE_H)+'j':''}${(+(scan.filters?.MAX_TOKEN_AGE_H??payload.values?.MAX_TOKEN_AGE_H)||0)>0?' · umur token ≤'+esc(scan.filters?.MAX_TOKEN_AGE_H??payload.values?.MAX_TOKEN_AGE_H)+'j':''} · BIN ${esc(scan.filters?.MIN_BIN_STEP??payload.values?.MIN_BIN_STEP??100)}–${esc(scan.filters?.MAX_BIN_STEP??payload.values?.MAX_BIN_STEP??400)}<br>${scan.filters?.ANTI_PVP_MODE!==undefined?'Filter token: '+(scan.filters.FILTERS_ENABLED?'ON':'<b class="negative">OFF semua</b>')+' · pump 1j '+(scan.filters.PUMP1H_FILTER_ENABLED?'ON':'OFF')+' · pump 24j '+(scan.filters.PUMP24H_FILTER_ENABLED?'ON':'OFF')+' · RugCheck '+(scan.filters.RUGCHECK?'ON':'OFF')+' · top holder '+(scan.filters.CHECK_TOP_HOLDERS?'ON':'OFF')+' · insider '+(scan.filters.CHECK_INSIDERS?'≤'+esc(scan.filters.MAX_INSIDER_PCT)+'%':'OFF')+' · anti PvP '+esc(scan.filters.ANTI_PVP_MODE)+(scan.filters.TVL_DROP_FILTER_ENABLED!==undefined?' · TVL turun '+(scan.filters.TVL_DROP_FILTER_ENABLED?'ON ≥'+esc(scan.filters.TVL_DROP_MAX_PCT)+'%':'OFF'):'')+'<br>':''}${st.screenRefresh?.stale?'Setting sekarang BIN '+esc(payload.values?.MIN_BIN_STEP)+'–'+esc(payload.values?.MAX_BIN_STEP)+'; alasan merah di bawah masih milik scan '+esc(wib(scan.at))+'.<br>':''}Eligible: ${esc(scan.coverage?.eligibleTotal??'—')} pool · ${esc(scan.coverage?.eligiblePages??'—')} halaman · urut fee/TVL</div>`+(near.length?near.map(c=>{const held=entries.some(e=>e.position.pool===c.address),bypass=costBypass(c,payload.values),attempt=(summary.lastScan?.openResults||[]).find(x=>x.address===c.address||(!x.address&&x.pool===c.name));return `<div class="candidate"><div class="candidate-top"><strong>${tokLogo(c.mintX,'tok-logo sm')}${esc(c.name)}</strong><b class="purple mono">${numeric(c.ft30m)?Number(c.ft30m).toFixed(3)+'%':'—'}</b></div><div class="meta">Fees 30m ${esc(money(c.fees30mUsd))} · TVL ${esc(money(c.tvl))} · MC ${esc(money(c.marketCapUsd))}<br>BIN ${esc(c.binStep??'—')} / ${numeric(c.baseFeePct)?esc(c.baseFeePct)+'%':'—'} · umur ${esc(ageText(c.ageH))} · quote ${esc(c.quote||'SOL')}<br>Non-refundable: ${bypass?esc(bypass):c.entryCostEstimate?.known?esc(c.entryCostEstimate.nonrefTotalSol.toFixed(6)+' SOL · '+c.entryCostEstimate.newBinArrays+' bin array baru'):'belum dihitung; dicek wajib sebelum open'}</div>${c.isOpen||held?`<div class="meta positive"><b>● OPEN</b>${c.openInfo?` · dibuka ${esc(wib(c.openInfo.openedAt))}${c.openInfo.source?' · '+esc(c.openInfo.source):''}<br><b>Alasan dibuka:</b>${c.openInfo.list.length?c.openInfo.list.map(x=>'<br>'+(x.s==='pass'?'✓':x.s==='warn'?'⚠':'ℹ️')+' '+esc(x.t)).join(''):' data entry tidak tersedia'}`:''}</div>`:''}<div class="meta ${c.isOpen?'':c.status==='passed'?'positive':c.status==='pending'?'purple':'negative'}">${c.isOpen?'<b>Status filter sekarang</b> (posisi tetap open, tidak ditutup karena ini) · ':''}Scan ${esc(wib(scan.at))} · ${reasonsHtml(c,reasonText)}</div>${attempt&&(attempt.skipped||attempt.error)?`<p class="meta negative">Open tertunda: ${esc(attempt.skipped||attempt.error)}${bypass?' · NONREF SUDAH DILEWATI':''}</p>`:''}${links(c.address,c.mintX)}<button type="button" class="btn ${c.status==='passed'?'primary':'ghost'}" data-openpool="${esc(c.address)}" ${(paperAllowed||state.liveRunning)&&!held?'':'disabled'}>${held?'Sudah dibuka':full&&!state.liveRunning?'Ganti dengan posisi...':'Open sekarang'}${state.liveRunning&&!held?' · LIVE':''}${!held&&c.status!=='passed'?' · ⚠':''}</button>${!held&&full&&state.liveRunning?`<p class="meta">Slot penuh (${slotCount}/${maxPositions}) · di LIVE tutup satu posisi dahulu</p>`:''}${!held&&full&&!state.liveRunning?`<p class="meta">Slot penuh (${slotCount}/${maxPositions}) · pilih posisi yang diganti</p><select data-replacement="${esc(c.address)}">${entries.map(e=>`<option value="${esc(e.position.pool)}" ${state.replacements[c.address]===e.position.pool?'selected':''}>${esc(e.position.name)} · ${esc(quotePnlText(e.live||{}))}</option>`).join('')}</select>`:''}</div>`;}).join(''):'<p class="empty">Menunggu daftar kandidat dari scan berikutnya.</p>'));
    const activity=st.activity||[];
    const feed=activity.map(e=>{const mt=mintInText(e.text);return `<div class="event ${esc(e.kind)}">${mt?tokLogo(mt,'tok-logo ev'):'<span class="event-dot"></span>'}<div><time>${esc(e.atWib)}</time><p>${esc(e.text)}</p></div></div>`;}).join('')||'<div class="empty">Belum ada event.</div>';
    // Stable DOM while unchanged: preserves scrolling and button focus across polls.
    patchMarkup($('activity'),feed);
    if($('archive-note'))$('archive-note').textContent=`${stats.archivedCount||0} posisi >$500 diarsipkan (disembunyikan dari daftar, tetap dihitung di Total PnL ${signed(stats.archivedPnlUsd??0)}). History: ${stats.trades??0} posisi · win rate ${stats.winRate??0}% · PnL terlihat ${signed(stats.totalNetPnlUsd)} · Total PnL ${signed(stats.totalNetPnlAllUsd??stats.totalNetPnlUsd)} USDC. Equity tetap seluruh saldo/posisi nyata.`;
    closedRows=(summary.closedRecent||[]).filter(r=>Date.parse(r.closedAt)>=Date.now()-86400000).reverse();renderClosed();
    if(stats.live){if($('archive-note'))$('archive-note').textContent=`LIVE · history dari bot live: ${stats.trades??0} posisi ditutup · win rate ${stats.winRate??'—'}% · ${stats.wins??0}W · ${stats.losses??0}L${stats.be?' · '+stats.be+' BE':''} · realized ${solTxt(+stats.totalNetPnlSol||0,6)}${numeric(stats.totalNetPnlSolUsd)?' (≈ '+signed(stats.totalNetPnlSolUsd)+')':''}.`;}
    if(stats.live)$('window-info').textContent=`LIVE${st.window?.endsWib?' · sesi tes live sampai '+st.window.endsWib+(st.window.expired?' (habis)':''):''} · UI poll 7 detik · semua angka dari wallet & posisi live.`;else $('window-info').textContent=`Window sampai ${st.window?.endsWib||summary.endsWib||'—'} · UI poll 7 detik · scan saat flat 5 menit. PnL risiko sesuai aset modal saat entry (${capitalUnit}); angka paper bukan hasil live.`;
    try{if(window.SWDash&&typeof window.SWDash.render==='function')window.SWDash.render(payload);}catch(e){}
    try{liveSweep();}catch(_){}
  }
  async function statusPoll() {
    if(statusBusy||document.hidden||!initData()) return;
    statusBusy=true;
    try {
      const r=await api('GET','/api/status');
      if(r.status===200&&r.json.ok){renderStatus(r.json);lastSuccessAt=Date.now();}
      else { $('sync-state').textContent='Akses kedaluwarsa · buka ulang'; $('sync-state').classList.add('stale'); }
    } catch { $('sync-state').textContent='Koneksi terputus · mencoba lagi'; $('sync-state').classList.add('stale'); }
    finally { statusBusy=false; }
  }
  async function copyCA(ca,button) {
    if(!validCA(ca)) return;
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(ca);
      else throw new Error('fallback');
    } catch {
      const text=document.createElement('textarea');text.value=ca;text.readOnly=true;text.style.cssText='position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(text);text.focus();text.select();text.setSelectionRange(0,ca.length);
      const ok=document.execCommand('copy');text.remove();
      if(!ok){window.prompt('Salin CA pool:',ca);return;}
    }
    button.textContent='✓ Tersalin';if(tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    setTimeout(()=>{if(button.isConnected)button.textContent='▣ Salin CA';},1800);
  }

  document.addEventListener('click',e=>{const b=e.target.closest('[data-position-view]');if(b)setPositionView(b.dataset.positionView);});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-copy],[data-mint],[data-trade]');if(!b||b.disabled)return;
    if(b.hasAttribute('data-copy'))copyCA(b.dataset.copy,b).catch(()=>showBanner('CA belum tersalin. Coba tekan lagi.',true));
    if(b.hasAttribute('data-mint')&&validCA(b.dataset.mint)){
      const url='https://gmgn.ai/sol/token/'+b.dataset.mint;
      if(tg?.openLink)tg.openLink(url);else window.open(url,'_blank','noopener,noreferrer');
    }
    if(b.hasAttribute('data-trade')){
      const r=closedRows[+b.dataset.trade];if(!r)return;
      const rows=[['Pool',r.name],['CA',r.pool],['Tutup',wib(r.closedAt)],['Alasan tutup',(closeTag(r)?'['+closeTag(r).t+'] '+closeTag(r).l+' — ':'')+(r.closeReasonText||r.reason)],...entryHistoryRows(r),...(isSolRow(r)?[['Modal',(+r.capitalInSol||0).toFixed(6)+' SOL'],['Kembali',numeric(r.solOut)?(+r.solOut).toFixed(6)+' SOL':'—'],['PnL SOL (hasil utama)',solTxt(r.pnlSol)+' ('+pctTxt(r.pnlSolPct)+')'],['≈ USD (PnL SOL × harga close)',numeric(r.pnlSolUsd)?signed(r.pnlSolUsd)+(numeric(r.solUsd)?' @ $'+(+r.solUsd).toFixed(2):''):'—'],['Fee earned',numeric(r.feesSol)?(+r.feesSol).toFixed(6)+' SOL':'—'],...(r.note?[['Koreksi',r.note]]:[]),['Durasi open',durText(r)]]:[['Modal',money(r.usdcIn)],['Kembali',money(r.usdcOut)],...(isUsdcCapital(r)?[['PnL net USDC',signedWithPct(r.pnlUsd,entryCapitalUsd(r))+' USDC'],['PnL LP quote (info)',quotePnlText(r,entryCapitalUsd(r))]]:[['PnL LP net quote',quotePnlText(r,entryCapitalUsd(r))],['PnL exit USD',signedWithPct(r.pnlUsd,entryCapitalUsd(r))]]),['Swap cost (sudah dalam PnL)',money(r.swapCostUsd)],['Gas (SOL, sudah dalam PnL)',r.gasUsedSol??'—'],['Durasi open',durText(r)+(r.hold?' ('+r.hold+')':'')]])];if(closeTag(r)?.t==='STALE')rows.splice(4,0,['Stale close',closeTag(r).l+' · open '+durText(r)+' · aturan: '+(r.closeReasonText||r.reason)]);
      $('trade-detail').innerHTML=rows.map(([k,v])=>`<div class="row"><div class="k">${esc(k)}</div><div class="v mono">${esc(v)}</div></div>`).join('')+links(r.pool,r.mintX,true);showSheet($('trade-modal'));
    }
  });
  const askConfirm=message=>tg?.showConfirm?new Promise(resolve=>tg.showConfirm(message,resolve)):Promise.resolve(window.confirm(message));
  const requestId=()=>globalThis.crypto?.randomUUID?.()||('paper-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  // ---- Opsi SOL untuk tambah modal & edit modal dry run: jumlah SOL dikonversi ke USDC virtual pada harga SOL sekarang (ledger tetap USDC).
  const solPx=()=>Number(lastPayload?.status?.summary?.stats?.solUsd)||0;
  state.unit={funding:null,modal:null};
  const unitOf=p=>{if(!state.unit[p])state.unit[p]=state.fields?.CAPITAL_ASSET?.value==='SOL'?'SOL':'USDC';return state.unit[p];};
  function amountUsd(p,raw){const u=unitOf(p),n=Number(raw);if(String(raw).trim()===''||!Number.isFinite(n))return NaN;if(u==='SOL'){const px=solPx();return px>0?Math.round(n*px*1e6)/1e6:NaN;}return n;}
  function renderUnits(){
    for(const p of ['funding','modal']){
      const u=unitOf(p),inp=$(p==='funding'?'funding-amount':'modal-amount'),lab=$(p+'-label'),eq=$(p+'-eq');if(!inp)continue;
      document.querySelectorAll(`[data-unit-for="${p}"] [data-unit]`).forEach(x=>{const on=x.dataset.unit===u;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));});
      if(lab)lab.textContent=p==='funding'?(u==='SOL'?'Jumlah SOL (setara USDC 1–10000)':'Jumlah USDC (1–10000)'):(u==='SOL'?'Modal baru SOL (setara USDC minimal 1)':'Modal baru USDC (minimal 1)');
      if(u==='SOL'){inp.removeAttribute('max');inp.min='0';}else if(p==='funding'){inp.min='1';inp.max='10000';}else{inp.min='0';inp.removeAttribute('max');}
      const px=solPx(),n=Number(inp.value),usd=amountUsd(p,inp.value);
      if(eq)eq.textContent=u==='SOL'?(px>0?(Number.isFinite(usd)?`≈ ${money(usd)} (SOL × $${px.toFixed(2)})`:`Harga SOL $${px.toFixed(2)}`):'Harga SOL belum tersedia; coba lagi sebentar.'):(px>0&&Number.isFinite(n)&&n>0?`≈ ${(n/px).toFixed(4)} SOL @ $${px.toFixed(2)}`:'');
    }
  }
  document.addEventListener('click',e=>{const u=e.target.closest('[data-unit-for] [data-unit]');if(!u)return;const p=u.closest('[data-unit-for]').dataset.unitFor;state.unit[p]=u.dataset.unit;renderUnits();});
  document.addEventListener('input',e=>{if(e.target&&(e.target.id==='funding-amount'||e.target.id==='modal-amount'))renderUnits();});
  $('funding-form').addEventListener('submit',async e=>{
    e.preventDefault();if(state.actionBusy||!state.paperAllowed)return;
    const amount=amountUsd('funding',$('funding-amount').value);if(!Number.isFinite(amount)||amount<1||amount>10000){showBanner(unitOf('funding')==='SOL'?'Setara USDC harus 1–10000 (cek jumlah SOL dan harga SOL).':'Jumlah harus 1–10000 USDC.',true);return;}
    state.actionBusy=true;$('btn-funding').disabled=true;
    try{
      if(!await askConfirm(`Tambah ${unitOf('funding')==='SOL'?Number($('funding-amount').value)+' SOL ≈ ':''}${amount} USDC virtual? Ini DRY RUN, bukan transfer uang.`))return;
      const {status,json}=await api('POST','/api/paper/capital/deposit',{amount,confirmed:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Top-up gagal');
      $('funding-result').textContent=`+${amount} USDC antre; bot menerapkan tanpa mengubah posisi. Biasanya 5–10 detik (bisa lebih lama saat scan).`;
      $('funding-amount').value='';await statusPoll();
    }catch(e){showBanner(e.message,true);}finally{state.actionBusy=false;$('btn-funding').disabled=false;}
  });
  function renderRuns(r,deposited,allowed,openCount,cash){
    const f=$('modal-form');if(!f)return;f.classList.toggle('hidden',!allowed);state.runInfo={current:r?.current||null,deposited,openCount,cash};
    const sp=r?.stopped,cc=$('continue-card');if(cc){cc.classList.toggle('hidden',!(sp?.stopped)||state.liveRunning);if(sp?.stopped)$('continue-info').textContent='Status: '+[sp.paused?'dijeda (paper/STOP)':null,sp.ended?'proses selesai (ENDED)':null,sp.windowEnded?'jendela waktu habis '+wib(sp.endsAt):null].filter(Boolean).join(', ');}
    const cur=r?.current;$('modal-stats').textContent=`Dry Run #${cur?.number??1} · modal ${money(cur?.modal??deposited)}${cur?.startedAt?' · mulai '+wib(cur.startedAt):''}${openCount?' · '+openCount+' posisi open (tutup semua dulu)':''}${r?.pending?' · 1 permintaan antre':''}`;
    if(r?.last?.result&&!r.pending)$('modal-result').textContent=r.last.result.ok?r.last.result.activated?`Terakhir: Dry Run #${r.last.result.run} disimpan, Dry Run #${r.last.result.activated} diaktifkan (${r.last.doneWib})`:`Terakhir: Dry Run #${r.last.result.run??r.last.result.newRun-1} disimpan, Dry Run #${r.last.result.newRun} mulai ${money(r.last.result.modal)} (${r.last.doneWib})`:`Terakhir ditolak: ${r.last.result.error} (${r.last.doneWib})`;
    if(r?.live){$('runs-list').innerHTML='';$('runs-list').classList.add('hidden');return;}$('runs-list').classList.remove('hidden');
    const runs=(r?.runs||[]).slice().reverse();
    $('runs-list').innerHTML='<h3>Dry run tersimpan</h3>'+(runs.length?runs.map(x=>`<div class="row"><div><b>Dry Run #${esc(x.number)}${x.number===cur?.number?' (aktif)':''}</b><br><span class="k">${esc(x.startedWib||'?')} → ${esc(x.endedWib||'?')}</span><br><span class="k">modal ${esc(money(x.modal))} · ${esc(x.trades)} trade · equity akhir ${esc(money(x.equityUsd))}</span></div><div class="mono ${pnlClass(x.totalPnlUsd)}">${esc(signed(x.totalPnlUsd))}${allowed&&!openCount&&x.number!==cur?.number?`<br><button type="button" class="btn ghost" data-activate="${esc(x.number)}">Aktifkan</button>`:''}</div></div>`).join('')+'<p class="meta">Data lengkap tersimpan di paper/runs/ (state, history CSV, summary, PnL calendar). Hanya baca.</p>':'<div class="empty">Belum ada dry run tersimpan.</div>');
  }
  $('btn-continue')?.addEventListener('click',async()=>{
    if(state.actionBusy)return;state.actionBusy=true;const b=$('btn-continue');b.disabled=true;
    try{
      if(!await askConfirm('Lanjutkan dry run yang berhenti? Data disimpan otomatis dulu, lalu bot dijalankan ulang. Ini DRY RUN, bukan live.'))return;
      const {status,json}=await api('POST','/api/runs/continue',{confirmed:true});
      if(status!==200||!json.ok)throw Error(json.error||'Lanjut gagal');
      $('continue-result').textContent=`Dilanjutkan. Tersimpan: ${json.autosave}${json.extendedWindow?' · jendela waktu diperpanjang':''}${json.restarted?' · bot dijalankan ulang':(json.restartError?' · restart gagal: '+json.restartError:'')}.`;await statusPoll();
    }catch(e){showBanner(e.message,true);}finally{state.actionBusy=false;b.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-activate]');if(!b||b.disabled||state.actionBusy||!state.paperAllowed)return;
    const n=Number(b.dataset.activate),cur=state.runInfo?.current?.number??'?';state.actionBusy=true;b.disabled=true;
    try{
      if(!await askConfirm(`Aktifkan Dry Run #${n}? Dry Run #${cur} yang sedang jalan disimpan otomatis sebagai arsip, lalu #${n} jadi run aktif dan dilanjutkan dari kondisi terakhirnya. Setelan bersama tetap. Ini DRY RUN.`))return;
      const {status,json}=await api('POST','/api/runs/activate',{number:n,confirmed:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Aktifkan gagal');
      $('modal-result').textContent=`Antre: Dry Run #${cur} disimpan, lalu Dry Run #${n} diaktifkan. Bot menerapkan dalam beberapa detik.`;await statusPoll();
    }catch(err){showBanner(err.message,true);}finally{state.actionBusy=false;b.disabled=false;}
  });
  function modalConfirm(oldModal,newModal,num,cash){return new Promise(resolve=>{
    const d=document.createElement('dialog'),delta=newModal-cash;
    d.innerHTML=`<h2 style="margin:0 0 10px;font-size:15px">Edit modal dry run?</h2><div class="row"><div class="k">Modal lama</div><div class="v mono">${esc(money(oldModal))}</div></div><div class="row"><div class="k">Modal baru</div><div class="v mono">${esc(money(newModal))}</div></div><div class="row"><div class="k">Saldo kas</div><div class="v mono">${esc(money(cash))} → ${esc(money(newModal))} (${esc(signed(delta))})</div></div><p class="meta" style="font-size:12px;line-height:1.6"><b>Dry run sekarang akan disimpan sebagai Dry Run #${esc(num)} dan dimulai ulang dari awal.</b> History, PnL calendar dan equity mulai dari nol dengan modal baru. Data lama tidak dihapus. SL blacklist dan settings tetap. Virtual USDC saja, bukan transfer uang.</p><div class="btn-row"><button type="button" class="btn ghost" id="mc-cancel">Batal</button><button type="button" class="btn danger" id="mc-ok">Simpan &amp; mulai ulang</button></div>`;
    document.body.appendChild(d);const done=v=>{try{d.close();}catch{}d.remove();resolve(v);};
    d.querySelector('#mc-cancel').onclick=()=>done(false);d.querySelector('#mc-ok').onclick=()=>done(true);d.addEventListener('cancel',e=>{e.preventDefault();done(false);});d.showModal();});}
  $('modal-form')?.addEventListener('submit',async e=>{
    e.preventDefault();if(state.actionBusy||!state.paperAllowed)return;
    const raw=$('modal-amount').value,amount=amountUsd('modal',raw);if(!Number.isFinite(amount)||amount<1){showBanner(unitOf('modal')==='SOL'?'Modal minimal setara $1 (cek jumlah SOL dan harga SOL).':'Modal minimal $1',true);return;}
    const info=state.runInfo||{};if(info.openCount){showBanner('Tutup semua posisi dulu',true);return;}
    const oldModal=Number(info.current?.modal??info.deposited??0),num=info.current?.number??1,cash=Number(info.cash??0);
    state.actionBusy=true;$('btn-modal').disabled=true;
    try{
      if(!await modalConfirm(oldModal,amount,num,cash))return;
      const {status,json}=await api('POST','/api/paper/capital/new-run',{amount,expectedOldModal:oldModal,confirmed:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Edit modal gagal');
      $('modal-result').textContent=`Antre: Dry Run #${num} disimpan lalu mulai ulang dengan modal ${money(amount)}. Bot menerapkan dalam beberapa detik.`;$('modal-amount').value='0';await statusPoll();
    }catch(err){showBanner(err.message,true);}finally{state.actionBusy=false;$('btn-modal').disabled=false;}
  });
  document.addEventListener('change',e=>{const select=e.target.closest('[data-replacement]');if(select)state.replacements[select.dataset.replacement]=select.value;});

  document.addEventListener('click',async e=>{
    const scanButton=e.target.closest('[data-rescan]');
    if(scanButton&&!scanButton.disabled){
      state.scanBusy=true;scanButton.disabled=true;
      try{const {status,json}=await api('POST','/api/paper/scan',{});if(status!==202||!json.ok)throw Error(json.error||'Scan gagal');state.lastManualScanAt=Date.now();state.scanAskedAt=Date.now();showBanner('Scan ulang diminta. Hasil muncul beberapa detik lagi, kabar masuk di sini kalau sudah selesai.');await statusPoll();}catch(err){showBanner(err.message,true);}finally{state.scanBusy=false;}
      return;
    }
    const b=e.target.closest('[data-openpool],[data-closepool]');if(!b||b.disabled||state.actionBusy)return;
    const opening=b.hasAttribute('data-openpool'),pool=opening?b.dataset.openpool:b.dataset.closepool;
    if(opening&&state.liveRunning){if(validCA(pool))await liveManualOpen(b,pool);return;}
    if(!opening&&state.liveRunning){if(validCA(pool))await liveManualClose(b,pool);return;}
    if(!state.paperAllowed)return;
    if(!validCA(pool))return;state.actionBusy=true;b.disabled=true;
    try{
      const st=lastPayload?.status||{},open=st.positions_open||{};
      const entries=open.positions||(open.position?[{position:open.position,live:open.live}]:[]);
      const full=entries.length>=(lastPayload?.values?.MAX_POSITIONS??5);
      const selectedPool=opening&&full?document.querySelector(`[data-replacement="${pool}"]`)?.value:pool;
      const entry=entries.find(e=>e.position.pool===selectedPool);
      const pos=entry?.position,live=entry?.live||{};
      if(opening&&full&&!pos)throw Error('Pilih posisi yang diganti dahulu');
      const scan=pickScan(st);
      const candidate=(scan.display||scan.near||scan.candidates||[]).find(x=>x.address===pool),override=opening&&candidate?.status!=='passed';
      const reasons=candidate?.reasons||['Pemeriksaan semua filter belum selesai'];
      let overrideConfirmed=false;
      if(override){if(!await askConfirm('PERINGATAN: '+reasons.join('; ')+'. Ini override filter screening PAPER. Filter biasa bisa dilewati, tapi TVL, quote, RugCheck, mint, insider dan holder tetap wajib: kalau kena, bot menolak open dan alasannya tampil di aktivitas. Nilai pasar diperiksa ulang.'))return;overrideConfirmed=true;}
      const replacing=opening&&full&&!!pos,pnl=live.pnlUsd??pos?.lastPnlUsd;
      const settlement=pos?.capitalAsset||'USDC';
      const message=replacing?`Ganti ${pos.name} ke ${candidate?.name||pool}? Posisi lama ditutup ke ${settlement} (estimasi PnL USD ${signed(pnl)}), lalu buka pool pilihan. Biaya swap/gas berlaku; quote bisa berubah.`:opening?'Open posisi sekarang? PAPER saja.':`Tutup posisi dan kembali ke ${settlement} sekarang? PAPER saja.`;
      if(!await askConfirm(message))return;
      if(!await askConfirm(replacing?'Konfirmasi kedua: close → aset modal → open sebagai satu perintah paper. Jika re-screen/quote/open gagal, seluruh perubahan virtual dibatalkan.':opening?'Konfirmasi kedua: buka dengan sizing/shape saat ini, re-screen dan quote terbaru; tidak menyentuh live.':'Konfirmasi kedua: tutup posisi ini pada quote pasar saat bot memproses. PnL bisa berubah.'))return;
      const {status,json}=await api('POST',opening?'/api/paper/open':'/api/paper/close',{pool,openedAt:opening?undefined:b.dataset.opened,replaceCurrent:!!replacing,expectedPool:replacing?pos.pool:undefined,expectedOpenedAt:replacing?pos.openedAt:undefined,overrideFailedFilters:!!override,overrideConfirmed,confirmedReasons:override?reasons:[],confirmed:true,confirmedTwice:true,requestId:requestId()});
      if(status!==202||!json.ok)throw Error(json.error||'Aksi ditolak');
      showBanner('Aksi paper antre. Bot memeriksa ulang; hasil tampil di aktivitas.');await statusPoll();
    }catch(e){showBanner(e.message,true);}finally{state.actionBusy=false;if(b.isConnected)b.disabled=false;}
  });

  $('hide-dust').addEventListener('change',renderClosed);
  $('close-modal').onclick=()=>hideSheet($('trade-modal'));
  $('cal-day-close').onclick=()=>hideSheet($('cal-day-modal'));
  $('cal-day-modal').addEventListener('click',e=>{if(e.target===$('cal-day-modal'))hideSheet($('cal-day-modal'));});

  function pumpHint(key,el){const f=state.fields?.[key],w={MAX_PUMP1H:'1 jam',MAX_PUMP24H_PCT:'24 jam',MAX_PUMP_24H:'24 jam'}[key];if(!w||!f)return el;const p=document.createElement('p');p.className='meta';p.innerHTML='💡 Bot skip token yang sudah naik lebih dari <b>'+esc(String(f.display))+'%</b> dalam '+w+' terakhir (anti beli di pucuk). Makin besar = makin longgar.';el.appendChild(p);return el;}
  const ratioKeys=['OPEN_SPOT_PCT','COMPOUND_SPOT_PCT'];
  const fmtRatio=v=>{const s=+Number(v).toFixed(4);return `${s}:${+(100-s).toFixed(4)}`;};
  function parseRatio(t){const m=String(t||'').trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);if(!m)return null;const a=+m[1],b=+m[2];return Math.abs(a+b-100)<1e-9&&a>=0&&a<=100?a:null;}
  const ratioLabels={OPEN_SPOT_PCT:'Shape saat open Spot:Bid-Ask',COMPOUND_SPOT_PCT:'Shape saat compound Spot:Bid-Ask'};
  const intPct=t=>/^\d{1,3}$/.test(String(t).trim())&&+t<=100?+t:null;
  document.addEventListener('input',e=>{const b=e.target.closest('[data-ratio-box]');if(!b)return;const k=b.dataset.ratioBox,side=b.dataset.side,sp=document.getElementById('rs-'+k),ba=document.getElementById('rb-'+k),h=document.getElementById('f-'+k);const v=intPct(b.value);if(v!=null){(side==='s'?ba:sp).value=100-v;}const a=intPct(sp.value),c=intPct(ba.value),ok=a!=null&&c!=null&&a+c===100;h.value=ok?a:'';sp.style.borderColor=ba.style.borderColor=ok?'':'#ef4444';});
  const enumLabels={OLD_TOKEN_MODE:{BLOCK_ALL:'Blok semua token tua (umur > batas)',DUMP_ONLY:'Hanya yang lagi dump (pump 24 jam < batas)'},ANTI_PVP_MODE:{KEEP_BIGGEST:'Ambil yang likuiditasnya terbesar (bukan yang tertua), skip kembarannya',SKIP_ALL:'Skip semua kalau ada kembaran',OFF:'OFF'}};
  const tokenFilterKeys=['FILTERS_ENABLED','PUMP1H_FILTER_ENABLED','PUMP24H_FILTER_ENABLED','RUGCHECK_ENABLED','RUGCHECK_STICKY_DAYS','FEE_TURNOVER_MAX_PCT','FEE_TURNOVER_TVL_BELOW_USD','TOP_HOLDERS_ENABLED','CHECK_INSIDERS','MAX_INSIDER_PCT','ANTI_PVP_MODE','ANTI_PVP_MIN_LIQ_USD','OLD_DUMP_FILTER_ENABLED','OLD_TOKEN_MODE','OLD_DUMP_MIN_AGE_H','OLD_DUMP_MAX_PUMP24H','TVL_DROP_FILTER_ENABLED','TVL_DROP_MAX_PCT'];
  // All reasons a pool is not opened (display only; open decision is unchanged in the bot).
  function reasonsHtml(c,reasonText){
    const all=Array.isArray(c.allReasons)?c.allReasons:null,line=(icon,x)=>'<br>'+icon+' '+esc(x.t),orig=()=>esc((c.reasons||['belum lolos semua filter']).map(reasonText).join(' · '));
    if(c.status==='passed')return (c.isOpen?'✓ Masih lolos semua filter':'✓ Lolos semua filter · menunggu slot posisi')+(all||[]).filter(x=>x.s==='info').map(x=>line('ℹ️',x)).join('');
    if(!all)return orig();
    const f=all.filter(x=>x.s==='fail'),u=all.filter(x=>x.s==='unchecked'),i=all.filter(x=>x.s==='info'&&!(c.isOpen&&/^Sudah open di pool ini/.test(x.t)));
    return (f.length?`<b>${f.length} ${c.isOpen?'filter gagal sekarang':'alasan tidak dibuka'}:</b>`+f.map(x=>line('✗',x)).join(''):orig())+i.map(x=>line('ℹ️',x)).join('')+(u.length?`<br><span style="opacity:.7">Belum dicek: ${esc(u.map(x=>x.t.replace(/: belum dicek$/,'')).join(', '))}</span>`:'');
  }
  function fieldInput(key, info) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    if(info.type==='enum'){const ol=enumLabels[key]||{};wrap.innerHTML=`<label for="f-${key}">${esc(info.label)}</label><select id="f-${key}" name="${key}">${(info.options||[]).map(v=>`<option value="${esc(v)}" ${v===info.value?'selected':''}>${esc(ol[v]||v)}</option>`).join('')}</select><p class="meta">${key==='ANTI_PVP_MODE'?'Default: ambil yang tertua/terbesar. Kembar = simbol/nama sama (huruf besar-kecil, simbol, akhiran coin/token diabaikan) tapi CA beda; pool lain dengan CA sama bukan kembar. Kembar dihitung hanya jika likuiditasnya ≥ batas di bawah. Data: pool Meteora + pencarian DexScreener.':key==='OLD_TOKEN_MODE'?'Blok semua = skip pool yang umurnya lebih dari batas jam (umur tidak diketahui juga di-skip). Hanya yang lagi dump = skip token tua hanya kalau pump 24 jam di bawah batas. Hanya untuk entry baru; posisi open tidak ditutup.':key==='CAPITAL_ASSET'?'Default USDC. Ganti mode menukar saldo bebas; basis posisi lama tetap.':'Hanya posisi baru. MIXED mengikuti persentase Spot; BIDASK dan SPOT adalah 100% shape tersebut.'}</p>`;return wrap;}
    if(ratioKeys.includes(key)){
      const v=Number(info.value),cur=fmtRatio(v);
      wrap.innerHTML=`<label for="rs-${key}">${ratioLabels[key]}</label><p class="meta">Default ${fmtRatio(Number(info.defaultDisplay))} · sekarang ${cur} · angka bulat 0–100, jumlah 100</p>
        <div style="display:flex;align-items:center;gap:8px"><input type="number" inputmode="numeric" min="0" max="100" step="1" id="rs-${key}" data-ratio-box="${key}" data-side="s" value="${v}" aria-label="Spot" style="flex:1;min-width:0;text-align:center"><b>:</b><input type="number" inputmode="numeric" min="0" max="100" step="1" id="rb-${key}" data-ratio-box="${key}" data-side="b" value="${100-v}" aria-label="Bid-Ask" style="flex:1;min-width:0;text-align:center"></div>
        <p class="meta" style="display:flex;justify-content:space-around"><span>Spot</span><span>Bid-Ask</span></p>
        <input type="hidden" id="f-${key}" name="${key}" value="${v}">`;
      return wrap;
    }
    if (info.type === 'boolean') {
      wrap.innerHTML = `<label class="toggle"><input id="f-${key}" name="${key}" type="checkbox" ${info.display ? 'checked' : ''}> ${esc(info.label)}</label><p class="meta">Default ${info.defaultDisplay ? 'aktif' : 'nonaktif'} · hanya paper</p>`;
      return wrap;
    }
    wrap.innerHTML = `
      <label for="f-${key}">${info.label}</label>
      <p class="meta">Default ${info.defaultDisplay} ${info.unit} · rentang ${info.displayMin}–${info.displayMax} ${info.unit}</p>
      <input id="f-${key}" name="${key}" type="number" step="${info.type==='integer'?'1':'any'}" required
        min="${info.displayMin}" max="${info.displayMax}" value="${info.display}">
    `;
    return wrap;
  }

  const strategyKeys=['NOTIFY_RESHAPE','QUOTE_FAILURE_POLLS','RANGE_DOWN_PCT', 'LOWER_BINS', 'RANGE_UP_PCT', 'UPPER_BUFFER_BINS', 'OPEN_SHAPE', 'OPEN_SPOT_PCT', 'RESHAPE_ENABLED', 'RESHAPE_N', 'RESHAPE_SHAPE', 'COMPOUND_ENABLED', 'COMPOUND_SPOT_PCT', 'MAX_POSITION_TVL_PCT', 'TP_USD_PCT', 'EMERGENCY_DROP', 'EMERGENCY_TP_ENABLED', 'EMERGENCY_TP_TRIGGER_RANGE_PCT', 'EMERGENCY_TP_PCT','EMERGENCY_SLPLUS_ENABLED','EMERGENCY_SLPLUS_ARM_PCT','EMERGENCY_SLPLUS_LOCK_PCT','EMERGENCY_SLPLUS_CONFIRM_POLLS','EMERGENCY_SLPLUS_FLOOR_PCT','EMERGENCY_SLPLUS_FLOOR_POLLS', 'OOR_RIGHT_CLOSE', 'OOR_RIGHT_CONFIRM_POLLS', 'OOR_RIGHT_MIN_BINS', 'OOR_RIGHT_REPOSITION_MIN_PNL_PCT', 'OOR_RIGHT_MIN_PROFIT_PCT', 'OOR_RIGHT_MAX_REPOSITIONS', 'MAX_HOURS', 'TRAIL_ENABLED', 'TRAIL_ARM_PCT', 'TRAIL_DROP_PCT', 'OOR_MAX_MIN', 'GAS_BUFFER_SOL'];
  const ppKeys=['EMERGENCY_TP_ENABLED','EMERGENCY_TP_TRIGGER_RANGE_PCT','EMERGENCY_TP_PCT','EMERGENCY_SLPLUS_ENABLED','EMERGENCY_SLPLUS_ARM_PCT','EMERGENCY_SLPLUS_LOCK_PCT','EMERGENCY_SLPLUS_CONFIRM_POLLS','EMERGENCY_SLPLUS_FLOOR_PCT','EMERGENCY_SLPLUS_FLOOR_POLLS'];
  function boldField(el,key){if(/^TRAIL_/.test(key)){el.style.fontWeight='800';el.querySelectorAll('label').forEach(l=>{l.style.fontWeight='800';l.style.color='#e9d5ff';});}if(key==='EMERGENCY_DROP'||key==='EMERGENCY_TP_ENABLED')el.querySelectorAll('label').forEach(l=>l.style.fontWeight='700');return el;}
  function trailWarning(){return new Promise(resolve=>{
    const d=document.createElement('dialog');
    d.innerHTML='<h2 style="margin:0 0 10px;font-size:15px">⚠️ Aktifkan Trailing Stop?</h2><p class="meta" style="font-size:12px;line-height:1.6">Default: trailing <b>OFF</b>. Jika ON, posisi bisa ditutup otomatis saat profit turun dari puncak (sesuai Arm &amp; Turun dari puncak), termasuk posisi yang sudah open.</p><label class="toggle" style="font-size:12px;color:inherit"><input type="checkbox" id="trail-ack"> <b>Saya paham trailing stop aktif dan bisa menutup posisi otomatis saat profit turun dari puncak.</b></label><div class="btn-row"><button type="button" class="btn ghost" id="trail-cancel">Batal</button><button type="button" class="btn primary" id="trail-ok" disabled>Aktifkan</button></div>';
    document.body.appendChild(d);
    const done=v=>{try{d.close();}catch{}d.remove();resolve(v);};
    d.querySelector('#trail-ack').onchange=e=>{d.querySelector('#trail-ok').disabled=!e.target.checked;};
    d.querySelector('#trail-cancel').onclick=()=>done(false);
    d.querySelector('#trail-ok').onclick=()=>done(d.querySelector('#trail-ack').checked);
    d.addEventListener('cancel',e=>{e.preventDefault();done(false);});
    d.showModal();
  });}
  // ---- Modal USDC / SOL (menu Live). Satu setelan bersama: dry run dan live memakai aset modal yang sama.
  function renderCapital() {
    const cur = state.fields?.CAPITAL_ASSET?.value || null;
    for (const id of ['USDC', 'SOL']) {
      const b = $('btn-cap-' + id); if (!b) continue;
      b.classList.toggle('active', cur === id); b.setAttribute('aria-pressed', String(cur === id));
    }
    const n = $('capital-note');
    if (n) n.textContent = cur ? ('Modal aktif: ' + cur + (cur === 'SOL' ? ' · budget posisi = USD setara SOL saat open; PnL utama dalam SOL.' : ' · PnL utama dalam USDC (sudah termasuk swap, gas, rent).')) : 'Memuat setelan…';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-capital]'); if (!b || b.disabled) return;
    const to = b.dataset.capital, cur = state.fields?.CAPITAL_ASSET?.value || 'USDC';
    if (to === cur) { showBanner('Modal sudah ' + to + '.'); return; }
    if (!await askConfirm('Ganti aset modal ke ' + to + '?\n\nBerlaku untuk dry run dan live (satu setelan). Saldo bebas dikonversi pada quote/estimasi saat bot memproses, biaya swap berlaku. Hanya posisi BARU memakai basis dan aturan exit aset ini; posisi lama tetap basis lama.')) return;
    document.querySelectorAll('[data-capital]').forEach(x => { x.disabled = true; });
    try {
      const { status, json } = await api('POST', '/api/settings', { settings: { CAPITAL_ASSET: to }, capitalAssetConfirmed: true });
      if (status !== 200 || !json.ok) { const rej = (json.rejected || []).map(r => r.key + ': ' + r.reason).join('; '); showBanner('Modal tidak diganti. ' + (rej || json.reason || json.error || status), true); }
      else showBanner('Modal sekarang ' + to + '. Berlaku untuk posisi baru (dry run & live).');
    } catch (err) { showBanner('Ganti modal gagal: ' + err.message, true); }
    finally { document.querySelectorAll('[data-capital]').forEach(x => { x.disabled = false; }); await refresh(); }
  });

  function renderSettings(payload) {
    state.fields = payload.fields;
    renderCapital();
    renderUnits();
    state.paused = !!payload.paused;
    const form = $('settings-form');
    form.innerHTML = '';
    // Everything that decides how much of the wallet is used sits at the very top.
    const walletKeys=['MAX_POSITIONS','POSITION_SOL_OPEN','POSITION_USDC','GAS_BUFFER_SOL','MAX_NONREFUND_SOL','USDC_BUFFER'];
    {const g=document.createElement('fieldset');g.className='strategy-settings wallet-settings';g.innerHTML='<legend>Wallet &amp; ukuran posisi</legend><p class="meta">Berapa banyak wallet yang dipakai: jumlah posisi, budget per posisi, dan buffer. Berlaku untuk dry run dan live. Aset modal (SOL/USDC) dipilih di Wallet → Live.</p>';for(const k of walletKeys){const fi=payload.fields[k];if(fi)g.appendChild(fieldInput(k,fi));}form.appendChild(g);}
    const section=document.createElement('fieldset');section.className='strategy-settings';section.innerHTML='<legend>Strategy · N5</legend><p class="meta">Berlaku hanya posisi baru. Posisi open tetap memakai snapshot strategi saat entry. Range bawah = target coverage bin (bin dibulatkan); range atas 0 memakai jumlah bin atas. MIXED memakai persentase Spot; Bid-Ask sisanya. Ini bukan split token/quote: porsi token/quote mengikuti jumlah bin atas/bawah.</p>';form.appendChild(section);
    for(const key of strategyKeys)if(payload.fields[key])section.appendChild(boldField(fieldInput(key,payload.fields[key]),key));
    const order = [
      'MIN_FT', 'MIN_LIQ_USD', 'MAX_LIQ_USD', 'MAX_NONREFUND_SOL', 'MIN_AGE_H', 'MIN_TOKEN_AGE_H', 'MAX_TOKEN_AGE_H', 'MIN_BIN_STEP', 'MAX_BIN_STEP', 'POSITION_USDC', 'POSITION_SOL_OPEN', 'REOPEN_COOLDOWN_MIN', 'SL_BLACKLIST_ENABLED', 'MAX_PUMP24H_PCT', 'MAX_POSITIONS', 'UPPER_BUFFER_BINS', 'OOR_RIGHT_CONFIRM_POLLS', 'OOR_RIGHT_MIN_BINS', 'OOR_RIGHT_REPOSITION_MIN_PNL_PCT', 'OOR_RIGHT_MIN_PROFIT_PCT', 'OOR_RIGHT_MAX_REPOSITIONS', 'RESHAPE_N', 'TP_USD_PCT', 'OOR_RIGHT_CLOSE', 'TRAIL_ENABLED', 'TRAIL_ARM_PCT', 'TRAIL_DROP_PCT', 'OOR_MAX_MIN', 'EMERGENCY_DROP',
      'STALE_CLOSE_ENABLED', 'MAX_HOURS', 'STALE_EXIT_MODE', 'STALE_EXIT_PCT', 'GAS_BUFFER_SOL', 'MAX_PUMP1H', 'VOL_SPIKE_1H_OF_24H', 'MIN_VOL24H_TVL_X',
    ];
    const staleGroup=['MAX_HOURS','STALE_CLOSE_ENABLED','STALE_EXIT_MODE','STALE_EXIT_PCT'];
    const budgetHint=()=>{const el=form.querySelector('#f-POSITION_USDC'),px=+(lastPayload?.status?.summary?.stats?.solUsd||0);if(!el||el.parentNode.querySelector('.budget-sol'))return;const pp=document.createElement('p');pp.className='meta budget-sol';const upd=()=>{const v=+el.value;pp.textContent=px>0&&v>0?`≈ ${(v/px).toFixed(4)} SOL @ $${px.toFixed(2)} (mode modal SOL: budget ini dibagi harga SOL saat open)`:'0 = saldo bebas dibagi slot kosong';};el.addEventListener('input',upd);upd();el.parentNode.appendChild(pp);};
    const gasHint=()=>{const el=form.querySelector('#f-GAS_BUFFER_SOL'),h=payload.hints?.gasBuffer;if(!el||!h||el.parentNode.querySelector('.gas-reco'))return;const pp=document.createElement('p');pp.className='meta gas-reco';const f=n=>Number(n).toFixed(4);pp.innerHTML=`<b>Rekomendasi ${esc(String(h.recommended))} SOL.</b> Hitungan: rent posisi + ATA ${f(h.parts.rentRefundable)} + bin array non-refund maks ${f(h.parts.rentNonRefundable)} (dari MAX_NONREFUND_SOL) + biaya tx ${f(h.parts.txFees)} = ${f(h.raw)} × margin ${esc(String(h.margin))} = ${f(h.needed)} SOL, dibulatkan ke atas kelipatan 0,05. Angka di kolom ini hanya lantai: tiap open bot memakai yang lebih besar dari lantai dan kebutuhan pool itu. Buffer ikut dihitung di dalam budget posisi. <button type="button" class="btn ghost" id="gas-use-reco">Pakai ${esc(String(h.recommended))}</button>`;el.parentNode.appendChild(pp);pp.querySelector('#gas-use-reco').onclick=()=>{el.value=h.recommended;el.dispatchEvent(new Event('input',{bubbles:true}));};};
    const solOpenHint=()=>{const el=form.querySelector('#f-POSITION_SOL_OPEN');if(!el||el.parentNode.querySelector('.solopen-note'))return;const pp=document.createElement('p');pp.className='meta solopen-note';const upd=()=>{const v=+el.value;pp.textContent=v>0?`Mode modal SOL: tiap open memakai tepat ${v} SOL termasuk buffer gas (Budget USDC diabaikan). Butuh saldo bebas minimal ${v} SOL.`:'0 = pakai Budget USDC ÷ harga SOL saat open. Mode modal USDC selalu memakai Budget USDC.';};el.addEventListener('input',upd);upd();el.parentNode.appendChild(pp);};
    for (const key of order) {
      if(walletKeys.includes(key))continue;   // already rendered in the wallet group above
      if(staleGroup.includes(key)){if(!form.querySelector('.stale-settings')){const g=document.createElement('fieldset');g.className='strategy-settings stale-settings';g.innerHTML='<legend>Close stale</legend><p class="meta">Tutup posisi yang sudah lama open. Jam batas posisi open tetap sesuai saat entry; ON/OFF dan syarat berlaku juga ke posisi open.</p>';for(const k of staleGroup){const fi=payload.fields[k];if(!fi)continue;const lbl=k==='MAX_HOURS'?'Stale setelah berapa jam (posisi open memakai jam saat entry)':String(fi.label).replace(/^Stale close:\s*/,'').replace(/^./,c=>c.toUpperCase());g.appendChild(fieldInput(k,{...fi,label:lbl}));}form.appendChild(g);}continue;}
      if (payload.fields[key]&&!strategyKeys.includes(key)) form.appendChild(key==='SL_BLACKLIST_ENABLED'?boldField(fieldInput(key,payload.fields[key]),'EMERGENCY_DROP'):pumpHint(key,fieldInput(key, payload.fields[key])));
    }
    try{budgetHint();}catch{}
    try{solOpenHint();}catch{}
    try{gasHint();}catch{}
    {const g=document.createElement('fieldset');g.className='strategy-settings token-filter-settings';g.innerHTML='<legend>Filter token (anti rug / anti PvP)</legend><p class="meta">Master OFF melewati semua filter di grup ini tanpa menghapus pilihan per filter. Cek mint/freeze on-chain, filter dasar (fee/TVL, TVL, umur, bin step, volume) dan SL blacklist (termasuk blok manual) tetap jalan.</p>';for(const k of tokenFilterKeys){const fi=payload.fields[k];if(!fi)continue;const el=fieldInput(k,fi);if(k==='FILTERS_ENABLED')boldField(el,'EMERGENCY_DROP');if(k==='TVL_DROP_MAX_PCT'||k==='TVL_DROP_FILTER_ENABLED'){const p=document.createElement('p');p.className='meta';p.textContent='Hanya entry baru: bandingkan TVL pool sekarang vs TVL saat entry terakhir token yang sama (history atau posisi open). Posisi open tidak ditutup.';el.appendChild(p);}g.appendChild(el);}form.appendChild(g);
      const m=g.querySelector('#f-FILTERS_ENABLED'),sync=()=>{for(const k of tokenFilterKeys.slice(1)){const el=g.querySelector('#f-'+k);if(el)el.closest('.field').style.opacity=m&&!m.checked?'.45':'';}};if(m){m.addEventListener('change',sync);sync();}}
    renderSlBlacklist(payload.slBlacklist||[]);
  }

  function renderSlBlacklist(list){
    let box=document.getElementById('sl-blacklist');
    if(!box){box=document.createElement('div');box.id='sl-blacklist';box.className='card';$('settings-form').insertAdjacentElement('afterend',box);}
    box.innerHTML='<div class="section-head" style="margin:0 0 8px"><h2>🚫 SL blacklist ('+list.length+')</h2></div><p class="meta">Token yang pernah kena Stop Loss tidak dibuka lagi (semua pool/fee tier token itu). Hapus untuk mengizinkan lagi.</p>'+
      (list.length?list.map(x=>`<div class="row"><div><b>${esc(x.symbol||'?')}</b><br><span class="k">${esc(x.mint)}</span><br><span class="k">${esc(x.reason||'')} · ${x.closedAt?esc(wib(x.closedAt)):''}</span></div><div><button type="button" class="btn danger" data-slbl-remove="${esc(x.mint)}" data-slbl-sym="${esc(x.symbol||'')}">Hapus</button></div></div>`).join(''):'<div class="empty">Kosong</div>');
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-slbl-remove]');if(!b||b.disabled)return;
    const mint=b.dataset.slblRemove,sym=b.dataset.slblSym;
    if(!await askConfirm('Hapus '+sym+' dari SL blacklist? Bot boleh membuka token ini lagi jika lolos screening.'))return;
    b.disabled=true;
    const {status,json}=await api('POST','/api/sl-blacklist/remove',{mint,confirmed:true});
    if(status!==200||!json.ok){showBanner('Gagal hapus: '+(json.error||status),true);b.disabled=false;return;}
    showBanner(sym+' dihapus dari SL blacklist.');renderSlBlacklist(json.slBlacklist||[]);
  });
  function collectDisplay() {
    const out = { _display: true };
    if (!state.fields) return out;
    for (const key of Object.keys(state.fields)) {
      const el = document.getElementById('f-' + key);
      if (el) out[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out;
  }

  function renderWallet(w) { renderRpc(w && w.rpc);
    $('wallet-address').innerHTML = (w && w.hasKey && w.publicAddress) ? addrSpan(w.publicAddress) : 'Belum ada key';
    $('wallet-updated').textContent = (w && w.source === 'env') ? 'Sumber: .env (teks polos, belum terenkripsi). Disarankan pindah ke penyimpanan terenkripsi: jalankan set-wallet-key.js lewat SSH, lalu hapus baris PRIVATE_KEY dari .env.' : ((w && w.updatedWib) ? ('Disimpan: ' + w.updatedWib) : '');
    const input = $('wallet-secret');
    if (input) input.value = '';
  }

  function renderLive(L) {
    if (!L) return;
    state.paperAllowed=!!L.stopPresent&&!L.liveRunning&&L.liveStatus!=='unknown';
    if(lastPayload)renderStatus(lastPayload);
    const check = L.balanceCheck || {};
    const rows = [
      ['Key', L.hasKey ? 'tersimpan' : 'belum ada'],
      ['Address', addrSpan(L.publicAddress)],
      ['SOL', L.sol != null ? Number(L.sol).toFixed(4) : 'n/a'],
      ['USDC', L.usdc != null ? Number(L.usdc).toFixed(2) : 'n/a'],
      ['Saldo', check.ok ? 'cukup untuk live' : ('belum cukup: ' + ((check.reasons || []).join('; ') || 'belum lolos') + ' (live menolak jalan, dry run tetap)')],
      ['RPC', rpcSlotsText(L.rpcSlots)],
      ['Live', L.liveRunning ? 'ON (berjalan)' : L.stopPresent === false ? 'ON (status proses dicek ulang…)' : 'OFF (dry run jalan)'],
      ...(L.testSession ? [['Tes live', L.testSession.expired ? 'habis' : ('AKTIF: maks ' + L.testSession.maxPositions + ' posisi, ' + L.testSession.maxPositionSol + ' SOL/posisi' + (Date.parse(L.testSession.expiresAt) > Date.parse('2090-01-01') ? ', tanpa batas waktu' : ', sisa ' + Math.round(L.testSession.msLeft / 60000) + ' menit'))]] : []),
      ...(L.noNew ? [['Posisi baru', 'dihentikan (posisi yang ada tetap dikelola)']] : []),
    ];
    $('live-status').innerHTML = rows.map(([k, v]) => `<div class="row"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    {
      const tb = $('live-test-box'); if (tb) {
        tb.classList.toggle('hidden', !((L.gates && L.gates.length) && L.capitalAsset === 'SOL'));
        const d = L.testDefaults || {};
        for (const [id, k] of [['test-max-pos', 'maxPositions'], ['test-max-sol', 'maxPositionSol'], ['test-hours', 'hours']]) { const el = $(id); if (!el) continue; if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('input', () => { el.dataset.touched = '1'; }); } if (!el.dataset.touched && !el.value) el.value = d[k] ?? ''; }
      }
    }
    state.liveRunning = !!L.liveRunning || L.stopPresent === false;   // LIVE = the lock file is gone; the process may be restarting for a few seconds
    state.liveWallet = (L.sol != null) ? { sol: Number(L.sol), usdc: Number(L.usdc) || 0 } : null;
    // Same rule as state.liveRunning: a brief pm2 "unknown"/restart must not flip the wallet, equity and pills back to dry run.
    const liveOn = state.liveRunning;
    window.WarlockLiveWallet = liveOn ? state.liveWallet : null;
    applyModeChrome(liveOn);
    { const d = $('mode-dry'), l = $('mode-live'), n = $('mode-note');
      if (d && l) { d.classList.toggle('on', !liveOn); l.classList.toggle('on', liveOn); d.setAttribute('aria-pressed', String(!liveOn)); l.setAttribute('aria-pressed', String(liveOn)); }
      if (n) n.textContent = liveOn ? 'Mode sekarang: LIVE (uang asli). Pilih DRY RUN untuk mematikan live.' : 'Mode sekarang: DRY RUN (simulasi). Pilih LIVE untuk menyalakan live.'; }
    $('btn-arm').disabled = !!L.liveRunning;   // always pressable (even without key / balance): the refusal is shown AFTER the confirmation
    $('btn-arm').textContent = L.liveRunning ? 'Live sedang ON' : 'Live ON';
  }

  async function refresh() {
    if (!initData()) {
      showBanner('Buka mini app ini dari Telegram biar auth-nya jalan. Write dikunci di luar Telegram.', true);
    }
    if (!initData()) return;
    const { status, json } = await api('GET', '/api/settings');
    if (status !== 200 || !json.ok) {
      showBanner(json.reason === 'user not allowed' || json.reason === 'locked out'
        ? ('Akses ditolak' + (json.reason === 'locked out' ? ' (lockout sementara).' : '. Mini app ini hanya untuk pemilik.'))
        : ('Gagal memuat (' + (json.reason || json.error || status) + ').'), true);
      return;
    }
    if (initData()) showBanner('');
    if (window.WarlockI18n && json.lang) window.WarlockI18n.sync(json.lang);   // same language as the Telegram chat
    renderStatus(json);
    lastSuccessAt=Date.now();
    renderSettings(json);
    const w = await api('GET', '/api/wallet');
    if (w.status === 200 && w.json.ok) renderWallet(w.json);
    const L = await api('GET', '/api/live');
    if (L.status === 200 && L.json.ok) renderLive(L.json);
  }

  // ---- PnL Calendar (Wallet sub-menu) ----
  const cal={data:null,ym:null,busy:false,unit:(()=>{try{return localStorage.getItem('calUnit')==='SOL'?'SOL':'USD';}catch(_){return 'USD';}})()};
  const wibNow=()=>new Date(); /* calendar days are UTC dates: reset 00:00 UTC = 07:00 WIB */
  cal.liveUnit=(()=>{try{return localStorage.getItem('calUnitLive');}catch(_){return null;}})();
  const calSol=()=>cal.data?.unit==='SOL'?(cal.liveUnit||'SOL')==='SOL':cal.unit==='SOL';   // LIVE modal SOL: default SOL
  const calMoney=v=>calSol()?(v>=0?'+':'−')+Math.abs(v).toFixed(Math.abs(v)>=10?2:3)+' SOL':(v>=0?'+':'−')+'$'+Math.abs(v).toFixed(Math.abs(v)>=100?0:2);
  const calFmt=v=>calSol()?calMoney(Number(v)||0):signed(v);   // tampilan rinci: USD pakai format biasa, SOL pakai 3-6 desimal
  const MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  function renderCal(){
    const box=$('pnlcal');if(!box)return;const d=cal.data;
    if(!d){box.innerHTML='<div class="empty">Memuat PnL calendar…</div>';return;}
    if(!cal.ym){const n=wibNow();cal.ym=[n.getUTCFullYear(),n.getUTCMonth()];}
    const [y,m]=cal.ym,pre=`${y}-${String(m+1).padStart(2,'0')}-`,first=(new Date(Date.UTC(y,m,1)).getUTCDay()+6)%7,dim=new Date(Date.UTC(y,m+1,0)).getUTCDate(),today=wibNow().toISOString().slice(0,10);
    let tot=0,trades=0,win=0,loss=0,cells='';
    for(let i=0;i<first;i++)cells+='<div class="cal-cell cal-pad"></div>';
    for(let day=1;day<=dim;day++){const k=pre+String(day).padStart(2,'0'),x=d.days[k];let cls='cal-cell',body='';
      if(x){const pv=calSol()?(x.pnlSol??0):x.pnl;tot+=pv;trades+=x.trades;pv>0?win++:pv<0?loss++:0;cls+=pv>0?' cal-pos':pv<0?' cal-neg':' cal-flat';body=`<b>${esc(calMoney(pv))}</b><small>${x.trades} trx</small>`;}
      if(k===today)cls+=' cal-today';cells+=`<button type="button" class="${cls}" data-cal-day="${k}" aria-label="Rincian ${day} ${MONTHS[m]} ${y}"><span class="cal-day">${day}</span>${body}</button>`;}
    const mo=d.mode||{label:'DRY RUN'},badge=`<span class="cal-mode ${mo.live?'live':'dry'}">${esc(mo.label)}</span>`;
    box.innerHTML=`<div class="section-head" style="margin:0 0 10px"><h2>📅 PnL Calendar</h2>${badge}</div>
      <div class="seg cal-unit" role="group" aria-label="Satuan PnL"><button type="button" class="seg-btn ${calSol()?'':'active'}" data-cal-unit="USD" aria-pressed="${!calSol()}">USD</button><button type="button" class="seg-btn ${calSol()?'active':''}" data-cal-unit="SOL" aria-pressed="${calSol()}">SOL</button></div>
      <div class="cal-nav"><button type="button" class="btn ghost" data-cal-step="-1" aria-label="Bulan sebelumnya">‹</button><strong>${MONTHS[m]} ${y}</strong><button type="button" class="btn ghost" data-cal-step="1" aria-label="Bulan berikutnya">›</button></div>
      <div class="cal-total"><span class="k">Realized bulan ini</span><strong class="mono ${tot>0?'positive':tot<0?'negative':''}">${esc(calSol()?calMoney(+tot.toFixed(6)):signed(+tot.toFixed(4)))}</strong>${calSol()&&solPx()>0?usdSub(tot*solPx()):''}<small>${trades} trade · ${win} hari profit · ${loss} hari rugi</small></div>
      <div class="cal-grid cal-head">${['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(w=>`<div>${w}</div>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <p class="meta cal-foot">Hari = tanggal UTC. Sumber: history realized (semua history termasuk posisi arsip, sama dengan Total PnL). Total semua waktu ${esc(calSol()?calMoney(d.totalSol??0):signed(d.total))} · ${d.trades} trade. Mode ${esc(mo.label)}${mo.live?'':' — simulasi paper, bukan uang sungguhan'}.</p><p class="meta cal-foot">🕖 Reset harian: <b>07:00 WIB</b> = <b>00:00 UTC</b></p>`;
  }
  async function loadCal(){if(cal.busy)return;cal.busy=true;try{const r=await api('GET','/api/pnl-calendar');if(r.status===200&&r.json.ok){cal.data=r.json;}else if(!cal.data){$('pnlcal').innerHTML='<div class="empty">Gagal memuat PnL calendar ('+esc(r.json.reason||r.json.error||r.status)+').</div>';cal.busy=false;return;}}catch(e){}cal.busy=false;renderCal();}
  function calDayTitle(k){
    const p=String(k||'').split('-');
    if(p.length!==3)return k||'';
    const y=+p[0],m=+p[1]-1,d=+p[2];
    if(!Number.isFinite(y)||m<0||m>11||!Number.isFinite(d))return k||'';
    return `${d} ${MONTHS[m]} ${y}`;
  }
  function calTimeWib(at){
    if(!at||!Number.isFinite(Date.parse(at)))return '—';
    return new Date(at).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' WIB';
  }
  function calTone(n){return n>0?'positive':n<0?'negative':'';}
  function openCalDay(k){
    const modal=$('cal-day-modal'),body=$('cal-day-body'),title=$('cal-day-title');
    if(!modal||!body||!title)return;
    title.textContent=calDayTitle(k);
    const d=cal.data,day=d&&d.days&&d.days[k],rows=day&&Array.isArray(day.rows)?day.rows:[];
    if(!rows.length){
      body.innerHTML='<div class="empty">Tidak ada trade</div>';
      showSheet(modal);
      return;
    }
    const S=calSol(),profit=S?(day.profitSol??0):day.profit,minus=S?(day.minusSol??0):day.minus,net=S?(day.pnlSol??0):day.pnl,wins=day.wins||0,losses=day.losses||0;
    const tokens=Array.isArray(day.tokens)?day.tokens:[];
    const tokHtml=tokens.length?`<div class="cal-day-sec"><div class="k">Per token</div>${tokens.map(t=>`<div class="cal-tok"><span class="cal-tok-name">${esc(t.name)}</span><span class="cal-tok-n">${t.trades} trade</span><strong class="mono ${calTone(S?t.pnlSol:t.pnl)}">${esc(calFmt(S?t.pnlSol:t.pnl))}</strong></div>`).join('')}</div>`:'';
    const listHtml=`<div class="cal-day-sec"><div class="k">Trade</div>${rows.map(r=>`<div class="cal-day-row"><div><strong>${esc(r.name)}</strong><small>${esc(calTimeWib(r.closedAt))}</small></div><strong class="mono ${calTone(S?r.pnlSol:r.pnlUsd)}">${esc(S?calMoney(r.pnlSol??0):signedWithPct(r.pnlUsd,r.capital))}</strong></div>`).join('')}</div>`;
    body.innerHTML=`<div class="cal-day-sums">
      <div class="cal-day-sum"><span class="k">Total profit</span><strong class="mono ${calTone(profit)}">${esc(calFmt(profit))}</strong><small>${wins} trade menang</small></div>
      <div class="cal-day-sum"><span class="k">Total minus</span><strong class="mono ${calTone(minus)}">${esc(calFmt(minus))}</strong><small>${losses} trade rugi</small></div>
      <div class="cal-day-sum net"><span class="k">Netto</span><strong class="mono ${calTone(net)}">${esc(calFmt(net))}</strong><small>${day.trades} trade · ${wins}W · ${losses}L${day.be?' · '+day.be+' BE':''} · sama dengan sel kalender</small></div>
    </div>${tokHtml}${listHtml}`;
    showSheet(modal);
  }
  document.addEventListener('click',e=>{
    const unitBtn=e.target.closest('[data-cal-unit]');if(unitBtn){const u=unitBtn.dataset.calUnit==='SOL'?'SOL':'USD';if(cal.data?.unit==='SOL'){cal.liveUnit=u;try{localStorage.setItem('calUnitLive',u);}catch(_){}}else{cal.unit=u;try{localStorage.setItem('calUnit',u);}catch(_){}}renderCal();return;}
    const dayBtn=e.target.closest('[data-cal-day]');if(dayBtn){openCalDay(dayBtn.dataset.calDay);return;}
    const s=e.target.closest('[data-cal-step]');if(s&&cal.ym){let [y,m]=cal.ym;m+=+s.dataset.calStep;if(m<0){m=11;y--;}if(m>11){m=0;y++;}cal.ym=[y,m];renderCal();return;}
    const w=e.target.closest('[data-wallet-view]');if(!w)return;setWalletView(w.dataset.walletView);
  });
  function setWalletView(v){
    if(!['key','pnlcal','live'].includes(v))return;
    document.querySelectorAll('[data-wallet-view]').forEach(b=>{const a=b.dataset.walletView===v;b.classList.toggle('active',a);b.setAttribute('aria-selected',String(a));});
    $('wallet-key-view').classList.toggle('hidden',v!=='key');$('wallet-pnlcal-view').classList.toggle('hidden',v!=='pnlcal');$('wallet-live-view').classList.toggle('hidden',v!=='live');if(v==='pnlcal')return loadCal();
  }
  setInterval(()=>{if(!$('wallet-pnlcal-view')?.classList.contains('hidden')&&!$('panel-wallet')?.classList.contains('hidden'))loadCal();},60000);

  // ---- Tabs + Dashboard navigation (Dashboard is the default front tab; every dashboard card calls SWApp.go) ----
  function showTab(name){
    const btn=document.querySelector('.tab[data-tab="'+name+'"]');if(!btn)return;
    document.querySelectorAll('.tab').forEach((b)=>{const a=b===btn;b.classList.toggle('active',a);b.setAttribute('aria-selected',String(a));});
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.remove('hidden');
    document.body.classList.toggle('dash-wide',name==='dashboard');
    if(name==='dashboard'&&window.SWDash){try{if(lastPayload)window.SWDash.render(lastPayload);window.SWDash.loadCal&&window.SWDash.loadCal(false);}catch(e){}}
  }
  document.querySelectorAll('.tab').forEach((btn) => { btn.onclick = () => showTab(btn.dataset.tab); });
  function focusSetting(key){
    const el=$('f-'+key),box=el&&(el.closest('.field')||el.closest('fieldset')||el);
    if(!box)return false;
    try{box.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}
    box.classList.add('dash-flash');setTimeout(()=>box.classList.remove('dash-flash'),2200);return true;
  }
  function go(target){
    const [tab,sub,extra]=String(target||'').split(':');
    if(!['dashboard','status','settings','wallet'].includes(tab))return;
    showTab(tab);
    if(tab==='status'&&sub)setPositionView(sub);
    if(tab==='wallet'&&sub){const p=setWalletView(sub);if(sub==='pnlcal'&&extra&&/^\d{4}-\d\d-\d\d$/.test(extra)){Promise.resolve(p).then(()=>{if(!cal.data)return loadCal();}).then(()=>openCalDay(extra)).catch(()=>{});}}
    if(tab==='settings'&&sub){setTimeout(()=>{if(!focusSetting(sub))window.scrollTo(0,0);},80);}
    else{try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){}}
    if(tg?.HapticFeedback){try{tg.HapticFeedback.selectionChanged();}catch(e){}}
  }
  window.SWApp={api,go,showTab,closeTag,wib,openCalDay,loadCal};

  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    for(const k of ratioKeys){const h=document.getElementById('f-'+k);if(h&&h.value===''){showBanner(ratioLabels[k]+' tidak valid: isi angka bulat 0–100 dan jumlah harus 100 (mis. 25:75).',true);return;}}
    const patch=collectDisplay(),switching=patch.CAPITAL_ASSET!==undefined&&patch.CAPITAL_ASSET!==(state.fields?.CAPITAL_ASSET?.value||'USDC');
    if(switching&&!await askConfirm('Ganti aset modal ke '+patch.CAPITAL_ASSET+'? Saldo bebas dikonversi pada quote/estimasi saat bot memproses, biaya swap berlaku. Hanya posisi BARU memakai basis/aturan exit aset ini; posisi lama tetap basis lama.'))return;
    const trailTurningOn=patch.TRAIL_ENABLED===true&&state.fields?.TRAIL_ENABLED?.value!==true;
    if(trailTurningOn&&!await trailWarning()){showBanner('Trailing stop tetap OFF. Tidak ada yang disimpan.',true);return;}
    if(patch.SL_BLACKLIST_ENABLED!==undefined&&patch.SL_BLACKLIST_ENABLED!==state.fields?.SL_BLACKLIST_ENABLED?.value&&!await askConfirm('SL blacklist '+(patch.SL_BLACKLIST_ENABLED?'ON: token yang kena Stop Loss tidak akan dibuka lagi.':'OFF: token yang pernah kena Stop Loss boleh dibuka lagi.')+' Lanjut?'))return;
    const staleKeys=['STALE_CLOSE_ENABLED','MAX_HOURS','STALE_EXIT_MODE','STALE_EXIT_PCT'];
    if(staleKeys.some(k=>patch[k]!==undefined&&String(patch[k])!==String(state.fields?.[k]?.value))){const md=patch.STALE_EXIT_MODE,x=patch.STALE_EXIT_PCT,desc=!patch.STALE_CLOSE_ENABLED?'OFF (posisi tidak ditutup karena umur)':'ON setelah '+patch.MAX_HOURS+' jam · '+(md==='ANY'?'tutup langsung berapa pun PnL':md==='MINUS'?'tutup saat PnL ≥ -'+x+'%':md==='BEP'?'tutup saat PnL ≥ 0 (BEP)':'tutup saat PnL ≥ +'+x+'%');if(!await askConfirm('Stale close: '+desc+'. ON/OFF dan syarat berlaku juga ke posisi open; jam batas posisi open tetap sesuai saat entry. Lanjut?'))return;}
    const ppChanged=ppKeys.some(k=>patch[k]!==undefined&&String(patch[k])!==String(state.fields?.[k]?.value));
    if(ppChanged&&!await askConfirm('TP emergency berlaku untuk SEMUA posisi (termasuk yang sudah open): posisi yang harganya pernah turun ≥ '+patch.EMERGENCY_TP_TRIGGER_RANGE_PCT+'% dari range bawah saat open (range -50% → -'+(patch.EMERGENCY_TP_TRIGGER_RANGE_PCT/2)+'%) memakai target TP +'+patch.EMERGENCY_TP_PCT+'% (bukan TP normal). Status: '+(patch.EMERGENCY_TP_ENABLED?'ON':'OFF')+'. TP Emergency SL+: '+(patch.EMERGENCY_SLPLUS_ENABLED?'ON · aktif setelah TP emergency bila PnL menyentuh +'+patch.EMERGENCY_SLPLUS_ARM_PCT+'%, tutup bila PnL ≤ +'+patch.EMERGENCY_SLPLUS_LOCK_PCT+'% selama '+patch.EMERGENCY_SLPLUS_CONFIRM_POLLS+' poll; pelindung BEP: langsung tutup bila PnL ≤ '+(Number(patch.EMERGENCY_SLPLUS_FLOOR_PCT)===0?'BEP (0%)':'+'+patch.EMERGENCY_SLPLUS_FLOOR_PCT+'%')+(Number(patch.EMERGENCY_SLPLUS_FLOOR_POLLS)>1?' selama '+patch.EMERGENCY_SLPLUS_FLOOR_POLLS+' poll':'')+' (berlaku juga ke posisi open)':'OFF')+'. Lanjut?'))return;
    const strategyChanged=strategyKeys.filter(k=>!ppKeys.includes(k)).some(k=>patch[k]!==undefined&&String(patch[k])!==String(state.fields?.[k]?.value));if(strategyChanged&&!await askConfirm(ratioKeys.filter(k=>patch[k]!==undefined&&String(patch[k])!==String(state.fields?.[k]?.value)).map(k=>ratioLabels[k]+' '+fmtRatio(state.fields[k].value)+' → '+fmtRatio(patch[k])+'. ').join('')+'Simpan perubahan strategi N5? Hanya posisi BARU memakai strategi/risk ini. Posisi yang sudah open tidak diubah.'))return;
    const { status, json } = await api('POST', '/api/settings', { settings: patch,capitalAssetConfirmed:switching,strategyConfirmed:strategyChanged||ppChanged });
    if (status !== 200 || !json.ok) {
      const rej = (json.rejected || []).map((r) => r.key + ': ' + r.reason).join('; ');
      showBanner('Tidak tersimpan. ' + (rej || json.reason || json.error || status), true);
      await refresh();
      return;
    }
    showBanner('Settings paper disimpan. Berlaku di scan berikutnya.');
    await refresh();
  });

  $('btn-reset').onclick = async () => {
    if (!window.confirm('Reset semua settings paper ke default USDC? Jika sedang SOL, saldo bebas akan dikonversi ke USDC dengan biaya paper; posisi lama tetap basis lama.')) return;
    const { status, json } = await api('POST', '/api/settings/reset', {capitalAssetConfirmed:true});
    if (status !== 200 || !json.ok) { showBanner('Reset gagal: ' + (json.reason || json.error || status), true); return; }
    showBanner('Settings dikembalikan ke default.');
    await refresh();
  };

  $('wallet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('wallet-secret');
    const secret = input.value;
    if (!secret.trim()) { showBanner('Tempel private key dulu.', true); return; }
    const age = initAgeSec();
    if (age != null && age > 285) { showBanner('Key belum dikirim: ' + authWhy({ reason: 'initData expired' }), true); return; }   // input is kept so nothing is lost
    let { status, json } = await api('POST', '/api/wallet', { secret });
    if (status !== 200 && /csrf/i.test(String(json && json.reason))) { await api('GET', '/api/wallet'); ({ status, json } = await api('POST', '/api/wallet', { secret })); }
    input.value = '';
    if (status !== 200 || !json.ok) { showBanner('Key tidak disimpan: ' + (json.reason ? authWhy(json) : (json.error || status)), true); return; }
    showBanner('Key tersimpan. Address: ' + maskAddr(json.publicAddress));
    await refresh();
  });

  // ---- Claim Token Account (cek dulu -> konfirmasi -> claim; bisa kapan saja, mint posisi live yang terbuka dijaga server)
  const rentState = { count: 0, sol: 0 };
  function rentShow(text, err) { const el = $('rent-result'); if (el) { el.textContent = text; el.classList.toggle('negative', !!err); } }
  const rentSol = (n) => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  $('btn-rent-scan').onclick = async () => {
    rentShow('Memeriksa…'); $('btn-rent-claim').classList.add('hidden');
    const r = await api('GET', '/api/wallet/rent'); const j = r.json || {};
    if (r.status !== 200 || !j.ok) { rentShow('Cek gagal: ' + (j.error || j.reason || r.status), true); return; }
    rentState.count = j.count || 0; rentState.sol = j.totalSol || 0;
    if (!rentState.count) { rentShow('Tidak ada token account kosong yang bisa ditutup (dari ' + (j.total || 0) + ' akun' + (j.skipped && j.skipped['protected-open-position'] ? ', ' + j.skipped['protected-open-position'] + ' dijaga karena posisi live masih terbuka' : '') + ').'); return; }
    rentShow(rentState.count + ' akun kosong, rent yang bisa diklaim ≈ ' + rentSol(rentState.sol) + ' SOL' + '.');
    $('btn-rent-claim').classList.remove('hidden');
  };
  $('btn-rent-claim').onclick = async () => {
    if (!window.confirm('Tutup ' + rentState.count + ' token account kosong dan kembalikan ≈ ' + rentSol(rentState.sol) + ' SOL ke wallet ini?\n\nHanya akun saldo 0 milik wallet ini. Transaksi disimulasikan dulu; jika ada error, tidak ada yang dikirim.')) return;
    const phrase = window.prompt('Ketik CLAIM untuk mengonfirmasi'); if (phrase !== 'CLAIM') { rentShow('Dibatalkan.'); return; }
    $('btn-rent-claim').classList.add('hidden'); rentShow('Mengklaim…');
    const r = await api('POST', '/api/wallet/rent/claim', { confirm: 'CLAIM' }); const j = r.json || {};
    if (r.status !== 200 || !j.ok) { rentShow('Klaim gagal: ' + (j.error || j.reason || r.status) + (j.closed ? ' (sudah tertutup ' + j.closed + ' akun)' : '') + (j.detail ? ' — ' + j.detail : ''), true); showBanner('Claim Token Account gagal: ' + (j.error || r.status), true); return; }
    rentShow('Selesai: ' + (j.closed || 0) + ' akun ditutup, ≈ ' + rentSol(j.reclaimedSol) + ' SOL kembali.' + (j.remaining ? ' Sisa ' + j.remaining + ' akun, cek lagi lalu klaim.' : ''));
    showBanner('Claim Token Account berhasil: ' + rentSol(j.reclaimedSol) + ' SOL'); await refresh();
  };

  // ---- RPC 1/2/3: write-only fields; the server answers with the last 5 characters only (rpc-store.mask) ----
  function renderRpc(rpc) {
    if (!Array.isArray(rpc)) return;
    for (const r of rpc) { const m = $('rpc-mask-' + r.slot); if (!m) continue;
      const t = r.configured ? r.mask + (r.source === 'env' ? ' (.env)' : '') : 'kosong';
      if (m.textContent !== t) m.textContent = t; }
  }
  async function rpcPost(payload) {
    let { status, json } = await api('POST', '/api/wallet/rpc', payload);
    if (status !== 200 && /csrf/i.test(String(json && json.reason))) { await api('GET', '/api/wallet'); ({ status, json } = await api('POST', '/api/wallet/rpc', payload)); }
    return { status, json: json || {} };
  }
  document.addEventListener('click', async (e) => {
    const sv = e.target.closest && e.target.closest('[data-rpc-save]'), cl = e.target.closest && e.target.closest('[data-rpc-clear]');
    if (!sv && !cl) return;
    e.preventDefault();
    const slot = Number((sv || cl).dataset.rpcSave || (sv || cl).dataset.rpcClear), input = $('rpc-url-' + slot);
    const age = initAgeSec();
    if (age != null && age > 285) { showBanner('RPC belum dikirim: ' + authWhy({ reason: 'initData expired' }), true); return; }
    if (sv) {
      const url = String(input.value || '').trim();
      if (!/^https:\/\/\S+$/i.test(url)) { showBanner('RPC ' + slot + ': isi URL https:// yang lengkap.', true); return; }
      if (!await askConfirm('Simpan RPC ' + slot + '? Disimpan hanya di server (file rahasia, izin 600); yang tampil cuma 5 karakter terakhir. Bot & mini app memakai RPC ini otomatis dalam ±10 detik.')) return;
      const { status, json } = await rpcPost({ slot, url, confirm: 'RPC' });
      input.value = '';
      if (status !== 200 || !json.ok) { showBanner('RPC ' + slot + ' tidak disimpan: ' + (json.reason ? authWhy(json) : (json.error || status)), true); return; }
      renderRpc(json.rpc); showBanner('RPC ' + slot + ' tersimpan (' + ((json.rpc || [])[slot - 1] || {}).mask + '). Aktif otomatis dalam ±10 detik, tanpa restart.');
      return;
    }
    if (!await askConfirm('Hapus RPC ' + slot + '?' + (slot === 1 ? ' RPC 1 hanya bisa dihapus kalau masih ada RPC lain.' : ' Slot ini tidak dipakai lagi sebagai cadangan.'))) return;
    const { status, json } = await rpcPost({ slot, clear: true, confirm: 'RPC' });
    if (status !== 200 || !json.ok) { showBanner('RPC ' + slot + ' tidak dihapus: ' + (json.reason ? authWhy(json) : (json.error || status)), true); return; }
    input.value = ''; renderRpc(json.rpc); showBanner('RPC ' + slot + ' dihapus.');
  });

  $('btn-del-key').onclick = async () => {
    if (!window.confirm('Hapus key dari penyimpanan terenkripsi?')) return;
    const { status, json } = await api('POST', '/api/wallet/delete', {});
    $('wallet-secret').value = '';
    if (status !== 200 || !json.ok) { showBanner('Hapus key gagal: ' + (json.error || json.reason || status), true); return; }
    showBanner('Key dihapus.');
    await refresh();
  };

  function clearArm() {
    state.armId = null;
    $('live-confirm').classList.add('hidden');
    $('live-phrase').value = '';
    if (state.armTimer) { clearInterval(state.armTimer); state.armTimer = null; }
  }

  // Verification gates still open: live runs ONLY as a supervised test session (time-boxed, size-capped). Same arm -> type LIVE -> start flow, plus the limits.
  async function startTestLive() {
    const test = { maxPositions: Number($('test-max-pos')?.value) || undefined, maxPositionSol: Number($('test-max-sol')?.value) || undefined, hours: $('test-hours')?.value === '' ? undefined : Number($('test-hours')?.value) };
    const mp = test.maxPositions ?? 10, ms = test.maxPositionSol ?? 1, hr = (test.hours ?? 24);
    if (!window.confirm('Gerbang verifikasi belum tertutup, jadi live hanya bisa jalan sebagai TES LIVE TERAWASI dengan uang asli:\n\n• maks ' + mp + ' posisi sekaligus\n• maks ' + ms + ' SOL per posisi (termasuk buffer gas)\n• ' + (Number($('test-hours')?.value) === 0 ? 'tanpa batas waktu' : ('sesi ' + hr + ' jam; habis waktu semua posisi ditutup dan bot berhenti')) + '\n\nDry run dihentikan selama live ON. Lanjut?')) return;
    const arm = await api('POST', '/api/live/arm', { mode: 'test', test });
    if (arm.status !== 200 || !arm.json.ok) {
      const j = arm.json || {};
      showBanner('Tes live gagal ON: ' + (j.error === 'balance check failed' ? ('saldo belum cukup (' + ((j.reasons || []).join('; ') || 'cek saldo gagal') + ')') : (j.error || j.reason || arm.status)) + '. Dry run tetap jalan.', true);
      return;
    }
    await new Promise((r) => setTimeout(r, 900));   // stay clear of the server's 0.75 s write rate limit right after the arm call
    const { status, json } = await api('POST', '/api/live/start', { confirm: 'LIVE', mode: 'test', test, armId: arm.json.armId });
    if (status !== 200 || !json.ok) { showBanner('Tes live gagal ON: ' + ((json.reasons || []).join('; ') || json.error || json.reason || status) + '. Dry run tetap jalan.', true); await refresh(); return; }
    showBanner(json.started ? ('Tes live ON: maks ' + mp + ' posisi, ' + ms + ' SOL/posisi, ' + (hr === 0 ? 'tanpa batas waktu' : hr + ' jam') + '.') : ('Live gagal start (' + (json.startError || 'proses belum jalan') + '). ' + (json.dryRunResumed ? 'Dry run dilanjutkan.' : 'Cek dry run.')), !json.started);
    await refresh();
  }

  // One button: Live ON -> one confirmation -> live runs. Server-side checks stay (key, wallet balance, fresh Telegram auth, live == dry run, arm id).
  // No balance -> refused, dry run keeps running.
  $('btn-arm').onclick = async () => {
    // 1) confirmation first (works without key / balance), 2) then the checks; a refusal is reported after "yes" and the dry run keeps running.
    if (!window.confirm('Nyalakan LIVE sekarang?\n\nBot memakai uang asli di wallet. Dry run dihentikan selama live ON dan datanya disimpan sebagai run bernomor (run berikutnya mulai bersih setelah Live OFF).\nKalau key/saldo belum ada atau belum cukup, live menolak jalan dan dry run tetap berjalan.')) { showBanner('Live dibatalkan. Dry run tetap jalan.'); return; }
    const { status, json } = await api('POST', '/api/live/start', { confirm: 'LIVE', direct: true });
    if (status !== 200 || !json.ok) {
      const j = json || {};
      if (j.differences && j.differences.length) showBanner('Live gagal ON: masih ada ' + j.differences.length + ' syarat yang belum selesai: ' + j.differences.slice(0, 6).join(', ') + '. Dry run tetap jalan.', true);
      else if (j.error === 'key not stored') showBanner('Live gagal ON: belum ada private key wallet. Dry run tetap jalan.', true);
      else if (j.error === 'balance check failed' || (j.reasons && j.reasons.length)) showBanner('Live gagal ON: saldo wallet belum cukup (' + ((j.reasons || []).join('; ') || 'cek saldo gagal') + '). Dry run tetap jalan.', true);
      else showBanner('Live gagal ON: ' + (j.error || j.reason || status) + '. Dry run tetap jalan.', true);
      await refresh(); return;
    }
    showBanner(json.started ? 'Live ON. Bot live berjalan.' : ('Live gagal start (' + (json.startError || 'proses belum jalan') + '). ' + (json.dryRunResumed ? 'Dry run dilanjutkan.' : 'Cek dry run.')), !json.started);
    await refresh();
  };

  // The two big buttons at the top of Wallet > Live: LIVE runs the same confirmed Live ON flow, DRY RUN turns live off (same confirmation as Live OFF).
  $('mode-live')?.addEventListener('click', () => { if (state.liveRunning) { showBanner('Live sedang ON.'); return; } $('btn-arm').click(); });
  $('mode-dry')?.addEventListener('click', () => { if (!state.liveRunning) { showBanner('Mode sekarang sudah DRY RUN.'); return; } $('btn-stop-close').click(); });

  $('btn-stop-close').onclick = async () => {
    if (!window.confirm('Matikan live? Posisi live ditutup (jika ada) dan proses live dihentikan.')) return;
    const { status, json } = await api('POST', '/api/live/stop', { mode: 'closeAll' });
    if (status !== 200 || !json.ok) { showBanner('Stop gagal: ' + (json.error || json.reason || status), true); return; }
    showBanner(json.closing ? 'Live OFF diminta: bot menutup semua posisi lalu berhenti sendiri (beberapa detik sampai menit). Jangan matikan proses secara manual.' : 'Live OFF. Proses live tidak berjalan.');
    await refresh();
  };

  $('btn-stop-nonew').onclick = async () => {
    if (!window.confirm('Stop buka posisi baru saja? Posisi yang sudah kebuka dibiarkan sampai exit rule.')) return;
    const { status, json } = await api('POST', '/api/live/stop', { mode: 'noNew' });
    if (status !== 200 || !json.ok) { showBanner('Gagal: ' + (json.error || json.reason || status), true); return; }
    showBanner('Mode no-new: bot live tidak buka posisi baru.');
    await refresh();
  };

  document.addEventListener('warlock:lang', (e) => { api('POST', '/api/lang', { lang: e.detail.lang }).catch(() => {}); });   // shared with the Telegram menus (lang.json)
  setInterval(statusPoll, 7000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)statusPoll();});
  refresh().catch((e) => showBanner('Gagal memuat: ' + (e && e.message), true));
})();
