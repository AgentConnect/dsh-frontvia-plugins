import test from 'node:test';
import assert from 'node:assert/strict';
import {Pap03Transport} from '../src/pap03-transport.js';
import {Pap03Business} from '../src/pap03-business.js';
import {CustomerService} from '../src/core.js';
import {UCP_CHECKOUT_CONFIRMATION,UCP_PURCHASE_PROFILE} from '../src/ucp-business.js';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';
const version='2026-08-25';
const ucp={version};
const storeContext='com.frontvia.shopping.store_context';
const orderHistory='com.frontvia.shopping.order_history';
const metadata=(capability:string)=>({version,status:'success',capabilities:{[capability]:[{version}]}});
const product={id:'product-1',title:'Mug',description:{plain:'Ceramic'},price_range:{min:{amount:1250,currency:'USD'},max:{amount:1250,currency:'USD'}},variants:[{id:'variant-1',title:'Blue',description:{plain:'Blue ceramic'},price:{amount:1250,currency:'USD'},sku:'MUG-BLUE',availability:{available:false},media:[{type:'image',url:'https://shop.example/mug.jpg',alt_text:'Blue mug'}],options:[{name:'Color',id:'blue',label:'Blue'}]}]};
function fixture(cartOnly=false, fullFlow=false){
  let loseNext=false, dropCompleteBeforeAdmission=false, rejection: {status:number;code:string;version:string}|undefined;const receipts=new Map<string,any>();let effects=0;
  const calls:any[]=[],store={companyRef:'shop',companyId:fullFlow?'https://issuer.example':'https://shop.example',domain:'shop.example',name:'Shop',ucpCapabilities:['dev.ucp.shopping.fulfillment']};
  if (fullFlow) store.ucpCapabilities.push(UCP_CHECKOUT_CONFIRMATION);
  const checkoutId = fullFlow ? '6c7cedd6-7df5-4df1-b13c-ff81a06b0e44' : 'draft-1';
  const intentId = '593e39b7-4130-49ff-884c-98e10eeb8cd1';
  const paymentReference = 'd8468997-828c-46d4-879a-743f448d62f0';
  const orderId = 'fa47864c-f990-4637-a298-37e2fae36f54';
  let storeId = 'physical-shop', generation = 1, country = 'US', advertisedContext = fullFlow, storeStatus = 200;
  let authorized = true, catalogAvailable = true, confirmationPatch: Record<string,unknown> = {};
  const currentProduct = () => ({...product,variants:product.variants.map(variant=>({...variant,availability:{available:catalogAvailable}}))});
  const expiresAt = new Date(Date.now()+120_000).toISOString();
  let checkout: any, checkoutRevision = 1;
  const specs=[['commerce.capabilities.get','GET'],['update_checkout','PUT'],['search_catalog','POST'],['get_product','POST'],['create_cart','POST'],['get_cart','GET'],['update_cart','PUT'],['create_checkout','POST'],['get_checkout','GET'],['cancel_checkout','POST'],['get_order','GET']];
  if (fullFlow) specs.push(['prepare_checkout','POST'],['approve_checkout_handoff','POST'],['complete_checkout','POST'],['list_orders','GET']);
  const legacy = cartOnly ? ['commerce.checkouts.create','commerce.checkouts.get','commerce.orders.get'] : [];
  const offered = cartOnly
    ? [...specs.filter(([id])=>!id.includes('checkout')&&id!=='get_order'),...legacy.map(id=>[id,'POST'])]
    : specs;
  const operations=offered.map(([operationId,method])=>({companyRef:'shop',operationRef:operationId,operationId,method,channel:operationId.startsWith('commerce.')?'openapi':'ucp',pathParameters:['get_cart','update_cart','get_checkout','cancel_checkout','get_order','update_checkout'].includes(operationId)?['id']:[]}));
  const storeOperation={companyRef:'shop',operationRef:'get_store_context',operationId:'get_store_context',method:'GET',channel:'ucp',pathParameters:[]};
  let etag='"v1"',cart:any={ucp,id:'cart-1',currency:'USD',line_items:[{id:'line-1',item:{id:'variant-1',title:'Mug',price:1250},quantity:1,totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]},{id:'line-2',item:{id:'variant-2',title:'Plate',price:1000},quantity:1,totals:[{type:'subtotal',amount:1000},{type:'total',amount:1000}]}],totals:[{type:'subtotal',amount:2250},{type:'total',amount:2250}]};
  const sdk:PapOperationsClient={requestTimeoutMs:1000,connect:async()=>({ok:true,value:{company:store}}),status:async()=>({ok:true,value:{state:'ready',identity:{did:authorized?'test':'other'},companies:[store],sessions:[{companyRef:'shop',connected:true}]}}),operations:async()=>({ok:true,value:[...operations,...(advertisedContext?[storeOperation]:[])]}),request:async(input:any)=>{
    calls.push(structuredClone(input));
    if(input.idempotencyKey&&receipts.has(input.idempotencyKey))return structuredClone(receipts.get(input.idempotencyKey));
    if (input.operationRef === 'update_cart' && rejection) {
      const {status,code,version}=rejection;
      rejection=undefined;
      return {ok:true,value:{status,body:{ucp:{version,status:'error'},messages:[{type:'error',code}]}}};
    }
    let body:any;
    if(input.operationRef==='commerce.capabilities.get')body={result:{data:{store_id:'shop',default_context:{country:'US',currency:'USD',locale:'en-US'},methods:legacy.map(method=>({method,availability:'supported'}))}}};
    else if(input.operationRef==='get_store_context'){
      body={ucp:metadata(storeContext),store_id:storeId,default_context:{country,currency:country==='US'?'USD':'CNY',locale:country==='US'?'en-US':'zh-CN'},connection:{connection_id:'native',generation}};
      return {ok:true,value:{status:storeStatus,body}};
    }
    else if(input.operationRef==='search_catalog')body={ucp,products:[currentProduct()],pagination:{has_next_page:false}};
    else if(input.operationRef==='get_product')body={ucp,product:currentProduct()};
    else if(fullFlow && input.operationRef==='create_checkout') {
      checkout??={...cart,id:checkoutId,status:'incomplete',buyer:{email:'buyer@example.test'},
        context:{address_country:country,currency:country==='CN'?'CNY':'USD',address_region:'CA'}};
      body=checkout;
    }
    else if(fullFlow && input.operationRef==='get_checkout')body=checkout;
    else if(fullFlow && input.operationRef==='update_checkout'){
      if(input.ifMatch!==`"checkout-${checkoutRevision}"`)
        return {ok:true,value:{status:412,body:{ucp:{version,status:'error'},
          messages:[{type:'error',code:'etag_mismatch'}]}}};
      checkout={...checkout,buyer:input.body.buyer,fulfillment:input.body.fulfillment};
      checkoutRevision++;
      body=checkout;
    }
    else if(input.operationRef==='prepare_checkout'){
      assert.equal(input.path.id,checkoutId);
      checkout={...checkout,status:'ready_for_complete',expires_at:expiresAt,
        continue_url:`https://shop.example/ucp/v1/checkout-sessions/${checkoutId}/handoff`};
      body={checkout,intent_id:intentId,revision:2,expires_at:expiresAt,payment_reference:paymentReference,
        confirmation:{profile:UCP_PURCHASE_PROFILE,store_id:storeId,connection_id:'native',generation,
          checkout_id:checkoutId,quote_id:'a65ec167-4752-47bb-919f-5680ca846b03',
          snapshot_hash:'a'.repeat(64),amount_minor:'2250',currency:'USD',idempotency_key:'ucp:'+intentId,...confirmationPatch}};
    }
    else if(input.operationRef==='approve_checkout_handoff')body={status:'authorized'};
    else if(input.operationRef==='complete_checkout'){
      assert.equal(input.path.id,checkoutId);
      if(dropCompleteBeforeAdmission){
        dropCompleteBeforeAdmission=false;
        return {ok:false,error:{code:'request_uncertain',businessRequest:'unknown'}};
      }
      checkout={...checkout,status:'complete_in_progress'};
      body=checkout;
    }
    else if(input.operationRef==='list_orders')body={ucp:metadata(orderHistory),items:[{order_id:orderId}],page:input.query?.cursor?{has_more:false,next_cursor:null}:{has_more:true,next_cursor:'opaque-next'}};
    else if(input.operationRef==='create_checkout'||input.operationRef==='get_checkout'||input.operationRef==='update_checkout')body={...cart,ucp:{version,payment_handlers:{}},id:'draft-1',status:'incomplete',links:[],messages:[{type:'error',code:'payment_method_unavailable',severity:'recoverable',content:'Payment is unavailable'}],...(input.operationRef==='update_checkout'?{buyer:input.body.buyer,fulfillment:input.body.fulfillment}:{})};
    else if(input.operationRef==='cancel_checkout')body={...cart,ucp:{version,payment_handlers:{}},id:'draft-1',status:'canceled',links:[]};
    else if(input.operationRef==='get_order')body={...cart,id:fullFlow?orderId:'order-1',checkout_id:checkoutId,permalink_url:'https://shop.example/orders/order-1',line_items:cart.line_items.map((line:any)=>({...line,quantity:{original:line.quantity,total:line.quantity,fulfilled:line.quantity}})),fulfillment:{events:[{id:'shipment-event',type:'shipped',occurred_at:'2026-11-15T00:00:00Z',tracking_number:'track-1',tracking_url:'https://carrier.example/track-1',carrier:'Carrier',line_items:[{id:'line-1',quantity:1}]}]}};
    else if(input.operationRef==='get_cart')body=cart;
    else if(input.operationRef==='update_cart'){assert.equal(input.ifMatch,etag);etag='"v2"';cart={...cart,line_items:input.body.line_items.map((line:any)=>({...line,item:{...line.item,title:'Mug',price:1250},totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]}))};body=cart;}
    else if(input.operationRef==='create_cart'){cart={...cart,line_items:input.body.line_items.map((line:any,index:number)=>({...line,id:`line-${index+1}`,item:{...line.item,title:'Mug',price:1250},totals:[{type:'subtotal',amount:1250},{type:'total',amount:1250}]}))};body=cart;}
    else throw new Error('Unexpected operation');
    const response={ok:true as const,value:{status:200,body,
      etag:fullFlow&&body.id===checkoutId?`"checkout-${checkoutRevision}"`:etag}};
    if(input.idempotencyKey){effects++;receipts.set(input.idempotencyKey,structuredClone(response));if(loseNext){loseNext=false;return {ok:false,error:{code:'request_uncertain',businessRequest:'unknown'}};}}
    return response;
  }};
  return {sdk,calls,paymentReference,checkoutId,orderId,transport:new Pap03Transport(sdk),lose(){loseNext=true;},effects:()=>effects,
    useContext(){advertisedContext=true;}, useCountry(value:string){country=value;}, changeGeneration(){generation++;},
    denyStore(){storeStatus=403;}, changeIdentity(){authorized=false;}, patchConfirmation(fields:Record<string,unknown>){confirmationPatch=fields;},
    noStock(){catalogAvailable=false;},
    dropComplete(){dropCompleteBeforeAdmission=true;},
    finishPurchase(){checkout={...checkout,status:'completed',order:{id:orderId}};},
    reject(code:string,status=409,responseVersion=version){rejection={code,status,version:responseVersion};},
    externalEdit(){etag='"external"';cart.line_items[0].quantity=2;},
  };
}
test('Customer UCP catalog uses standard POST payloads and projects product and SKU separately',async()=>{
 const f=fixture();f.noStock();const search:any=await f.transport.request('shop.example','commerce.products.search',{query:'mug',page:{limit:8}});
 assert.deepEqual(f.calls[0],{operationRef:'search_catalog',body:{query:'mug',pagination:{limit:8}}});assert.equal(search.result.data.items[0].description,'Ceramic');
 assert.deepEqual(search.result.data.items[0].price_range.max,{amount_minor:'1250',currency:'USD'});
 const variants:any=await f.transport.request('shop.example','commerce.variants.list',{product_id:'product-1'});
 assert.deepEqual(f.calls[1],{operationRef:'get_product',body:{id:'product-1'}});
 const [variant]=variants.result.data.items;
 assert.equal(variant.id,'variant-1');
 assert.equal(variant.product_id,'product-1');
 assert.equal(variant.sku,'MUG-BLUE');
 assert.equal(variant.buyable,false);
 assert.equal(variant.selected_options[0].value,'Blue');
 assert.equal(variant.images[0].alt,'Blue mug');
 assert.deepEqual(variant.unit_price,{amount_minor:'1250',currency:'USD'});
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
 const update=f.calls.findLast(call=>call.operationRef==='update_checkout');assert(update);assert.equal(update.path.id,'draft-1');assert.equal(update.body.id,undefined);assert.deepEqual(update.body.line_items,[{id:'line-1',item:{id:'variant-1'},quantity:1}]);
 assert.equal(update.body.buyer.email,'buyer@example.test');const method=update.body.fulfillment.methods[0];assert.equal(method.type,'shipping');assert.deepEqual(method.line_item_ids,['line-1']);assert.equal(method.destinations[0].street_address,'1 Main Street');assert(!('totals' in update.body));assert(!('status' in update.body));
 assert.equal(service.flow('chat',flowId).purchaseReady,false);
});


test('standard Order quantities and fulfillment events project without inventing payment state',async()=>{
 const f=fixture();const response:any=await f.transport.request('shop.example','commerce.orders.get',{order_id:'order-1'});
 assert.deepEqual(f.calls.at(-1),{operationRef:'get_order',path:{id:'order-1'}});
 const order=response.result.data;assert.equal(order.lines[0].quantity,1);assert.equal(order.checkout_id,'draft-1');assert.equal(order.shipments[0].status,'shipped');assert.equal(order.shipments[0].tracking[0].tracking_number,'track-1');assert.equal(order.payment,undefined);assert.equal(order.status,undefined);
});

async function connectFlow(f: ReturnType<typeof fixture>, sites: {siteId:string;storeId:string}[] = []) {
 const saved=new Map<string,any>();
 const vault={keys:(prefix:string)=>[...saved.keys()].filter(key=>key.startsWith(prefix)),get:<T>(key:string)=>structuredClone(saved.get(key)) as T|undefined,set:(key:string,value:unknown)=>{saved.set(key,structuredClone(value));}};
 const service=new CustomerService({dataDir:'unused',sites},new Pap03Business(f.sdk),vault);
 const {flowId}=await service.connect('chat','shop.example');
 const call=(args:object,command:string)=>service.tool('chat','frontvia_cart',{...args,flowId},command);
 return {service,flowId,call,vault,flow:()=>service.flow('chat',flowId)};
}
async function cartFlow(f: ReturnType<typeof fixture>) {
 const flow=await connectFlow(f);
 await flow.call({action:'add',variant_id:'variant-1',quantity:1},'initial');
 return flow;
}

test('authoritative Store Context drives US/CN wire fields and ignores old metadata',async()=>{
 for(const [country,currency,language] of [['US','USD','en-US'],['CN','CNY','zh-CN']]){
  const f=fixture(false,true);f.useCountry(country);
  const c=await connectFlow(f);
  assert.equal(c.flow().storeId,'physical-shop');
  assert.deepEqual(c.flow().connection,{connection_id:'native',generation:1});
  await c.service.tool('chat','frontvia_products',{action:'browse',flowId:c.flowId},'browse');
  assert.deepEqual(f.calls.find(call=>call.operationRef==='search_catalog').body.context,
    {address_country:country,currency,language});
  assert(!f.calls.some(call=>call.operationRef==='commerce.capabilities.get'));
 }
});
test('an older shop without Store Context or legacy metadata keeps only catalog methods',async()=>{
 const f=fixture();
 const operations=f.sdk.operations;
 f.sdk.operations=async()=>{
  const result=await operations();
  assert(result.ok&&Array.isArray(result.value));
  return {ok:true,value:result.value.filter(op=>op.operationId!=='commerce.capabilities.get')};
 };
 const c=await connectFlow(f);
 await c.service.tool('chat','frontvia_products',{action:'browse',flowId:c.flowId},'catalog');
 await assert.rejects(c.call({action:'add',variant_id:'variant-1',quantity:1},'cart'),{code:'METHOD_UNAVAILABLE'});
 assert.deepEqual(f.calls.map(call=>call.operationRef),['search_catalog']);
});
test('store binding, generations and identity changes fail closed',async()=>{
 const f=fixture(false,true);
 await assert.rejects(connectFlow(f,[{siteId:'shop.example',storeId:'wrong-store'}]),{code:'STORE_BINDING_MISMATCH'});
 const c=await connectFlow(f);f.changeGeneration();
 await assert.rejects(c.service.refreshUcpCheckout('chat',c.flowId),{code:'CONNECTION_GENERATION_CHANGED'});
 f.changeIdentity();
 await assert.rejects(c.service.tool('chat','frontvia_products',{action:'browse',flowId:c.flowId},'browse'),
   {code:'PERSONAL_ACCOUNT_CHANGED'});
 const denied=fixture(false,true);denied.denyStore();
 await assert.rejects(connectFlow(denied),{code:'PAP_BUSINESS_HTTP_ERROR'});
 assert(!denied.calls.some(call=>call.operationRef==='commerce.capabilities.get'));
});
test('only resource-free, unconfigured synthetic store flows adopt the official store binding',async()=>{
 for(const withCart of [false,true]){
  const f=fixture(),c=await (withCart?cartFlow(f):connectFlow(f));
  assert.equal(c.flow().storeId,'shop');
  f.useContext();
  if(withCart) {
   await assert.rejects(c.service.refreshUcpCheckout('chat',c.flowId),{code:'STORE_BINDING_MISMATCH'});
   assert.equal(c.flow().cart.id,'cart-1');
   assert.equal(c.flow().storeId,'shop');
  } else {
   await c.service.refreshUcpCheckout('chat',c.flowId);
   assert.equal(c.flow().storeId,'physical-shop');
  }
  assert.equal(f.calls.filter(call=>call.operationRef==='create_cart').length,Number(withCart));
 }
});
test('a pending legacy Cart create retains its wire context and key without a new request',async()=>{
 const f=fixture(false,true),c=await connectFlow(f);
 f.lose();
 await assert.rejects(c.call({action:'add',variant_id:'variant-1',quantity:1},'old'),/PAP_REQUEST_UNCERTAIN/);
 const saved=c.flow(), pending=saved.pending!;
 delete saved.commands[pending].params.ucp_wire_version;
 c.vault.set(`flow:${c.flowId}`,saved);
 await assert.rejects(c.service.recoverFromOwner('chat',c.flowId), {code:'ORIGINAL_RESULT_UNKNOWN'});
 assert.deepEqual(c.flow().commands[pending].params,saved.commands[pending].params);
 await c.service.discardCartAddition('chat',c.flowId);
 await c.service.view('chat',c.flowId,['cart']);
 assert.equal(c.flow().pending,pending);
 assert.equal(f.calls.filter(call=>call.operationRef==='create_cart').length,1);
});
test('order history forwards only the paging cursor and reads the same original Order ID',async()=>{
 const f=fixture(false,true),c=await connectFlow(f);
 const first:any=await f.transport.request('shop.example','commerce.orders.list',{page:{limit:10},store_id:'ignored',connection:{tenant:'ignored'}});
 const cursor=first.result.data.page.next_cursor;
 assert.deepEqual(first.result.data.items,[{order_id:f.orderId}]);
 assert.deepEqual(f.calls.at(-1),{operationRef:'list_orders',query:{limit:'10'}});
 const next:any=await f.transport.request('shop.example','commerce.orders.list',{page:{limit:10,cursor}});
 assert.equal(next.result.data.page.has_more,false);
 assert.deepEqual(f.calls.at(-1),{operationRef:'list_orders',query:{limit:'10',cursor:'opaque-next'}});
 const result:any=await c.service.tool('chat','frontvia_orders',{action:'get',flowId:c.flowId,order_id:f.orderId},'original');
 assert.equal(result.data.id,f.orderId);
 assert.deepEqual(f.calls.at(-1),{operationRef:'get_order',path:{id:f.orderId}});
});

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

test('a Cart-only UCP connection cannot persist or dispatch checkout through legacy routes',async()=>{
 const f=fixture(true), c=await cartFlow(f);
 const connected=await f.transport.connect('shop.example');
 for (const method of ['commerce.checkouts.create','commerce.checkouts.get','commerce.orders.get'])
  assert(!connected.methods.includes(method));
 await assert.rejects(c.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:c.flowId},'checkout'),
   {code:'METHOD_NOT_ADVERTISED'});
 assert.equal(c.flow().pending,undefined);
 assert.equal(f.effects(),1);
 assert(!f.calls.some(call=>String(call.operationRef).includes('checkout')));
});


test('full UCP review and browser approval retain one Checkout and recover a lost Complete by GET', async () => {
 const f=fixture(false,true), c=await cartFlow(f);
 await c.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:c.flowId},'draft');
 const beforePrepare=f.calls.length;
 const prepared=await c.service.prepareUcpPurchase('chat',c.flowId,'prepare');
 const preparation=f.calls.slice(beforePrepare).map(call=>call.operationRef);
 assert(preparation.includes('get_checkout'));
 assert(!preparation.includes('get_cart'));
 assert.equal(prepared.checkout.status,'ready_for_complete');
 assert.equal(prepared.checkout.handoff,`https://shop.example/ucp/v1/checkout-sessions/${f.checkoutId}/handoff`);
 assert.equal(prepared.checkout.canConfirm,true);
 assert(!JSON.stringify(prepared).includes(f.paymentReference));
 const challenge='u'.repeat(43);
 await c.service.approveUcpHandoff('chat',c.flowId,challenge,'pair');
 const approval=f.calls.find(call=>call.operationRef==='approve_checkout_handoff');
 assert.deepEqual(approval.path,{id:f.checkoutId});
 assert.deepEqual(approval.body,{challenge});
 assert(!f.calls.some(call=>call.operationRef==='complete_checkout'));

 f.lose();
 await assert.rejects(c.service.confirmUcpPurchase('chat',c.flowId,'confirm'), /PAP_REQUEST_UNCERTAIN/);
 const complete=f.calls.find(call=>call.operationRef==='complete_checkout');
 assert.deepEqual(complete.path,{id:f.checkoutId});
 assert.deepEqual(complete.body,{payment:{instruments:[{
   id:f.paymentReference,handler_id:'com.frontvia.payment.durable_mock',type:'frontvia_mock',selected:true,
 }]}});
 const frame=JSON.parse(Buffer.from(complete.checkoutConfirmation,'base64url').toString('utf8'));
 assert.equal(frame.amount_minor,'2250');
 assert(frame.exp>frame.iat);
 await c.service.tool('chat','frontvia_orders',{action:'recover',flowId:c.flowId},'recover');
 assert.equal(c.flow().checkout.status,'complete_in_progress');
 assert.equal(c.flow().pending,undefined);
 assert.equal(f.calls.filter(call=>call.operationRef==='complete_checkout').length,1);
 f.finishPurchase();
 await c.service.refreshUcpCheckout('chat',c.flowId);
 assert.equal(c.flow().order.id,f.orderId);
 await c.service.tool('chat','frontvia_orders',{action:'list',flowId:c.flowId},'history');
 assert.equal(c.flow().orders.items[0].id,f.orderId);
});
test('checkout preparation rejects altered store, quote and intent bindings',async()=>{
 const invalid=[
  {store_id:'other-store'}, {connection_id:'other'}, {generation:2}, {checkout_id:'abc'},
  {profile:'frontvia.pap03_purchase.v1'}, {quote_id:'not-a-quote'}, {amount_minor:'2251'},
  {currency:'CNY'}, {idempotency_key:'ucp:fa47864c-f990-4637-a298-37e2fae36f54'},
 ];
 for(const fields of invalid){
  const f=fixture(false,true),c=await cartFlow(f);
  f.patchConfirmation(fields);
  await c.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:c.flowId},'draft');
  await assert.rejects(c.service.prepareUcpPurchase('chat',c.flowId,'prepare'),/INVALID_UCP_CONFIRMATION/);
  assert(!c.flow().ucpPurchase);
  assert(!f.calls.some(call=>call.operationRef==='complete_checkout'));
 }
});
test('only owner recovery may retry the exact Complete after reading the original Checkout',async()=>{
 const f=fixture(false,true),c=await cartFlow(f);
 await c.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:c.flowId},'draft');
 await c.service.prepareUcpPurchase('chat',c.flowId,'prepare');
 f.dropComplete();
 await assert.rejects(c.service.confirmUcpPurchase('chat',c.flowId,'confirm'),/PAP_REQUEST_UNCERTAIN/);
 const original=f.calls.find(call=>call.operationRef==='complete_checkout');
 await assert.rejects(c.service.tool('chat','frontvia_orders',{action:'recover',flowId:c.flowId},'recover'),
   {code:'ORIGINAL_RESULT_UNKNOWN'});
 assert.equal(f.calls.filter(call=>call.operationRef==='complete_checkout').length,1);
 const start=f.calls.length;
 await c.service.recoverFromOwner('chat',c.flowId);
 const operations=f.calls.slice(start);
 const retry=operations.findIndex(call=>call.operationRef==='complete_checkout');
 assert(operations.slice(0,retry).some(call=>call.operationRef==='get_checkout'&&call.path.id===f.checkoutId));
 assert.deepEqual(operations[retry],original);
 assert.equal(c.flow().pending,undefined);
});
test('a persisted legacy Complete is observed without rewriting or replaying its proof',async()=>{
 const f=fixture(false,true),c=await cartFlow(f);
 await c.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:c.flowId},'draft');
 await c.service.prepareUcpPurchase('chat',c.flowId,'prepare');
 f.lose();
 await assert.rejects(c.service.confirmUcpPurchase('chat',c.flowId,'confirm'),/PAP_REQUEST_UNCERTAIN/);
 const flow=c.flow(), command=flow.commands[flow.pending!];
 command.params.confirmation.profile='frontvia.pap03_purchase.v1';
 flow.ucpPurchase!.confirmation!.profile='frontvia.pap03_purchase.v1';
 const proof=structuredClone(command.params.confirmation);
 c.vault.set(`flow:${c.flowId}`,flow);
 await c.service.recoverFromOwner('chat',c.flowId);
 assert.equal(c.flow().pending,undefined);
 assert.deepEqual(c.flow().commands[command.key].params.confirmation,proof);
 assert.equal(f.calls.filter(call=>call.operationRef==='complete_checkout').length,1);
});

test('two Customer clients can edit the same Checkout after a definite ETag rejection', async () => {
 const f=fixture(false,true), a=await cartFlow(f);
 await a.service.tool('chat','frontvia_checkout',{action:'prepare',flowId:a.flowId},'draft');
 const original=a.flow();
 const bState=new Map<string,any>([[`flow:${a.flowId}`,structuredClone(original)]]);
 const bVault={
   keys:(prefix:string)=>[...bState.keys()].filter(key=>key.startsWith(prefix)),
   get:<T>(key:string)=>structuredClone(bState.get(key)) as T|undefined,
   set:(key:string,value:unknown)=>{bState.set(key,structuredClone(value));},
 };
 const bPap=new Pap03Business(f.sdk);
 assert.equal((await bPap.connect('shop.example')).connectionRef,original.connectionRef);
 const b=new CustomerService({dataDir:'unused',sites:[]},bPap,bVault);
 const edit=(client:CustomerService, email:string, key:string)=>client.contact('chat',a.flowId,original.cart.version,{
   email,shipping_address:{country:'US',recipient:'Buyer',line1:'1 Main Street',city:'Town',region:'CA',postal_code:'90001'},
 },key);

 await edit(a.service,'first@example.test','first');
 await assert.rejects(edit(b,'second@example.test','stale'),{code:'UCP_ETAG_MISMATCH'});
 const rejected=b.flow('chat',a.flowId);
 assert.equal(rejected.pending,undefined);
 assert.equal(rejected.checkout.version,'"checkout-2"');
 assert.equal(rejected.checkout.buyer.email,'first@example.test');
 const rejectedCommand=Object.values(rejected.commands).find(command=>command.checkoutRejection);
 assert.equal(rejectedCommand?.status,'done');
 assert.equal(rejectedCommand?.params.expected_version,'"checkout-1"');
 const writes=f.calls.filter(call=>call.operationRef==='update_checkout');
 assert.deepEqual(writes[0].body.context,{address_country:'US',currency:'USD',address_region:'CA'});
 assert.equal(a.flow().checkout.context.country,'US');
 assert.deepEqual(writes.map(call=>call.ifMatch),['"checkout-1"','"checkout-1"']);
 await b.tool('chat','frontvia_orders',{action:'recover',flowId:a.flowId},'refresh');
 assert.equal(f.calls.filter(call=>call.operationRef==='update_checkout').length,2);
 const updated=await edit(b,'second@example.test','fresh');
 const retry=f.calls.findLast(call=>call.operationRef==='update_checkout');
 assert.equal(retry.ifMatch,'"checkout-2"');
 assert.notEqual(retry.idempotencyKey,writes[1].idempotencyKey);
 assert.equal(updated.checkout.buyer.email,'second@example.test');
 assert.equal(updated.checkout.version,'"checkout-3"');
});
