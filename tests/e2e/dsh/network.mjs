import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function caseFingerprint(orderId,caseId){
  return createHash('sha256').update(JSON.stringify([orderId,caseId])).digest('hex');
}

/** Test-only loopback TLS routing; the production PAP transport still verifies certificates. */
export async function apply(ctx,config){
  const {SafeHttpsTransport}=await import(pathToFileURL(config.transportModule).href);
  const transport=new SafeHttpsTransport({ca:await readFile(config.ca),
    privateOrigins:[config.origin,...(config.ucpPlatformProfileUrl?[new URL(config.ucpPlatformProfileUrl).origin]:[])],
    lookup:async()=>[{address:'127.0.0.1',family:4}]});
  ctx.provide('papHost',{transport:{async request(url,options){
    const response=await transport.request(url,options);
    const pathname=new URL(url).pathname;
    if(pathname.startsWith('/ucp/v1/')){
      const operation=pathname.replace(/^\/ucp\/v1\//,'')
        .replace(/^(carts|checkout-sessions|orders)\/[^/]+/,'$1/:id');
      const headers=new Headers(options?.headers);
      const pap10=headers.get('poppy-version')==='1.0'&&headers.has('poppy-session')
        &&headers.get('ucp-agent')===`profile="${config.ucpPlatformProfileUrl}"`;
      let checkout;
      if(operation.includes('/prepare')){
        try{
          const payload=JSON.parse(Buffer.from(response.body).toString());
          checkout={state:payload.checkout?.status,hasHandoff:typeof payload.checkout?.continue_url==='string',
            merchantOrigin:!!payload.checkout?.continue_url&&new URL(payload.checkout.continue_url).origin===config.origin,
            revisionValid:Number.isSafeInteger(payload.revision),hasFrame:!!payload.confirmation,
            frameHashLength:payload.confirmation?.snapshot_hash?.length,
            frameAmountMatches:payload.confirmation?.amount_minor===String(payload.checkout?.totals?.find(t=>t.type==='total')?.amount),
            reason:typeof payload.messages?.[0]?.code==='string'&&/^[a-z_]{1,80}$/.test(payload.messages[0].code)?payload.messages[0].code:undefined};
        }catch{}
      }
      console.log(JSON.stringify({event:'frontvia-e2e-http',operation,method:options.method,status:response.status,pap10,...(checkout?{checkout}:{})}));
    }
    if(pathname.startsWith('/poppy/v1/aftersales/')){
      const headers=new Headers(options?.headers);
      let originalCase;
      if(response.status===200&&options.method==='GET'&&pathname.endsWith('/eligibility')){
        try{
          const facts=JSON.parse(Buffer.from(response.body).toString());
          if(typeof facts.order_id==='string'&&typeof facts.active_case?.id==='string'){
            originalCase=caseFingerprint(facts.order_id,facts.active_case.id);
          }
        }catch{}
      }
      console.log(JSON.stringify({event:'frontvia-e2e-http',
        operation:pathname.slice('/poppy/v1/'.length).replace(/\/orders\/[^/]+/,'/orders/:id')
          .replace(/\/(cases|intents|operations)\/[^/]+/,'/$1/:id'),
        method:options.method,status:response.status,
        pap10:headers.get('poppy-version')==='1.0'&&headers.has('poppy-session'),
        operationsV3:/"operations"\s*;\s*v="3"/.test(headers.get('poppy-extensions')??''),
        userApproval:/(?:^|,\s*)approver="user"(?:,|$)/.test(headers.get('poppy-approval')??''),
        originalCase,
      }));
    }
    const operation=pathname.split('/api/')[1];
    if(operation){
      let code;
      try{const body=JSON.parse(Buffer.from(response.body).toString());const value=body.error?.data?.type??body.error?.code;if(typeof value==='string'&&/^[A-Z_]{1,80}$/.test(value))code=value;}catch{}
      console.log(JSON.stringify({event:'frontvia-e2e-http',operation,status:response.status,...(code?{code}:{})}));
    }
    return response;
  }}});
}
