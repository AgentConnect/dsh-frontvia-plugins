import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { CustomerAftersales } from "../src/aftersales.js";
import { AftersalesPanel } from "../src/client/aftersales.js";
import type { AftersalesView } from "../src/aftersales-contract.js";
import { PapRequestError } from "../src/pap03-transport.js";
import type { PapPort } from "../src/pap-port.js";
import { uiSchemas } from "../src/ui-contract.js";
import { guidance, schemas } from "../src/tools.js";

test("paid order guidance opens the original after-sales card before offering store contact",()=>{
  assert.match(guidance,/已付款订单先引导买家打开原订单的「查看售后」/);
  assert.match(guidance,/只有原订单提示联系店铺时/);
  assert.match(guidance,/模型不代为提交售后申请/);
});

const orderId="b50aa930-90c6-494a-ab06-c6a22db36592";
const caseId="c23014de-d1ef-48b2-8424-852870d732b8";
const lineId="084a88e5-305d-4378-b315-5c704bc32c74";
const scope={orderId,connectionRef:"original-store-and-identity"};
const cancel={kind:"cancel_order",reason:"重复购买"} as const;
const eligibility:AftersalesView["eligibility"]={
  order_id:orderId,lines:[{id:lineId,title:"测试商品",kind:"physical",quantity:2,packed:0,shipped:0,unshipped:2}],
  active_case:null,allowed:["cancel_order"],reasons:[],currency:"CNY",captured_minor:"21000",refundable_minor:"21000",
  original_shipping_minor:"1000",refund_opportunity:"available",support:{support_contact:"support@example.test",support_hours:"周一至周五"},
};
const entry:NonNullable<AftersalesView["selected"]>={
  id:caseId,order_id:orderId,kind:"return_and_refund",stage:"waiting_return",revision:3,updated_at:"2026-11-23T10:00:00Z",
  reason:"货物有损",decision_reason:null,currency:"CNY",requested_minor:"21000",original_shipping_refund_minor:"1000",
  lines:[{line_id:lineId,quantity:2}],return:{status:"open",items:[{line_id:lineId,quantity:2,received:1,damaged:0}]},
  return_instructions:{recipient:"退货组",address:"测试路一号",delivery_notes:"请妥善包装"},allowed_actions:[],refund:null,
};
const history={items:[entry],page:{has_more:false,next_cursor:null}};

function fixture() {
  const records=new Map<string,unknown>();
  const vault={get<T>(key:string){return records.get(key) as T|undefined;},set(key:string,value:unknown){records.set(key,structuredClone(value));}};
  const calls:{method:string;params:any}[]=[];
  let mutation:(params:any)=>unknown=()=>assert.fail("unplanned write");
  let lookup:()=>unknown=()=>({operation_id:"original-operation",status:"performing"});
  let intentLookup:(params:any)=>unknown=()=>assert.fail("unplanned intent lookup");
  const pap={request:async(ref:string,method:string,params:any)=>{
    assert.equal(ref,scope.connectionRef);
    calls.push({method,params});
    if(method==="aftersales.eligibility")return eligibility;
    if(method==="aftersales.list")return history;
    if(method==="aftersales.get")return entry;
    if(method==="aftersales.operation.get")return lookup();
    if(method==="aftersales.intent.get")return intentLookup(params);
    return mutation(params);
  }} as unknown as PapPort;
  return {build:()=>new CustomerAftersales(pap,vault),calls,
    write(fn:typeof mutation){mutation=fn;},readOperation(fn:typeof lookup){lookup=fn;},
    readIntent(fn:typeof intentLookup){intentLookup=fn;}};
}

test("after-sales recovery on restart queries the original operation without another submission",async()=>{
  const f=fixture();
  f.write(()=>{throw new PapRequestError({code:"request_uncertain",businessRequest:"unknown",papOperationId:"original-operation"});});
  const initial=await f.build().change(scope,cancel);
  assert.equal(initial.pending?.phase,"reconciling");
  const first=f.calls.find(call=>call.method==="aftersales.submit")!;
  assert.match(first.params.input.intent_id,/^[a-f0-9-]{36}$/);
  f.readOperation(()=>({operation_id:"original-operation",status:"performed",order_id:orderId,case_id:caseId}));
  const restored=await f.build().change(scope,{...cancel,reason:"another submission"});
  assert.equal(restored.selected?.id,caseId);
  assert.equal(restored.pending,undefined);
  assert.equal(f.calls.filter(call=>call.method==="aftersales.submit").length,1);
  assert(f.calls.filter(call=>call.method==="aftersales.operation.get").every(call=>call.params.operation_id==="original-operation"));
});

test("editable terms preserve one intent until the buyer confirms",async()=>{
  const f=fixture();
  f.write(()=>{throw new PapRequestError({code:"identity_authorization_required",businessRequest:"not_sent",papOperationId:"prepared"});});
  assert.equal((await f.build().change(scope,cancel)).pending?.phase,"confirm");
  const revised={...cancel,reason:"我选错了商品"};
  assert.deepEqual((await f.build().change(scope,revised)).pending?.input,revised);
  const input=f.calls.filter(call=>call.method==="aftersales.submit").map(call=>call.params.input);
  assert.equal(input[0].intent_id,input[1].intent_id);
  assert.notEqual(input[0].reason,input[1].reason);
});

test("when the operation ID was lost the same client intent recovers the original effect",async()=>{
  const f=fixture();
  let originalIntent:string;
  f.write(({input})=>{originalIntent=input.intent_id;throw new PapRequestError({code:"request_uncertain",businessRequest:"unknown"});});
  f.readIntent(params=>{
    assert.deepEqual(params,{order_id:orderId,intent_id:originalIntent});
    return {status:"performing",operation_id:"original-operation",order_id:orderId};
  });
  const pending=await f.build().change(scope,cancel);
  assert.equal(pending.pending?.phase,"reconciling");
  f.readOperation(()=>({status:"performed",operation_id:"original-operation",order_id:orderId,case_id:caseId}));
  const restored=await f.build().view(scope);
  assert.equal(restored.selected?.id,caseId);
  assert.equal(restored.pending,undefined);
  assert.deepEqual(f.calls.filter(call=>call.method==="aftersales.operation.get").map(call=>call.params.operation_id),["original-operation"]);
  assert.equal(f.calls.filter(call=>call.method==="aftersales.submit").length,1);
});

test("an unobserved original intent returns for approval with the same key",async()=>{
  const f=fixture();
  f.write(()=>{throw new PapRequestError({code:"request_uncertain",businessRequest:"unknown"});});
  f.readIntent(({intent_id})=>({status:"unobserved",order_id:orderId,intent_id}));
  assert.equal((await f.build().change(scope,cancel)).pending?.phase,"confirm");
  assert.equal(f.calls.filter(call=>call.method==="aftersales.submit").length,1);
  await f.build().change(scope,cancel);
  const submissions=f.calls.filter(call=>call.method==="aftersales.submit");
  assert.equal(submissions.length,2);
  assert.deepEqual(submissions[0].params,submissions[1].params);
});

test("model action can open the card and owner RPC rejects protocol approval fields",()=>{
  const flowId="342cd6c5-347b-40e9-a035-28722a7f978a";
  assert(schemas.frontvia_orders.safeParse({action:"aftersales",flowId,order_id:orderId}).success);
  assert(!schemas.frontvia_orders.safeParse({action:"aftersales",flowId,order_id:orderId,reason:"try to write"}).success);
  const payload={sessionId:"chat",flowId,order_id:orderId,input:cancel};
  assert(uiSchemas["aftersales-change"].safeParse(payload).success);
  assert(!uiSchemas["aftersales-change"].safeParse({...payload,input:{...cancel,poppyApproval:"forged"}}).success);
});

test("order card shows exact whole-order amounts and the one-refund notice",async()=>{
  let ui!:ReturnType<typeof create>;
  await act(async()=>{
    ui=create(React.createElement(AftersalesPanel,{orderId,initialOpen:true,
      request:async()=>({eligibility,selected:null,history})}));
  });
  const text=JSON.stringify(ui.toJSON());
  assert.match(text,/¥210\.00/);
  assert.match(text,/¥10\.00/);
  assert.match(text,/本单最多成功退款一次/);
  await act(async()=>ui.unmount());
});

test("order card shows the original return address and counted receipt, with recovery as the only action",async()=>{
  let ui!:ReturnType<typeof create>;
  await act(async()=>{
    ui=create(React.createElement(AftersalesPanel,{orderId,initialOpen:true,request:async()=>({
      eligibility:{...eligibility,allowed:[],active_case:entry},selected:entry,history,
      pending:{phase:"reconciling" as const,input:cancel},
    })}));
  });
  const text=JSON.stringify(ui.toJSON());
  assert.match(text,/测试路一号/);
  assert.match(text,/商家已收.*1.*2/);
  assert.match(text,/查询这笔申请/);
  assert.doesNotMatch(text,/继续本次确认|核对并确认申请|运输单号|再次申请/);
  await act(async()=>ui.unmount());
});

test("the buyer sees verified money separately from a pending digital entitlement update",async()=>{
  const digital:typeof entry={
    ...entry,kind:"refund_only",stage:"refunding",lines:[],return:null,return_instructions:null,
    digital_access:"revocation_pending",
    refund:{state:"confirmed",amount_minor:"21000",shipping_minor:"0",currency:"CNY",reason:"退款已确认"},
    allowed_actions:[],
  };
  let ui!:ReturnType<typeof create>;
  await act(async()=>{
    ui=create(React.createElement(AftersalesPanel,{orderId,initialOpen:true,request:async()=>({
      eligibility:{...eligibility,allowed:[],active_case:digital},selected:digital,history,
    })}));
  });
  const text=JSON.stringify(ui.toJSON());
  assert.match(text,/已确认退款/);
  assert.match(text,/数字内容已停止访问，正在更新权益记录/);
  assert.doesNotMatch(text,/数字内容权益已撤销/);
  await act(async()=>ui.unmount());
});
