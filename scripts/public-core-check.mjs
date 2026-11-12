/** Public Identity/PAP acceptance against the deployed awiki.me User Service. */
import assert from 'node:assert/strict';
import {createRequire, registerHooks} from 'node:module';
import {dirname, resolve, join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import https from 'node:https';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'package.json'));
const hostRequire=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const identityRoot=dirname(require.resolve('@agent-network-protocol/dsh-anp-identity/package.json'));
process.env.PYTHONDONTWRITEBYTECODE='1';
assert.equal(require('@agent-network-protocol/dsh-anp-identity/package.json').version,'0.1.16');
const nativeRequire=createRequire(join(identityRoot,'package.json'));
assert.equal(nativeRequire(join(dirname(nativeRequire.resolve('@agent-network-protocol/anp-identity/provider')),'package.json')).version,'0.2.6');

// Resolve the owner's fixture against the formal published implementation and
// one actual Cordis Host. This changes module resolution, not caller admission.
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/')){
    let entry;
    try{entry=require.resolve(specifier);}catch{entry=hostRequire.resolve(specifier);}
    return {url:pathToFileURL(entry).href,shortCircuit:true};
  }
  return next(specifier,context);
}});
let fixture;
let publisher;
let stage='public_identity_registration';
try{
  console.log(JSON.stringify({stage,identityVersion:'0.1.16',nativeVersion:'0.2.6'}));
  const commerce=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):undefined;
  const {awikiMeIdentity}=await import('../tests/support/awiki-me-identity.mjs');
  fixture=await awikiMeIdentity();
  const metadata=JSON.parse(fixture.publicMaterials.metadata);
  const jwks=JSON.parse(fixture.publicMaterials.jwks);
  assert(metadata.client_id&&metadata.jwks_uri&&jwks.keys.length>0);
  assert.equal(new URL(metadata.client_id).origin,'https://awiki.me');
  assert.equal(fixture.evidence.observations.deviceAuthorizationRequests,0);
  assert(fixture.evidence.excludesInternalCredentials({metadata,jwks}));
  console.log(JSON.stringify({status:'passed',case:'public-native-identity-register-publish',identityVersion:'0.1.16',nativeVersion:'0.2.6',
    boundary:'Live awiki.me User Service and public CIMD/JWKS; protected dedicated test identity retained, local-file custody. No production service configuration changes.'}));
  if(commerce){
    stage='public_identity_https';
    if(commerce.suite==='system')console.log(JSON.stringify({suite:'pap03-system',case:'identity.awiki-me-live-public-materials',status:'passed'}));
    const allowed=new Set(); // This local peer serves negative protocol vectors, never awiki.me identity materials.
    const publications=new Map();
    publisher=https.createServer({key:await readFile(commerce.key),cert:await readFile(commerce.cert)},async(request,response)=>{
      if(request.method==='GET'&&publications.has(request.url)){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(publications.get(request.url)));return;}
      if(request.method!=='GET'||!allowed.has(request.url)){response.writeHead(404);response.end();return;}
      try{
        const reply=await fixture.requestForTest(commerce.identityOrigin+request.url);
        response.writeHead(reply.status,{'content-type':'application/json','cache-control':'no-store'});
        response.end(Buffer.from(await reply.arrayBuffer()));
      }catch{response.writeHead(503);response.end();}
    });
    await new Promise((resolve,reject)=>{publisher.once('error',reject);publisher.listen(commerce.identityPort,'127.0.0.1',resolve);});
    if(commerce.suite==='dsh'){
      stage='dsh_web_e2e';
      const {runDsh}=await import('../tests/e2e/dsh/run.mjs');
      await runDsh({fixture,commerce,root});
    }else{
    const papModule=await import(pathToFileURL(resolve(root,'../dsh-pap/src/plugin.ts')).href);
    const {SafeHttpsTransport}=await import(pathToFileURL(resolve(root,'../dsh-pap/src/network.ts')).href);
    const customerModule=await import(pathToFileURL(join(root,'packages/customer/src/index.ts')).href);
    const toolModule=await import('@deepseek-ai/dsh-tools');
    const executorModule=await import('@deepseek-ai/dsh-tool-executor-native');
    const nativeTransport=new SafeHttpsTransport({ca:await readFile(commerce.ca),privateOrigins:[commerce.origin],lookup:async hostname=>hostname==='company-a.test'?[{address:'127.0.0.1',family:4}]:(await import('node:dns/promises')).lookup(hostname,{all:true})});
    let lastCatalogRequest;
    const transport={async request(url,options){
      const response=await nativeTransport.request(url,options);
      if(response.status===200&&new URL(url).pathname.endsWith('/api/commerce.products.search'))lastCatalogRequest={url,options:{...options,headers:{...options.headers},signal:undefined}};
      if(response.status>=400&&!(response.status===404&&new URL(url).pathname==='/.well-known/oauth-protected-resource')){
        let failure;try{const body=JSON.parse(Buffer.from(response.body).toString());failure=typeof body.error==='string'?body.error:body.error?.data?.type;}catch{}
        console.log(JSON.stringify({case:'business-http-diagnostic',status:response.status,operation:new URL(url).pathname.split('/api/')[1]??'discovery',
          ...(/^[a-z_]+$/i.test(failure??'')?{error:failure}:{})}));
      }
      return response;
    }};
    const NETWORK='@fixture/frontvia-core-host';
    const routes=new Map();
    const network={apply(context){
      context.provide('papHost',{transport});
      context.provide('profileContext',{name:'pap03-core',dir:fixture.root});
      context.provide('systemPrompt',{tools(){return()=>{};},section(){return()=>{};}});
      context.provide('connection',{browserPeer:{principal:{kind:'owner'}},fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path);}}});
    }};
    stage='installed_public_pap_customer';
    const ctx=await fixture.reopen({modules:{[NETWORK]:network,'@deepseek-ai/dsh-tools':toolModule,'@deepseek-ai/dsh-tool-executor-native':executorModule,
      '@awiki/dsh-pap/plugin':papModule,'dsh-frontvia-customer':customerModule},entries:[{name:NETWORK},{name:'@deepseek-ai/dsh-tools'},{name:'@deepseek-ai/dsh-tool-executor-native'}]});
    const serviceEntry=[...ctx.loader.entries()].find(entry=>entry.options.name==='@agent-network-protocol/dsh-anp-identity');
    await ctx.loader.update(serviceEntry.id,{config:{...serviceEntry.options.config,
      allowConsumers:[...(serviceEntry.options.config.allowConsumers??[]),'@awiki/dsh-pap/plugin'],
      userConsumers:[...(serviceEntry.options.config.userConsumers??[]),'@awiki/dsh-pap/plugin'],
      domainAccess:{enabled:true,identity:fixture.publicRef,scopes:[],secretStore:'local-file'}}});
    await ctx.loader.await();
    const managerContext=[...ctx.loader.entries()].find(entry=>entry.options.name==='@agent-network-protocol/dsh-anp-identity/management-remote').fiber.ctx;
    const identity=managerContext.get('anpIdentity');
    const current=await identity.defaultIdentity(managerContext);
    await identity.configureDefaultIdentity(managerContext,{expectedVersion:current.version,identity:fixture.publicRef});
    const permissions=await identity.protocolManagement(managerContext);
    const rule={mode:'allow_all',outside:'ask',domains:[]};
    await identity.configureProtocolPolicy(managerContext,{expectedVersion:permissions.policy.version,policy:{read:rule,write:rule}});
    await ctx.loader.create({name:'@awiki/dsh-pap/plugin',config:{enabled:true,autoConnect:true,stateRoot:join(fixture.root,'pap'),businessConsumers:['dsh-frontvia-customer']}});
    const customerConfig=join(fixture.root,'customer.json');
    await writeFile(customerConfig,JSON.stringify({dataDir:join(fixture.root,'customer'),storageKeyRef:'PAP03_CUSTOMER_STATE',sites:[]}),{mode:0o600});
    await ctx.loader.create({name:'dsh-frontvia-customer',config:{configFile:customerConfig}});
    await ctx.loader.await();
    const customerContext=[...ctx.loader.entries()].find(entry=>entry.options.name==='dsh-frontvia-customer').fiber.ctx;
    const registry=customerContext.get('tools');
    assert(registry&&typeof registry.execute==='function','installed_customer_tools_executor_unavailable');
    let call=0;
    const execute=async(name,args)=>{
      const batch=await registry.execute({calls:[{type:'tool_call',id:'core-'+(++call),name,arguments:JSON.stringify(args)}],agent:{id:'pap03-core-chat'},signal:new AbortController().signal});
      assert.equal(batch.results.length,1);
      const result=batch.results[0].result;
      assert(!result.isError,'Actual tool execution failed');
      if(result.value?.error)throw new Error(result.value.error.code);
      return result.value;
    };
    stage='claude_domain_browsing';
    const {checkClaudeDomain}=await import('./claude-public-shopping.mjs');
    console.log(JSON.stringify(await checkClaudeDomain({domain:commerce.domain,execute,definitions:registry.definitions(),privateDir:fixture.root})));
    stage='domain_discovery_catalog';
    const connected=await execute('frontvia_connection',{action:'connect',domain:commerce.domain});
    assert(connected.flowId,'Domain-only connection must create a shopping flow');
    const products=await execute('frontvia_products',{action:'browse',flowId:connected.flowId});
    assert(products.data.items.length>0,'Actual store product must be visible');
    console.log(JSON.stringify({status:'passed',case:'zero-merchants-domain-discovery-real-products',products:products.data.items.length,
      boundary:'Live awiki.me identity and public materials, actual Customer/PAP and Core/Medusa HTTPS. Local Company routing and system-test owner connection remain controlled seams.'}));
    const flowId=connected.flowId;
    const ui=async(operation,payload={})=>{
      const route=routes.get('/api/frontvia-customer/'+operation);
      assert(route,'Actual Customer owner endpoint must be registered');
      const response=await route.fetch(new Request('http://localhost/api/frontvia-customer/'+operation,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method:'frontvia-customer/'+operation,payload:{sessionId:'pap03-core-chat',flowId,...payload}})}));
      const message=await response.json();
      if(!message.result?.ok)throw new Error(message.result?.error?.code??'owner_endpoint_failed');
      return message.result.value;
    };
    const facts=async(phase)=>{
      await writeFile(join(commerce.controlDir,phase+'.request'),'ready',{mode:0o600});
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){try{return JSON.parse(await readFile(join(commerce.controlDir,phase+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}await delay(50);}
      throw Error('owned_native_facts_timeout');
    };
    stage='real_cart_quote';
    const variants=await execute('frontvia_products',{action:'variants',flowId,product_id:products.data.items[0].id});
    assert(variants.data.items.length>0);
    await execute('frontvia_cart',{action:'add',flowId,variant_id:variants.data.items[0].id,quantity:1});
    let view=await ui('view');
    assert(view.cart.lines.length===1);
    await ui('contact',{expected_version:view.cart.version,patch:{email:'pap03-owned@example.test',shipping_address:{country:'US',recipient:'Owned Test',line1:'1 Test Street',city:'Test City',region:'CA',postal_code:'94105'}},actionId:randomUUID()});
    view=await ui('view');
    await execute('frontvia_checkout',{action:'quote',flowId,expected_version:view.cart.version});
    await execute('frontvia_checkout',{action:'prepare',flowId});
    const review=await ui('review');
    assert(review.intent?.id&&review.quote?.totals?.grand_total,'Owner quote/intent must be complete');
    stage='public_pap_final_approval';
    let settled=false;
    const purchase=ui('confirm',{intentId:review.intent.id}).finally(()=>{settled=true;});
    void purchase.catch(()=>{});
    const manager=identity.acquireManagement(managerContext);
    let pending;
    const approvalDeadline=Date.now()+15000;
    while(Date.now()<approvalDeadline&&!settled){pending=(await manager.listRequests()).find(request=>request.kind==='access'&&request.status==='pending');if(pending)break;await delay(50);}
    assert(pending&&!settled,'Purchase must wait for the public PAP approval');
    assert.equal((await facts('before-confirm')).orders,0);
    const approval=await manager.getRequest(pending.id);
    assert.equal(approval.operationPreview.method,'POST');
    assert(approval.operationPreview.target.endsWith('/api/commerce.checkouts.confirm'));
    assert.equal(approval.operationPreview.parameters.confirmation.amount_minor,review.quote.totals.grand_total.amount_minor);
    assert.equal(approval.operationPreview.parameters.confirmation.currency,review.quote.totals.grand_total.currency);
    await manager.decide({requestId:pending.id,expectedVersion:pending.version,decision:'approve',identity:fixture.publicRef,mode:'once',reviewedSnapshot:approval.snapshot});
    await purchase;
    for(let attempt=0;attempt<15;attempt++){
      view=await ui('view');if(view.order?.id)break;
      await execute('frontvia_orders',{action:'recover',flowId});await delay(100);
    }
    assert(view.order?.id,'Approved purchase must resolve to its original order');
    assert.equal((await facts('after-confirm')).orders,1);
    console.log(JSON.stringify({status:'passed',case:'real-cart-quote-public-once-approval-original-order',
      ordersBeforeApproval:0,ordersAfterApproval:1,currency:review.quote.totals.grand_total.currency,
      boundary:'Actual Native Mock store; owner endpoint and user decision driven by the test operator, not a browser or real payment channel.'}));
    if(commerce.consultation){
      stage='same_domain_consultation';
      const operations=await customerContext.get('pap').acquireBusiness(customerContext).operations();
      assert(operations.ok);
      const commerceOperation=operations.value.find(operation=>operation.operationId==='commerce.products.search');
      const consultationOperation=operations.value.find(operation=>operation.operationId==='consultation.messages.submit');
      assert(commerceOperation&&consultationOperation);
      assert.equal(commerceOperation.companyRef,consultationOperation.companyRef);
      let conversation=await execute('frontvia_consultation',{action:'ask',flowId,text:'请说出当前店内商品的名称，以及它的交付方式；没有公开资料的内容不要编造。'});
      const consultationFlow=conversation.flowId;
      const deadline=Date.now()+90000;
      while(Date.now()<deadline){
        conversation=await execute('frontvia_consultation',{action:'get',flowId:consultationFlow});
        if(conversation.data.messages?.some(message=>message.actor==='agent'&&message.text))break;
        for(const pointer of conversation.data.prepared_answers??[]){
          if(pointer.answerRef)await execute('frontvia_consultation',{action:'answer_accept',flowId:consultationFlow,answerRef:pointer.answerRef});
        }
        await delay(500);
      }
      assert(conversation.data.messages?.some(message=>message.actor==='agent'&&message.text),'Actual consultation must answer');
      const observed=await facts('after-consultation');
      assert(observed.consultationModelCalls>0,'The public runtime must actually call the configured model');
      assert.equal(observed.orders,1,'Consultation must not place another order');
      console.log(JSON.stringify({status:'passed',case:'same-domain-shopping-and-real-consultation-without-knowledge',modelCalls:observed.consultationModelCalls,
        boundary:'Actual published PublicConsultation runtime and DeepSeek; no Knowledge service and no real payment channel.'}));
    }
    if(commerce.suite==='system'){
      stage='pap03_system_interfaces';
      const {checkInterfaces}=await import(pathToFileURL(resolve(root,'../frontvia-core/platform/tests/system/pap03/interfaces.mjs')).href);
      await checkInterfaces({commerce,transport:nativeTransport,publications});
    }
    stage='real_protocol_replay_and_signature';
    const sdk=customerContext.get('pap').acquireBusiness(customerContext);
    const catalogOperations=await sdk.operations();assert(catalogOperations.ok);
    const catalogOperation=catalogOperations.value.find(operation=>operation.operationId==='commerce.products.search');
    const fresh=await sdk.request({operationRef:catalogOperation.operationRef,query:{params:'{}'}});assert(fresh.ok);
    assert(lastCatalogRequest);
    const replay=await nativeTransport.request(lastCatalogRequest.url,lastCatalogRequest.options);
    assert.equal(replay.status,400);
    assert.equal(JSON.parse(Buffer.from(replay.body).toString()).error,'invalid_session');
    const changed={...lastCatalogRequest.options,headers:{...lastCatalogRequest.options.headers}};
    const sessionHeader=Object.keys(changed.headers).find(name=>name.toLowerCase()==='poppy-session');
    const parts=changed.headers[sessionHeader].split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    changed.headers[sessionHeader]=parts.join('.');
    const malformed=await nativeTransport.request(lastCatalogRequest.url,changed);
    assert.equal(malformed.status,400);
    assert.equal(JSON.parse(Buffer.from(malformed.body).toString()).error,'invalid_session');
    const selection=await identity.defaultIdentity(managerContext);
    await identity.configureDefaultIdentity(managerContext,{expectedVersion:selection.version,identity:null});
    const denied=await routes.get('/api/frontvia-customer/view').fetch(new Request('http://localhost/api/frontvia-customer/view',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method:'frontvia-customer/view',payload:{sessionId:'pap03-core-chat',flowId}})}));
    const deniedBody=await denied.json();assert.equal(deniedBody.result.ok,false);assert.equal(deniedBody.result.error.code,'PERSONAL_ACCOUNT_CHANGED');
    console.log(JSON.stringify({status:'passed',case:'real-native-proof-replay-signature-and-identity-epoch-fences',
      boundary:'Fresh Native Session proof replay and tampered signature rejected; changed default-identity epoch cannot read the old Customer flow.'}));
    }
  }
}catch(error){
  process.exitCode=1;
  const message=String(error?.message??'');
  console.log(JSON.stringify({status:'failed',stage,error:error?.code??error?.name,
    ...( /^[a-z][a-z0-9_]+$/i.test(message)?{reason:message}:{}),
    stackFrames:String(error?.stack??'').split('\n').slice(1,5).map(line=>line.trim())}));
}finally{
  if(publisher)await new Promise(resolve=>publisher.close(resolve));
  await fixture?.dispose();
  hooks.deregister();
  console.log(JSON.stringify({stage:'test_runtime_cleanup',status:'passed',identity:'protected-dedicated-awiki-me-identity-retained'}));
}
