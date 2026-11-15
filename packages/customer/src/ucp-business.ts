import {createHash} from 'node:crypto';

export type UcpOperation={operationRef:string;operationId?:string;channel?:string;method:string;pathParameters?:string[]};
export type UcpRequest={operationRef:string;path?:Record<string,string>;body?:unknown;idempotencyKey?:string;ifMatch?:string};
export type UcpResponse={status:number;body:any;etag?:string};
const mapped:Record<string,string>={
  'commerce.products.search':'search_catalog','commerce.products.get':'get_product','commerce.variants.list':'get_product','commerce.variants.get':'get_product',
  'commerce.carts.create':'create_cart','commerce.carts.get':'get_cart','commerce.carts.lines.add':'update_cart','commerce.carts.lines.update':'update_cart','commerce.carts.lines.remove':'update_cart','commerce.carts.update':'update_cart','commerce.carts.cancel':'cancel_cart',
  'commerce.checkouts.create':'create_checkout','commerce.checkouts.get':'get_checkout','commerce.checkouts.update':'update_checkout','commerce.checkouts.cancel':'cancel_checkout','commerce.orders.get':'get_order',
};
export const isUcpBusinessMethod=(method:string)=>Object.hasOwn(mapped,method);
export function ucpBusinessMethods(operations:UcpOperation[]):string[]{
  const available=new Set(operations.filter(op=>op.channel==='ucp').map(op=>op.operationId));
  return Object.entries(mapped).filter(([,id])=>available.has(id)).map(([method])=>method);
}
const object=(value:any):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_UCP_RESPONSE');return value;};
const amount=(n:any,currency:string)=>{if(!Number.isSafeInteger(n))throw new Error('INVALID_UCP_AMOUNT');return {amount_minor:String(n),currency};};
function totals(resource:any){
  if(!Array.isArray(resource.totals)||typeof resource.currency!=='string')throw new Error('INVALID_UCP_RESPONSE');
  const result:Record<string,unknown>={};
  for(const entry of resource.totals)result[entry.type==='total'?'grand_total':entry.type]=amount(entry.amount,resource.currency);
  return result;
}
function product(value:any,productId?:string){
  const item=object(value),price=item.price;
  return {...item,description:item.description?.plain??'',...(item.description?.markdown?{description_markdown:item.description.markdown}:{}),
    ...(productId?{product_id:productId}:{}),images:(item.media??[]).filter((m:any)=>m.type==='image').map((m:any)=>({url:m.url,alt:m.alt})),
    ...(price?{price:amount(price.amount,price.currency)}:{}),...(item.availability?.status?{availability:item.availability.status}:{})};
}
function resource(value:any,etag?:string){
  const item=object(value);
  if(typeof item.id!=='string'||!Array.isArray(item.line_items))throw new Error('INVALID_UCP_RESPONSE');
  return {...item,version:etag,lines:item.line_items.map((line:any)=>({id:line.id,variant_id:line.item.id,title:line.item.title,quantity:typeof line.quantity==='object'?line.quantity.total:line.quantity,unit_price:amount(line.item.price,item.currency)})),totals:totals(item),
    ...(item.status?{can_start_new_attempt:item.status==='incomplete'||item.status==='canceled'}:{})};
}
function uuid(key:unknown):string{
  if(typeof key!=='string'||!key)throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  const hex=createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function lineInput(line:any){return {id:line.id,item:{id:line.item.id},quantity:line.quantity};}
function cartInput(cart:any){return {id:cart.id,line_items:cart.line_items.map(lineInput),...(cart.buyer?{buyer:cart.buyer}:{}),...(cart.context?{context:cart.context}:{}),...(cart.fulfillment?{fulfillment:cart.fulfillment}:{}),...(cart.discounts?{discounts:cart.discounts}:{})};}
function context(value:any){return value?{...value,...(value.locale?{language:value.locale}:{})}:undefined;}

/** Only wire requests use UCP schemas; the returned objects are local presentation data for existing cards. */
export async function requestUcp(method:string,params:Record<string,any>,operations:UcpOperation[],send:(request:UcpRequest)=>Promise<UcpResponse>):Promise<unknown>{
  const id=mapped[method];if(!id)return undefined;
  const match=operations.filter(op=>op.channel==='ucp'&&op.operationId===id);
  if(!match.length)return undefined;if(match.length!==1)throw new Error('AMBIGUOUS_UCP_OPERATION');
  const op=match[0],write=!['search_catalog','get_product','get_cart','get_checkout','get_order'].includes(id);
  const key=write?uuid(params.meta?.idempotency_key??params.idempotency_key):undefined;
  let body:any,path:Record<string,string>|undefined,ifMatch:string|undefined;
  if(id==='search_catalog')body={...(params.query?{query:params.query}:{}),...(params.context?{context:context(params.context)}:{}),...(params.page?{pagination:params.page}:{})};
  else if(id==='get_product')body={id:params.product_id??params.variant_id,...(params.context?{context:context(params.context)}:{})};
  else if(id==='create_cart')body={line_items:(params.lines??[]).map((line:any)=>({item:{id:line.variant_id},quantity:line.quantity})),...(params.context?{context:context(params.context)}:{})};
  else if(['get_cart','cancel_cart','update_cart'].includes(id))path={id:params.cart_id};
  else if(['get_checkout','cancel_checkout','update_checkout'].includes(id))path={id:params.checkout_id};
  else if(id==='get_order')path={id:params.order_id};
  else if(id==='create_checkout')body={cart_id:params.cart_id,line_items:[]};
  if(id==='update_cart'){
    const read=operations.filter(entry=>entry.channel==='ucp'&&entry.operationId==='get_cart');if(read.length!==1)throw new Error('METHOD_NOT_ADVERTISED');
    const current=params.ucp_cart_snapshot?{body:params.ucp_cart_snapshot,etag:params.ucp_cart_snapshot.version}:await send({operationRef:read[0].operationRef,path});
    if(current.body.id!==params.cart_id)throw new Error('CART_VERSION_CHANGED');
    if(!current.etag||params.expected_version!==current.etag)throw new Error('CART_VERSION_CHANGED');
    ifMatch=current.etag;body=cartInput(current.body);
    if(method==='commerce.carts.lines.add')body.line_items.push({item:{id:params.line.variant_id},quantity:params.line.quantity});
    else if(method==='commerce.carts.lines.remove'){
      if(!body.line_items.some((line:any)=>line.id===params.line_id))throw new Error('LINE_NOT_FOUND');
      body.line_items=body.line_items.filter((line:any)=>line.id!==params.line_id);
    }else if(method==='commerce.carts.lines.update'){
      const line=body.line_items.find((line:any)=>line.id===params.line_id);if(!line)throw new Error('LINE_NOT_FOUND');line.quantity=params.quantity;
    }else if(method==='commerce.carts.update'){
      const patch=object(params.patch);
      if(Object.keys(patch).some(key=>!['buyer','context','fulfillment'].includes(key)))throw new Error('UNSUPPORTED_UCP_CART_FIELD');
      Object.assign(body,patch);
    }
  }
  if(id==='update_checkout'){
    ifMatch=params.expected_version;
    body={id:params.checkout_id,line_items:params.line_items,...(params.buyer?{buyer:params.buyer}:{}),...(params.fulfillment?{fulfillment:params.fulfillment}:{}),...(params.context?{context:params.context}:{})};
  }
  if(id==='cancel_cart'||id==='cancel_checkout')body={};
  const response=await send({operationRef:op.operationRef,...(path?{path}:{}),...(body===undefined?{}:{body}),...(key?{idempotencyKey:key}:{}),...(ifMatch?{ifMatch}:{})});
  const result=object(response.body),envelope=object(result.ucp);
  if(envelope.version!=='2026-08-25'||envelope.status==='error')throw new Error('UCP_OPERATION_FAILED');
  let data:any;
  if(id==='search_catalog'){
    if(!Array.isArray(result.products))throw new Error('INVALID_UCP_RESPONSE');
    data={items:result.products.map(item=>product(item)),page:{has_more:result.pagination?.has_next_page===true,next_cursor:result.pagination?.cursor??null}};
  }else if(id==='get_product'){
    const found=object(result.product);
    data=method==='commerce.variants.list'?{items:(found.variants??[]).map((variant:any)=>product(variant,found.id)),page:{has_more:false,next_cursor:null}}:method==='commerce.variants.get'?product((found.variants??[]).find((variant:any)=>variant.id===params.variant_id),found.id):product(found);
  }else {
    data=resource(result,response.etag);
    if(id==='get_order')data.shipments=(result.fulfillment?.events??[]).map((event:any)=>({id:event.id,status:event.type,occurred_at:event.occurred_at,description:event.description,
      tracking:event.tracking_number||event.tracking_url?[{carrier:event.carrier,tracking_number:event.tracking_number,tracking_url:event.tracking_url}]:[]}));
  }
  if(write)return {result:{data:{operation:{id:key,status:'succeeded',source:'ucp_response'},resource:data}}};
  return {result:{data}};
}

/** Standard complete Checkout update assembled from the last observed resource. */
export function ucpCheckoutContact(checkout:any,contact:any){
  const address=contact.shipping_address;
  const methods=(checkout.fulfillment?.methods??[]).map((method:any)=>({id:method.id,type:method.type,line_item_ids:method.line_item_ids,
    ...(method.type==='shipping'&&method.destinations?{destinations:method.destinations}:{}),
    ...(method.selected_destination_id!==undefined?{selected_destination_id:method.selected_destination_id}:{}),
    ...(method.groups?{groups:method.groups.map((group:any)=>({id:group.id,selected_option_id:group.selected_option_id??null}))}:{})}));
  if(address){
    const current=methods.find((method:any)=>method.type==='shipping'),destination={id:current?.selected_destination_id??'customer-address',type:'shipping_address',
      address_country:address.country,street_address:address.line1,...(address.line2?{extended_address:address.line2}:{}),
      ...(address.city?{address_locality:address.city}:{}),...(address.region?{address_region:address.region}:{}),...(address.postal_code?{postal_code:address.postal_code}:{}),
      ...(address.recipient?{first_name:address.recipient}:{}),...(address.phone?{phone_number:address.phone}:{})};
    const shipping={...(current??{}),type:'shipping',line_item_ids:checkout.line_items.map((line:any)=>line.id),destinations:[destination],selected_destination_id:destination.id};
    // Address changes invalidate a previously selected shipping quote.
    delete shipping.groups;
    const index=methods.findIndex((method:any)=>method.type==='shipping');if(index<0)methods.push(shipping);else methods[index]=shipping;
  }
  return {checkout_id:checkout.id,line_items:checkout.line_items.map(lineInput),buyer:{...(checkout.buyer??{}),...(contact.email?{email:contact.email}:{})},
    ...(checkout.context?{context:checkout.context}:{}),...(methods.length?{fulfillment:{methods}}:{}),...(checkout.version?{expected_version:checkout.version}:{})};
}
