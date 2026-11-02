import { spawnSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("."),
  home = resolve(process.env.DSH_FRONTVIA_HOME ?? ".local/dsh-home"),
  profile = "frontvia";
const cli = resolve("node_modules/@deepseek-ai/dsh/lib/bin.js");
const env = { ...process.env, DSH_HOME: home };
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Use Node >=24.9");
function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status) throw new Error("DSH profile setup failed");
}
try {
  await access(resolve(home, `profiles/${profile}/package.json`));
} catch {
  run(["--profile", profile, "--from-default-profile", "web", "--dump-config"]);
}
if (process.argv.includes("--install")) {
  const manifest = JSON.parse(
    await readFile(resolve(".local/packages/manifest.json"), "utf8"),
  );
  for (const name of ["dsh-pap", "dsh-frontvia-customer"]) {
    run([
      "plugin",
      "--profile",
      profile,
      "add",
      manifest.artifacts.find((a) => a.name === name).path,
    ]);
    const folder = name === "dsh-pap" ? "pap" : "customer";
    for (const f of ["index.js", "core.js", "client.js"]) {
      const built = await readFile(resolve(`packages/${folder}/dist/${f}`)),
        installed = await readFile(
          resolve(home, `profiles/${profile}/node_modules/${name}/dist/${f}`),
        );
      if (!built.equals(installed))
        throw new Error(`Installed bundle differs: ${name}/${f}`);
    }
  }
}
if (process.argv.includes("--setup-only")) process.exit(0);
const args = [
  cli,
  "--profile",
  profile,
  "--port",
  process.env.DSH_FRONTVIA_PORT ?? "4347",
];
if (process.env.DSH_FRONTVIA_PATCH)
  args.push("--patch", resolve(process.env.DSH_FRONTVIA_PATCH));
const p = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => p.kill(s));
p.on("exit", (c) => process.exit(c ?? 0));
