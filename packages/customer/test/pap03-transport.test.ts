import test from 'node:test';
import assert from 'node:assert/strict';
import {Pap03Transport,PapRequestError} from '../src/pap03-transport.js';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';
function fixture(){
 const connects:string[]=[],requests:unknown[]=[];
 let rows:any[]=[{companyRef:'shop',operationRef:'read',operationId:'commerce.products.search',method:'GET',queryParameters:[{name:'params',required:false}]},{companyRef:'shop',operationRef:'write',operationId:'commerce.carts.create',method:'POST'}];
 let result:any={ok:true,value:{status:200,body:{result:{data:{items:[]}}}}};
 const pap:PapOperationsClient={requestTimeoutMs:1000,connect:async domain=>{connects.push(domain);return {ok:true,value:{company:{companyRef:'shop',companyId:'https://shop.example',name:'Shop'}}};},status:async()=>({ok:true,value:{}}),operations:async()=>({ok:true,value:rows}),request:async input=>{requests.push(input);return result;}};
 return {wire:new Pap03Transport(pap),connects,requests,setRows(v:any[]){rows=v;},setResult(v:unknown){result=v;}};
}
test('PAP03 Customer: first domain request discovers without a configured merchant or Agent URL',async()=>{
 const f=fixture();await f.wire.request('shop.example','commerce.products.search',{query:'bed'});
 assert.deepEqual(f.connects,['shop.example']);assert.deepEqual(f.requests,[{operationRef:'read',query:{params:'{"query":"bed"}'}}]);
 await f.wire.request('shop.example','commerce.carts.create',{idempotency_key:'same-key'});
 assert.equal(f.connects.length,1);assert.deepEqual(f.requests[1],{operationRef:'write',body:{idempotency_key:'same-key'}});
});
test('PAP03 Customer: foreign and ambiguous operations never dispatch',async()=>{
 for(const rows of [[{companyRef:'other',operationRef:'foreign',operationId:'commerce.products.search',method:'GET'}],[{companyRef:'shop',operationRef:'a',operationId:'commerce.products.search',method:'GET'},{companyRef:'shop',operationRef:'b',operationId:'commerce.products.search',method:'GET'}]]){
  const f=fixture();f.setRows(rows);await assert.rejects(f.wire.request('shop.example','commerce.products.search',{}),/METHOD_NOT_ADVERTISED/);assert.equal(f.requests.length,0);
 }
});
test('PAP03 Customer: uncertain writes preserve the public trace and are not retried',async()=>{
 const f=fixture();f.setResult({ok:false,error:{code:'request_uncertain',businessRequest:'unknown',phase:'request'}});
 await assert.rejects(f.wire.request('shop.example','commerce.carts.create',{}),e=>e instanceof PapRequestError&&e.detail.businessRequest==='unknown');assert.equal(f.requests.length,1);
});

test('PAP03 Customer: after-sales uses the discovered original path parameters and never injects approval',async()=>{
 const f=fixture();
 f.setRows([
  {companyRef:'shop',operationRef:'get',operationId:'aftersales.get',channel:'openapi',method:'GET',pathParameters:['order_id','case_id']},
  {companyRef:'shop',operationRef:'send',operationId:'aftersales.submit',channel:'openapi',method:'POST',pathParameters:['order_id'],approvalProtocol:'pap-operations-v3'},
 ]);
 await f.wire.request('shop.example','aftersales.get',{order_id:'original-order',case_id:'original-case'});
 await f.wire.request('shop.example','aftersales.submit',{order_id:'original-order',input:{kind:'cancel_order'},poppyApproval:'ignored'});
 assert.deepEqual(f.requests,[
  {operationRef:'get',path:{order_id:'original-order',case_id:'original-case'},query:{}},
  {operationRef:'send',path:{order_id:'original-order'},query:{},body:{kind:'cancel_order'}},
 ]);
 f.setRows([{companyRef:'shop',operationRef:'old',operationId:'aftersales.submit',channel:'openapi',method:'POST',pathParameters:['order_id']}]);
 await assert.rejects(f.wire.request('shop.example','aftersales.submit',{order_id:'original-order',input:{}}),/AFTERSALES_PAP_UPDATE_REQUIRED/);
 assert.equal(f.requests.length,2);
});
