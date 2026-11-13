import test from 'node:test';
import assert from 'node:assert/strict';
import {Pap03Business} from '../src/pap03-business.js';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';
function fixture(){
 let ready=false,identity='one',denied=false,connected=true;const calls:any[]=[],connects:string[]=[];
 const operations=[{companyRef:'company',operationRef:'products',operationId:'commerce.products.search',method:'GET',queryParameters:[{name:'params',required:false}]},{companyRef:'company',operationRef:'payment',operationId:'commerce.payments.hosted.start',method:'POST'}];
 const sdk:PapOperationsClient={requestTimeoutMs:1000,connect:async domain=>{ready=true;connects.push(domain);return {ok:true,value:{company:{companyRef:'company',companyId:'https://shop.example',name:'Shop'}}};},status:async()=>denied?{ok:false,error:{code:'permission_denied'}}:{ok:true,value:ready?{state:'ready',identity:{did:identity},companies:[{companyRef:'company',companyId:'https://shop.example',domain:'shop.example',name:'Shop'}],sessions:[{companyRef:'company',sessionRef:'session',connected}]}:{state:'unconfigured'}},operations:async()=>({ok:true,value:operations}),request:async input=>{calls.push(input);return {ok:true,value:{status:200,body:{result:{data:{items:[]}}}}};}};
 return {sdk,calls,connects,changeIdentity(){identity='two';},deny(){denied=true;},disconnect(){connected=false;}};
}
test('public business projection restores the same identity/domain connection after Customer restart',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);const {connectionRef}=await first.connect('shop.example');
 await first.connect('shop.example');assert.equal(f.connects.length,1);
 const restarted=new Pap03Business(f.sdk);await restarted.refresh();
 assert.equal(restarted.canAccess(connectionRef),true);assert.equal(restarted.sites()[0].domain,'shop.example');
 await restarted.request(connectionRef,'commerce.products.search',{});assert.equal(f.connects.length,1);assert.equal(f.calls.length,1);
});
test('public identity switch or revoked access prevents old flow reads and dispatch',async()=>{
 for(const revoke of [false,true]){
  const f=fixture(),business=new Pap03Business(f.sdk);const {connectionRef}=await business.connect('shop.example');
  if(revoke)f.deny();else f.changeIdentity();await business.refresh();
  assert.equal(business.canAccess(connectionRef),false);
  assert.throws(()=>business.identity(connectionRef),/IDENTITY_CHANGED/);
  await assert.rejects(business.request(connectionRef,'commerce.products.search',{}),/IDENTITY_CHANGED/);assert.equal(f.calls.length,0);
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

test('public business projection does not restore disconnected sessions after restart',async()=>{
 const f=fixture(),first=new Pap03Business(f.sdk);const {connectionRef}=await first.connect('shop.example');
 f.disconnect();const restarted=new Pap03Business(f.sdk);await restarted.refresh();
 assert.equal(restarted.canAccess(connectionRef),false);
 await assert.rejects(restarted.request(connectionRef,'commerce.products.search',{}),/IDENTITY_CHANGED/);
 assert.equal(f.connects.length,1);assert.equal(f.calls.length,0);
});
