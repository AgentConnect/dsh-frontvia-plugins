import test from 'node:test';
import assert from 'node:assert/strict';
import {tools} from '../src/tools.js';

test('the actual tool executor accepts a domain-only connection and preserves it for Customer',async()=>{
  const calls:unknown[][]=[];
  const service={async tool(...args:unknown[]){calls.push(args);return {data:{connected:true}};}};
  const definition=tools(service as any).find(tool=>tool.name==='frontvia_connection')!;
  await definition.execute({action:'connect',domain:'shop.example'},
    {agent:{id:'domain-only-chat'},callId:'domain-connect',signal:new AbortController().signal} as any);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'domain-only-chat');
  assert.deepEqual(calls[0][2],{action:'connect',domain:'shop.example'});
});
