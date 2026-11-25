import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {mkdir,readFile,writeFile,symlink,readdir,open,cp} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {publicIdentityPackage,publicPapPackage} from '../../support/public-pap.mjs';

/** Scope the browser's CONNECT tunnel to the isolated HTTPS peer. */
async function checkoutBrowserProxy(origin){
  const target=new URL(origin);
  assert.equal(target.protocol,'https:');
  assert.equal(target.hostname,'company-a.test');
  const port=Number(target.port);
  assert(Number.isSafeInteger(port)&&port>0&&port<=65535);
  const sockets=new Set();
  const server=createServer((_request,response)=>{response.writeHead(403);response.end();});
  server.on('connect',(request,downstream,head)=>{
    if(request.url!==target.host){
      downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream=connect(port,'127.0.0.1',()=>{
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
    sockets.add(downstream);
    downstream.on('error',()=>upstream.destroy());
    downstream.on('close',()=>{sockets.delete(downstream);upstream.destroy();});
    upstream.on('error',()=>downstream.destroy());
    upstream.on('close',()=>downstream.destroy());
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {
    options:{server:'http://127.0.0.1:'+server.address().port,bypass:'127.0.0.1,localhost'},
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    },
  };
}

/** Full DSH CLI/Web process and browser; no mocked Context or connection owner. */
export async function runDsh({fixture,commerce,root}){
  const started=performance.now();
  const selectedPap=publicPapPackage(),selectedIdentity=publicIdentityPackage();
  const host=JSON.parse(await readFile(join(root,'node_modules/@deepseek-ai/dsh/package.json'),'utf8'));
  const customer=JSON.parse(await readFile(join(root,'packages/customer/package.json'),'utf8'));
  const supportedHosts=customer.engines.dsh.split('||').map(version=>version.trim());
  assert(supportedHosts.includes(host.version),`DSH ${host.version} is outside the pinned Customer host range`);
  const fullFlow=commerce.suite==='dsh-ucp-full';
  const ucp=commerce.suite==='dsh-ucp'||fullFlow;
  const suite=fullFlow?'dsh-ucp-full-e2e':ucp?'dsh-ucp-e2e':'dsh-e2e';
  console.log(JSON.stringify({suite,nodeVersion:process.version,dshVersion:host.version,papVersion:selectedPap.version,papSource:selectedPap.source,
    identityVersion:selectedIdentity.version,identitySource:selectedIdentity.source,nativeVersion:selectedIdentity.nativeVersion}));
  const home=join(fixture.root,'dsh-home'),profile=join(home,'profiles','frontvia-e2e');
  await mkdir(join(profile,'node_modules'),{recursive:true,mode:0o700});
  const modules=join(profile,'node_modules');
  for(const name of await readdir(join(root,'node_modules'))){
    if(name.startsWith('.')||name==='@awiki'||name==='@agent-network-protocol'&&selectedIdentity.source==='explicit-local')continue;
    await symlink(join(root,'node_modules',name),join(modules,name));
  }
  await mkdir(join(modules,'@awiki'),{recursive:true});
  // Install the exact local archives into the private profile, never the user's profile.
  const packs=JSON.parse(await readFile(join(root,'.local/packages/manifest.json'),'utf8'));
  assert.equal(packs.artifacts.find(a=>a.name==='@awiki/dsh-pap')?.version,selectedPap.version);
  assert.equal(packs.papSource,selectedPap.source,'Repack after changing the PAP test source');
  assert.equal(packs.papRoot,selectedPap.root,'Repack after changing the PAP candidate root');
  assert.equal(packs.identitySource,selectedIdentity.source,'Repack after changing the Identity test source');
  assert.equal(packs.identityRoot,selectedIdentity.root,'Repack after changing the Identity candidate root');
  assert.equal(packs.identityArtifact?.version,selectedIdentity.version);
  assert.equal(packs.nativeIdentityVersion,selectedIdentity.nativeVersion);
  const identityName='@agent-network-protocol/dsh-anp-identity';
  const archives=selectedIdentity.source==='explicit-local'?[...packs.artifacts,packs.identityArtifact]:packs.artifacts;
  const dependencies={[identityName]:packs.identityVersion};
  for(const artifact of archives){
    const target=join(modules,artifact.name);await mkdir(target,{recursive:true});
    assert.equal(createHash('sha256').update(await readFile(artifact.path)).digest('hex'),artifact.sha256);
    execFileSync('tar',['-xzf',artifact.path,'-C',target,'--strip-components=1']);
    const dependencyRoot=artifact.name==='@awiki/dsh-pap'?selectedPap.dependencyRoot
      :artifact.name===identityName?selectedIdentity.dependencyRoot:join(root,'node_modules');
    await symlink(dependencyRoot,join(target,'node_modules'));
    dependencies[artifact.name]='file:'+artifact.path;
  }
  const serviceEntry=[...fixture.ctx.loader.entries()].find(e=>e.options.name==='@agent-network-protocol/dsh-anp-identity');
  const identitySeedRoot=serviceEntry.options.config.stateRoot;
  let identityHostRoot=identitySeedRoot;
  if(!ucp){
    const managerEntry=[...fixture.ctx.loader.entries()].find(e=>e.options.name==='@agent-network-protocol/dsh-anp-identity/management-remote');
    const context=managerEntry.fiber.ctx,identity=context.get('anpIdentity');
    const selection=await identity.defaultIdentity(context);
    await identity.configureDefaultIdentity(context,{expectedVersion:selection.version,identity:fixture.publicRef});
    const permissions=await identity.protocolManagement(context),rule={mode:'allow_all',outside:'ask',domains:[]};
    await identity.configureProtocolPolicy(context,{expectedVersion:permissions.policy.version,policy:{read:rule,write:rule}});
  }
  if(!ucp){
    identityHostRoot=join(fixture.root,'dsh-identity-host');
    await mkdir(identityHostRoot,{mode:0o700});
    // Keep the published identity and owner settings while giving this browser
    // its own PAP connections and authorization ledger.
    await writeFile(join(identityHostRoot,'catalog-v1.json'),
      await readFile(join(identitySeedRoot,'catalog-v1.json')),{mode:0o600});
    await cp(join(identitySeedRoot,'manager-settings'),join(identityHostRoot,'manager-settings'),{recursive:true});
  }
  const identityConfig={...serviceEntry.options.config,stateRoot:identityHostRoot,allowConsumers:[...(serviceEntry.options.config.allowConsumers??[]),'@awiki/dsh-pap/plugin'],
    userConsumers:[...(serviceEntry.options.config.userConsumers??[]),'@awiki/dsh-pap/plugin'],domainAccess:{enabled:true,identity:fixture.publicRef,scopes:[],secretStore:'local-file'}};
  await fixture.ctx.fiber.dispose();
  const network=join(modules,'frontvia-e2e-network');await mkdir(network);
  await writeFile(join(network,'package.json'),JSON.stringify({name:'frontvia-e2e-network',version:'0.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
  await writeFile(join(network,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'frontvia-e2e-network',name:join(root,'tests/e2e/dsh/network.mjs'),config:{ca:commerce.ca,origin:commerce.origin,transportModule:selectedPap.transportModule,ucpPlatformProfileUrl:commerce.ucpPlatformProfileUrl,liveStore:commerce.liveStore===true}}]}]));
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'frontvia-e2e-profile',private:true,dependencies,
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','frontvia-e2e-network','@deepseek-ai/dsh-web-app','@agent-network-protocol/dsh-anp-identity','@awiki/dsh-pap','dsh-frontvia-customer']}}}));
  const customerConfig=join(fixture.root,'dsh-customer.json');
  await writeFile(customerConfig,JSON.stringify({dataDir:join(fixture.root,'dsh-customer'),storageKeyRef:'FRONTVIA_E2E_STATE',sites:[]}),{mode:0o600});
  const patch=[{id:'anp-identity',config:identityConfig},{id:'anp-identity-provider',config:{stateRoot:fixture.identityRoot??join(fixture.root,'identity'),rootKeyProvider:'local-file'}},
    {id:'anp-identity-manager',config:{}},{id:'anp-identity-protocol-bootstrap',disabled:true},
    // The UCP domain probe already connected through the published PAP plugin.
    // Reopen its private state after disposing the probe host so the browser
    // starts from the same real connection and owner rather than an empty list.
    {id:'pap',config:{enabled:true,autoConnect:true,stateRoot:join(fixture.root,ucp?'pap':'dsh-pap'),businessConsumers:['dsh-frontvia-customer'],
      ...(ucp?{ucpPlatformProfileUrl:commerce.ucpPlatformProfileUrl}:{})}},
    {id:'dsh-frontvia-customer',config:{configFile:customerConfig}},{id:'credentials',config:{path:fixture.credentialsFile??join(fixture.root,'.credentials.yaml'),watch:false}}];
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify(patch),{mode:0o600});
  const workspace=join(fixture.root,'workspace');await mkdir(workspace);
  const logPath=join(fixture.root,'dsh.log');const log=await open(logPath,'w',0o600);
  const child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','frontvia-e2e','--host','127.0.0.1','--port','0','--no-open'],
    {cwd:workspace,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore',log.fd,log.fd]});
  await log.close();
  let browser,browserProxy,checkpoint='start';
  try{
    let url;const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      assert.equal(child.exitCode,null,'DSH process exited during startup');
      const output=await readFile(logPath,'utf8');
      url=output.match(/http:\/\/127\.0\.0\.1:\d+(?:\/[^\s\x1b]*)?/u)?.[0];
      // The printed URL carries a one-use owner bootstrap code. Only the browser may open it.
      if(url)break;
      await delay(200);
    }
    assert(url,'DSH Web did not advertise its URL');
    const core=process.env.FRONTVIA_CORE_ROOT??resolve(root,'../frontvia-core');
    assert(isAbsolute(core),'Core candidate root must be absolute');
    const require=createRequire(join(core,'web/package.json'));
    const {chromium}=require('playwright-core');
    const args=['--no-sandbox'];
    if(fullFlow&&!commerce.liveStore){
      const certificate=new X509Certificate(await readFile(commerce.cert));
      const spki=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
      args.push(`--ignore-certificate-errors-spki-list=${spki}`);
      browserProxy=await checkoutBrowserProxy(commerce.origin);
    }
    const executablePath=process.env.CHROMIUM_PATH;
    browser=await chromium.launch({headless:true,args,...(executablePath?{executablePath}:{}),...(browserProxy?{proxy:browserProxy.options}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-US'});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    // A fresh profile always has the preview notice; late client startup must
    // not leave it covering the shopping entry after a short optional wait.
    checkpoint='preview-notice';
    const preview=page.getByRole('dialog',{name:/^(?:Preview Notice|Internal Testing Notice|预览版说明)$/});
    await preview.waitFor({state:'visible',timeout:60000});
    await preview.getByRole('button',{name:/^(?:Continue|继续|同意并继续|我已了解|我已知晓)$/}).click();
    await preview.waitFor({state:'hidden'});
    const keyDialog=page.getByRole('dialog',{name:/^(?:Add an API key to get started|添加 API 密钥以开始使用)$/});
    await page.addLocatorHandler(keyDialog,async()=>{
      await keyDialog.getByRole('button',{name:/^(?:Configure later|稍后配置)$/}).click();
    });
    checkpoint='open-frontvia';
    await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
    checkpoint='storefront';
    if(ucp){
      if(fullFlow){
        const {readUcpAftersales,shopUcpFullFlow}=await import('./ucp-full-flow.mjs');
        await (commerce.existingAftersales?readUcpAftersales:shopUcpFullFlow)({page,commerce,logPath});
      }else{
        const {shopUcp}=await import('./ucp-shopping.mjs');
        await shopUcp({page,commerce,logPath});
      }
      return;
    }
    await page.getByText('提供店铺域名即可开始',{exact:true}).waitFor({state:'visible',timeout:30000});
    console.log(JSON.stringify({suite:'dsh-e2e',case:'DSH-001-real-web-empty-merchants',status:'passed',durationMs:Math.round(performance.now()-started)}));
    // Continue through user-visible chat and business cards in the product suite.
    const {shopping}=await import('./shopping.mjs');
    await shopping({page,commerce,workspace});
  }catch(error){
    const failedPage=browser?.contexts()[0]?.pages()[0];
    if(failedPage){
      const alerts=(await failedPage.getByRole('alert').allTextContents()).flatMap(text=>text.match(/\b[a-zA-Z][a-zA-Z_]{2,60}_[a-zA-Z_]{2,40}\b/g)??[]);
      console.log(JSON.stringify({suite,case:'browser-failure-context',checkpoint,buttonCount:await failedPage.getByRole('button').count(),headings:await failedPage.getByRole('heading').allTextContents(),
        dialogs:await failedPage.getByRole('dialog').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')??document.getElementById(node.getAttribute('aria-labelledby'))?.textContent)),
        dialogButtons:await failedPage.getByRole('dialog').getByRole('button').allTextContents(),
        alerts:[...new Set(alerts)].slice(0,12)}));
    }
    const output=await readFile(logPath,'utf8');
    for(const line of output.split('\n').filter(line=>line.startsWith('{"event":"frontvia-e2e-http"')).slice(-12))console.log(line);
    // Emit fixed loader diagnostics, never the log's URLs, credentials or user data.
    console.log(JSON.stringify({suite,status:'failed',code:error.name,
      loaderFailures:[...output.matchAll(/(?:Cannot find (?:package|module)|ERR_[A-Z_]+|INCOMPATIBLE[^\s]*)[^\n]*/g)].map(v=>v[0].slice(0,240)).slice(-8)}));
    throw error;
  }finally{
    try{await browser?.close();}finally{await browserProxy?.close();}
    if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(10000)]);if(child.exitCode===null){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}}
  }
}
