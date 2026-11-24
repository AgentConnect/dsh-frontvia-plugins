/** Live awiki.me custody bridge for the independent Python PAP 1.0/UCP wire runner.
 * Only already discovered operation targets can receive a short-lived Session proof.
 * The protected IPC carries public-request headers, never private keys or account tokens.
 */
import assert from 'node:assert/strict';
import {createRequire,registerHooks} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,writeFile,rename,rm,access} from 'node:fs/promises';
import https from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {loadPublicIdentity,loadPublicPap} from '../tests/support/public-pap.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'package.json'));
const hostRequire=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/')){let entry;try{entry=require.resolve(specifier);}catch{entry=hostRequire.resolve(specifier);}return {url:pathToFileURL(entry).href,shortCircuit:true};}
  return next(specifier,context);
}});
const VERSION='2026-08-25';
const capabilityNames=['catalog.search','catalog.lookup','cart','checkout','order','fulfillment'];
const productProfile={ucp:{version:VERSION,services:{'dev.ucp.shopping':[{version:VERSION,transport:'rest',spec:`https://ucp.dev/${VERSION}/specification/overview/`,schema:`https://ucp.dev/${VERSION}/services/shopping/rest.openapi.json`}]},payment_handlers:{},capabilities:Object.fromEntries(capabilityNames.map(name=>[`dev.ucp.shopping.${name}`,[{version:VERSION,...(name==='fulfillment'?{extends:['dev.ucp.shopping.checkout','dev.ucp.shopping.catalog.search','dev.ucp.shopping.catalog.lookup']}:{}),spec:`https://ucp.dev/${VERSION}/specification/shopping/${name.startsWith('catalog.')?'catalog':name}/`,schema:`https://ucp.dev/${VERSION}/schemas/shopping/${name.replace('.','_')}.json`}]] ))}};
let fixture,publisher,stage='configuration';
const discoveryHttp=[];
const toolFailures=[];
const safeCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,79}$/i.test(value)?value:undefined;
const take=result=>{
  if(!result.ok)throw Object.assign(new Error('Public PAP operation failed'),{code:safeCode(result.error?.code)??'public_pap_failed'});
  return result.value;
};
async function run(){
  const selected=await loadPublicPap();
  const selectedIdentity=await loadPublicIdentity();
  const sources={papSource:selected.source,papVersion:selected.version,papRoot:selected.root,
    identitySource:selectedIdentity.source,identityVersion:selectedIdentity.version,identityRoot:selectedIdentity.root,nativeVersion:selectedIdentity.nativeVersion};
  if(process.argv[2]==='--preflight'){
    console.log(JSON.stringify({stage:'candidate_package_preflight',...sources}));
    return;
  }
  const config=JSON.parse(await readFile(process.argv[2],'utf8'));
  const control=resolve(config.controlDir),profileUrl=config.liveStore ? config.ucpPlatformProfileUrl : `https://agent.test:${config.identityPort}/.well-known/ucp`;
  if(config.liveStore){
    assert(['dsh-ucp-full','ucp-reference'].includes(config.suite));
    assert.equal(new URL(config.origin).origin,`https://${config.domain}`);
    assert.equal(config.origin,`https://${config.domain}`);
    assert.equal(new URL(profileUrl).protocol,'https:');
  }
  const atomic=async(name,value)=>{const target=join(control,name),temporary=target+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,target);};
  if(!config.liveStore&&!config.externallyHostedProfile){
    publisher=https.createServer({key:await readFile(config.key),cert:await readFile(config.cert)},(request,response)=>{
      if(request.method!=='GET'||request.url!=='/.well-known/ucp'){response.writeHead(404);response.end();return;}
      response.writeHead(200,{'content-type':'application/json','cache-control':'public, max-age=300'});response.end(JSON.stringify(productProfile));
    });
    await new Promise((resolve,reject)=>{publisher.once('error',reject);publisher.listen(config.identityPort,'127.0.0.1',resolve);});
  }
  stage='live_identity';
  const {awikiMeIdentity}=await import('../tests/support/awiki-me-identity.mjs');fixture=await awikiMeIdentity(selectedIdentity,{reusePublished:true});
  assert.equal(new URL(JSON.parse(fixture.publicMaterials.metadata).client_id).origin,'https://awiki.me');
  assert.equal(fixture.identityPackage.root,selectedIdentity.root);
  const Manager=(await import(pathToFileURL(join(selected.root,'lib/management-remote.js')).href)).default;
  const Customer=await import(pathToFileURL(join(root,'packages/customer/src/index.ts')).href);
  const Tools=await import('@deepseek-ai/dsh-tools');const Executor=await import('@deepseek-ai/dsh-tool-executor-native');
  const base=new selected.SafeHttpsTransport(config.liveStore ? {} : {ca:await readFile(config.ca),privateOrigins:[config.origin,new URL(profileUrl).origin],lookup:async hostname=>['company-a.test','agent.test'].includes(hostname)?[{address:'127.0.0.1',family:4}]:(await import('node:dns/promises')).lookup(hostname,{all:true})});
  if(config.liveStore){
    stage='managed_store_discovery';
    const discovery=await base.request(config.origin+'/.well-known/poppy.json',{method:'GET'});
    assert.equal(discovery.status,200);
    const metadata=JSON.parse(Buffer.from(discovery.body).toString('utf8'));
    assert.equal(metadata.organization?.domain,config.domain);
    assert.equal(metadata.protocol_version,'1.0');
    assert(metadata.extensions?.operations?.some(extension=>extension.version==='3'));
    const apiUrls=metadata.apis?.map(api=>api.url)??[];
    for(const path of ['/ucp/openapi.json','/poppy/aftersales.openapi.json']){
      assert.equal(apiUrls.filter(url=>url===config.origin+path).length,1);
    }
    const response=await base.request(config.origin+'/.well-known/ucp',{method:'GET'});
    assert.equal(response.status,200);
    const profile=JSON.parse(Buffer.from(response.body).toString('utf8'));
    assert(profile.ucp?.payment_handlers?.['com.frontvia.payment.durable_mock']?.length,
      'The dedicated store must publicly advertise its Mock payment handler before purchase');
    if(config.suite==='dsh-ucp-full'){
      const clientProfile=await base.request(profileUrl,{method:'GET'});
      assert.equal(clientProfile.status,200);
      assert(JSON.parse(Buffer.from(clientProfile.body).toString('utf8')).ucp?.payment_handlers?.['com.frontvia.payment.durable_mock']?.length,
        'The dedicated buyer profile must negotiate the same Mock payment handler');
    }
  }
  let capture;
  const transport={async request(url,options={}){
    if(capture && url===capture.url && (options.method??'GET')===capture.method && options.headers?.['poppy-session']){
      capture.headers=structuredClone(options.headers);
      return {url,status:418,headers:{'content-type':'application/json'},body:Buffer.from('{}')};
    }
    const target=new URL(url);
    const discovery=(options.method??'GET')==='GET'&&!options.headers?.['poppy-session']
      &&[config.origin,new URL(profileUrl).origin].includes(target.origin)
      &&/^\/[a-z0-9_./-]{0,180}$/i.test(target.pathname);
    const observe=fields=>{
      if(!discovery)return;
      discoveryHttp.push({peer:target.origin===config.origin?'company':'platform',method:'GET',path:target.pathname,...fields});
      if(discoveryHttp.length>12)discoveryHttp.shift();
    };
    try{
      const response=await base.request(url,options);
      observe({status:response.status});
      return response;
    }catch(error){
      observe({error:safeCode(error?.code)??'transport_failed'});
      throw error;
    }
  }};
  const NETWORK='@fixture/frontvia-pap10-host',MANAGER='@awiki/dsh-pap/management-remote';
  const network={apply(context){context.provide('papHost',{transport});context.provide('profileContext',{name:'pap10-core',dir:fixture.root});context.provide('systemPrompt',{tools(){return()=>{};},section(){return()=>{};}});context.provide('connection',{browserPeer:{principal:{kind:'owner'}},fetch:{register(){return()=>{};}}});}};
  const ctx=await fixture.reopen({modules:{[NETWORK]:network,'@awiki/dsh-pap/plugin':selected.plugin,[MANAGER]:Manager,'dsh-frontvia-customer':Customer,'@deepseek-ai/dsh-tools':Tools,'@deepseek-ai/dsh-tool-executor-native':Executor},entries:[{name:NETWORK},{name:'@deepseek-ai/dsh-tools'},{name:'@deepseek-ai/dsh-tool-executor-native'}]});
  const entry=[...ctx.loader.entries()].find(entry=>entry.options.name==='@agent-network-protocol/dsh-anp-identity');
  await ctx.loader.update(entry.id,{config:{...entry.options.config,allowConsumers:[...(entry.options.config.allowConsumers??[]),'@awiki/dsh-pap/plugin'],userConsumers:[...(entry.options.config.userConsumers??[]),'@awiki/dsh-pap/plugin'],domainAccess:{enabled:true,identity:fixture.publicRef,scopes:[],secretStore:'local-file'}}});
  await ctx.loader.await();
  const identityContext=[...ctx.loader.entries()].find(entry=>entry.options.name==='@agent-network-protocol/dsh-anp-identity/management-remote').fiber.ctx;
  const identity=identityContext.get('anpIdentity'),current=await identity.defaultIdentity(identityContext);
  await identity.configureDefaultIdentity(identityContext,{expectedVersion:current.version,identity:fixture.publicRef});
  const policy=await identity.protocolManagement(identityContext),rule={mode:'allow_all',outside:'ask',domains:[]};
  await identity.configureProtocolPolicy(identityContext,{expectedVersion:policy.policy.version,policy:{read:rule,write:rule}});
  await ctx.loader.create({name:'@awiki/dsh-pap/plugin',config:{enabled:true,autoConnect:true,stateRoot:join(fixture.root,'pap'),ucpPlatformProfileUrl:profileUrl,businessConsumers:['dsh-frontvia-customer']}});
  await ctx.loader.create({name:MANAGER});
  const customerConfig=join(fixture.root,'customer.json');await writeFile(customerConfig,JSON.stringify({dataDir:join(fixture.root,'customer'),storageKeyRef:'PAP10_CUSTOMER_STATE',sites:[]}),{mode:0o600});
  await ctx.loader.create({name:'dsh-frontvia-customer',config:{configFile:customerConfig}});await ctx.loader.await();
  const customerContext=[...ctx.loader.entries()].find(entry=>entry.options.name==='dsh-frontvia-customer').fiber.ctx;
  const managerContext=[...ctx.loader.entries()].find(entry=>entry.options.name===MANAGER).fiber.ctx;
  const service=customerContext.get('pap'),sdk=service.acquireBusiness(customerContext),manager=managerContext.get('pap').acquireManagement(managerContext);
  if(config.suite==='dsh-ucp'||config.suite==='dsh-ucp-full'){
    stage='claude_ucp_domain_browsing';
    const registry=customerContext.get('tools');
    const execute=async(name,args)=>{
      const batch=await registry.execute({calls:[{type:'tool_call',id:randomUUID(),name,arguments:JSON.stringify(args)}],
        agent:{id:'pap10-customer'},signal:new AbortController().signal});
      assert.equal(batch.results.length,1);
      const result=batch.results[0].result;
      if(result.isError||result.value?.error){
        const code=safeCode(result.value?.error?.code)??'customer_tool_failed';
        toolFailures.push({name,action:args.action,code});
        throw Object.assign(new Error('Customer tool call failed'),{code});
      }
      return result.value;
    };
    if(config.liveStore){
      stage='customer_ucp_connection';
      const connected=await execute('frontvia_connection',{action:'connect',domain:config.domain});
      assert(typeof connected.flowId==='string','The Customer tool must bind a flow to the discovered store');
      stage='claude_ucp_domain_browsing';
    }
    if(!config.existingAftersales){
      const {checkClaudeDomain}=await import('./claude-public-shopping.mjs');
      console.log(JSON.stringify(await checkClaudeDomain({domain:config.domain,execute,definitions:registry.definitions(),privateDir:fixture.root})));
    }
    assert(take(await sdk.operations()).some(operation=>operation.channel==='ucp'),'UCP candidate routes must be present');
    stage='dsh_web_ucp_e2e';
    const {runDsh}=await import('../tests/e2e/dsh/run.mjs');
    await runDsh({fixture,commerce:{...config,ucpPlatformProfileUrl:profileUrl},root});
    return;
  }
  stage='public_pap_connect';
  const connected=take(await sdk.connect(config.domain)),companyRef=connected.company.companyRef;
  const openSession=async mode=>take(await manager.execute({action:'session/connect',companyRef,mode}));
  const discovered=async()=>take(await sdk.operations()).filter(operation=>operation.companyRef===companyRef);
  stage='public_pap_operations';
  const operations=await discovered();
  stage='pap_regular_session';
  const owner=await openSession('regular');
  assert(operations.some(operation=>operation.channel==='ucp'),'UCP candidate routes must be present');
  const sessions={owner:owner.sessionRef};
  if(config.suite!=='ucp-reference'){
    stage='pap_anonymous_session';
    sessions.other=(await openSession('anonymous')).sessionRef;
  }
  await atomic('ucp-ready.json',{ready:true,profileUrl,users:Object.keys(sessions)});
  console.log(JSON.stringify({status:'passed',case:'pap10-live-awiki-identity-and-product-profile',...sources}));
  stage='restricted_signing_bridge';
  let lastId;
  for(;;){
    try{await access(join(control,'ucp-stop.json'));break;}catch{}
    let request;try{request=JSON.parse(await readFile(join(control,'ucp-sign.request.json'),'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;await delay(40);continue;}
    if(request.id===lastId){await delay(40);continue;}lastId=request.id;
    try{
      assert(/^[0-9a-f-]{36}$/i.test(request.id)&&sessions[request.user]);
      const target=new URL(request.url);assert.equal(target.origin,config.origin);assert(!target.hash);
      const method=String(request.method).toUpperCase();
      let chosen,path={};
      for(const operation of operations){
        if(operation.method!==method)continue;
        const names=[],pattern=operation.path.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{([A-Za-z0-9_.-]+)\}/g,(_all,name)=>{names.push(name);return '([^/]+)';});
        const match=new RegExp('^'+pattern+'$').exec(target.pathname);
        if(match){assert(!chosen);chosen=operation;path=Object.fromEntries(names.map((name,index)=>[name,decodeURIComponent(match[index+1])]));}
      }
      assert(chosen,'Only discovered operations can receive Session headers');
      take(await manager.execute({action:'operation/enable',operationRef:chosen.operationRef,sessionRef:sessions[request.user]}));
      capture={url:target.href,method};
      let settled=false;
      const dispatch=sdk.request({operationRef:chosen.operationRef,...(Object.keys(path).length?{path}:{}),...(target.search?{query:Object.fromEntries(target.searchParams)}:{}),...(!['GET','HEAD'].includes(method)?{body:request.body??{},idempotencyKey:request.idempotencyKey??request.id}:{})}).finally(()=>{settled=true;});
      const ownerManager=identity.acquireManagement(identityContext),deadline=Date.now()+20000;
      while(!settled&&Date.now()<deadline){
        const pending=(await ownerManager.listRequests()).find(item=>item.kind==='access'&&item.status==='pending');
        if(pending){const review=await ownerManager.getRequest(pending.id);assert.equal(review.operationPreview.target,target.href);assert.equal(review.operationPreview.method,method);if(chosen.operationId==='commerce.checkouts.confirm')assert.deepEqual(review.operationPreview.parameters.confirmation,request.body?.confirmation);await ownerManager.decide({requestId:pending.id,expectedVersion:pending.version,decision:'approve',identity:fixture.publicRef,mode:'once',reviewedSnapshot:review.snapshot});}
        await delay(30);
      }
      assert(settled,'Signing approval timed out');const result=await dispatch;
      if(!capture.headers)take(result);
      assert(capture.headers,'Public PAP dispatch must reach the exact transport target');
      const headers=Object.fromEntries(Object.entries(capture.headers).filter(([name])=>['poppy-session','poppy-version','poppy-extensions','ucp-agent','request-id'].includes(name.toLowerCase())));
      assert.equal(headers['poppy-version'],'1.0');
      await atomic('ucp-sign.response.json',{id:request.id,headers});
      void result;
    }catch(error){await atomic('ucp-sign.response.json',{id:request.id,error:safeCode(error?.code)??'signing_rejected'});}
    finally{capture=undefined;}
  }
}
try{await run();}
catch(error){
  process.exitCode=1;
  const location=String(error?.stack??'').match(/(?:awiki-me-identity|pap10-core-check)\.mjs:\d+:\d+/)?.[0];
  console.log(JSON.stringify({status:'failed',stage,error:safeCode(error?.code)??safeCode(error?.name)??'bridge_failed',
    location,...(discoveryHttp.length?{discoveryHttp}:{}),...(toolFailures.length?{toolFailures}:{} )}));
}
finally{if(publisher)await new Promise(resolve=>publisher.close(resolve));await fixture?.dispose();hooks.deregister();}
