import {requestUcp,ucpBusinessMethods,isUcpBusinessMethod,UCP_CHECKOUT_CONFIRMATION,UCP_PURCHASE_PROFILE,type UcpRequest,type UcpResponse} from './ucp-business.js';
import type {PapOperationsClient, ProductResult} from '@awiki/dsh-pap/product-api';
import {actionObserver, measure, type ActionPhase} from "./action-progress.js";
import {PapError} from './state.js';

export class PapRequestError extends PapError {
  constructor(readonly detail: Extract<ProductResult,{ok:false}>['error'] & {papOperationId?:string}) {
    super('PAP_'+detail.code.replace(/[^A-Za-z0-9_]/g,'_').toUpperCase());
  }
}
function value(result:ProductResult):unknown {
  if(!result.ok)throw new PapRequestError(result.error);
  return result.value;
}
type Operation={channel?:string;operationRef:string;companyRef:string;operationId?:string;method:string;queryParameters?:{name:string;required:boolean}[];pathParameters?:string[];approvalProtocol?:string};
export type StoreConnection={ucp?:boolean;ucpCapabilities?:string[];ucpFulfillmentParents?:string[];domain:string;companyRef:string;companyId:string;name:string;methods:string[]};
const allowedLegacyMethod = (method: string) => !method.startsWith('commerce.') ||
  method === 'commerce.capabilities.get' || method === 'commerce.connections.list';
const aftersalesMethods = {
  'aftersales.eligibility': { method:'GET', path:['order_id'], query:[] },
  'aftersales.list': { method:'GET', path:['order_id'], query:['limit','cursor'] },
  'aftersales.get': { method:'GET', path:['order_id','case_id'], query:[] },
  'aftersales.operation.get': { method:'GET', path:['operation_id'], query:[] },
  'aftersales.intent.get': { method:'GET', path:['order_id','intent_id'], query:[] },
  'aftersales.contact': { method:'GET', path:[], query:[] },
  'aftersales.submit': { method:'POST', path:['order_id'], query:[] },
  'aftersales.withdraw': { method:'POST', path:['order_id','case_id'], query:[] },
} as const;

function storeContext(body: any) {
  const capability = 'com.frontvia.shopping.store_context';
  const context = body?.default_context;
  const connection = body?.connection;
  const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
  if (body?.ucp?.version !== '2026-08-25' || body.ucp.status !== 'success' ||
      !body.ucp.capabilities?.[capability]?.some?.((entry:any)=>entry?.version === '2026-08-25') ||
      !identifier(body.store_id) || !identifier(connection?.connection_id) ||
      !Number.isSafeInteger(connection.generation) || connection.generation < 1 ||
      !((context?.country === 'US' && context.currency === 'USD') ||
        (context?.country === 'CN' && context.currency === 'CNY')) ||
      !['en-US','zh-CN'].includes(context?.locale))
    throw new Error('INVALID_UCP_STORE_CONTEXT');
  return {
    store_id:body.store_id,
    default_context:{country:context.country,currency:context.currency,locale:context.locale},
    ucp_connection:{connection_id:connection.connection_id,generation:connection.generation},
  };
}

/** Business mapping only. Discovery, keys, policy and once-approval stay in PAP. */
export class Pap03Transport {
  private stores=new Map<string,StoreConnection>();
  constructor(private readonly pap:PapOperationsClient) {}
  async connect(domain:string, expected?:StoreConnection):Promise<StoreConnection> {
    // The public client validates the domain and performs the only discovery.
    const connected=value(await this.pap.connect(domain)) as {company?:{companyRef?:string;companyId?:string;name?:string;ucpCapabilities?:string[];ucpFulfillmentParents?:string[]}};
    const companyRef=connected?.company?.companyRef;
    const companyId=connected?.company?.companyId;
    if(typeof companyRef!=='string'||!companyRef||typeof companyId!=='string'||!companyId)throw new Error('INVALID_PAP_COMPANY');
    if(expected && (expected.companyRef!==companyRef || expected.companyId!==companyId)) throw new PapError('PAP_STORE_CHANGED');
    const operations=await this.operations(companyRef);
    const methods=operations.map(o=>o.operationId).filter((m):m is string=>typeof m==='string'&&(/^(commerce|consultation|knowledge)\./.test(m)||Object.hasOwn(aftersalesMethods,m)));
    const ucp=operations.some(op=>op.channel==='ucp');
    const store={domain,companyRef,companyId,ucp,ucpCapabilities:connected.company?.ucpCapabilities,ucpFulfillmentParents:connected.company?.ucpFulfillmentParents,name:connected.company?.name??domain,methods:[...new Set(ucp
      ? [...methods.filter(allowedLegacyMethod),...ucpBusinessMethods(operations),'commerce.capabilities.get']
      : methods)]};
    this.stores.set(domain,store);return {...store,methods:[...store.methods]};
  }
  restore(store:StoreConnection){this.stores.set(store.domain,{...store,methods:[...store.methods]});}
  private async operations(company:string):Promise<Operation[]> {
    const operations=value(await this.pap.operations());
    if(!Array.isArray(operations))throw new Error('INVALID_PAP_OPERATIONS');
    return operations.filter((o):o is Operation=>!!o&&typeof o==='object'&&o.companyRef===company&&typeof o.operationRef==='string'&&typeof o.method==='string');
  }
  async request(target:string|StoreConnection,method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    signal?.throwIfAborted();
    const store=typeof target==='string' ? this.stores.get(target)??await this.connect(target) : target;
    const aftersales=Object.hasOwn(aftersalesMethods,method)?aftersalesMethods[method as keyof typeof aftersalesMethods]:undefined;
    if(!aftersales&&!/^(commerce|consultation|knowledge)\./.test(method))throw new Error('METHOD_NOT_ADVERTISED');
    const operations=await this.operations(store.companyRef);
    if(aftersales){
      const exact=operations.filter(op=>op.operationId===method&&op.channel==='openapi'&&op.method===aftersales.method&&
        [...(op.pathParameters??[])].sort().join() === [...aftersales.path].sort().join());
      if(exact.length!==1)throw new PapError('AFTERSALES_UNAVAILABLE');
      const path:Record<string,string>={}, query:Record<string,string>={};
      for(const field of aftersales.path){
        const value=params[field];
        if(typeof value!=='string'||!/^[A-Za-z0-9_.-]{1,200}$/.test(value))throw new PapError('INVALID_AFTERSALES_REFERENCE');
        path[field]=value;
      }
      for(const field of aftersales.query) if(params[field]!==undefined)query[field]=String(params[field]);
      const route=exact[0]!;
      if(aftersales.method==='POST'&&route.approvalProtocol!=='pap-operations-v3')throw new PapError('AFTERSALES_PAP_UPDATE_REQUIRED');
      const response=await this.send({operationRef:route.operationRef,path,query,
        ...(aftersales.method==='POST'?{body:params.input}:{})},signal,true);
      if(response.status>=200&&response.status<300)return response.body;
      const result=response.body as {error?:unknown;operation?:{operation_id?:unknown}}|undefined;
      if(result?.error==='approval_required'&&aftersales.method==='POST'&&typeof result.operation?.operation_id==='string')
        throw new PapRequestError({code:'aftersales_terms_changed',phase:'approval',businessRequest:'not_sent',papOperationId:result.operation.operation_id});
      if(response.status===404)throw new PapError('AFTERSALES_NOT_FOUND');
      if(response.status===409)throw new PapError('AFTERSALES_CHANGED');
      if(result?.error==='approval_declined')throw new PapError('AFTERSALES_DECLINED');
      throw new PapRequestError({code:'aftersales_http_error',httpStatus:response.status,phase:'response',businessRequest:'response_received'});
    }
    const ucpMethods=ucpBusinessMethods(operations);
    const useUcp = store.ucp || operations.some(op=>op.channel==='ucp');
    if(useUcp && method==='commerce.capabilities.get') {
      const contexts=operations.filter(op=>op.channel==='ucp'&&op.operationId==='get_store_context');
      if(contexts.length>1)throw new Error('AMBIGUOUS_UCP_OPERATION');
      const legacy=operations.filter(op=>op.channel!=='ucp'&&op.operationId===method);
      const connections=operations.filter(op=>op.channel!=='ucp'&&op.operationId==='commerce.connections.list');
      let data:any={store_id:store.companyRef}, hasLegacyMetadata=false;
      if(contexts.length===1) {
        const response=await this.send({operationRef:contexts[0]!.operationRef},signal);
        data=storeContext(response.body);
      } else if(legacy.length===1) {
        const response=await this.send({operationRef:legacy[0]!.operationRef},signal);
        const metadata=(response.body as any)?.result?.data;
        if(metadata && typeof metadata.store_id==='string'){
          data={store_id:metadata.store_id,default_context:metadata.default_context,methods:metadata.methods};
          hasLegacyMetadata=true;
        }
      }
      const available=contexts.length||hasLegacyMetadata?ucpMethods:
        ucpMethods.filter(method=>/^commerce\.(products|variants)\./.test(method));
      const methods=[...available,'commerce.capabilities.get',...(!contexts.length&&connections.length===1&&
        data.methods?.some?.((entry:any)=>entry.method==='commerce.connections.list'&&entry.availability==='supported')
        ?['commerce.connections.list']:[]),
        ...operations.filter(op=>op.operationId&&Object.hasOwn(aftersalesMethods,op.operationId)).map(op=>op.operationId!)];
      const ucpFulfillment = ucpMethods.includes('commerce.checkouts.update')
        && store.ucpCapabilities?.includes('dev.ucp.shopping.fulfillment')===true
        && (store.ucpFulfillmentParents === undefined || store.ucpFulfillmentParents.includes('dev.ucp.shopping.checkout'));
      const ucpCheckoutConfirmation = !!data.ucp_connection && store.ucpCapabilities?.includes(UCP_CHECKOUT_CONFIRMATION) === true
        && ['commerce.checkouts.create','commerce.checkouts.get','commerce.checkouts.update','commerce.checkouts.prepare',
          'commerce.checkouts.confirm','commerce.checkouts.handoff.approve','commerce.orders.get'].every(method=>ucpMethods.includes(method));
      return {result:{data:{...data,ucp:true,ucpSyntheticStoreId:store.companyRef,ucpFulfillment,ucpCheckoutConfirmation,
        methods:methods.map(method=>({method,availability:'supported'})),
        business_profiles:[{id:UCP_PURCHASE_PROFILE,availability:'supported'}]}}};
    }
    if (method === 'commerce.orders.file') {
      const routes = operations.filter(op => op.operationId === method && op.method === 'GET' && op.channel === 'openapi');
      if (routes.length === 0) throw new PapError('ORDER_FILE_ROUTE_MISSING');
      if (routes.length !== 1) throw new PapError('ORDER_FILE_UNAVAILABLE');
      const { store_id, order_id, line_id, sha256 } = params;
      if (![store_id,order_id,line_id,sha256].every(value => typeof value === 'string')) throw new Error('ORDER_FILE_UNAVAILABLE');
      const response = await this.send({ operationRef: routes[0]!.operationRef, path: { store_id,order_id,line_id,sha256 } as Record<string,string> }, signal);
      return response.body;
    }
    const ucp=await requestUcp(method,params,operations,request=>this.send(request,signal,true));
    if(ucp!==undefined)return ucp;
    if((useUcp||params.ucp_protocol===true)&&!allowedLegacyMethod(method))throw new Error('UCP_OPERATION_UNAVAILABLE');
    const matches=operations.filter(o=>o.operationId===method);
    if(matches.length!==1)throw new Error('METHOD_NOT_ADVERTISED');
    const operation=matches[0]!;
    if(operation.pathParameters?.length)throw new Error('STORE_ROUTE_NOT_BOUND');
    let request:{operationRef:string;query?:Record<string,string>;body?:unknown};
    if(operation.method==='GET') {
      const query=operation.queryParameters??[];
      if(query.some(p=>p.name!=='params')||Object.keys(params).length&&!query.some(p=>p.name==='params'))throw new Error('INVALID_READ_MAPPING');
      request={operationRef:operation.operationRef,...(query.some(p=>p.name==='params')?{query:{params:JSON.stringify(params)}}:{})};
    } else if(operation.method==='POST')request={operationRef:operation.operationRef,body:params};
    else throw new Error('UNSUPPORTED_BUSINESS_MAPPING');
    signal?.throwIfAborted();
    return (await this.send(request,signal)).body;
  }
  private async send(request:UcpRequest,signal?:AbortSignal,ucp=false):Promise<UcpResponse> {
    const client: PapOperationsClient & {request(input:unknown,signal?:AbortSignal,report?:(phase:Exclude<ActionPhase,"prepare">)=>void):Promise<ProductResult>} = this.pap;
    const response=value(await measure("pap_request",()=>client.request(request,signal,actionObserver.getStore()))) as {status?:number;body?:unknown;bodyAvailable?:boolean;etag?:string};
    if(!response||typeof response.status!=='number'||response.bodyAvailable===false||!('body' in response))throw new Error('PAP_BUSINESS_RESPONSE_UNAVAILABLE');
    if(!ucp&&(response.status<200||response.status>=300))throw new PapRequestError({code:'business_http_error',businessRequest:'response_received',httpStatus:response.status,phase:'response'});
    return response as UcpResponse;
  }
}
