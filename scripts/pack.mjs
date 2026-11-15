import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import spawn from "cross-spawn";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pluginPackages } from "./plugin-packages.mjs";
import { assertBundleInputs } from "./package-inputs.mjs";
import {publicIdentityPackage,publicPapPackage} from "../tests/support/public-pap.mjs";
const root = resolve("."),
  out = resolve(".local/packages");
const bundles = pluginPackages.map(({ folder, name }) => [
  `packages/${folder}`,
  name,
]);
// Validate every dependency before packing or publishing a new manifest.
const selectedPap=publicPapPackage(),selectedIdentity=publicIdentityPackage();
for (const [folder, name] of bundles) await assertBundleInputs(folder, name);
await mkdir(out, { recursive: true });
const artifacts = [];
for (const [folder, name] of bundles) {
  const result = spawn.sync(
    "pnpm",
    ["--dir", folder, "pack", "--pack-destination", out],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const { version } = JSON.parse(await readFile(resolve(folder, "package.json"), "utf8"));
  const path = resolve(out, `${name}-${version}.tgz`),
    bytes = await readFile(path),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  // pnpm caches local tarballs by URL. Content-addressed filenames prevent an
  // unchanged dev version from silently reinstalling an earlier bundle.
  const immutable = resolve(out, `${name}-${version}-${sha256.slice(0, 12)}.tgz`);
  await cp(path, immutable);
  artifacts.push({ name, path: immutable, sha256 });
}
// Local packaging never publishes either package to npm.
async function packDependency(name,selected){
  const packed=spawn.sync('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:selected.root,encoding:'utf8'});
  if(packed.error)throw packed.error;
  if(packed.status!==0)throw new Error(`Local packaging failed for ${name}`);
  const {name:actualName,version,filename}=JSON.parse(packed.stdout)[0];
  if(actualName!==name||version!==selected.version)throw new Error(`Selected package changed for ${name}`);
  const path=resolve(out,filename),bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex');
  const immutable=resolve(out,filename.replace(/\.tgz$/,'-'+sha256.slice(0,12)+'.tgz'));
  await cp(path,immutable);
  return {name,path:immutable,sha256,version,localPatch:selected.source==='explicit-local'};
}
artifacts.push(await packDependency('@awiki/dsh-pap',selectedPap));
const identityArtifact=await packDependency('@agent-network-protocol/dsh-anp-identity',selectedIdentity);
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      runtime: JSON.parse(await readFile(resolve("package.json"), "utf8"))
        .devDependencies["@deepseek-ai/dsh"],
      publication: "local-only",
      papSource: selectedPap.source,
      papRoot: selectedPap.root,
      identitySource: selectedIdentity.source,
      identityRoot: selectedIdentity.root,
      identityVersion: selectedIdentity.version,
      nativeIdentityVersion: selectedIdentity.nativeVersion,
      identityArtifact,
      artifacts,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ artifacts }));
