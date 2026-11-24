import assert from "node:assert/strict";
import test from "node:test";
import { ActionProgress, actionObserver } from "../src/action-progress.js";

test("only the active owner request reports its phase and completion releases the entry",async()=>{
  const requests=new ActionProgress();
  let finish!:()=>void;
  const pending=requests.track("original",async()=>{
    actionObserver.getStore()!("approval");
    await new Promise<void>(resolve=>{finish=resolve;});
    actionObserver.getStore()!("request");
    return "original receipt";
  });
  assert.equal(requests.read("original"),"approval");
  assert.equal(requests.read("other"),undefined);
  await assert.rejects(requests.track("original",async()=>{}),{code:"ACTION_IN_PROGRESS"});
  finish();
  assert.equal(await pending,"original receipt");
  assert.equal(requests.read("original"),undefined);
});
