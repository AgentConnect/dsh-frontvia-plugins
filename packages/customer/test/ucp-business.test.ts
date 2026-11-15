import test from 'node:test';
import assert from 'node:assert/strict';
import {Pap03Transport} from '../src/pap03-transport.js';
import {Pap03Business} from '../src/pap03-business.js';
import {CustomerService} from '../src/core.js';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';
const version='2026-08-25';
const ucp={version};
const product={id:'product-1',title:'Mug',description:{plain:'Ceramic'},price_range:{min:{amount:1250,currency:'USD'},max:{amount:1250,currency:'USD'}},variants:[{id:'variant-1',title:'Blue',description:{plain:'Blue ceramic'},price:{amount:1250,currency:'USD'}}]};
function fixture(){
  let loseNext=false, rejection: {status:number;code:string;version:string}|undefined;const receipts=new Map<string,any>();let effects=0;
  const calls:any[]=[],store={companyRef:'shop',companyId:'https://shop.example',domain:'shop.example',name:'Shop',ucpCapabilities:['dev.ucp.shopping.fulfillment']};
  const specs=[['commerce.capabilities.get','GET'],['update_checkout','PUT'],['search_catalog','POST'],['get_product','POST'],['create_cart','POST'],['get_cart','GET'],['update_cart','PUT'],['create_checkout','POST'],['get_checkout','GET'],['cancel_checkout','POST'],['get_order','GET']];
  const operations=specs.map(([operationId,method])=>({companyRef:'shop',operationRef:operationId,operationId,method,channel:operationId==='commerce.capabilities.get'?'openapi':'ucp',pathParameters:['get_cart','update_cart','get_checkout','cancel_checkout','get_order','update_checkout'].includes(operationId)?['id']:[]}));
  let etag='"v1"',cart:any={ucp,id:'cart-1',currency:'USD',line_items:[{id:'line-1',item:{id:'variant-1',title:'Mug',price:1250},quantity:1,totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]},{id:'line-2',item:{id:'variant-2',title:'Plate',price:1000},quantity:1,totals:[{type:'subtotal',amount:1000},{type:'total',amount:1000}]}],totals:[{type:'subtotal',amount:2250},{type:'total',amount:2250}]};
  const sdk:PapOperationsClient={requestTimeoutMs:1000,connect:async()=>({ok:true,value:{company:store}}),status:async()=>({ok:true,value:{state:'ready',identity:{did:'test'},companies:[store],sessions:[{companyRef:'shop',connected:true}]}}),operations:async()=>({ok:true,value:operations}),request:async(input:any)=>{
    calls.push(structuredClone(input));
    if(input.idempotencyKey&&receipts.has(input.idempotencyKey))return structuredClone(receipts.get(input.idempotencyKey));
    if (input.operationRef === 'update_cart' && rejection) {
      const {status,code,version}=rejection;
      rejection=undefined;
      return {ok:true,value:{status,body:{ucp:{version,status:'error'},messages:[{type:'error',code}]}}};
    }
    let body:any;
    if(input.operationRef==='commerce.capabilities.get')body={result:{data:{store_id:'shop',default_context:{country:'US',currency:'USD',locale:'en-US'},methods:[]}}};
    else if(input.operationRef==='search_catalog')body={ucp,products:[product],pagination:{has_next_page:false}};
    else if(input.operationRef==='get_product')body={ucp,product};
    else if(input.operationRef==='create_checkout'||input.operationRef==='get_checkout'||input.operationRef==='update_checkout')body={...cart,ucp:{version,payment_handlers:{}},id:'draft-1',status:'incomplete',links:[],messages:[{type:'error',code:'payment_method_unavailable',severity:'recoverable',content:'Payment is unavailable'}],...(input.operationRef==='update_checkout'?{buyer:input.body.buyer,fulfillment:input.body.fulfillment}:{})};
    else if(input.operationRef==='cancel_checkout')body={...cart,ucp:{version,payment_handlers:{}},id:'draft-1',status:'canceled',links:[]};
    else if(input.operationRef==='get_order')body={...cart,id:'order-1',checkout_id:'draft-1',permalink_url:'https://shop.example/orders/order-1',line_items:cart.line_items.map((line:any)=>({...line,quantity:{original:line.quantity,total:line.quantity,fulfilled:line.quantity}})),fulfillment:{events:[{id:'shipment-event',type:'shipped',occurred_at:'2026-11-15T00:00:00Z',tracking_number:'track-1',tracking_url:'https://carrier.example/track-1',carrier:'Carrier',line_items:[{id:'line-1',quantity:1}]}]}};
    else if(input.operationRef==='get_cart')body=cart;
    else if(input.operationRef==='update_cart'){assert.equal(input.ifMatch,etag);etag='"v2"';cart={...cart,line_items:input.body.line_items.map((line:any)=>({...line,item:{...line.item,title:'Mug',price:1250},totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]}))};body=cart;}
    else if(input.operationRef==='create_cart'){cart={...cart,line_items:input.body.line_items.map((line:any,index:number)=>({...line,id:`line-${index+1}`,item:{...line.item,title:'Mug',price:1250},totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]}))};body=cart;}
    else throw new Error('Unexpected operation');
    const response={ok:true as const,value:{status:200,body,etag}};
    if(input.idempotencyKey){effects++;receipts.set(input.idempotencyKey,structuredClone(response));if(loseNext){loseNext=false;return {ok:false,error:{code:'request_uncertain',businessRequest:'unknown'}};}}
    return response;
  }};
  return {sdk,calls,transport:new Pap03Transport(sdk),lose(){loseNext=true;},effects:()=>effects,
    reject(code:string,status=409,responseVersion=version){rejection={code,status,version:responseVersion};},
    externalEdit(){etag='"external"';cart.line_items[0].quantity=2;},
  };
}
test('Customer UCP catalog uses standard POST payloads and projects product and SKU separately',async()=>{
 const f=fixture();const search:any=await f.transport.request('shop.example','commerce.products.search',{query:'mug',page:{limit:8}});
 assert.deepEqual(f.calls[0],{operationRef:'search_catalog',body:{query:'mug',pagination:{limit:8}}});assert.equal(search.result.data.items[0].description,'Ceramic');
 const variants:any=await f.transport.request('shop.example','commerce.variants.list',{product_id:'product-1'});
 assert.deepEqual(f.calls[1],{operationRef:'get_product',body:{id:'product-1'}});assert.equal(variants.result.data.items[0].id,'variant-1');assert.deepEqual(variants.result.data.items[0].price,{amount_minor:'1250',currency:'USD'});
});
test('Customer line removal sends one complete PUT with an ETag and stable UUID idempotency',async()=>{
 const f=fixture();await f.transport.request('shop.example','commerce.carts.lines.remove',{cart_id:'cart-1',line_id:'line-2',expected_version:'"v1"',meta:{idempotency_key:'persisted-command'}});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].operationRef,'get_cart');const put=f.calls[1];assert.equal(put.operationRef,'update_cart');assert.equal(put.ifMatch,'"v1"');assert.deepEqual(put.body.line_items,[{id:'line-1',item:{id:'variant-1'},quantity:1}]);assert.match(put.idempotencyKey,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('Customer stale Cart version stops before PUT',async()=>{
 const f=fixture();await assert.rejects(f.transport.request('shop.example','commerce.carts.lines.remove',{cart_id:'cart-1',line_id:'line-2',expected_version:'"old"',meta:{idempotency_key:'same-command'}}),/CART_VERSION_CHANGED/);assert.equal(f.calls.length,1);
});
test('actual Customer flow browses, adds a SKU and opens a nonpayment UCP draft',async()=>{
 const f=fixture(),saved=new Map<string,any>();const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 const service=new CustomerService({dataDir:'unused',sites:[]},new Pap03Business(f.sdk),vault);
 const connected=await service.connect('chat','shop.example');const flowId=connected.flowId;
 await service.tool('chat','frontvia_products',{action:'browse',flowId},'browse');
 await service.tool('chat','frontvia_cart',{action:'add',flowId,variant_id:'variant-1',quantity:1},'add');
 const result:any=await service.tool('chat','frontvia_checkout',{action:'prepare',flowId},'draft');
 assert.equal(result.data.resource.status,'incomplete');assert.equal(result.data.resource.id,'draft-1');assert.equal(f.calls.at(-1).operationRef,'create_checkout');assert.deepEqual(f.calls.at(-1).body,{cart_id:'cart-1',line_items:[]});
 const flow=service.flow('chat',flowId);assert.equal(flow.purchaseReady,false);assert.equal(flow.cart.id,'cart-1');assert.equal(flow.checkout.messages[0].code,'payment_method_unavailable');assert(!f.calls.some(call=>/confirm|complete/.test(call.operationRef)));
});


test('lost Cart PUT response recovers the exact persisted body/key after Customer restart',async()=>{
 const f=fixture(),saved=new Map<string,any>();const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 const make=()=>new CustomerService({dataDir:'unused',sites:[]},new Pap03Business(f.sdk),vault);
 const first=make(),connected=await first.connect('chat','shop.example'),flowId=connected.flowId;
 await first.tool('chat','frontvia_cart',{action:'add',flowId,variant_id:'variant-1',quantity:1},'add');
 f.lose();await assert.rejects(first.tool('chat','frontvia_cart',{action:'update',flowId,line_id:'line-1',quantity:3,expected_version:'"v1"'},'change'));
 const original=f.calls.findLast(call=>call.operationRef==='update_cart');assert(original);assert.equal(f.effects(),2);
 const restarted=make();await restarted.connect('chat','shop.example');
 await restarted.tool('chat','frontvia_orders',{action:'recover',flowId},'recover');
 const repeated=f.calls.filter(call=>call.operationRef==='update_cart');assert.equal(repeated.length,2);assert.deepEqual(repeated[1],original);assert.equal(f.effects(),2);
 assert.equal(restarted.flow('chat',flowId).cart.lines[0].quantity,3);assert.equal(restarted.flow('chat',flowId).pending,undefined);
});


test('owner contact updates a complete standard Checkout payload without readonly prices',async()=>{
 const f=fixture(),saved=new Map<string,any>();const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 const service=new CustomerService({dataDir:'unused',sites:[]},new Pap03Business(f.sdk),vault),connected=await service.connect('chat','shop.example'),flowId=connected.flowId;
 await service.tool('chat','frontvia_cart',{action:'add',flowId,variant_id:'variant-1',quantity:1},'add');
 await service.tool('chat','frontvia_checkout',{action:'prepare',flowId},'draft');
 await service.contact('chat',flowId,'"v1"',{email:'buyer@example.test',shipping_address:{country:'US',recipient:'Buyer',line1:'1 Main Street',city:'Town',region:'CA',postal_code:'90001'}},'contact');
 const update=f.calls.findLast(call=>call.operationRef==='update_checkout');assert(update);assert.equal(update.path.id,'draft-1');assert.deepEqual(update.body.line_items,[{id:'line-1',item:{id:'variant-1'},quantity:1}]);
 assert.equal(update.body.buyer.email,'buyer@example.test');const method=update.body.fulfillment.methods[0];assert.equal(method.type,'shipping');assert.deepEqual(method.line_item_ids,['line-1']);assert.equal(method.destinations[0].street_address,'1 Main Street');assert(!('totals' in update.body));assert(!('status' in update.body));
 assert.equal(service.flow('chat',flowId).purchaseReady,false);
});


test('standard Order quantities and fulfillment events project without inventing payment state',async()=>{
 const f=fixture();const response:any=await f.transport.request('shop.example','commerce.orders.get',{order_id:'order-1'});
 assert.deepEqual(f.calls.at(-1),{operationRef:'get_order',path:{id:'order-1'}});
 const order=response.result.data;assert.equal(order.lines[0].quantity,1);assert.equal(order.checkout_id,'draft-1');assert.equal(order.shipments[0].status,'shipped');assert.equal(order.shipments[0].tracking[0].tracking_number,'track-1');assert.equal(order.payment,undefined);assert.equal(order.status,undefined);
});

async function cartFlow(f: ReturnType<typeof fixture>) {
 const saved=new Map<string,any>();
 const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 const service=new CustomerService({dataDir:'unused',sites:[]},new Pap03Business(f.sdk),vault);
 const {flowId}=await service.connect('chat','shop.example');
 const call=(args:object,command:string)=>service.tool('chat','frontvia_cart',{...args,flowId},command);
 await call({action:'add',variant_id:'variant-1',quantity:1},'initial');
 return {service,flowId,call,flow:()=>service.flow('chat',flowId)};
}

test('a definite UCP version conflict settles the command and reloads the current cart',async()=>{
 const f=fixture(),c=await cartFlow(f);
 f.externalEdit();
 f.reject('version_conflict');
 const edit={action:'update',line_id:'line-1',quantity:3,expected_version:'"v1"'};
 await assert.rejects(c.call(edit,'stale'),{code:'CART_VERSION_CHANGED'});
 assert.equal(c.flow().pending,undefined);
 assert.equal(c.flow().cart.version,'"external"');
 assert.equal(c.flow().cart.lines[0].quantity,2);
 assert.equal(f.effects(),1);
 await assert.rejects(c.call(edit,'stale'),{code:'CART_VERSION_CHANGED'});
 assert.equal(f.calls.filter(call=>call.operationRef==='update_cart').length,1);
 await c.call({...edit,expected_version:'"external"'},'new-edit');
 assert.equal(c.flow().cart.lines[0].quantity,3);
});

test('pending, busy and malformed UCP responses retain the original persisted Cart write',async()=>{
 for(const [code,responseVersion] of [['operation_pending',version],['resource_busy',version],['version_conflict','bad']]){
  const f=fixture(),c=await cartFlow(f);
  f.reject(code,409,responseVersion);
  await assert.rejects(c.call({action:'update',line_id:'line-1',quantity:3,expected_version:'"v1"'},'pending'));
  assert(c.flow().pending);
  const original=f.calls.findLast(call=>call.operationRef==='update_cart');
  await c.service.tool('chat','frontvia_orders',{action:'recover',flowId:c.flowId},'recover');
  assert.deepEqual(f.calls.findLast(call=>call.operationRef==='update_cart'),original);
  assert.equal(c.flow().pending,undefined);
  assert.equal(c.flow().cart.lines[0].quantity,3);
 }
});

test('repeat adding a SKU preserves its line ID and handles quantity and inventory rejection',async()=>{
 const f=fixture(),c=await cartFlow(f);
 const add=(quantity:number,command:string)=>c.call({action:'add',variant_id:'variant-1',quantity,expected_version:c.flow().cart.version},command);
 await add(2,'again');
 assert.deepEqual(f.calls.findLast(call=>call.operationRef==='update_cart').body.line_items,
   [{id:'line-1',item:{id:'variant-1'},quantity:3}]);
 await assert.rejects(add(98,'too-many'),{code:'CART_QUANTITY_LIMIT'});
 assert.equal(f.calls.filter(call=>call.operationRef==='update_cart').length,1);
 assert.equal(c.flow().pending,undefined);
 f.reject('out_of_stock');
 await assert.rejects(add(2,'stock'),{code:'OUT_OF_STOCK'});
 assert.equal(c.flow().pending,undefined);
 assert.equal(c.flow().cart.lines[0].quantity,3);
 await add(1,'smaller');
 assert.equal(c.flow().cart.lines[0].quantity,4);
});
