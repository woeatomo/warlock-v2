'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');

const root=path.join(__dirname,'miniapp/public');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const appjs=fs.readFileSync(path.join(root,'app.js'),'utf8');
const appcss=fs.readFileSync(path.join(root,'app.css'),'utf8');

// Structural: dialog must not sit inside a tab panel that gets display:none
const statusStart=html.indexOf('id="panel-status"');
const settingsStart=html.indexOf('id="panel-settings"');
const statusChunk=html.slice(statusStart, settingsStart);
assert.ok(!statusChunk.includes('id="cal-day-modal"'), 'cal-day-modal was left inside #panel-status (hidden when Wallet/Calendar is open)');
assert.ok(!statusChunk.includes('id="trade-modal"'), 'trade-modal was left inside #panel-status');
assert.ok(html.indexOf('id="cal-day-modal"')>html.indexOf('</main>'), 'cal-day-modal should be a body-level element');

const nov11={
  pnl:248.9984,trades:26,wins:23,losses:3,profit:478.7421,minus:-229.7437,
  rows:[
    {name:'X-SOL',closedAt:'2026-11-11T08:24:15.000Z',pnlUsd:-99.98,capital:499.9},
    {name:'PUSSY-SOL',closedAt:'2026-11-11T10:00:00.000Z',pnlUsd:13.5,capital:489.97}
  ],
  tokens:[
    {name:'PUSSY-SOL',trades:1,pnl:13.5},
    {name:'X-SOL',trades:1,pnl:-99.98}
  ]
};
const payload={
  ok:true,
  days:{
    '2026-11-10':{pnl:87.1954,trades:15,wins:15,losses:0,profit:87.1954,minus:0,rows:[{name:'A-SOL',closedAt:'2026-11-10T12:00:00.000Z',pnlUsd:87.1954,capital:500}],tokens:[{name:'A-SOL',trades:15,pnl:87.1954}]},
    '2026-11-11':nov11
  },
  total:336.1938,trades:41,archivedIncluded:true,tz:'UTC',
  mode:{label:'DRY RUN',live:false}
};

function jsonRes(obj,status=200){
  return Promise.resolve({
    status,
    json:async()=>obj
  });
}

const virtualConsole=new (require('jsdom').VirtualConsole)();
const errors=[];
virtualConsole.on('jsdomError',e=>errors.push(String(e)));
virtualConsole.on('error',e=>errors.push(String(e)));

const dom=new JSDOM(html,{
  url:'http://127.0.0.1:8797/',
  runScripts:'outside-only',
  pretendToBeVisual:true,
  virtualConsole
});
const {window}=dom;
const {document}=window;

// CSS so .hidden computes if needed
const style=document.createElement('style');
style.textContent=appcss;
document.head.appendChild(style);

window.Telegram={WebApp:{
  initData:'user=%7B%22id%22%3A1%7D',
  ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){},
  HapticFeedback:null, showConfirm:null, openLink:null
}};
window.fetch=async(url)=>{
  const u=String(url);
  if(u.includes('/api/pnl-calendar'))return jsonRes(payload);
  if(u.includes('/api/settings'))return jsonRes({ok:true,csrf:'x',fields:{},paused:false});
  if(u.includes('/api/wallet'))return jsonRes({ok:true,hasKey:false});
  if(u.includes('/api/live'))return jsonRes({ok:true,stopPresent:true,liveRunning:false,liveStatus:'off',hasKey:false,balanceCheck:{ok:false,reasons:[]}});
  if(u.includes('/api/status'))return jsonRes({ok:true,fields:{},paused:false,open:[],closed:[],events:[],screening:[]});
  return jsonRes({ok:false,error:'unexpected '+u},404);
};
if(!window.AbortSignal.timeout)window.AbortSignal.timeout=(ms)=>{const c=new window.AbortController();window.setTimeout(()=>c.abort(),ms);return c.signal;};

// Polyfill dialog if jsdom is incomplete
const Dialog=window.HTMLDialogElement||window.HTMLElement;
if(Dialog&&!Dialog.prototype.showModal){
  Dialog.prototype.showModal=function(){this.setAttribute('open','');this.open=true;};
}
if(Dialog&&!Dialog.prototype.close){
  Dialog.prototype.close=function(){this.removeAttribute('open');this.open=false;};
}

window.eval(appjs);

function ancestorHidden(el){
  let n=el;
  while(n&&n.nodeType===1){
    if(n!==el && n.classList && n.classList.contains('hidden'))return n.id||n.className;
    n=n.parentElement;
  }
  return null;
}

function click(el){
  assert.ok(el,'missing click target');
  el.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
}

(async()=>{
  // Wait a tick for refresh() catch
  await new Promise(r=>setTimeout(r,20));

  click(document.querySelector('[data-tab="wallet"]'));
  click(document.querySelector('[data-wallet-view="pnlcal"]'));
  await new Promise(r=>setTimeout(r,40));

  const cell11=document.querySelector('[data-cal-day="2026-11-11"]');
  const cell10=document.querySelector('[data-cal-day="2026-11-10"]');
  const cell12=document.querySelector('[data-cal-day="2026-11-12"]');
  assert.ok(cell11,'11 Nov cell missing');
  assert.ok(cell10,'10 Nov cell missing');
  assert.ok(cell12,'12 Nov cell missing (empty day should still be tappable)');
  assert.ok(cell11.className.includes('cal-pos')||cell11.innerHTML.includes('248')||cell11.textContent.includes('+'), '11 Nov should show a positive cell, got '+cell11.textContent);

  const modal=document.getElementById('cal-day-modal');
  assert.ok(modal,'modal missing');
  assert.strictEqual(ancestorHidden(modal),null,'sheet ancestor is hidden: '+ancestorHidden(modal));
  // Status panel itself is hidden while calendar is open — modal must not be inside it
  const status=document.getElementById('panel-status');
  assert.ok(status.classList.contains('hidden'),'status panel should be hidden on Wallet tab');
  assert.ok(!status.contains(modal),'modal must not be a descendant of #panel-status');

  click(cell11);
  assert.ok(modal.open||modal.hasAttribute('open')||modal.classList.contains('sheet-open'),'sheet did not open after tapping 11 Nov');
  const body=document.getElementById('cal-day-body').textContent;
  assert.ok(body.includes('Total profit'),body);
  assert.ok(body.includes('Total minus'),body);
  assert.ok(body.includes('Netto'),body);
  assert.ok(body.includes('Per token'),body);
  assert.ok(body.includes('PUSSY-SOL'),body);
  assert.ok(body.includes('X-SOL'),body);

  click(document.getElementById('cal-day-close'));
  assert.ok(!(modal.open||modal.classList.contains('sheet-open'))||!modal.hasAttribute('open'),'Tutup did not close the sheet');

  click(cell12);
  assert.ok(modal.open||modal.hasAttribute('open')||modal.classList.contains('sheet-open'),'empty 12 Nov should still open the sheet');
  assert.ok(document.getElementById('cal-day-body').textContent.includes('Tidak ada trade'));

  if(errors.length){
    console.error(errors);
    assert.fail('jsdom errors: '+errors.join(' | '));
  }
  console.log('OK cal-day-click: body-level sheet, 10/11/12 Nov cells present, tap opens/closes, empty day message');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
