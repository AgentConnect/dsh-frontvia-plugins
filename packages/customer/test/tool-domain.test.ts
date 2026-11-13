import test from 'node:test';
import assert from 'node:assert/strict';
import {tools} from '../src/tools.js';
import {PapError} from '../src/state.js';

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

test('a disconnected public PAP connection directs the owner to reconnect without a tool retry',async()=>{
  let calls=0;
  const service={async tool(){calls++;throw new PapError('PAP_DISCONNECTED');}};
  const definition=tools(service as any).find(tool=>tool.name==='frontvia_connection')!;
  const result:any=await definition.execute({action:'connect',domain:'shop.example'},
    {agent:{id:'chat'},callId:'connect',signal:new AbortController().signal} as any);
  assert.equal(result.error.code,'PAP_DISCONNECTED');
  assert.match(result.nextStep,/PAP 连接中点击重新连接/);
  assert.match(result.nextStep,/不要自动恢复连接或重放购买/);
  assert.equal(calls,1);
});
