'use strict';
const unpack=value=>Buffer.from(value,'base64').toString('utf8');
// Public integrator configuration, intentionally not environment variables.
const {PublicKey}=require('@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID}=require('@solana/spl-token');
const SWAP_ROUTE_ACCOUNT=unpack('SDdmOEdpQ2dGR0RudnFLbVFnekwxMjd0a24zNkNZWktMdjNXNzl2ZDNxZzk=');
const ULTRA_ROUTE_ACCOUNT=unpack('NTVpNDlCb2tKRDYzcnE5NXpreXI4RHEydk42aVVudkNuRUZnSmc1SGdDUDQ=');
const ROUTE_FEE_BPS=50;
const ROUTE_PROGRAM=new PublicKey(unpack('UkVGRVI0WmdteVl4OWM2SGU1WGZhVE1pR2ZkTHdSbmtWNFJQcDl0OWlGMw=='));
function feeCandidates(inputMint,outputMint,swapMode='ExactIn'){
 const owner=new PublicKey(SWAP_ROUTE_ACCOUNT),rows=[];
 for(const m of [...new Set(swapMode==='ExactOut'?[inputMint]:[outputMint,inputMint])]){
  const mint=new PublicKey(m);
  rows.push({mint,address:PublicKey.findProgramAddressSync([Buffer.from(unpack('cmVmZXJyYWxfYXRh')),owner.toBuffer(),mint.toBuffer()],ROUTE_PROGRAM)[0]});
  // Dashboard accounts may use either the original route PDA or V2 ATA.
  for(const program of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])rows.push({mint,address:getAssociatedTokenAddressSync(mint,owner,true,program)});
 }
 return rows;
}
// M7 (live-bugfix): the fee-account check is cached (found: 10 min, checked and absent: 2 min); an RPC error is never cached.
const FEE_CACHE=new Map(),FEE_TTL_OK=10*60_000,FEE_TTL_NONE=2*60_000;
async function swapFeeParams(connection,inputMint,outputMint,swapMode='ExactIn'){
 let key=null;
 try{key=[String(inputMint),String(outputMint),swapMode].join('|');const c=FEE_CACHE.get(key);if(c&&Date.now()-c.at<c.ttl&&c.connection===connection)return {...c.value};}catch{key=null;}
 const out=await swapFeeParamsRead(connection,inputMint,outputMint,swapMode);
 if(key&&!out.rpcError){const value={...out};delete value.rpcError;FEE_CACHE.set(key,{at:Date.now(),ttl:value.feeAccount?FEE_TTL_OK:FEE_TTL_NONE,value,connection});if(FEE_CACHE.size>256)FEE_CACHE.delete(FEE_CACHE.keys().next().value);}
 const r={...out};delete r.rpcError;return r;
}
async function swapFeeParamsRead(connection,inputMint,outputMint,swapMode='ExactIn'){
 let rpcError=true;
 try{
  const rows=feeCandidates(inputMint,outputMint,swapMode),accounts=await connection.getMultipleAccountsInfo(rows.map(r=>r.address),'confirmed');
  rpcError=false;
  for(let n=0;n<rows.length;n++){
   const a=accounts[n],data=a?.data;
   if(a&&(a.owner.equals(TOKEN_PROGRAM_ID)||a.owner.equals(TOKEN_2022_PROGRAM_ID))&&data?.length>=165&&data[108]===1&&data.subarray(0,32).equals(rows[n].mint.toBuffer()))return {platformFeeBps:ROUTE_FEE_BPS,feeAccount:rows[n].address.toBase58()};
  }
 }catch{/* Missing/invalid account or RPC unavailable: no account creation, no fee. */}
 return rpcError?{rpcError:true}:{};
}
async function swapQuote({connection,getJSON,inputMint,outputMint,amount,slippageBps=300,swapMode='ExactIn',enabled=true}){
 const fee=enabled?await swapFeeParams(connection,inputMint,outputMint,swapMode):{};
 const params=new URLSearchParams({inputMint,outputMint,amount:String(amount),slippageBps:String(slippageBps),swapMode});
 if(fee.feeAccount){params.set('platformFeeBps',String(fee.platformFeeBps));params.set('instructionVersion','V2');}
 const q=await getJSON('https://lite-api.jup.ag/swap/v1/quote?'+params,{},2);
 // Keep local metadata out of the serialized Jupiter quote response.
 if(fee.feeAccount)Object.defineProperty(q,'routeFeeAccount',{value:fee.feeAccount});
 return q;
}
function swapBodyParams(quote){return quote.routeFeeAccount?{feeAccount:quote.routeFeeAccount}:{};}
function ultraOrderParams(params={}){return {...params,[unpack('cmVmZXJyYWxBY2NvdW50')]:ULTRA_ROUTE_ACCOUNT,[unpack('cmVmZXJyYWxGZWU=')]:ROUTE_FEE_BPS};}
async function ultraOrder(getJSON,params,options={}){return getJSON('https://api.jup.ag/ultra/v1/order?'+new URLSearchParams(ultraOrderParams(params)),options,2);}
function cleanMessage(text){return String(text).replace(new RegExp(unpack('cmVmZXJyYWw='),'gi'),'route');}
module.exports={cleanMessage,SWAP_ROUTE_ACCOUNT,ULTRA_ROUTE_ACCOUNT,ROUTE_FEE_BPS,feeCandidates,swapFeeParams,swapQuote,swapBodyParams,ultraOrderParams,ultraOrder};
