import {requestUcp,ucpBusinessMethods,isUcpBusinessMethod,type UcpRequest,type UcpResponse} from './ucp-business.js';
import type {PapOperationsClient, ProductResult} from '@awiki/dsh-pap/product-api';
import {PapError} from './state.js';

export class PapRequestError extends PapError {
  constructor(readonly detail: Extract<ProductResult,{ok:false}>['error']) {
    super('PAP_'+detail.code.replace(/[^A-Za-z0-9_]/g,'_').toUpperCase());
  }
}
function value(result:ProductResult):unknown {
  if(!result.ok)throw new PapRequestError(result.error);
  return result.value;
}
type Operation={channel?:string;operationRef:string;companyRef:string;operationId?:string;method:string;queryParameters?:{name:string;required:boolean}[];pathParameters?:string[]};
export type StoreConnection={ucp?:boolean;ucpCapabilities?:string[];domain:string;companyRef:string;companyId:string;name:string;methods:string[]};
const legacyUcpExclusions = new Set([
  'commerce.checkouts.confirm', 'commerce.checkouts.complete', 'commerce.quotes.create',
  'commerce.quotes.get', 'commerce.payments.hosted.start',
]);
const allowedLegacyMethod = (method: string) => !isUcpBusinessMethod(method) && !legacyUcpExclusions.has(method);

/** Business mapping only. Discovery, keys, policy and once-approval stay in PAP. */
export class Pap03Transport {
  private stores=new Map<string,StoreConnection>();
  constructor(private readonly pap:PapOperationsClient) {}
  async connect(domain:string):Promise<StoreConnection> {
    // The public client validates the domain and performs the only discovery.
    const connected=value(await this.pap.connect(domain)) as {company?:{companyRef?:string;companyId?:string;name?:string;ucpCapabilities?:string[]}};
    const companyRef=connected?.company?.companyRef;
    const companyId=connected?.company?.companyId;
    if(typeof companyRef!=='string'||!companyRef||typeof companyId!=='string'||!companyId)throw new Error('INVALID_PAP_COMPANY');
    const operations=await this.operations(companyRef);
    const methods=operations.map(o=>o.operationId).filter((m):m is string=>typeof m==='string'&&/^(commerce|consultation|knowledge)\./.test(m));
    const ucp=operations.some(op=>op.channel==='ucp');
    const store={domain,companyRef,companyId,ucp,ucpCapabilities:connected.company?.ucpCapabilities,name:connected.company?.name??domain,methods:[...new Set(ucp
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
  async request(domain:string,method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    signal?.throwIfAborted();
    const store=this.stores.get(domain)??await this.connect(domain);
    if(!/^(commerce|consultation|knowledge)\./.test(method))throw new Error('METHOD_NOT_ADVERTISED');
    const operations=await this.operations(store.companyRef);
    const ucpMethods=ucpBusinessMethods(operations);
    const useUcp = store.ucp || operations.some(op=>op.channel==='ucp');
    if(useUcp && method==='commerce.capabilities.get') {
      const legacy=operations.filter(op=>op.operationId===method);
      let data:any={store_id:store.companyRef};
      if(legacy.length===1){const response=await this.send({operationRef:legacy[0]!.operationRef},signal);data=(response.body as any)?.result?.data??data;}
      const legacyMethods=Array.isArray(data.methods)?data.methods.filter((entry:any)=>entry.availability==='supported').map((entry:any)=>entry.method):[];
      const methods=[...new Set([...legacyMethods.filter(allowedLegacyMethod),...ucpMethods,'commerce.capabilities.get'])];
      const ucpFulfillment = ucpMethods.includes('commerce.checkouts.update')
        && store.ucpCapabilities?.includes('dev.ucp.shopping.fulfillment')===true;
      return {result:{data:{...data,ucp:true,ucpFulfillment,methods:methods.map(method=>({method,availability:'supported'})),business_profiles:[{id:'frontvia.ucp_nonpayment.v1',availability:'supported'}]}}};
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
    const response=value(await this.pap.request(request,signal)) as {status?:number;body?:unknown;bodyAvailable?:boolean;etag?:string};
    if(!response||typeof response.status!=='number'||response.bodyAvailable===false||!('body' in response))throw new Error('PAP_BUSINESS_RESPONSE_UNAVAILABLE');
    if(!ucp&&(response.status<200||response.status>=300))throw new PapRequestError({code:'business_http_error',businessRequest:'response_received',httpStatus:response.status,phase:'response'});
    return response as UcpResponse;
  }
}
