import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {serverResponseSchema} from '@deepseek-ai/dsh-client-connection';
import {apply,inject} from '../src/index.js';
import {evaluatePluginCompatibility} from '@deepseek-ai/dsh-app-boot';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'customer-public-entry-')),file=join(dir,'customer.json'),key=randomBytes(32).toString('base64url');
 writeFileSync(file,JSON.stringify({dataDir:join(dir,'state'),storageKeyRef:'CUSTOMER_STATE',sites:[]}),{mode:0o600});
 const routes=new Map<string,any>(),tools=new Map<string,any>(),cleanups:(()=>void)[]=[];let credentials=0,facades=0;
 const sdk={requestTimeoutMs:1000,status:async()=>({ok:true,value:{state:'unconfigured',access_token:'host-secret-not-for-UI'}}),operations:async()=>({ok:true,value:[]}),connect:async()=>({ok:false,error:{code:'default_identity_required'}}),request:async()=>{throw Error('Unexpected dispatch');}};
 const ctx:any={pap:{acquireBusiness(c:unknown){assert.equal(c,ctx);facades++;return sdk;}},credentials:{resolve:async()=>{credentials++;return {value:key};},set:async()=>{}},effect(fn:()=>undefined|(()=>void)){const close=fn();if(close)cleanups.push(close);},tools:{register(tool:any){tools.set(tool.name,tool);}},systemPrompt:{section(){}},connection:{browserPeer:{principal:{kind:'owner'}},fetch:{register(route:any){routes.set(route.path,route);return ()=>{};}}}};
 async function call(operation:string,payload={}){
  return routes.get('/api/frontvia-customer/'+operation).fetch(new Request('http://localhost/api/frontvia-customer/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'test-request',method:'frontvia-customer/'+operation,payload})}));
 }
 return {dir,file,ctx,routes,tools,call,get credentials(){return credentials;},get facades(){return facades;},close(){for(const fn of cleanups.reverse())fn();rmSync(dir,{recursive:true,force:true});}};
}
test('Customer activates with only public PAP and zero merchants, without phone routes or protocol secrets',async()=>{
 const f=fixture();try{
  assert(!inject.includes('frontviaPap'));assert(!inject.includes('frontviaIdentity'));assert(inject.includes('pap'));
  await apply(f.ctx,{configFile:f.file});assert.equal(f.facades,1);assert(f.tools.has('frontvia_products'));
  for(const old of ['personal-status','personal-code','personal-verify','personal-logout'])assert(!f.routes.has('/api/frontvia-customer/'+old));
  const status=serverResponseSchema.parse(await(await f.call('identity-status')).json());assert(status.result.ok);assert(!JSON.stringify(status).includes('host-secret'));
  const list=serverResponseSchema.parse(await(await f.call('list')).json());assert(list.result.ok);if(list.result.ok)assert.deepEqual(list.result.value,{flows:[],sites:[],identityRevision:''});
  const missing=serverResponseSchema.parse(await(await f.call('view',{sessionId:'chat',flowId:'00000000-0000-4000-8000-000000000001'})).json());assert(!missing.result.ok);if(!missing.result.ok)assert.equal(missing.result.error.code,'FLOW_NOT_OWNED');
  f.ctx.connection.browserPeer.principal.kind='guest';assert.equal((await f.call('list')).status,403);
 }finally{f.close();}
});
test('Customer without a public consumer grant fails before opening state or registering capabilities',async()=>{
 const f=fixture();try{
  f.ctx.pap.acquireBusiness=()=>{throw Error('permission_denied');};
  await assert.rejects(apply(f.ctx,{configFile:f.file}),/permission_denied/);
  assert.equal(f.credentials,0);assert.equal(f.routes.size,0);assert.equal(f.tools.size,0);assert.equal(existsSync(join(f.dir,'state')),false);
 }finally{f.close();}
});
test('Customer retains the supported DSH Host version with no compatibility exemption',()=>{
 const manifest=require('../package.json');
 assert.equal(evaluatePluginCompatibility(manifest,{},'0.2.2-rc.1'),undefined);
 assert.ok(evaluatePluginCompatibility(manifest,{},'0.1.5'));
});
