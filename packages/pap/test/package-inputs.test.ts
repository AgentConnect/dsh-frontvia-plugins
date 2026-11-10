import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error build helper has no public TypeScript declaration
import { assertBundleInputs } from "../../../scripts/package-inputs.mjs";
test("packing rejects missing dependency output before desktop installation", async () => {
 const dir=await mkdtemp(join(tmpdir(),"bundle-inputs-"));
 try {
  await writeFile(join(dir,"package.json"),JSON.stringify({name:"identity"}));
  await mkdir(join(dir,"dist"));
  for(const name of ["core.js","index.js"])await writeFile(join(dir,"dist",name),"export {};");
  await assert.rejects(assertBundleInputs(dir,"identity"),/构建产物不完整/);
  await writeFile(join(dir,"dist/client.js"),"module.exports={};");
  await assertBundleInputs(dir,"identity");
  await assert.rejects(assertBundleInputs(dir,"wrong"),/构建产物不完整/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
