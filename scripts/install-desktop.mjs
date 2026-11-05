import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  link,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveProfileDir } from "@deepseek-ai/dsh-app-boot";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import spawn from "cross-spawn";

const profile = resolveProfileDir("desktop");
const manifestPath = join(profile, "package.json");
if (!existsSync(manifestPath))
  throw new Error("请先打开 DSH 桌面版，等待 desktop Profile 初始化。");
const macCli =
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
const cli =
  process.env.DSH_DESKTOP_CLI || (existsSync(macCli) ? macCli : "dsh");
const artifacts = JSON.parse(
  await readFile(resolve(".local/packages/manifest.json"), "utf8"),
);
const names = ["dsh-pap", "dsh-frontvia-customer"];
const locks = { waitMs: 120000 };

function run(args, capture = false) {
  // cross-spawn resolves the official Windows .cmd shim and escapes its argv.
  const result = spawn.sync(cli, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`DSH 命令失败（${result.status ?? result.signal}）`);
  return result.stdout?.trim();
}
if (run(["--version"], true) !== artifacts.runtime)
  throw new Error("请使用与插件兼容的 DSH Desktop CLI：" + artifacts.runtime);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directory = join(profile, ".local-packages", "frontvia");
async function stagePair() {
  // Validate both inputs before publishing either path. Content-addressed
  // archives may already back a live installation and must never be overwritten.
  const pair = await Promise.all(
    names.map(async (name) => {
      const artifact = artifacts.artifacts.find((a) => a.name === name);
      const bytes = await readFile(artifact.path);
      if (digest(bytes) !== artifact.sha256)
        throw new Error("安装包校验失败：" + name);
      return { name, bytes, path: join(directory, basename(artifact.path)) };
    }),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(directory, ".stage-"));
  try {
    for (const item of pair) {
      const staged = join(temp, item.name);
      await writeFile(staged, item.bytes, { mode: 0o600 });
      try {
        await link(staged, item.path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (!(await readFile(item.path)).equals(item.bytes))
          throw new Error("原有安装包校验失败：" + item.name);
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return pair;
}

const lockPath = join(profile, "pnpm-lock.yaml");
async function snapshot() {
  const manifest = await readFile(manifestPath);
  const lock = await readFile(lockPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  return { manifest, lock };
}

function pointsTo(spec, archive) {
  return (
    typeof spec === "string" &&
    spec.startsWith("file:") &&
    resolve(profile, spec.slice(5)) === resolve(archive)
  );
}

function otherPackages(bytes) {
  const manifest = JSON.parse(bytes);
  for (const name of names) delete manifest.dependencies?.[name];
  if (manifest.dependencies && !Object.keys(manifest.dependencies).length)
    delete manifest.dependencies;
  if (manifest.dsh?.profile?.bundles)
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(
      (name) => !names.includes(name),
    );
  return manifest;
}

async function rollback(previous, pair) {
  await withFileLock(
    manifestPath,
    async () => {
      const current = await snapshot();
      const before = JSON.parse(previous.manifest).dependencies ?? {};
      const after = JSON.parse(current.manifest).dependencies ?? {};
      if (
        !isDeepStrictEqual(
          otherPackages(previous.manifest),
          otherPackages(current.manifest),
        ) ||
        pair.some(
          ({ name, path }) =>
            before[name] !== after[name] && !pointsTo(after[name], path),
        )
      )
        throw new Error(
          "Profile 同时被其他操作修改，已停止回滚以保留这些修改。",
        );
      await writeFileAtomic(manifestPath, previous.manifest, { mode: 0o600 });
      if (previous.lock)
        await writeFileAtomic(lockPath, previous.lock, { mode: 0o600 });
      else await rm(lockPath, { force: true });
    },
    locks,
  );
  run([
    "plugin",
    "--profile",
    "desktop",
    "install",
    previous.lock ? "--frozen-lockfile" : "--config.lockfile=false",
  ]);
}

await withFileLock(
  join(profile, ".frontvia-install"),
  async () => {
    const pair = await stagePair();
    const previous = await withFileLock(manifestPath, snapshot, locks);
    try {
      run([
        "plugin",
        "--profile",
        "desktop",
        "add",
        ...pair.map((item) => item.path),
      ]);
      for (const { name } of pair) {
        const folder = name === "dsh-pap" ? "pap" : "customer";
        for (const file of ["index.js", "core.js", "client.js"]) {
          const built = await readFile(join("packages", folder, "dist", file));
          const installed = await readFile(
            join(profile, "node_modules", name, "dist", file),
          );
          if (!installed.equals(built))
            throw new Error("DSH 加载的安装包与本次构建不符：" + name);
        }
      }
    } catch (error) {
      try {
        await rollback(previous, pair);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "插件安装失败，Profile 回滚未完成。",
        );
      }
      throw error;
    }
  },
  locks,
);
console.log("两个插件已安装。重新打开 DSH 后，进入「Frontvia 服务」登录。");
