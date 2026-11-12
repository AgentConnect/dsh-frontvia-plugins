import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Test-only loopback TLS routing; the production PAP transport still verifies certificates. */
export async function apply(ctx,config){
  const {SafeHttpsTransport}=await import(pathToFileURL(config.transportModule).href);
  const transport=new SafeHttpsTransport({ca:await readFile(config.ca),
    privateOrigins:[config.origin],lookup:async()=>[{address:'127.0.0.1',family:4}]});
  ctx.provide('papHost',{transport:{async request(url,options){
    const response=await transport.request(url,options);
    const operation=new URL(url).pathname.split('/api/')[1];
    if(operation){
      let code;
      try{const body=JSON.parse(Buffer.from(response.body).toString());const value=body.error?.data?.type??body.error?.code;if(typeof value==='string'&&/^[A-Z_]{1,80}$/.test(value))code=value;}catch{}
      console.log(JSON.stringify({event:'frontvia-e2e-http',operation,status:response.status,...(code?{code}:{})}));
    }
    return response;
  }}});
}
