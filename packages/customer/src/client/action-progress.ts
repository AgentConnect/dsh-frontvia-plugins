export const actionPhaseText={
  prepare:"正在准备本次操作…",
  approval:"等待你授权。若弹窗未显示，请打开设置中的「身份管理」，在「待处理请求」中查看本次操作。",
  request:"正在向店铺提交本次操作…",
  response:"已收到店铺回复，正在核对结果…",
};
export type ActionPhase=keyof typeof actionPhaseText;
const readIntents = new Set(["product","browse","variant-page","variants","orders","order-detail","delivery-options"]);

export async function observeOwnerAction(call:(op:string,payload:any)=>Promise<any>,op:string,payload:any,
    report:(phase?:ActionPhase)=>void) {
  if(!["shopping","prepare-purchase","contact","aftersales-change"].includes(op) ||
     op==="shopping"&&readIntents.has(payload.intent?.action))return call(op,payload);
  const progressId=crypto.randomUUID();
  let active=true,polling=false;
  report("prepare");
  const timer=setInterval(async()=>{
    if(polling||!active)return;
    polling=true;
    try{
      const result=await call("action-progress",{flowId:payload.flowId,sessionId:payload.sessionId,progressId});
      if(active&&Object.hasOwn(actionPhaseText,result?.phase))report(result.phase);
    }catch{ /* A failed display read cannot change the business request. */ }
    finally{polling=false;}
  },750);
  try{return await call(op,{...payload,progressId});}
  finally{active=false;clearInterval(timer);report(undefined);}
}
