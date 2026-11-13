import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,symlink,readdir,open,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {publicPapPackage} from '../../support/public-pap.mjs';

/** Full DSH CLI/Web process and browser; no mocked Context or connection owner. */
export async function runDsh({fixture,commerce,root}){
  const started=performance.now();
  const selectedPap=publicPapPackage();
  console.log(JSON.stringify({suite:'dsh-e2e',papVersion:selectedPap.version,papSource:selectedPap.source}));
  const home=join(fixture.root,'dsh-home'),profile=join(home,'profiles','frontvia-e2e');
  await mkdir(join(profile,'node_modules'),{recursive:true,mode:0o700});
  const modules=join(profile,'node_modules');
  for(const name of await readdir(join(root,'node_modules'))){
    if(name.startsWith('.')||name==='@awiki')continue;
    await symlink(join(root,'node_modules',name),join(modules,name));
  }
  await mkdir(join(modules,'@awiki'),{recursive:true});
  // Install the exact local archives into the private profile, never the user's profile.
  const packs=JSON.parse(await readFile(join(root,'.local/packages/manifest.json'),'utf8'));
  assert.equal(packs.artifacts.find(a=>a.name==='@awiki/dsh-pap')?.version,selectedPap.version);
  assert.equal(packs.papSource,selectedPap.source,'Repack after changing the PAP test source');
  assert.equal(packs.papRoot,selectedPap.root,'Repack after changing the PAP candidate root');
  for(const artifact of packs.artifacts){
    const target=join(modules,artifact.name);await mkdir(target,{recursive:true});
    const {createHash}=await import('node:crypto');
    assert.equal(createHash('sha256').update(await readFile(artifact.path)).digest('hex'),artifact.sha256);
    execFileSync('tar',['-xzf',artifact.path,'-C',target,'--strip-components=1']);
    const dependencyRoot=artifact.name==='@awiki/dsh-pap'?selectedPap.dependencyRoot:join(root,'node_modules');
    await symlink(dependencyRoot,join(target,'node_modules'));
  }
  const serviceEntry=[...fixture.ctx.loader.entries()].find(e=>e.options.name==='@agent-network-protocol/dsh-anp-identity');
  const managerEntry=[...fixture.ctx.loader.entries()].find(e=>e.options.name==='@agent-network-protocol/dsh-anp-identity/management-remote');
  const identity=managerEntry.fiber.ctx.get('anpIdentity');
  const selection=await identity.defaultIdentity(managerEntry.fiber.ctx);
  await identity.configureDefaultIdentity(managerEntry.fiber.ctx,{expectedVersion:selection.version,identity:fixture.publicRef});
  const permissions=await identity.protocolManagement(managerEntry.fiber.ctx);
  const rule={mode:'allow_all',outside:'ask',domains:[]};
  await identity.configureProtocolPolicy(managerEntry.fiber.ctx,{expectedVersion:permissions.policy.version,policy:{read:rule,write:rule}});
  const identityHostRoot=join(fixture.root,'dsh-identity-host');
  await mkdir(identityHostRoot,{mode:0o700});
  // Reuse the published identity and its native custody, but isolate the Host's
  // public catalog/preferences so this fresh profile has no prior PAP sessions.
  await writeFile(join(identityHostRoot,'catalog-v1.json'),
    await readFile(join(serviceEntry.options.config.stateRoot,'catalog-v1.json')),{mode:0o600});
  await cp(join(serviceEntry.options.config.stateRoot,'manager-settings'),join(identityHostRoot,'manager-settings'),{recursive:true});
  const identityConfig={...serviceEntry.options.config,stateRoot:identityHostRoot,allowConsumers:[...(serviceEntry.options.config.allowConsumers??[]),'@awiki/dsh-pap/plugin'],
    userConsumers:[...(serviceEntry.options.config.userConsumers??[]),'@awiki/dsh-pap/plugin'],domainAccess:{enabled:true,identity:fixture.publicRef,scopes:[],secretStore:'local-file'}};
  await fixture.ctx.fiber.dispose();
  const network=join(modules,'frontvia-e2e-network');await mkdir(network);
  await writeFile(join(network,'package.json'),JSON.stringify({name:'frontvia-e2e-network',version:'0.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
  await writeFile(join(network,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'frontvia-e2e-network',name:join(root,'tests/e2e/dsh/network.mjs'),config:{ca:commerce.ca,origin:commerce.origin,transportModule:selectedPap.transportModule}}]}]));
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'frontvia-e2e-profile',private:true,dependencies:{'@agent-network-protocol/dsh-anp-identity':packs.identityVersion,'@awiki/dsh-pap':'file:'+packs.artifacts.find(a=>a.name==='@awiki/dsh-pap').path,'dsh-frontvia-customer':'file:'+packs.artifacts.find(a=>a.name==='dsh-frontvia-customer').path},
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','frontvia-e2e-network','@deepseek-ai/dsh-web-app','@agent-network-protocol/dsh-anp-identity','@awiki/dsh-pap','dsh-frontvia-customer']}}}));
  const customerConfig=join(fixture.root,'dsh-customer.json');
  await writeFile(customerConfig,JSON.stringify({dataDir:join(fixture.root,'dsh-customer'),storageKeyRef:'FRONTVIA_E2E_STATE',sites:[]}),{mode:0o600});
  const patch=[{id:'anp-identity',config:identityConfig},{id:'anp-identity-provider',config:{stateRoot:fixture.identityRoot??join(fixture.root,'identity'),rootKeyProvider:'local-file'}},
    {id:'anp-identity-manager',config:{}},{id:'anp-identity-protocol-bootstrap',disabled:true},
    {id:'pap',config:{enabled:true,autoConnect:true,stateRoot:join(fixture.root,'dsh-pap'),businessConsumers:['dsh-frontvia-customer']}},
    {id:'dsh-frontvia-customer',config:{configFile:customerConfig}},{id:'credentials',config:{path:fixture.credentialsFile??join(fixture.root,'.credentials.yaml'),watch:false}}];
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify(patch),{mode:0o600});
  const workspace=join(fixture.root,'workspace');await mkdir(workspace);
  const logPath=join(fixture.root,'dsh.log');const log=await open(logPath,'w',0o600);
  const child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','frontvia-e2e','--host','127.0.0.1','--port','0','--no-open'],
    {cwd:workspace,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore',log.fd,log.fd]});
  await log.close();
  let browser;
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
    const require=createRequire(join(root,'../frontvia-core/web/package.json'));
    const {chromium}=require('playwright-core');
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    // A fresh profile always has the preview notice; late client startup must
    // not leave it covering the shopping entry after a short optional wait.
    const preview=page.getByRole('dialog',{name:'Preview Notice'})
      .or(page.getByRole('dialog',{name:'Internal Testing Notice'}));
    await preview.waitFor({state:'visible',timeout:60000});
    await preview.getByRole('button',{name:'Continue',exact:true}).click();
    await preview.waitFor({state:'hidden'});
    const keyDialog=page.getByRole('dialog',{name:'Add an API key to get started'});
    await page.addLocatorHandler(keyDialog,async()=>{
      await keyDialog.getByRole('button',{name:'Configure later',exact:true}).click();
    });
    await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
    await page.getByText('提供店铺域名即可开始',{exact:true}).waitFor({state:'visible',timeout:30000});
    console.log(JSON.stringify({suite:'dsh-e2e',case:'DSH-001-real-web-empty-merchants',status:'passed',durationMs:Math.round(performance.now()-started)}));
    // Continue through user-visible chat and business cards in the product suite.
    const {shopping}=await import('./shopping.mjs');
    await shopping({page,commerce,workspace});
  }catch(error){
    const failedPage=browser?.contexts()[0]?.pages()[0];
    if(failedPage)console.log(JSON.stringify({suite:'dsh-e2e',case:'browser-failure-context',buttonCount:await failedPage.getByRole('button').count(),headings:await failedPage.getByRole('heading').allTextContents(),
      dialogs:await failedPage.getByRole('dialog').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')??document.getElementById(node.getAttribute('aria-labelledby'))?.textContent))}));
    const output=await readFile(logPath,'utf8');
    for(const line of output.split('\n').filter(line=>line.startsWith('{"event":"frontvia-e2e-http"')).slice(-12))console.log(line);
    // Emit fixed loader diagnostics, never the log's URLs, credentials or user data.
    console.log(JSON.stringify({suite:'dsh-e2e',status:'failed',code:error.name,
      loaderFailures:[...output.matchAll(/(?:Cannot find (?:package|module)|ERR_[A-Z_]+|INCOMPATIBLE[^\s]*)[^\n]*/g)].map(v=>v[0].slice(0,240)).slice(-8)}));
    throw error;
  }finally{
    await browser?.close();
    if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(10000)]);if(child.exitCode===null){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}}
  }
}
