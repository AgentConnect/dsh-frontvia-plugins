import test from 'node:test';
import assert from 'node:assert/strict';
import {CustomerService} from '../src/core.js';
import {Pap03Business} from '../src/pap03-business.js';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';

function fixture(){
 let known=false,identity='one',failure='',catalogFailure='',connected=true;
 const calls:any[]=[],connects:string[]=[];
 const operations=[{companyRef:'company',operationRef:'capabilities',operationId:'commerce.capabilities.get',method:'GET'},{companyRef:'company',operationRef:'products',operationId:'commerce.products.search',method:'GET',queryParameters:[{name:'params',required:false}]},{companyRef:'company',operationRef:'payment',operationId:'commerce.payments.hosted.start',method:'POST'}];
 // PAP 0.1.6 restores local lifecycle state on status, including owner disconnects.
 const sdk:PapOperationsClient={
  requestTimeoutMs:1000,
  connect:async domain=>{
   connects.push(domain);
   if(known&&!connected)return {ok:false,error:{code:'disconnected'}};
   known=true;
   return {ok:true,value:{company:{companyRef:'company',companyId:'https://shop.example',name:'Shop'}}};
  },
  status:async()=>failure?{ok:false,error:{code:failure}}:{ok:true,value:{state:'ready',identity:{did:identity},companies:known?[{companyRef:'company',companyId:'https://shop.example',domain:'shop.example',name:'Shop'}]:[],sessions:known?[{companyRef:'company',sessionRef:'session',connected}]:[]}},
  operations:async()=>catalogFailure?{ok:false,error:{code:catalogFailure}}:{ok:true,value:operations},
  request:async input=>{calls.push(input);return {ok:true,value:{status:200,body:{result:{data:(input as {operationRef:string}).operationRef==='capabilities'?{store_id:'store',methods:[{method:'commerce.products.search',availability:'supported'}]}:{items:[]}}}}};}
 };
 return {sdk,calls,connects,changeIdentity(){identity='two';},deny(code='permission_denied'){failure=code;},denyCatalog(){catalogFailure='permission_denied';},disconnect(){connected=false;}};
}
function shopping(f:ReturnType<typeof fixture>){
 const saved=new Map<string,any>();
 const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 return {saved,service:()=>new CustomerService({dataDir:'unused',sites:[]},new Pap03Business(f.sdk),vault)};
}
test('public business projection restores the same identity/domain connection after Customer restart',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);const {connectionRef}=await first.connect('shop.example');
 await first.connect('shop.example');assert.equal(f.connects.length,1);
 const restarted=new Pap03Business(f.sdk);await restarted.refresh();
 assert.equal(restarted.canAccess(connectionRef),true);assert.equal(restarted.sites()[0].domain,'shop.example');
 await restarted.request(connectionRef,'commerce.products.search',{});assert.equal(f.connects.length,1);assert.equal(f.calls.length,1);
});
test('an old Profile rediscovers its order PDF route and respects a later refund',async()=>{
 const f=fixture(),s=shopping(f);
 const original=await s.service().connect('chat','shop.example');
 const connect=f.sdk.connect, operations=f.sdk.operations, request=f.sdk.request;
 const orderId='00000000-0000-4000-8000-000000000001';
 const digest='a'.repeat(64), bytes='JVBERi0xLjQ=';
 let discovered=false,revoked=false;
 f.sdk.connect=async domain=>{
  const result=await connect(domain);
  discovered=result.ok;
  return result;
 };
 f.sdk.operations=async()=>{
  const result=await operations();
  assert(result.ok && Array.isArray(result.value));
  return {ok:true,value:[
    ...result.value,
    {companyRef:'company',operationRef:'order',operationId:'get_order',channel:'ucp',method:'GET'},
    ...(discovered?[{companyRef:'company',operationRef:'file',operationId:'commerce.orders.file',channel:'openapi',method:'GET'}]:[]),
  ]};
 };
 f.sdk.request=async input=>{
  const ref=(input as {operationRef:string}).operationRef;
  if(ref!=='file'&&ref!=='order')return request(input);
  f.calls.push(input);
  const body=ref==='file'?{sha256:digest,bytes_base64:bytes}:{
   id:orderId,currency:'CNY',ucp:{version:'2026-08-25',status:'success'},
   line_items:[{id:'line',item:{id:'pdf',title:'Purchased PDF',price:100},quantity:{total:1}}],
   totals:[{type:'total',amount:100}],
   messages:[revoked?{code:'digital_delivery_revoked'}:{code:'digital_delivery_available',content_type:'markdown',
     content:`[Download the PDF](https://shop.example/commerce/v1/stores/store/orders/${orderId}/lines/line/files/${digest})`}],
  };
  return {ok:true,value:{status:200,body}};
 };
 const pap=new Pap03Business(f.sdk);
 await pap.refresh();
 const restored=new CustomerService({dataDir:'unused',sites:[]},pap,{
  keys:prefix=>[...s.saved.keys()].filter(key=>key.startsWith(prefix)),
  get:key=>structuredClone(s.saved.get(key)),
  set:(key,value)=>{s.saved.set(key,structuredClone(value));},
 });
 assert.equal(f.connects.length,1);
 assert.deepEqual(await restored.downloadOrderFile('chat',original.flowId,orderId),{bytes_base64:bytes});
 assert.deepEqual(f.connects,['shop.example','shop.example']);
 assert.deepEqual(f.calls.at(-1),{operationRef:'file',path:{store_id:'store',order_id:orderId,line_id:'line',sha256:digest}});
 revoked=true;
 await assert.rejects(restored.downloadOrderFile('chat',original.flowId,orderId),{code:'ORDER_FILE_UNAVAILABLE'});
 assert.equal(f.calls.filter(call=>call.operationRef==='file').length,1);
 assert.equal(f.connects.length,2);
});

test('missing PDF routes do not allow a restored flow to switch shop',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);
 const {connectionRef}=await first.connect('shop.example');
 const restored=new Pap03Business(f.sdk);
 await restored.refresh();
 f.sdk.connect=async()=>({ok:true,value:{company:{companyRef:'replacement',companyId:'https://shop.example'}}});
 await assert.rejects(restored.request(connectionRef,'commerce.orders.file',{}),{code:'PAP_STORE_CHANGED'});
 assert.equal(f.calls.length,0);
});

test('public identity switch or revoked access prevents old flow reads and dispatch',async()=>{
 for(const revoke of [false,true]){
  const f=fixture(),business=new Pap03Business(f.sdk);const {connectionRef}=await business.connect('shop.example');
  if(revoke){f.deny();await business.refresh();}
  else{f.changeIdentity();await business.refresh();}
  assert.equal(business.canAccess(connectionRef),false);
  assert.throws(()=>business.identity(connectionRef),{code:revoke?'PAP_PERMISSION_DENIED':'IDENTITY_CHANGED'});
  await assert.rejects(business.request(connectionRef,'commerce.products.search',{}),{code:revoke?'PAP_PERMISSION_DENIED':'IDENTITY_CHANGED'});
  assert.equal(f.calls.length,0);
 }
});
test('inline payment uses a discovered operation and refuses foreign payment links',async()=>{
 const f=fixture(),business=new Pap03Business(f.sdk);const {connectionRef}=await business.connect('shop.example');
 const id='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000002',expires=Math.floor(Date.now()/1000)+120,access='v2.'+sid+'.'+'a'.repeat(43);
 const link=`https://shop.example/companies/shop/pay/${id}?expires=${expires}&access=${access}`;
 await assert.rejects(business.hostedPayment(connectionRef,link.replace('shop.example','foreign.example'),id),/INVALID_PAYMENT_LINK/);
 assert.equal(f.calls.length,0);await business.hostedPayment(connectionRef,link,id);
 assert.deepEqual(f.calls,[{operationRef:'payment',body:{checkout_id:id,expires,access}}]);
});
test('explicit same-chat connect re-discovers PAP while preserving its flow and identity fence',async()=>{
 const f=fixture(),s=shopping(f);
 const first=await s.service().connect('chat','shop.example');
 const restored=await s.service().connect('chat','shop.example');
 assert.equal(restored.flowId,first.flowId);assert.equal(s.saved.size,1);
 assert.deepEqual(f.calls.map(call=>call.operationRef),['capabilities','capabilities']);
 assert.equal(f.connects.length,2);
 f.changeIdentity();const count=f.calls.length;
 await assert.rejects(s.service().connect('chat','shop.example'),{code:'PERSONAL_CHAT_ACCOUNT_CHANGED'});
 assert.equal(f.calls.length,count,'changed identity must not read business data');
 assert.equal(f.connects.length,2,'changed chat identity must be rejected before domain discovery');
 assert.equal(s.saved.size,1);
});
test('explicit preparation refreshes restored sessions without reconnecting ordinary reads',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);await first.connect('shop.example');
 const restored=new Pap03Business(f.sdk);await restored.refresh();
 await restored.prepareDomain('shop.example');
 const {connectionRef}=await restored.connect('shop.example');
 await restored.request(connectionRef,'commerce.products.search',{});
 assert.equal(f.connects.length,2);assert.equal(f.calls.length,1);
});
test('public business projection does not restore disconnected sessions after restart',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);const {connectionRef}=await first.connect('shop.example');
 f.disconnect();const restarted=new Pap03Business(f.sdk);await restarted.refresh();
 assert.equal(restarted.isCurrentIdentity(connectionRef),true);
 assert.equal(restarted.canAccess(connectionRef),false);
 await assert.rejects(restarted.request(connectionRef,'commerce.products.search',{}),{code:'PAP_DISCONNECTED'});
 assert.equal(f.connects.length,1);assert.equal(f.calls.length,0);
});
test('same chat keeps disconnected flow ownership and respects the public owner fence',async()=>{
 const f=fixture(),s=shopping(f),first=await s.service().connect('chat','shop.example');
 f.disconnect();const restarted=s.service();await restarted.pap.refresh?.();
 assert.throws(()=>restarted.flow('chat',first.flowId),{code:'PAP_DISCONNECTED'});
 await assert.rejects(restarted.connect('chat','shop.example'),{code:'PAP_DISCONNECTED'});
 assert.equal(f.calls.length,1);assert.equal(s.saved.size,1);
 assert.equal(restarted.pap.canAccess?.([...s.saved.values()][0].connectionRef),false);
});
test('public readiness failures retain their safe code instead of claiming a different chat owner',async()=>{
 for(const code of ['permission_denied','credential_unavailable','default_identity_required']){
  const f=fixture(),s=shopping(f);await s.service().connect('chat','shop.example');f.deny(code);
  await assert.rejects(s.service().connect('chat','shop.example'),{code:'PAP_'+code.toUpperCase()});
  assert.equal(f.connects.length,1);assert.equal(f.calls.length,1);assert.equal(s.saved.size,1);
 }
 const f=fixture(),s=shopping(f);await s.service().connect('chat','shop.example');f.denyCatalog();
 await assert.rejects(s.service().connect('chat','shop.example'),{code:'PAP_PERMISSION_DENIED'});
 assert.equal(f.connects.length,1);assert.equal(f.calls.length,1);
});

test('unconfigured identity keeps the service entry usable but refuses connection with its original code',async()=>{
 const f=fixture(),business=new Pap03Business(f.sdk);f.deny('default_identity_required');
 await business.refresh();
 assert.deepEqual(business.sites(),[]);assert.deepEqual(business.status(),[]);
 assert.equal(business.identityStatus().configured,false);
 assert.equal(business.identityStatus().state,'default_identity_required');
 await assert.rejects(business.connect('shop.example'),{code:'PAP_DEFAULT_IDENTITY_REQUIRED'});
 assert.equal(f.connects.length,0);assert.equal(f.calls.length,0);
});
