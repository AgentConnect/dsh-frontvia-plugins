import {createHash} from 'node:crypto';

export type UcpOperation={operationRef:string;operationId?:string;channel?:string;method:string;pathParameters?:string[]};
export type UcpRequest={operationRef:string;path?:Record<string,string>;query?:Record<string,string>;body?:unknown;idempotencyKey?:string;ifMatch?:string;checkoutConfirmation?:string};

export const UCP_CHECKOUT_CONFIRMATION = 'com.frontvia.shopping.checkout_confirmation';
export const UCP_PURCHASE_PROFILE = 'frontvia.ucp_purchase.v1';
const MOCK_HANDLER = 'com.frontvia.payment.durable_mock';
export type UcpPurchase = {
  checkoutId: string;
  intentId: string;
  revision: number;
  expiresAt: string;
  paymentReference: string | null;
  confirmation: Record<string, any> | null;
};
export type UcpResponse={status:number;body:any;etag?:string};
export type CartRejection = 'CART_VERSION_CHANGED' | 'CART_QUANTITY_LIMIT' | 'OUT_OF_STOCK';

export class UcpCartRejection extends Error {
  constructor(readonly code: CartRejection) {
    super(code);
  }
}

class UcpResponseError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(code ? `UCP_${code.toUpperCase()}` : 'UCP_OPERATION_FAILED');
    this.name = 'UcpResponseError';
  }
}

export function isUcpResponseError(error: unknown): error is UcpResponseError {
  return error instanceof Error && error.name === 'UcpResponseError';
}

function responseError(response: UcpResponse) {
  const body = response.body;
  const messages = body?.messages;
  const code = body?.ucp?.version === '2026-08-25' && body.ucp.status === 'error'
    && Array.isArray(messages) && messages.length === 1 && messages[0]?.type === 'error'
    && typeof messages[0].code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(messages[0].code)
    ? messages[0].code as string : undefined;
  return new UcpResponseError(response.status, code);
}

const mapped:Record<string,string>={
  'commerce.products.search':'search_catalog','commerce.products.get':'get_product','commerce.variants.list':'get_product','commerce.variants.get':'get_product',
  'commerce.carts.create':'create_cart','commerce.carts.get':'get_cart','commerce.carts.lines.add':'update_cart','commerce.carts.lines.update':'update_cart','commerce.carts.lines.remove':'update_cart','commerce.carts.update':'update_cart','commerce.carts.cancel':'cancel_cart',
  'commerce.checkouts.create':'create_checkout','commerce.checkouts.get':'get_checkout','commerce.checkouts.update':'update_checkout','commerce.checkouts.cancel':'cancel_checkout','commerce.orders.get':'get_order','commerce.orders.list':'list_orders',
  'commerce.checkouts.prepare':'prepare_checkout','commerce.checkouts.confirm':'complete_checkout',
  'commerce.checkouts.handoff.approve':'approve_checkout_handoff',
};
export const isUcpBusinessMethod=(method:string)=>Object.hasOwn(mapped,method);
export function ucpBusinessMethods(operations:UcpOperation[]):string[]{
  const available=new Set(operations.filter(op=>op.channel==='ucp').map(op=>op.operationId));
  return Object.entries(mapped).filter(([,id])=>available.has(id)
    && (id !== 'complete_checkout' || available.has('prepare_checkout') && available.has('approve_checkout_handoff'))).map(([method])=>method);
}
const object=(value:any):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_UCP_RESPONSE');return value;};
const amount=(n:any,currency:string)=>{if(!Number.isSafeInteger(n)||!(/^[A-Z]{3}$/.test(currency)))throw new Error('INVALID_UCP_AMOUNT');return {amount_minor:String(n),currency};};
function totals(resource:any){
  if(!Array.isArray(resource.totals)||typeof resource.currency!=='string')throw new Error('INVALID_UCP_RESPONSE');
  const result:Record<string,unknown>={};
  for(const entry of resource.totals)result[entry.type==='total'?'grand_total':entry.type]=amount(entry.amount,resource.currency);
  return result;
}
function product(value:any,productId?:string):Record<string,any>{
  const item=object(value);
  const money=(price:any)=>amount(price.amount,price.currency);
  const price=item.unit_price??item.price;
  const range=item.price_range;
  const availability=item.availability;
  const status=typeof availability==='string'?availability:availability?.status;
  const unavailable=availability?.available===false || availability?.quantity_available===0 ||
    ['out_of_stock','unavailable'].includes(status);
  const available=availability?.available===true || ['in_stock','available'].includes(status);
  return {...item,description:item.description?.plain??(typeof item.description==='string'?item.description:''),
    ...(item.description?.markdown?{description_markdown:item.description.markdown}:{}),
    ...(productId?{product_id:productId}:{}),
    images:(item.media??[]).filter((m:any)=>m.type==='image').map((m:any)=>({url:m.url,alt:m.alt_text??m.alt})),
    ...(range?{price_range:{
      ...((range.min??range.minimum)?{min:money(range.min??range.minimum)}:{}),
      ...((range.max??range.maximum)?{max:money(range.max??range.maximum)}:{}),
    }}:{}),
    ...(price?{price:money(price),...(productId||item.unit_price?{unit_price:money(price)}:{})}:{}),
    ...(unavailable||available?{buyable:!unavailable}:{}),
    ...(availability?{availability:{...(typeof availability==='object'?availability:{}),...(status?{status}:{})}}:{}),
    ...(productId && Array.isArray(item.options)?{selected_options:item.options.map((option:any)=>({...option,value:option.label}))}:{}),
    ...(!productId && Array.isArray(item.variants)?{variants:item.variants.map((variant:any)=>product(variant,item.id))}:{}),
  };
}
function resource(value:any,etag?:string){
  const item=object(value);
  if(typeof item.id!=='string'||!Array.isArray(item.line_items))throw new Error('INVALID_UCP_RESPONSE');
  return {...item,version:etag,lines:item.line_items.map((line:any)=>({id:line.id,variant_id:line.item.id,title:line.item.title,quantity:typeof line.quantity==='object'?line.quantity.total:line.quantity,unit_price:amount(line.item.price,item.currency)})),totals:totals(item),
    ...(item.context?{context:internalContext(item.context)}:{}),
    ...(item.status?{can_start_new_attempt:item.status==='incomplete'||item.status==='canceled'}:{}),
    ...(item.order?.id && item.status === 'completed' ? {order_ids:[item.order.id]} : {})};
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function matchesUcpConfirmation(input: unknown, checkout: any, intentId: string, storeId: string, connection: any) {
  if(!input||typeof input!=='object'||Array.isArray(input))return false;
  const frame = object(input);
  const fields = ['profile','store_id','connection_id','generation','checkout_id','quote_id',
    'snapshot_hash','amount_minor','currency','idempotency_key'];
  // The outer UCP resource uses the draft ID. The frame binds its Native attempt.
  return Object.keys(frame).length === fields.length && fields.every(field => Object.hasOwn(frame, field))
    && frame.profile === UCP_PURCHASE_PROFILE
    && frame.store_id === storeId && frame.connection_id === connection?.connection_id
    && frame.generation === connection?.generation
    && isUuid(checkout.id) && isUuid(frame.checkout_id) && isUuid(frame.quote_id)
    && typeof frame.snapshot_hash === 'string' && /^[0-9a-f]{64}$/.test(frame.snapshot_hash)
    && isUuid(intentId) && frame.idempotency_key === `ucp:${intentId}`
    && typeof frame.amount_minor === 'string' && /^\d+$/.test(frame.amount_minor)
    && ['USD','CNY'].includes(frame.currency)
    && frame.amount_minor === checkout.totals?.grand_total?.amount_minor && frame.currency === checkout.currency;
}
function uuid(key:unknown):string{
  if(typeof key!=='string'||!key)throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  const hex=createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function lineInput(line:any){return {id:line.id,item:{id:line.item.id},quantity:line.quantity};}
function cartInput(cart:any){return {id:cart.id,line_items:cart.line_items.map(lineInput),...(cart.buyer?{buyer:cart.buyer}:{}),...(cart.context?{context:context(cart.context)}:{}),...(cart.fulfillment?{fulfillment:cart.fulfillment}:{}),...(cart.discounts?{discounts:cart.discounts}:{})};}
function context(value:any){
  if(!value)return undefined;
  const {country,locale,...rest}=value;
  return {...rest,...(country?{address_country:country}:{}),...(locale?{language:locale}:{})};
}
function internalContext(value:unknown){
  const {address_country,language,...rest}=object(value);
  return {...rest,...(address_country?{country:address_country}:{}),...(language?{locale:language}:{})};
}

/** Only wire requests use UCP schemas; the returned objects are local presentation data for existing cards. */
export async function requestUcp(method:string,params:Record<string,any>,operations:UcpOperation[],send:(request:UcpRequest)=>Promise<UcpResponse>):Promise<unknown>{
  const id=mapped[method];if(!id || !ucpBusinessMethods(operations).includes(method))return undefined;
  const match=operations.filter(op=>op.channel==='ucp'&&op.operationId===id);
  if(!match.length)return undefined;if(match.length!==1)throw new Error('AMBIGUOUS_UCP_OPERATION');
  const op=match[0],write=!['search_catalog','get_product','get_cart','get_checkout','get_order','list_orders'].includes(id);
  const key=write?uuid(params.meta?.idempotency_key??params.idempotency_key):undefined;
  let body:any,path:Record<string,string>|undefined,query:Record<string,string>|undefined,ifMatch:string|undefined,checkoutConfirmation:string|undefined;
  if(id==='search_catalog')body={...(params.query?{query:params.query}:{}),...(params.context?{context:context(params.context)}:{}),...(params.page?{pagination:params.page}:{})};
  else if(id==='get_product')body={id:params.product_id??params.variant_id,...(params.context?{context:context(params.context)}:{})};
  else if(id==='create_cart')body={line_items:(params.lines??[]).map((line:any)=>({item:{id:line.variant_id},quantity:line.quantity})),...(params.context?{context:context(params.context)}:{})};
  else if(['get_cart','cancel_cart','update_cart'].includes(id))path={id:params.cart_id};
  else if(['get_checkout','cancel_checkout','update_checkout'].includes(id))path={id:params.checkout_id};
  else if(id==='get_order')path={id:params.order_id};
  else if(id==='list_orders'){
    const {limit,cursor}=params.page??{};
    if(limit!==undefined && (!Number.isSafeInteger(limit)||limit<1||limit>100) ||
        cursor!==undefined && (typeof cursor!=='string'||!cursor))throw new Error('INVALID_UCP_ORDER_PAGE');
    query={...(limit!==undefined?{limit:String(limit)}:{}),...(cursor!==undefined?{cursor}:{})};
  }
  else if(id==='create_checkout')body={cart_id:params.cart_id,line_items:[]};
  if(id==='update_cart'){
    const read=operations.filter(entry=>entry.channel==='ucp'&&entry.operationId==='get_cart');if(read.length!==1)throw new Error('METHOD_NOT_ADVERTISED');
    const current=params.ucp_cart_snapshot?{body:params.ucp_cart_snapshot,etag:params.ucp_cart_snapshot.version}:await send({operationRef:read[0].operationRef,path});
    if ('status' in current && (current.status < 200 || current.status >= 300))
      throw responseError(current);
    if(current.body.id!==params.cart_id)throw new Error('INVALID_UCP_RESPONSE');
    if(!current.etag||params.expected_version!==current.etag) {
      if (params.ucp_cart_snapshot) throw new UcpCartRejection('CART_VERSION_CHANGED');
      throw new Error('CART_VERSION_CHANGED');
    }
    ifMatch=current.etag;body=cartInput(current.body);
    if (method === 'commerce.carts.lines.add') {
      const line = body.line_items.find((line: any) => line.item.id === params.line.variant_id);
      const quantity = (line?.quantity ?? 0) + params.line.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100)
        throw new UcpCartRejection('CART_QUANTITY_LIMIT');
      if (line) line.quantity = quantity;
      else body.line_items.push({item:{id:params.line.variant_id},quantity});
    }
    else if(method==='commerce.carts.lines.remove'){
      if(!body.line_items.some((line:any)=>line.id===params.line_id))throw new Error('LINE_NOT_FOUND');
      body.line_items=body.line_items.filter((line:any)=>line.id!==params.line_id);
    }else if(method==='commerce.carts.lines.update'){
      const line=body.line_items.find((line:any)=>line.id===params.line_id);if(!line)throw new Error('LINE_NOT_FOUND');line.quantity=params.quantity;
    }else if(method==='commerce.carts.update'){
      const patch=object(params.patch);
      if(Object.keys(patch).some(key=>!['buyer','context','fulfillment'].includes(key)))throw new Error('UNSUPPORTED_UCP_CART_FIELD');
      Object.assign(body,patch,...(patch.context?[{context:context(patch.context)}]:[]));
    }
  }
  if(id==='update_checkout'){
    ifMatch=params.expected_version;
    body={line_items:params.line_items,...(params.buyer?{buyer:params.buyer}:{}),...(params.fulfillment?{fulfillment:params.fulfillment}:{}),...(params.context?{context:context(params.context)}:{})};
  }
  if(id==='cancel_cart'||id==='cancel_checkout')body={};
  if (['prepare_checkout','approve_checkout_handoff','complete_checkout'].includes(id)) {
    path = {id:params.checkout_id};
    if (id === 'prepare_checkout') body = {};
    else if (id === 'approve_checkout_handoff') body = {challenge:params.challenge};
    else {
      body = {payment: {instruments: params.payment_reference === null ? [] : [{
        id:params.payment_reference, handler_id:MOCK_HANDLER, type:'frontvia_mock', selected:true,
      }]}};
      checkoutConfirmation = Buffer.from(JSON.stringify(object(params.confirmation)), 'utf8').toString('base64url');
    }
  }
  const response=await send({operationRef:op.operationRef,...(path?{path}:{}),...(query?{query}:{}),...(body===undefined?{}:{body}),...(key?{idempotencyKey:key}:{}),...(ifMatch?{ifMatch}:{}),...(checkoutConfirmation?{checkoutConfirmation}:{})});
  if (response.status < 200 || response.status >= 300 || response.body?.ucp?.status === 'error') {
    const error = responseError(response);
    if (id === 'update_cart' && (error.status === 409 || error.status === 412) && error.code === 'version_conflict')
      throw new UcpCartRejection('CART_VERSION_CHANGED');
    if ((id === 'update_cart' || id === 'create_cart') && error.status === 409 && error.code === 'out_of_stock')
      throw new UcpCartRejection('OUT_OF_STOCK');
    throw error;
  }
  if (id === 'approve_checkout_handoff') {
    if (response.body?.status !== 'authorized') throw new Error('INVALID_UCP_RESPONSE');
    return {result:{data:{operation:{id:key,status:'succeeded',source:'ucp_response'}}}};
  }
  const wrapper = id === 'prepare_checkout' ? object(response.body) : undefined;
  const result=object(wrapper ? wrapper.checkout : response.body),envelope=object(result.ucp);
  if(envelope.version!=='2026-08-25')throw new Error('INVALID_UCP_RESPONSE');
  let data:any;
  if(id==='search_catalog'){
    if(!Array.isArray(result.products))throw new Error('INVALID_UCP_RESPONSE');
    data={items:result.products.map(item=>product(item)),page:{has_more:result.pagination?.has_next_page===true,next_cursor:result.pagination?.cursor??null}};
  }else if(id==='get_product'){
    const found=object(result.product);
    if(params.product_id!==undefined&&found.id!==params.product_id)throw new Error('INVALID_UCP_RESPONSE');
    data=method==='commerce.variants.list'?{items:(found.variants??[]).map((variant:any)=>product(variant,found.id)),page:{has_more:false,next_cursor:null}}:method==='commerce.variants.get'?product((found.variants??[]).find((variant:any)=>variant.id===params.variant_id),found.id):product(found);
  }else if(id==='list_orders'){
    const page=object(result.page);
    if(envelope.status!=='success'||!Array.isArray(envelope.capabilities?.['com.frontvia.shopping.order_history'])||
        !envelope.capabilities['com.frontvia.shopping.order_history'].some((entry:any)=>entry?.version==='2026-08-25')||
        !Array.isArray(result.items)||result.items.some((item:any)=>!isUuid(item?.order_id))||
        typeof page.has_more!=='boolean'||
        (page.has_more?typeof page.next_cursor!=='string'||!page.next_cursor:page.next_cursor!==null))
      throw new Error('INVALID_UCP_RESPONSE');
    data={items:result.items.map(({order_id}:any)=>({order_id})),page:{has_more:page.has_more,next_cursor:page.next_cursor}};
  }else {
    data=resource(result,response.etag);
    if(id==='get_order')data.shipments=(result.fulfillment?.events??[]).map((event:any)=>({id:event.id,status:event.type,occurred_at:event.occurred_at,description:event.description,
      tracking:event.tracking_number||event.tracking_url?[{carrier:event.carrier,tracking_number:event.tracking_number,tracking_url:event.tracking_url}]:[]}));
  }
  if (path?.id && ['get_cart','get_checkout','update_checkout','cancel_checkout','prepare_checkout','complete_checkout','get_order'].includes(id)
      && data.id !== path.id) throw new Error('INVALID_UCP_RESPONSE');
  if (wrapper) {
    const purchase: UcpPurchase = {
      checkoutId:data.id,
      intentId:wrapper.intent_id,
      revision:wrapper.revision,
      expiresAt:wrapper.expires_at,
      paymentReference:wrapper.payment_reference,
      confirmation:wrapper.confirmation,
    };
    if (!isUuid(purchase.intentId) || !Number.isSafeInteger(purchase.revision) || purchase.revision < 1
        || !Number.isFinite(Date.parse(purchase.expiresAt)) || purchase.expiresAt !== data.expires_at
        || purchase.paymentReference !== null && !isUuid(purchase.paymentReference)
        || purchase.confirmation !== null && !matchesUcpConfirmation(purchase.confirmation, data,
          purchase.intentId, params.ucp_store_id, params.ucp_connection)) {
      throw new Error('INVALID_UCP_CONFIRMATION');
    }
    return {result:{data:{operation:{id:key,status:'succeeded',source:'ucp_response'},resource:data,purchase}}};
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

/** Select one option on the same versioned Checkout, retaining its address. */
export function ucpCheckoutDelivery(checkout:any, groupId:string, optionId:string) {
  const patch = ucpCheckoutContact(checkout, {});
  const method = patch.fulfillment?.methods?.find((entry:any)=>entry.type==='shipping');
  const source = checkout.fulfillment?.methods?.find((entry:any)=>entry.type==='shipping');
  if (!method || !source?.groups?.some((group:any)=>group.id===groupId
      && group.options?.some((option:any)=>option.id===optionId))) throw new Error('DELIVERY_OPTION_UNAVAILABLE');
  method.groups = method.groups.map((group:any)=>group.id===groupId ? {...group,selected_option_id:optionId} : group);
  return patch;
}
