import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("."),
  native = resolve(".local/native"),
  home = resolve(".local/dsh-home");
const secretFile = resolve(native, "secrets.json");
const st = await stat(secretFile);
if (st.mode & 0o077)
  throw new Error("Protected bootstrap credentials required");
const secrets = JSON.parse(await readFile(secretFile, "utf8"));
const patch = resolve(native, "harness.patch.yml");
const disabled = [
  "session-title-llm",
  "tool-plugin-manager",
  "tool-working-directory",
  "tool-bash",
  "tool-pwsh",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search",
  "tool-skill",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-workflow",
  "tool-todo",
  "tool-goal",
  "tool-web",
  "product-analytics",
  "session-telemetry-otel",
];
let patchText =
  `- id: dsh-pap\n  config:\n    configFile: ${JSON.stringify(resolve(native, "pap.json"))}\n- id: dsh-frontvia-customer\n  config:\n    configFile: ${JSON.stringify(resolve(native, "customer.json"))}\n` +
  disabled.map((id) => `- id: ${id}\n  disabled: true\n`).join("");
const env = {
  ...process.env,
  ...(process.argv.includes("--stored-credentials") ? {} : secrets),
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: "1",
};
patchText +=
  '- id: preset-standard\n  config:\n    id: standard\n    order: 1\n    plugins:\n      - id: persona\n        name: "@deepseek-ai/dsh-persona"\n        config:\n          prefix: "你是 Frontvia 客户助手。使用已安装的 Frontvia 工具访问商家发布并授权的咨询、公开知识与购物服务。先查询连接与服务能力，按资源选择流程；购买必须由用户点击卡片确认。"\n';
for (const id of ["preset-ptc", "preset-minimal", "preset-cordis"])
  patchText += `- id: ${id}\n  disabled: true\n`;
if (process.argv.includes("--real-model")) {
  const source = JSON.parse(
    await readFile(
      "/Users/howard/workspace/frontvia-core/web/.local/agent-preview-20261027/config.json",
      "utf8",
    ),
  );
  const ref = source.model_keychain;
  const record = JSON.parse(
    execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", ref.service, "-a", ref.account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ),
  );
  if (record.type !== "api_key" || !record.key)
    throw new Error("Expected existing API key");
  env.DEEPSEEK_API_KEY = record.key;
  patchText +=
    "- id: llm-deepseek\n  config:\n    thinking: disabled\n    maxTokens: 4096\n";
  console.log(
    "Real model enabled for the explicitly authorized acceptance (maximum five shopping turns).",
  );
}
if (process.argv.includes("--controlled-model")) {
  if (process.argv.includes("--real-model"))
    throw new Error("Select exactly one acceptance model");
  env.DEEPSEEK_API_KEY = "controlled-local-fixture";
  patchText +=
    "- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:4348/anthropic\n    thinking: disabled\n    maxTokens: 4096\n";
}
await writeFile(patch, patchText, { mode: 0o600 });
const args = [
  resolve("node_modules/@deepseek-ai/dsh/lib/bin.js"),
  "--profile",
  "frontvia",
  "--patch",
  patch,
  "--port",
  "4347",
  "--no-open",
];
const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stored = false;
child.stdout.on("data", async (b) => {
  const s = b.toString(),
    url = s.match(/http:\/\/127\.0\.0\.1:4347\/\?token=[^\s]+/)?.[0];
  if (url && !stored) {
    stored = true;
    await writeFile(
      resolve(native, "harness-url.json"),
      JSON.stringify({ url }),
      { mode: 0o600 },
    );
  }
  process.stdout.write(s.replace(/token=[^\s]+/g, "token=[REDACTED]"));
});
child.stderr.on("data", (b) =>
  process.stderr.write(
    b.toString().replace(/token=[^\s]+/g, "token=[REDACTED]"),
  ),
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (c) => process.exit(c ?? 0));
