import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const require=createRequire(new URL('../../package.json',import.meta.url));

function selectPackage(name,candidate,entries){
  if(candidate!==undefined)assert(isAbsolute(candidate),`${name} candidate root must be an absolute path`);
  const root=realpathSync(candidate??dirname(require.resolve(`${name}/package.json`)));
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.name,name,'Unexpected package');
  assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version),'Invalid package version');
  for(const entry of entries)
    assert(existsSync(join(root,'lib',entry)),`Build the selected ${name} package before testing`);
  if(candidate===undefined){
    assert(root.split(sep).includes('node_modules'),'Registry mode must not resolve a linked source checkout');
    assert.equal(manifest.version,require('./package.json').devDependencies[name]);
  }else assert(!root.split(sep).includes('node_modules'),'Source candidate must resolve outside node_modules');
  const dependencyRoot=existsSync(join(root,'node_modules'))?join(root,'node_modules'):resolve(root,'../..');
  return {root,version:manifest.version,source:candidate===undefined?'registry':'explicit-local',dependencyRoot};
}

/** Registry dependencies by default; source candidates require an explicit opt-in. */
export function publicPapPackage(environment=process.env){
  const selected=selectPackage('@awiki/dsh-pap',environment.FRONTVIA_PAP_TEST_PACKAGE_ROOT,['plugin.js','product-api.js','network.js']);
  return {...selected,
    // The bounded TLS transport is used only by test peers, never by Customer.
    transportModule:join(selected.root,'lib/network.js')};
}

export function publicIdentityPackage(environment=process.env){
  const selected=selectPackage('@agent-network-protocol/dsh-anp-identity',environment.FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT,
    ['index.js','provider.js','management-remote.js','protocol-bootstrap.js']);
  const packageRequire=createRequire(join(selected.root,'package.json'));
  const provider=packageRequire.resolve('@agent-network-protocol/anp-identity/provider');
  const nativeVersion=packageRequire(join(dirname(provider),'package.json')).version;
  const pinnedNative=packageRequire('./package.json').dependencies['@agent-network-protocol/anp-identity'];
  assert.equal(nativeVersion,pinnedNative,'Unexpected native Identity binding version');
  return {...selected,nativeVersion};
}

export async function loadPublicPap(){
  const selected=publicPapPackage();
  const plugin=await import(pathToFileURL(join(selected.root,'lib/plugin.js')).href);
  const {SafeHttpsTransport}=await import(pathToFileURL(selected.transportModule).href);
  return {...selected,plugin,SafeHttpsTransport};
}

export async function loadPublicIdentity(){
  const selected=publicIdentityPackage();
  const [plugin,provider,manager,bootstrap]=await Promise.all(
    ['index.js','provider.js','management-remote.js','protocol-bootstrap.js']
      .map(entry=>import(pathToFileURL(join(selected.root,'lib',entry)).href)));
  return {...selected,plugin,provider,manager,bootstrap};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const selected=publicPapPackage(),identity=publicIdentityPackage();
  console.log(JSON.stringify({package:'@awiki/dsh-pap',version:selected.version,source:selected.source,root:selected.root,
    identityVersion:identity.version,identitySource:identity.source,identityRoot:identity.root,nativeVersion:identity.nativeVersion}));
}
