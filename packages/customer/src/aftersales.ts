import {measure} from "./action-progress.js";
import { createHash, randomUUID } from "node:crypto";
import { canonical, fail, Serial, type Vault } from "./state.js";
import type { PapPort } from "./pap-port.js";
import { PapRequestError } from "./pap03-transport.js";
import { aftersalesCase, aftersalesCases, aftersalesEligibility, aftersalesIntentOutcome, aftersalesOutcome, type AftersalesChange,
  type AftersalesView } from "./aftersales-contract.js";

type StoredIntent = {
  id:string;
  input:AftersalesChange;
  phase:"confirm"|"reconciling";
  operationId?:string;
};
type OrderScope = { connectionRef:string; orderId:string };

/** Local intent records only. Eligibility, case state and approval remain with the original store and PAP. */
export class CustomerAftersales {
  private readonly serial = new Serial();
  constructor(private readonly pap:PapPort,private readonly vault:Pick<Vault,"get"|"set">) {}

  private key(scope:OrderScope) {
    return "aftersales:"+createHash("sha256").update(canonical([scope.connectionRef,scope.orderId])).digest("hex");
  }

  private request(scope:OrderScope, method:string, params:Record<string,unknown>, signal?:AbortSignal) {
    return measure(method,()=>this.pap.request(scope.connectionRef, method, params, signal));
  }

  async view(scope:OrderScope, selected?:string, cursor?:string, signal?:AbortSignal,deferHistory=false):Promise<AftersalesView> {
    const key=this.key(scope);
    return this.serial.run(key,()=>this.read(scope,key,selected,cursor,signal,undefined,deferHistory));
  }

  private async read(scope:OrderScope,key:string,selected?:string,cursor?:string,signal?:AbortSignal,
      message?:AftersalesView["message"],deferHistory=false):Promise<AftersalesView> {
    const order_id=scope.orderId;
    let pending=this.vault.get<StoredIntent>(key);
    if(pending?.phase==="reconciling"){
      const outcome=aftersalesIntentOutcome.parse(pending.operationId
        ? await this.request(scope,"aftersales.operation.get",{operation_id:pending.operationId},signal)
        : await this.request(scope,"aftersales.intent.get",{order_id,intent_id:pending.id},signal));
      if(outcome.order_id&&outcome.order_id!==order_id)fail("AFTERSALES_CHANGED");
      if(outcome.status==="unobserved"){
        if(pending.operationId||outcome.intent_id!==pending.id)fail("AFTERSALES_CHANGED");
        pending={...pending,phase:"confirm"};
        this.vault.set(key,pending);
      }else if(!outcome.operation_id||pending.operationId&&outcome.operation_id!==pending.operationId){
        fail("AFTERSALES_CHANGED");
      }else if(outcome.status==="performed"){
        selected=selected??outcome.case_id;
        message=outcome.effect==="none"?"no_effect":"recorded";
        this.vault.set(key,null);
        pending=undefined;
      }else if(outcome.status==="performing"||outcome.status==="awaiting_approval"){
        pending={...pending,operationId:outcome.operation_id,phase:outcome.status==="performing"?"reconciling":"confirm"};
        this.vault.set(key,pending);
      }else{
        fail("AFTERSALES_CHANGED");
      }
    }
    const readEligibility=()=>this.request(scope,"aftersales.eligibility",{order_id},signal).then(raw=>aftersalesEligibility.parse(raw));
    const readHistory=()=>this.request(scope,"aftersales.list",{order_id,limit:"20",...(cursor?{cursor}:{})},signal).then(raw=>aftersalesCases.parse(raw));
    const defer=deferHistory&&!cursor;
    const [eligibility,history]=await Promise.all([readEligibility(),defer?undefined:readHistory()]);
    // A terminal order opened on a new device still needs its latest case.
    const needsHistory=!selected&&!eligibility.active_case&&eligibility.latest_case_id===undefined;
    const caseHistory=history??(needsHistory?await readHistory():undefined);
    if(eligibility.order_id!==order_id||caseHistory?.items.some(entry=>entry.order_id!==order_id))fail("AFTERSALES_CHANGED");
    const caseId=selected??eligibility.active_case?.id??eligibility.latest_case_id;
    const entry=caseId&&caseId!==eligibility.active_case?.id
      ? aftersalesCase.parse(await this.request(scope,"aftersales.get",{order_id,case_id:caseId},signal))
      : eligibility.active_case;
    if(entry&&entry.order_id!==order_id)fail("AFTERSALES_CHANGED");
    if(caseId&&entry?.id!==caseId)fail("AFTERSALES_CHANGED");
    return {eligibility,selected:entry,history:caseHistory??{items:[],page:{has_more:false,next_cursor:null}},
      ...(!caseHistory?{historyDeferred:true as const}:{}),
      ...(pending?{pending:{phase:pending.phase,input:pending.input}}:{}),...(message?{message}:{})};
  }

  async change(scope:OrderScope,input:AftersalesChange,signal?:AbortSignal):Promise<AftersalesView> {
    const key=this.key(scope);
    return this.serial.run(key,async()=>{
      const saved=this.vault.get<StoredIntent>(key);
      if(saved?.phase==="reconciling")return this.read(scope,key,undefined,undefined,signal);
      const sameAction=saved && (saved.input.kind==="withdraw")===(input.kind==="withdraw");
      const active=saved&&canonical(saved.input)===canonical(input)?saved:
        {id:sameAction?saved.id:randomUUID(),input,phase:"confirm" as const};
      const {orderId:order_id}=scope;
      // Record the original intent before any connection or approval can cross the process boundary.
      this.vault.set(key,{...active,phase:"reconciling"});
      let outcome;
      try {
        const params=input.kind==="withdraw"?{
          order_id,case_id:input.case_id,input:{intent_id:active.id,revision:input.revision,reason:input.reason,not_sent:input.not_sent},
        }:{order_id,input:{intent_id:active.id,...input}};
        outcome=aftersalesOutcome.parse(await this.request(scope,
          input.kind==="withdraw"?"aftersales.withdraw":"aftersales.submit",params,signal));
        if(outcome.order_id&&outcome.order_id!==order_id)fail("AFTERSALES_CHANGED");
      } catch(error) {
        if(error instanceof PapRequestError&&error.detail){
          const {code,businessRequest,papOperationId}=error.detail;
          if(code==="identity_authorization_required"||code==="aftersales_terms_changed"){
            this.vault.set(key,{...active,phase:"confirm",operationId:papOperationId??active.operationId});
            return this.read(scope,key,undefined,undefined,signal,code==="aftersales_terms_changed"?"terms_changed":undefined);
          }
          if(businessRequest==="unknown"||businessRequest==="response_received"){
            this.vault.set(key,{...active,phase:"reconciling",operationId:papOperationId??active.operationId});
            return this.read(scope,key,undefined,undefined,signal);
          }
          this.vault.set(key,null);
        }else if(error instanceof Error&&error.name==="PapError"&&
          ["AFTERSALES_PAP_UPDATE_REQUIRED","AFTERSALES_DECLINED","AFTERSALES_CHANGED","AFTERSALES_NOT_FOUND","AFTERSALES_UNAVAILABLE"]
            .includes((error as {code?:string}).code??"")){
          this.vault.set(key,null);
        }
        throw error;
      }
      if(outcome.status==="performing"||outcome.status==="awaiting_approval"){
        this.vault.set(key,{...active,phase:outcome.status==="performing"?"reconciling":"confirm",operationId:outcome.operation_id});
        return this.read(scope,key,undefined,undefined,signal);
      }
      this.vault.set(key,null);
      return this.read(scope,key,outcome.case_id,undefined,signal,outcome.effect==="none"?"no_effect":"recorded");
    });
  }
}
