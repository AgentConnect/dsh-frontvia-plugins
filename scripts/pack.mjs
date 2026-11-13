import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import spawn from "cross-spawn";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pluginPackages } from "./plugin-packages.mjs";
import { assertBundleInputs } from "./package-inputs.mjs";
import {publicPapPackage} from "../tests/support/public-pap.mjs";
const root = resolve("."),
  out = resolve(".local/packages");
const bundles = pluginPackages.map(({ folder, name }) => [
  `packages/${folder}`,
  name,
]);
// Validate every dependency before packing or publishing a new manifest.
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
const require = createRequire(resolve(root, 'package.json'));
const selectedPap=publicPapPackage();
const publicRoot=selectedPap.root;
const sdkPack=spawn.sync('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:publicRoot,encoding:'utf8'});
if(sdkPack.error)throw sdkPack.error;if(sdkPack.status!==0)throw new Error('Public PAP local packaging failed');
const sdk=JSON.parse(sdkPack.stdout)[0];if(sdk.name!=='@awiki/dsh-pap'||sdk.version!==selectedPap.version)throw new Error('Public PAP candidate baseline changed');
const sdkPath=resolve(out,sdk.filename),sdkBytes=await readFile(sdkPath),sdkHash=createHash('sha256').update(sdkBytes).digest('hex');
const sdkImmutable=resolve(out,sdk.filename.replace(/\.tgz$/,'-'+sdkHash.slice(0,12)+'.tgz'));
await cp(sdkPath,sdkImmutable);artifacts.push({name:'@awiki/dsh-pap',path:sdkImmutable,sha256:sdkHash,version:sdk.version,localPatch:selectedPap.source==='explicit-local'});
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      runtime: JSON.parse(await readFile(resolve("package.json"), "utf8"))
        .devDependencies["@deepseek-ai/dsh"],
      publication: "local-only",
      papSource: selectedPap.source,
      papRoot: selectedPap.root,
      identityVersion: require('@agent-network-protocol/dsh-anp-identity/package.json').version,
      artifacts,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ artifacts }));
