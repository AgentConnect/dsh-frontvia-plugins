import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const require=createRequire(new URL('../../package.json',import.meta.url));

/** Registry dependencies by default; source candidates require an explicit opt-in. */
export function publicPapPackage(environment=process.env){
  const candidate=environment.FRONTVIA_PAP_TEST_PACKAGE_ROOT;
  if(candidate!==undefined)assert(isAbsolute(candidate),'PAP candidate root must be an absolute path');
  const root=realpathSync(candidate??dirname(require.resolve('@awiki/dsh-pap/package.json')));
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.name,'@awiki/dsh-pap','Unexpected PAP package');
  assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version),'Invalid PAP package version');
  for(const entry of ['plugin.js','product-api.js','network.js'])
    assert(existsSync(join(root,'lib',entry)),'Build the selected PAP candidate before testing');
  if(candidate===undefined){
    assert(root.split(sep).includes('node_modules'),'Registry mode must not resolve a linked source checkout');
    assert.equal(manifest.version,require('./package.json').devDependencies['@awiki/dsh-pap']);
  }
  return {root,version:manifest.version,source:candidate===undefined?'registry':'explicit-local',
    dependencyRoot:existsSync(join(root,'node_modules'))?join(root,'node_modules'):resolve(root,'../..'),
    // The bounded TLS transport is used only by test peers, never by Customer.
    transportModule:join(root,'lib/network.js')};
}

export async function loadPublicPap(){
  const selected=publicPapPackage();
  const plugin=await import(pathToFileURL(join(selected.root,'lib/plugin.js')).href);
  const {SafeHttpsTransport}=await import(pathToFileURL(selected.transportModule).href);
  return {...selected,plugin,SafeHttpsTransport};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const selected=publicPapPackage();
  console.log(JSON.stringify({package:'@awiki/dsh-pap',version:selected.version,source:selected.source,
    identityVersion:require('@agent-network-protocol/dsh-anp-identity/package.json').version}));
}
