import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve("."),
  out = resolve(".local/packages");
await mkdir(out, { recursive: true });
const artifacts = [];
for (const [folder, name] of [
  ["pap", "dsh-pap"],
  ["customer", "dsh-frontvia-customer"],
]) {
  const result = spawnSync(
    "pnpm",
    ["--dir", `packages/${folder}`, "pack", "--pack-destination", out],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status) process.exit(result.status);
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
    { runtime: "0.2.1-rc.3", publication: "local-only", artifacts },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ artifacts }));
