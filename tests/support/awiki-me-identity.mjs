import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Registry from '@deepseek-ai/dsh-typert-registry';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import Identity from '@agent-network-protocol/dsh-anp-identity';
import * as Provider from '@agent-network-protocol/dsh-anp-identity/provider';
import Manager from '@agent-network-protocol/dsh-anp-identity/management-remote';
import * as Bootstrap from '@agent-network-protocol/dsh-anp-identity/protocol-bootstrap';
import {mkdir,mkdtemp,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

const SERVICE='@agent-network-protocol/dsh-anp-identity';
const MANAGER=SERVICE+'/management-remote';
const PROVIDER=SERVICE+'/provider';

/** Real public User Service. Retain only the dedicated encrypted test identity, not run artifacts. */
export async function awikiMeIdentity(){
  const authFile=process.env.FRONTVIA_IDENTITY_TEST_AUTH_FILE??resolve('.local/identity/awiki-me/auth.json');
  assert(authFile,'Protected awiki.me test authentication input is required');
  const input=await lstat(authFile);
  assert(input.isFile()&&!input.isSymbolicLink()&&(input.mode&0o077)===0&&input.uid===process.getuid(),'Test authentication input must be an owner-only regular file');
  const auth=JSON.parse(await readFile(authFile,'utf8'));
  assert.equal(auth.origin,'https://awiki.me');
  assert(/^\+[1-9][0-9]{6,14}$/.test(auth.phone)&&/^[0-9]{6}$/.test(auth.code));
  const persistent=resolve(process.env.FRONTVIA_IDENTITY_TEST_STATE??'.local/identity/awiki-me');
  await mkdir(persistent,{recursive:true,mode:0o700});
  const identityRoot=join(persistent,'identity'),credentialsFile=join(persistent,'.credentials.yaml');
  const root=await mkdtemp(join(tmpdir(),'frontvia-live-identity-'));
  const enrollment=join(persistent,'enrollment.json');
  let seed;
  try{seed=JSON.parse(await readFile(enrollment,'utf8'));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const suffix=randomBytes(5).toString('hex');
    seed={handle:'systestmd'+suffix,requestId:'frontvia-awiki-me-'+suffix,path:'/awiki/user/frontvia'+randomBytes(12).toString('hex')};
    await writeFile(enrollment,JSON.stringify(seed),{flag:'wx',mode:0o600});
  }
  const registration={id:'frontvia-live-phone',requestId:seed.requestId,stateRoot:join(persistent,'bootstrap'),origin:auth.origin,
    phone:auth.phone,clientName:'Frontvia dedicated PAP test identity',capabilities:{mcpMachine:false,papSession:true,papAccount:false},redirectUris:[],pollIntervalMs:200};
  let ctx,remote,managerContext,reference,materials,disposed=false;
  const observations={signedDeviceRequests:0,deviceAuthorizationRequests:0};
  const originalFetch=globalThis.fetch;
  const transport=async(input,init)=>{
    const request=new Request(input,init);
    if(new URL(request.url).origin===auth.origin){
      if(request.headers.has('signature-input')&&request.headers.has('signature'))observations.signedDeviceRequests++;
      if(new URL(request.url).pathname.includes('/agent-clients/device/')&&request.headers.get('authorization')?.startsWith('Bearer '))observations.deviceAuthorizationRequests++;
    }
    return originalFetch(request);
  };
  globalThis.fetch=transport;
  const until=async(read,accept,timeout=90000)=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const value=await read();if(accept(value))return value;await delay(100);}
    throw Error('live_identity_phase_timeout');
  };
  const manager=()=>managerContext.get('anpIdentity').acquireManagement(managerContext);
  const status=()=>remote.registrationBootstrapStatus()[0];
  const start=async(extra={})=>{
    ctx=new Context();await ctx.plugin(Registry);await ctx.plugin(Loader);
    const modules={[SERVICE]:Identity,[PROVIDER]:Provider,[MANAGER]:Manager,[Bootstrap.PROTOCOL_BOOTSTRAP_CONSUMER]:Bootstrap,
      '@deepseek-ai/dsh-credentials-local':Credentials,...extra.modules};
    ctx.loader.import=name=>{assert(Object.hasOwn(modules,name),'Unknown live test module');return modules[name];};
    await ctx.loader.create({name:'@deepseek-ai/dsh-credentials-local',config:{path:credentialsFile,watch:false}});
    await ctx.loader.create({name:SERVICE,config:{stateRoot:identityRoot,allowConsumers:[Bootstrap.PROTOCOL_BOOTSTRAP_CONSUMER],userConsumers:[Bootstrap.PROTOCOL_BOOTSTRAP_CONSUMER]}});
    await ctx.loader.create({name:PROVIDER,config:{stateRoot:identityRoot,rootKeyProvider:'local-file'}});
    await ctx.loader.await();
    await until(()=>ctx.get('anpIdentity').health(),v=>v.status==='ready');
    await ctx.loader.create({name:MANAGER,config:{registrationBootstrap:registration}});
    await ctx.loader.create({name:Bootstrap.PROTOCOL_BOOTSTRAP_CONSUMER,config:{requestId:seed.requestId,profile:'e1',identityOnly:true,label:'Frontvia awiki.me test',
      domain:'awiki.me',path:seed.path,handle:seed.handle+'.awiki.me'}});
    await ctx.loader.await();
    managerContext=[...ctx.loader.entries()].find(e=>e.options.name===MANAGER).fiber.ctx;
    remote=ctx.get('anpIdentityManager');
    for(const entry of extra.entries??[])await ctx.loader.create(entry);
    await ctx.loader.await();
  };
  const readPublished=async()=>{
    const view=await until(status,v=>v?.phase==='published');reference=view.reference;assert(reference&&view.clientId);
    const reply=await originalFetch(view.clientId,{redirect:'error'});assert.equal(reply.status,200);
    const metadata=await reply.text(),document=JSON.parse(metadata);
    assert.equal(document.client_id,view.clientId);assert.equal(new URL(document.client_id).origin,auth.origin);
    const jwks=await originalFetch(document.jwks_uri,{redirect:'error'});assert.equal(jwks.status,200);
    materials={metadata,jwks:await jwks.text()};
  };
  try{
    await start();
    const view=await until(status,v=>v?.phase);
    if(view.phase==='awaiting_approval'){
      const review=await manager().getRequest(seed.requestId);
      if(review.request.status==='pending')await manager().decide({requestId:seed.requestId,expectedVersion:review.request.version,decision:'approve'});
    }
    const phase=await until(status,v=>['awaiting_phone_verification','published','blocked','registration_uncertain'].includes(v?.phase));
    if(phase.phase==='awaiting_phone_verification')await remote.submitRegistrationOtp({code:auth.code});
    else assert.equal(phase.phase,'published','Live registration blocked; retain original identity state for reconciliation');
    await readPublished();
    return {
      root,identityRoot,credentialsFile,origin:auth.origin,get ctx(){return ctx;},get publicRef(){return reference;},get publicMaterials(){return materials;},
      evidence:{observations,excludesInternalCredentials(value){
        const visit=v=>!v||typeof v!=='object'||Object.entries(v).every(([key,item])=>!['access_token','refresh_token','otp_code','private_key','d','k'].includes(key)&&visit(item));
        return visit(value)&&!JSON.stringify(value).includes(auth.phone);
      }},
      async reopen(extra={}){await ctx.fiber.dispose();await start(extra);await readPublished();return ctx;},
      async dispose(){if(disposed)return;disposed=true;try{await ctx?.fiber.dispose();}finally{globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}},
    };
  }catch(error){await ctx?.fiber.dispose();globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});throw error;}
}
