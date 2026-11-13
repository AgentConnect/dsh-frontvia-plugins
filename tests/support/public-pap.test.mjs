import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {publicPapPackage} from './public-pap.mjs';

test('PAP tests select the installed registry package without a sibling checkout',()=>{
  const selected=publicPapPackage({});
  assert.equal(selected.source,'registry');
  assert.equal(selected.version,'0.1.6');
  assert(selected.root.includes('node_modules/'));
  assert(selected.transportModule.startsWith(selected.root+'/lib/'));
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
    assert.equal(selected.dependencyRoot,join(root,'node_modules'));
  }finally{rmSync(root,{recursive:true});}
});
