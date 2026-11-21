import {ucpBusinessMethods} from './ucp-business.js';
import {ASK_METHOD,askOperations} from './ucp-ask.js';
import {createHash} from 'node:crypto';
import type {PapOperationsClient} from '@awiki/dsh-pap/product-api';
import {Pap03Transport,PapRequestError,type StoreConnection} from './pap03-transport.js';
import type {PapPort,BusinessSite} from './pap-port.js';
import {fail,PapError} from './state.js';

/** Small card-facing projection of the one public PAP client, with no own protocol state. */
export class Pap03Business implements PapPort {
  readonly apiVersion=3;
  private transport:Pap03Transport;
  private connections=new Map<string,{store:StoreConnection;identity:string}>();
  private epoch='';
  private readinessError?:PapRequestError;
  private publicState:any={state:'unconfigured'};
  constructor(private readonly pap:PapOperationsClient){this.transport=new Pap03Transport(pap);}
  async refresh(){
    this.readinessError=undefined;
    const result=await this.pap.status();
    if(!result.ok){this.epoch='';this.publicState={state:result.error.code};this.readinessError=new PapRequestError(result.error);return;}
    const previous=this.epoch;
    const state=result.value as any;this.publicState=state;
    this.epoch=state?.state==='ready'&&state.identity?createHash('sha256').update(JSON.stringify(state.identity)).digest('hex'):'';
    if(this.epoch&&(previous!==this.epoch||!this.connections.size)){
      const catalog=await this.pap.operations();
      if(!catalog.ok){this.epoch='';this.publicState={state:catalog.error.code};this.readinessError=new PapRequestError(catalog.error);return;}
      const operations=Array.isArray(catalog.value)?catalog.value:[];
      for(const c of state.companies??[]){
        if(typeof c.domain!=='string'||typeof c.companyId!=='string'||typeof c.companyRef!=='string')continue;
        const own=operations.filter((op:any)=>op.companyRef===c.companyRef);
        const ask=askOperations(c.ucpCapabilities,own).length===1;
        const methods=[...new Set([...own.filter((op:any)=>typeof op.operationId==='string').map((op:any)=>op.operationId),...ucpBusinessMethods(own),...(own.some((op:any)=>op.channel==='ucp')?['commerce.capabilities.get']:[]),...(ask?[ASK_METHOD]:[])])];
        const store={ucp:own.some((op:any)=>op.channel==='ucp'),ucpCapabilities:c.ucpCapabilities,ucpFulfillmentParents:c.ucpFulfillmentParents,domain:c.domain,companyRef:c.companyRef,companyId:c.companyId,name:c.name??c.domain,methods};
        this.transport.restore(store);
        const ref=createHash('sha256').update(JSON.stringify([store.companyRef,this.epoch])).digest('hex');
        this.connections.set(ref,{store,identity:this.epoch});
      }
    }
  }
  async prepareDomain(domain:string){
    await this.refresh();
    if(this.readinessError)throw this.readinessError;
    // Explicit user connection re-discovers the protocol and lets PAP choose a
    // compatible session. Restored lifecycle state may predate a server upgrade.
    await this.discoverDomain(domain);
  }
  async connect(domain:string){
    await this.refresh();
    if(this.readinessError)throw this.readinessError;
    for(const [ref,value] of this.connections)if(value.store.domain===domain&&this.canAccess(ref))return {connectionRef:ref};
    return this.discoverDomain(domain);
  }
  private async discoverDomain(domain:string){
    const store=await this.transport.connect(domain);await this.refresh();
    if(this.readinessError)throw this.readinessError;
    if(!this.epoch)fail('PUBLIC_IDENTITY_REQUIRED');
    const ref=createHash('sha256').update(JSON.stringify([store.companyRef,this.epoch])).digest('hex');
    this.connections.set(ref,{store,identity:this.epoch});
    return {connectionRef:ref};
  }
  private current(ref:string){
    if(this.readinessError)throw this.readinessError;
    const value=this.connections.get(ref);
    if(!value||!this.isCurrentIdentity(ref))fail('IDENTITY_CHANGED');
    if(!this.canAccess(ref))fail('PAP_DISCONNECTED');
    return value;
  }
  isCurrentIdentity(ref:string){
    if(this.readinessError)throw this.readinessError;
    const value=this.connections.get(ref);
    return !!value&&!!this.epoch&&value.identity===this.epoch;
  }
  canAccess(ref:string){
    const value=this.connections.get(ref);
    return !!this.epoch&&this.isCurrentIdentity(ref)&&!!value&&Array.isArray(this.publicState.sessions)&&this.publicState.sessions.some((s:any)=>s.companyRef===value.store.companyRef&&s.connected&&!s.account);
  }
  sites():BusinessSite[]{
    return [...this.connections.entries()].filter(([ref])=>this.canAccess(ref)).map(([,v])=>({id:v.store.domain,domain:v.store.domain,label:v.store.name,issuer:v.store.companyId,resource:v.store.companyId,description:{profile:'frontvia.store.v1',methods:[...v.store.methods]}}));
  }
  status(ref?:string){return [...this.connections.keys()].filter(r=>(!ref||r===ref)&&this.canAccess(r)).map(r=>{const {store}=this.current(r);return {connectionRef:r,siteId:store.domain,label:store.name,domain:store.domain,issuer:store.companyId,resource:store.companyId,signedIn:false,connected:true};});}
  identity(ref:string){const {store}=this.current(ref);return {issuer:store.companyId,resource:store.companyId,signedIn:false};}
  capabilityCacheKey(ref:string){const value=this.current(ref);return createHash('sha256').update(JSON.stringify([value.identity,value.store.companyRef,value.store.methods,this.publicState.sessions])).digest('hex');}
  async askOperationRef(ref:string,signal?:AbortSignal){
    signal?.throwIfAborted();
    await this.refresh();
    const {store}=this.current(ref);
    const operationRef=await this.transport.askOperationRef(store);
    this.current(ref);
    signal?.throwIfAborted();
    return operationRef;
  }
  async request(ref:string,method:string,params:unknown,signal?:AbortSignal){
    await this.refresh();const {store}=this.current(ref);
    const send = (target:StoreConnection) => this.transport.request(target,method,params as Record<string,unknown>,signal);
    try {
      let result: unknown;
      try {
        result = await send(store);
      } catch (error) {
        if (!(error instanceof PapError) || error.code !== 'ORDER_FILE_ROUTE_MISSING') throw error;
        signal?.throwIfAborted();
        // Rediscover only the original store, before dispatch, under the restored owner.
        await this.refresh();
        this.current(ref);
        const discovered = await this.transport.connect(store.domain,store);
        await this.refresh();
        this.current(ref);
        this.connections.set(ref,{store:discovered,identity:this.epoch});
        try {
          result = await send(discovered);
        } catch (error) {
          if (error instanceof PapError && error.code === 'ORDER_FILE_ROUTE_MISSING') fail('ORDER_FILE_UNAVAILABLE');
          throw error;
        }
      }
      await this.refresh();
      this.current(ref);
      return result;
    } catch(error){
      if(error instanceof PapRequestError){
        if(error.detail?.code==='permission_denied'||error.detail?.code==='disconnected')this.epoch='';
        // Preserve admission/response uncertainty for original-operation recovery.
        throw error;
      }
      throw error;
    }
  }
  async hostedPayment(ref:string,link:string,checkoutId:string){
    const {store}=this.current(ref);let url:URL;
    try{url=new URL(link);}catch{return fail('INVALID_PAYMENT_LINK');}
    const expires=Number(url.searchParams.get('expires')),access=url.searchParams.get('access')??'';
    if(url.protocol!=='https:'||url.origin!==new URL(store.companyId).origin||url.username||url.password||url.hash||
      !/^[a-f0-9-]{36}$/.test(checkoutId)||!/^\/companies\/[A-Za-z0-9_-]+\/pay\/[a-f0-9-]{36}$/.test(url.pathname)||!url.pathname.endsWith('/'+checkoutId)||
      [...url.searchParams.keys()].sort().join(',')!=='access,expires'||!Number.isSafeInteger(expires)||expires<=Math.floor(Date.now()/1000)||!/^v2\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(access))return fail('INVALID_PAYMENT_LINK');
    const response=await this.request(ref,'commerce.payments.hosted.start',{checkout_id:checkoutId,expires,access}) as {error?:unknown;result?:unknown};
    if(!response||typeof response!=='object'||response.error||!response.result)fail('PAYMENT_RESULT_UNKNOWN');
    return response.result;
  }
  revision(){return this.epoch;}
  identityStatus(){return {configured:!!this.epoch,provider:'dsh-public-identity',state:this.publicState.state};}
}
