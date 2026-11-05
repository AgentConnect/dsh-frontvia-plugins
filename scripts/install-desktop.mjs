import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, copyFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveProfileDir } from "@deepseek-ai/dsh-app-boot";

const profile = resolveProfileDir("desktop");
if (!existsSync(join(profile, "package.json")))
  throw new Error("请先打开 DSH 桌面版，等待 desktop Profile 初始化。");
const macCli =
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
const cli =
  process.env.DSH_DESKTOP_CLI || (existsSync(macCli) ? macCli : "dsh");
const manifest = JSON.parse(
  await readFile(resolve(".local/packages/manifest.json"), "utf8"),
);
if (
  execFileSync(cli, ["--version"], { encoding: "utf8" }).trim() !==
  manifest.runtime
)
  throw new Error("请使用与插件兼容的 DSH Desktop CLI：" + manifest.runtime);

const directory = join(profile, ".local-packages", "frontvia");
await mkdir(directory, { recursive: true, mode: 0o700 });
for (const name of ["dsh-pap", "dsh-frontvia-customer"]) {
  const artifact = manifest.artifacts.find((a) => a.name === name);
  const destination = join(directory, basename(artifact.path));
  await copyFile(artifact.path, destination);
  const digest = createHash("sha256")
    .update(await readFile(destination))
    .digest("hex");
  if (digest !== artifact.sha256) throw new Error("安装包校验失败：" + name);
  execFileSync(cli, ["plugin", "--profile", "desktop", "add", destination], {
    stdio: "inherit",
  });
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
console.log("两个插件已安装。重新打开 DSH 后，进入「Frontvia 服务」登录。");
