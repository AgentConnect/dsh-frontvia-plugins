import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadCache} from '../src/read-cache.js';
test('display metadata shares reads for 30 seconds, expires, and never substitutes for fresh authority',async()=>{
 let now=0,calls=0;const cache=new ReadCache(30000,()=>now);
 const read=async()=>({revision:++calls});
 const values=await Promise.all(Array.from({length:5},()=>cache.get('account-a:resource:connection-1',read)));
 assert.equal(calls,1);values[0].revision=999;
 assert.equal((await cache.get('account-a:resource:connection-1',read)).revision,1);
 now=30000;assert.equal((await cache.get('account-a:resource:connection-1',read)).revision,2);
 assert.equal((await cache.get('account-b:resource:connection-1',read)).revision,3);
 assert.equal((await cache.get('account-b:resource:connection-1',read,true)).revision,4);
 await assert.rejects(cache.get('account-b:resource:connection-1',async()=>{throw Error('revoked');}),/revoked/);
 assert.equal((await cache.get('account-b:resource:connection-1',read)).revision,5);
});
