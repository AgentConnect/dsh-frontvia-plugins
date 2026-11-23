import React, { useEffect, useId, useRef, useState } from "react";
import type { AftersalesCase, AftersalesChange, AftersalesView } from "../aftersales-contract.js";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "./ui.js";

type Method = Exclude<AftersalesChange["kind"],"withdraw">;
export type AftersalesRequest = (operation:"aftersales-view"|"aftersales-change",
  payload:{order_id:string;case_id?:string;cursor?:string;input?:AftersalesChange})=>Promise<AftersalesView>;
const labels:Record<Method,string>={cancel_order:"取消整单并退款",refund_only:"仅退款",return_and_refund:"退货退款"};
const stages:Record<AftersalesCase["stage"],string>={
  pending_merchant:"等待店铺审核",waiting_return:"退货已同意",refunding:"退款核对中",refunded:"渠道已确认退款",
  withdrawn:"申请已撤回",rejected:"店铺已拒绝",closed:"申请已关闭",
};
const reasons:Record<string,string>={
  refund_already_used:"这张订单已成功退款一次。",
  refund_confirmation_pending:"店铺正在核对这张订单的原退款。",
  fulfillment_confirmation_pending:"店铺正在核对发货状态，请稍后刷新。",
  payment_not_captured:"付款尚未完成。",
  original_payment_unverified:"请联系店铺核实原付款。",
  order_canceled:"订单已取消。",
  line_kind_unverified:"有商品的交付方式需要店铺核实。",
  fulfillment_exists:"订单已有打包或发货记录，请联系店铺。",
  whole_order_cancel_unavailable:"整单已不符合线上取消条件，请联系店铺。",
  physical_items_not_all_shipped:"实物尚未全部发出，请联系店铺。",
  return_not_offered:"购买时的政策不支持退货。",
  policy_excludes_refund:"购买时的政策不支持这项退款。",
  policy_window_expired:"已超过购买时政策的申请期限。",
  original_store_read_only:"店铺暂未开放新的线上申请。",
};
const errorCopy:Record<string,string>={
  AFTERSALES_NOT_FOUND:"这笔订单或申请在当前连接中不可用。",
  AFTERSALES_UNAVAILABLE:"店铺暂未提供线上售后，请使用店铺公开联系方式。",
  AFTERSALES_PAP_UPDATE_REQUIRED:"请更新 PAP 插件后继续。本次申请尚未提交。",
  AFTERSALES_CHANGED:"店铺已更新订单或申请，请刷新后查看。",
  AFTERSALES_DECLINED:"此次批准未被店铺接受。请刷新原申请。",
  PAP_IDENTITY_AUTHORIZATION_DENIED:"这次确认已拒绝。按需重新发起。",
  PAP_IDENTITY_AUTHORIZATION_EXPIRED:"批准已过期，请刷新后核对最新条款。",
};
function money(amount:string|undefined|null,currency?:string|null) {
  if (amount==null || !currency) return "—";
  const padded=amount.padStart(3,"0");
  return `${currency==="CNY"?"¥":"$"}${padded.slice(0,-2)}.${padded.slice(-2)}`;
}
function minor(text:string) {
  if(!/^\d{1,14}(?:\.\d{1,2})?$/.test(text))return;
  const [whole,cents=""]=text.split(".");
  return BigInt(whole!+cents.padEnd(2,"0")).toString();
}

export function AftersalesPanel({orderId,request,initialOpen=false,originalCaseId}:{
  orderId:string;request:AftersalesRequest;initialOpen?:boolean;originalCaseId?:string;
}) {
  const [open,setOpen]=useState(initialOpen);
  const [value,setValue]=useState<AftersalesView>();
  const [kind,setKind]=useState<Method>();
  const [quantities,setQuantities]=useState<Record<string,string>>({});
  const [requested,setRequested]=useState("");
  const [shipping,setShipping]=useState("0");
  const [reason,setReason]=useState("");
  const [withdraw,setWithdraw]=useState(false);
  const [notSent,setNotSent]=useState(false);
  const [newRequest,setNewRequest]=useState(false);
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const running=useRef(false);
  const heading=useRef<HTMLSpanElement>(null);
  const form=useRef<HTMLFormElement>(null);
  const signature=useId();

  async function send(input?:AftersalesChange,caseId?:string,cursor?:string){
    if(running.current)return;
    running.current=true;
    setBusy(true);
    setError("");
    try {
      const result=await request(input?"aftersales-change":"aftersales-view",{
        order_id:orderId,...(caseId?{case_id:caseId}:{}),...(input?{input}:{}),...(cursor?{cursor}:{}),
      });
      setValue(result);
      setKind(current=>current&&result.eligibility.allowed.includes(current)?current:result.eligibility.allowed[0]);
      if(input&&result.message==="recorded"){
        setNewRequest(false);setWithdraw(false);setNotSent(false);setReason("");setQuantities({});setRequested("");setShipping("0");
        heading.current?.focus();
      } else if(caseId){
        setNewRequest(false);setWithdraw(false);
      }
    }catch(cause){
      const code=cause instanceof Error?cause.message.split(":")[0]:"";
      setError(errorCopy[code??""]??"暂未取得最新结果。刷新后可核对原申请，填写内容已保留。");
    }finally{setBusy(false);running.current=false;}
  }
  useEffect(()=>{
    if(open&&!value&&!error&&!running.current)void send(undefined,originalCaseId);
    // The panel is keyed to the original order and buyer connection.
  },[open,orderId,originalCaseId]);
  const eligibility=value?.eligibility;
  const entry=value?.selected;
  const pending=value?.pending;
  const editable=eligibility?.allowed.length&&!pending&&(!entry||newRequest);
  const eligibleLines=kind&&kind!=="cancel_order"?eligibility?.lines.filter(line=>line[kind]?.allowed):[];
  const terminal=entry&&["withdrawn","rejected","closed"].includes(entry.stage);
  const canWithdraw=entry?.allowed_actions.includes("withdraw")&&!pending;
  const submit=(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!eligibility||!kind||!reason.trim())return;
    if(kind==="cancel_order"){void send({kind,reason:reason.trim()});return;}
    const lines=(eligibleLines??[]).flatMap(line=>{
      const count=Number(quantities[line.id]);
      return Number.isSafeInteger(count)&&count>0?[{line_id:line.id,quantity:count}]:[];
    });
    const total=minor(requested), originalShipping=minor(shipping);
    if(!lines.length){setError("请至少为一项商品填写申请数量。");form.current?.querySelector<HTMLElement>("[data-quantity]")?.focus();return;}
    if(!total||total==="0"||BigInt(total)>BigInt(eligibility.refundable_minor??"0")){
      setError("申请金额须大于零且在原付款可退金额内。");form.current?.querySelector<HTMLElement>("[data-requested]")?.focus();return;
    }
    if(!originalShipping||BigInt(originalShipping)>BigInt(total)||BigInt(originalShipping)>BigInt(eligibility.original_shipping_minor??"0")){
      setError("申请退回的运费须在原运费和申请金额内。");form.current?.querySelector<HTMLElement>("[data-shipping]")?.focus();return;
    }
    void send({kind,reason:reason.trim(),lines,requested_minor:total,shipping_minor:originalShipping});
  };
  if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>查看售后</Button>;
  const received=entry?.return?.items.reduce((sum,line)=>sum+line.received,0)??0;
  const expected=entry?.return?.items.reduce((sum,line)=>sum+line.quantity,0)??0;
  const damaged=entry?.return?.items.reduce((sum,line)=>sum+line.damaged,0)??0;
  const instructions=entry?.return_instructions;
  return <Card className="fv-aftersales">
    <CardHeader>
      <CardTitle><span ref={heading} tabIndex={-1}>订单售后</span></CardTitle>
    </CardHeader>
    <CardContent className="fv-stack" aria-busy={busy}>
      {busy&&<p role="status">{value?"正在查询或等待宿主确认…":"正在读取售后…"}</p>}
      {error&&<Alert role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {value?.message==="terms_changed"&&<p role="status">店铺更新了条款，请在宿主重新核对后确认。</p>}
      {value?.message==="no_effect"&&<p role="status">本次操作未生效。请查看订单的当前进度。</p>}
      {pending?.phase==="reconciling"&&<p role="status">正在核对这笔操作，请查询原申请。</p>}
      {pending?.phase==="confirm"&&<div className="fv-stack">
        <p>请查看 PAP 宿主的确认提示。已填写的本次申请可以继续。</p>
        <Button disabled={busy} onClick={()=>void send(pending.input)}>继续本次确认</Button>
      </div>}
      {entry&&!newRequest&&<section className="fv-stack" aria-label="申请进度">
        <div>
          <h4>{stages[entry.stage]}</h4>
          <p className="fv-muted">{labels[entry.kind]} · {new Date(entry.updated_at).toLocaleString("zh-CN")}</p>
        </div>
        {instructions&&entry.stage==="waiting_return"&&<div className="fv-aftersales-address">
          <div><strong>{instructions.recipient}</strong><p>{instructions.address}</p><p>{instructions.delivery_notes}</p></div>
          <Button variant="outline" size="sm" onClick={()=>void navigator.clipboard.writeText(
            `${instructions.recipient}\n${instructions.address}`).then(()=>setCopied(true),()=>setError("可选中上方收件信息复制。"))}>
            {copied?"已复制":"复制收件信息"}
          </Button>
        </div>}
        {expected>0&&<p>商家已收 <strong>{received}/{expected}</strong> 件{damaged>0?`，其中破损 ${damaged} 件`:""}</p>}
        <dl className="fv-totals"><dt>申请金额</dt><dd>{money(entry.requested_minor,entry.currency)}</dd>
          {entry.refund&&<><dt>{entry.refund.state==="completed"||entry.refund.state==="confirmed"?"已确认退款":"店铺裁定金额"}</dt>
            <dd>{money(entry.refund.amount_minor,entry.currency)}</dd>
            {entry.refund.shipping_minor!=null&&<><dt>含原运费</dt><dd>{money(entry.refund.shipping_minor,entry.currency)}</dd></>}
          </>}
        </dl>
        {entry.cancellation_pending&&<p role="status">原订单正在取消。</p>}
        {entry.digital_access==="revocation_pending"&&<p role="status">数字内容已停止访问，正在更新权益记录。</p>}
        {entry.digital_access==="revoked"&&<p>数字内容权益已撤销。</p>}
        {entry.decision_reason&&<p className="fv-aftersales-wrap">{entry.decision_reason}</p>}
        {canWithdraw&&(!withdraw?<Button variant="outline" disabled={busy} onClick={()=>setWithdraw(true)}>撤回申请</Button>:
          <form className="fv-stack" onSubmit={event=>{
            event.preventDefault();
            void send({kind:"withdraw",case_id:entry.id,revision:entry.revision,reason:reason.trim(),not_sent:notSent});
          }}>
            {entry.stage==="waiting_return"&&<label><input type="checkbox" required checked={notSent} onChange={e=>setNotSent(e.target.checked)} /> 我确认商品尚未寄出</label>}
            <label htmlFor={signature+"withdraw"}>撤回原因</label>
            <textarea id={signature+"withdraw"} className="fv-input" maxLength={2000} required value={reason} onChange={e=>setReason(e.target.value)} />
            <Button type="submit" disabled={busy||!reason.trim()}>继续确认撤回</Button>
          </form>)}
        {terminal&&!!eligibility?.allowed.length&&!pending&&<Button onClick={()=>{setNewRequest(true);setReason("");}}>再次申请</Button>}
      </section>}
      {editable&&kind&&eligibility&&<form ref={form} className="fv-stack" onSubmit={submit}>
        {kind==="cancel_order"?<div>
          <h4>取消整张订单</h4>
          <p>原路退回 <strong>{money(eligibility.captured_minor,eligibility.currency)}</strong>，含运费 {money(eligibility.original_shipping_minor,eligibility.currency)}。</p>
        </div>:<>
          {eligibility.allowed.length>1&&<label className="fv-stack">处理方式
            <select className="fv-input" value={kind} onChange={e=>setKind(e.target.value as Method)}>
              {eligibility.allowed.map(method=><option key={method} value={method}>{labels[method]}</option>)}
            </select>
          </label>}
          <fieldset className="fv-aftersales-items">
            <legend>申请商品和数量</legend>
            {eligibleLines?.map(line=><label key={line.id} className="fv-aftersales-item">
              <span>{line.title||"订单商品"}<small>最多 {line.kind==="physical"?line.shipped:line.quantity} 件{line[kind]?.merchant_review?" · 由店铺审核":""}</small></span>
              <Input data-quantity aria-label={`${line.title||"订单商品"}的申请数量`} inputMode="numeric" type="number" min="0"
                max={line.kind==="physical"?line.shipped:line.quantity} value={quantities[line.id]??""} placeholder="0"
                onChange={e=>setQuantities({...quantities,[line.id]:e.target.value})} />
            </label>)}
          </fieldset>
          <div className="fv-aftersales-fields">
            <label className="fv-stack">申请金额（{eligibility.currency}）
              <Input data-requested required inputMode="decimal" value={requested} onChange={e=>setRequested(e.target.value)} /></label>
            <label className="fv-stack">其中退回原运费（{eligibility.currency}）
              <Input data-shipping required inputMode="decimal" value={shipping} onChange={e=>setShipping(e.target.value)} /></label>
          </div>
        </>}
        <label htmlFor={signature+"reason"}>申请原因</label>
        <textarea id={signature+"reason"} className="fv-input" required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} />
        <p className="fv-muted">本单最多成功退款一次，部分退款也会用完这次机会。</p>
        <Button type="submit" disabled={busy||!reason.trim()}>核对并确认申请</Button>
      </form>}
      {eligibility&&!pending&&(!entry||newRequest)&&<div className="fv-stack">
        {eligibility.reasons.map(code=>reasons[code]).filter(Boolean).map(text=><p key={text}>{text}</p>)}
        {eligibility.lines.filter(line=>line.kind==="physical"&&line.shipped<line.quantity&&
          !eligibility.allowed.includes("cancel_order")).map(line=><p key={line.id}>{line.title||"订单商品"} · 已发 {line.shipped}，备货 {line.packed}，其余 {line.unshipped}</p>)}
        {!!eligibility.support.support_contact&&<p className="fv-aftersales-wrap">店铺联系方式：{eligibility.support.support_contact}
          {eligibility.support.support_hours&&<><br />服务时间：{eligibility.support.support_hours}</>}</p>}
      </div>}
      <Button variant="outline" disabled={busy} onClick={()=>void send(undefined,entry?.id)}>
        {pending?.phase==="reconciling"||entry?.stage==="refunding"?"查询这笔申请":"刷新售后"}
      </Button>
      {!pending&&value?.history.items.some(item=>item.id!==entry?.id)&&<details>
        <summary>历史申请</summary>
        <ul className="fv-aftersales-history">{value.history.items.map(item=><li key={item.id}><Button variant="ghost" disabled={busy}
          onClick={()=>void send(undefined,item.id)}>{labels[item.kind]} · {stages[item.stage]}</Button></li>)}</ul>
        {value.history.page.next_cursor&&<Button variant="outline" onClick={()=>void send(undefined,entry?.id,value.history.page.next_cursor!)}>更多申请</Button>}
      </details>}
    </CardContent>
  </Card>;
}
