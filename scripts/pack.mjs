import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import spawn from "cross-spawn";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pluginPackages } from "./plugin-packages.mjs";
import { assertBundleInputs } from "./package-inputs.mjs";
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
  const path = resolve(out, `${name}-0.1.0.tgz`),
    bytes = await readFile(path),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  // pnpm caches local tarballs by URL. Content-addressed filenames prevent an
  // unchanged dev version from silently reinstalling an earlier bundle.
  const immutable = resolve(out, `${name}-0.1.0-${sha256.slice(0, 12)}.tgz`);
  await cp(path, immutable);
  artifacts.push({ name, path: immutable, sha256 });
}
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      runtime: JSON.parse(await readFile(resolve("package.json"), "utf8"))
        .devDependencies["@deepseek-ai/dsh"],
      publication: "local-only",
      artifacts,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ artifacts }));
