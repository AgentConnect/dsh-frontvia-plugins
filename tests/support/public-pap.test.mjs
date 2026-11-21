import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {publicIdentityPackage,publicPapPackage} from './public-pap.mjs';
import {assertPapPackage} from '../../scripts/package-inputs.mjs';

test('PAP tests select the installed locked package without a sibling checkout',()=>{
  const selected=publicPapPackage({});
  assert.ok(['git','registry'].includes(selected.source));
  assert.equal(selected.version,'0.2.3');
  assert(selected.root.includes('node_modules/'));
  assert(selected.transportModule.startsWith(selected.root+'/lib/'));
});

test('UCP packaging and installation require the PDF and UCP operations at the locked version', () => {
  const selected = publicPapPackage({});
  assert.throws(() => assertPapPackage({name:'@awiki/dsh-pap', version:selected.version}, selected.version),
    /verified PDF downloads/);
  const candidate = {name:'@awiki/dsh-pap', version:selected.version, dshPapUcpOperations:['get_store_context']};
  assert.throws(() => assertPapPackage(candidate, selected.version), /verified PDF downloads/);
  candidate.dshPapUcpOperations.push('list_orders');
  assert.throws(() => assertPapPackage(candidate, '0.2.0'), /verified PDF downloads/);
  assert.throws(() => assertPapPackage(candidate, selected.version), /verified PDF downloads/);
  candidate.dshPapUcpOperations.push('commerce.orders.file');
  assert.doesNotThrow(() => assertPapPackage(candidate, selected.version));
});

test('an explicit missing, relative or wrong PAP candidate never falls back to registry',()=>{
  assert.throws(()=>publicPapPackage({FRONTVIA_PAP_TEST_PACKAGE_ROOT:'../dsh-pap'}));
  const root=mkdtempSync(join(tmpdir(),'frontvia-pap-selection-'));
  try{
    assert.throws(()=>publicPapPackage({FRONTVIA_PAP_TEST_PACKAGE_ROOT:join(root,'missing')}));
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'other-package',version:'0.1.6'}));
    assert.throws(()=>publicPapPackage({FRONTVIA_PAP_TEST_PACKAGE_ROOT:root}));
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'@awiki/dsh-pap',version:'0.1.7'}));
    assert.throws(()=>publicPapPackage({FRONTVIA_PAP_TEST_PACKAGE_ROOT:root}));
    mkdirSync(join(root,'lib'));mkdirSync(join(root,'node_modules'));
    for(const entry of ['plugin.js','product-api.js','network.js'])writeFileSync(join(root,'lib',entry),'export {};');
    const selected=publicPapPackage({FRONTVIA_PAP_TEST_PACKAGE_ROOT:root});
    assert.equal(selected.source,'explicit-local');assert.equal(selected.version,'0.1.7');
    assert.equal(selected.dependencyRoot,realpathSync(join(root,'node_modules')));
  }finally{rmSync(root,{recursive:true});}
});

test('Identity defaults to the locked registry package and validates explicit candidate roots',()=>{
  const selected=publicIdentityPackage({});
  assert.equal(selected.source,'registry');
  assert.equal(selected.version,'0.1.18');
  assert.equal(selected.nativeVersion,'0.2.6');
  assert.throws(()=>publicIdentityPackage({FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT:'../anp-identity'}));
  assert.throws(()=>publicIdentityPackage({FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT:selected.root}));
  assert.throws(()=>publicIdentityPackage({FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT:publicPapPackage({}).root}));
  const root=mkdtempSync(join(tmpdir(),'frontvia-identity-selection-'));
  try{
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'@agent-network-protocol/dsh-anp-identity',version:'0.1.17'}));
    assert.throws(()=>publicIdentityPackage({FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT:root}));
  }finally{rmSync(root,{recursive:true});}
});
