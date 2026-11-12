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
type Operation={operationRef:string;companyRef:string;operationId?:string;method:string;queryParameters?:{name:string;required:boolean}[];pathParameters?:string[]};
export type StoreConnection={domain:string;companyRef:string;companyId:string;name:string;methods:string[]};

/** Business mapping only. Discovery, keys, policy and once-approval stay in PAP. */
export class Pap03Transport {
  private stores=new Map<string,StoreConnection>();
  constructor(private readonly pap:PapOperationsClient) {}
  async connect(domain:string):Promise<StoreConnection> {
    // The public client validates the domain and performs the only discovery.
    const connected=value(await this.pap.connect(domain)) as {company?:{companyRef?:string;companyId?:string;name?:string}};
    const companyRef=connected?.company?.companyRef;
    const companyId=connected?.company?.companyId;
    if(typeof companyRef!=='string'||!companyRef||typeof companyId!=='string'||!companyId)throw new Error('INVALID_PAP_COMPANY');
    const operations=await this.operations(companyRef);
    const methods=operations.map(o=>o.operationId).filter((m):m is string=>typeof m==='string'&&/^(commerce|consultation|knowledge)\./.test(m));
    const store={domain,companyRef,companyId,name:connected.company?.name??domain,methods:[...new Set(methods)]};
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
    const matches=(await this.operations(store.companyRef)).filter(o=>o.operationId===method);
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
    const response=value(await this.pap.request(request,signal)) as {status?:number;body?:unknown;bodyAvailable?:boolean};
    if(!response||typeof response.status!=='number'||response.bodyAvailable===false||!('body' in response))throw new Error('PAP_BUSINESS_RESPONSE_UNAVAILABLE');
    if(response.status<200||response.status>=300)throw new PapRequestError({code:'business_http_error',businessRequest:'response_received',httpStatus:response.status,phase:'response'});
    return response.body;
  }
}
