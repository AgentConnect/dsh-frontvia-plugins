import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import spawn from "cross-spawn";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot";
import { pluginPackages } from "./plugin-packages.mjs";
import { assertBundleInputs, assertPapPackage } from "./package-inputs.mjs";
import {publicIdentityPackage,publicPapPackage} from "../tests/support/public-pap.mjs";
const root = resolve("."),
  out = resolve(".local/packages");
const bundles = pluginPackages.map(({ folder, name }) => [
  `packages/${folder}`,
  name,
]);
// Validate every dependency before packing or publishing a new manifest.
const selectedPap=publicPapPackage(),selectedIdentity=publicIdentityPackage();
const buildManifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const papManifest = JSON.parse(await readFile(resolve(selectedPap.root, "package.json"), "utf8"));
assertPapPackage(papManifest, buildManifest.devDependencies["@awiki/dsh-pap"]);
const runtime = process.env.FRONTVIA_DSH_RUNTIME ?? buildManifest.devDependencies["@deepseek-ai/dsh"];
if (runtime !== "0.2.2-rc.1" && runtime !== "0.2.2-rc.3") {
  throw new Error("FRONTVIA_DSH_RUNTIME must be 0.2.2-rc.1 or 0.2.2-rc.3");
}
for (const directory of [...bundles.map(([folder]) => folder), selectedPap.root, selectedIdentity.root]) {
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (evaluatePluginCompatibility(manifest, {}, runtime)) {
    throw new Error(`Select a ${manifest.name} candidate compatible with DSH ${runtime}`);
  }
}
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
  const packed=spawn.sync('npm',['pack','.','--offline','--ignore-scripts','--json','--pack-destination',out],{cwd:selected.root,encoding:'utf8'});
  if(packed.error)throw packed.error;
  if(packed.status!==0)throw new Error(`Local packaging failed for ${name}`);
  const {name:actualName,version,filename}=JSON.parse(packed.stdout)[0];
  if(actualName!==name||version!==selected.version)throw new Error(`Selected package changed for ${name}`);
  const path=resolve(out,filename),bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex');
  const immutable=resolve(out,filename.replace(/\.tgz$/,'-'+sha256.slice(0,12)+'.tgz'));
  await cp(path,immutable);
  return {name,path:immutable,sha256,version,localPatch:selected.source==='explicit-local',
    ...(name === papManifest.name ? {dshPapUcpOperations: papManifest.dshPapUcpOperations} : {})};
}
artifacts.push(await packDependency('@awiki/dsh-pap',selectedPap));
const identityArtifact=await packDependency('@agent-network-protocol/dsh-anp-identity',selectedIdentity);
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      runtime,
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
