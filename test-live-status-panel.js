'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements=new Map();const node=()=>({innerHTML:'',textContent:'',children:[],appendChild(n){this.children.push(n);},classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},removeAttribute(){},getAttribute(){return null;},querySelector(){return null;},querySelectorAll(){return [];},dataset:{},style:{},previousElementSibling:null});   // minimal DOM surface used by renderSettings
const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
const ctx={window:{},document:{getElementById:$,createElement:()=>node(),addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},hidden:false},console,Date};
let src=fs.readFileSync(__dirname+'/miniapp/public/app.js','utf8');src=src.slice(0,src.indexOf("  document.addEventListener('click'"));
const all=fs.readFileSync(__dirname+'/miniapp/public/app.js','utf8');   // fieldInput..renderWallet now comes from the generic extractor below (avoids duplicate const declarations)
// Pull in every top-level function (and one-line const helper / state default) declared after the first click handler (renderRuns, reasonsHtml, ...), so the render
// test keeps working when helpers move around in app.js. Only declarations are copied; no listeners or timers run.
{const cut=all.indexOf("  document.addEventListener('click'"),out=[];let on=false;for(const l of all.slice(cut).split("\n")){if(/^  (async )?function [A-Za-z_$]/.test(l)){on=true;out.push(l);continue;}if(/^  (const|let) [A-Za-z_$][\w$]*\s*=/.test(l)||/^  state\.[\w$]+\s*=/.test(l)){on=false;out.push(l);continue;}if(on&&(/^ {3,}/.test(l)||/^  [}\])]/.test(l)||!l.trim())){out.push(l);continue;}on=false;}src+="\n"+out.join("\n")+"\n";}
vm.runInNewContext(src+'globalThis.entryRows=entryHistoryRows;globalThis.render=renderStatus;globalThis.renderSettings=renderSettings;globalThis.collect=collectDisplay;globalThis.uiState=state;state.paperAllowed=true;})();',ctx);
const pool=i=>'1111111111111111111111111111111'+(i+1),now=new Date().toISOString();
const entry=i=>({position:{name:'POOL-'+i,pool:pool(i),mintX:pool(i+10),openedAt:now,minBinId:1,maxBinId:5,lastSolUsd:100,usdcIn:100,quoteSymbol:'USDC',binShape:{activeBin:2,bins:[{id:1,token:1,sol:2},{id:2,token:2,sol:1}]}},live:{valueUsd:99,pnlUsd:-1,feesUsd:.5,pnlQuote:.05,pnlQuoteUsd:4.1,quoteSymbol:'SOL',displaySolUsdEntry:100,displaySolUsd:80,solPriceChangePct:-20},leftoverSol:.2});
const payload=n=>({values:{MAX_POSITIONS:5},status:{positions_open:{positions:Array.from({length:n},(_,i)=>entry(i)),updated:now},summary:{stats:{equityUsd:500,equityPnlUsd:0}},screening:{at:now,display:[{address:pool(0),mintX:pool(10),name:'HELD',status:'passed'},{address:pool(8),mintX:pool(18),name:'NEW',status:'passed'}]}}});
// LIVE: the Status panel must show the real wallet (6.98 SOL), never the dry run's free balance (10.09 SOL), and no 'Saldo bebas' / 'Modal disetor' / 'Live tidak aktif'
const live={values:{MAX_POSITIONS:5},status:{liveSummary:{live:true,solUsd:72,wins:1,losses:2,trades:3,realizedUsd:-1.7,closed:3,realizedSol:-0.0233,walletSol:6.977182438,rentRefundableSol:0.059,openFeesSol:0.002,openPnlSol:0.004,openValueSol:0.9,maxPositions:7},
  positions_open:{positions:[entry(0)],updated:now},summary:{stats:{equityUsd:730,equitySol:10.09,freeCapitalSol:10.09,virtualUsdc:731,totalDepositedSol:10.09,totalDepositedUsdc:731,solUsd:72,capitalAsset:'SOL'}},screening:{at:now,display:[]}}};
ctx.render(live);
const h=$('status-body').innerHTML;
assert(/LIVE · N5/.test(h),'live badge'); assert(/Di wallet 6\.98 SOL/.test(h),'wallet balance shown: '+h.slice(0,600)); assert(!/10\.09/.test(h),'dry run balance must not appear'); assert(!/Saldo bebas|Modal disetor|Live tidak aktif|Paper dipause|Dry run berjalan/.test(h),'no dry run wording');
assert(/Di posisi 0\.96 SOL/.test(h),'positions part: '+h.slice(0,700)); assert(/Rent refundable/.test(h));
ctx.uiState.liveRunning=false; const dry={...live,status:{...live.status,liveSummary:undefined}}; ctx.render(dry); assert(!/Live tidak aktif/.test($('status-body').innerHTML),'dry run footer has no Live tidak aktif');
console.log('test-live-status-panel: OK');
