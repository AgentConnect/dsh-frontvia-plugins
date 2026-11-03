import { httpsTransport } from "../packages/pap/src/network.js";
// Real Frontvia TLS/PAP/OTP + both built plugins, then their actual DSH owner UI.
// Called by Frontvia's isolated publication runner. Uses reserved test numbers.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";
import { PapService, Vault } from "../packages/pap/dist/core.js";
import { CustomerService } from "../packages/customer/dist/core.js";

const cfg = JSON.parse(await readFile(process.argv[2], "utf8"));
const dir = join(cfg.evidence, "dsh-personal");
await mkdir(dir, { recursive: true, mode: 0o700 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The prepared isolated DSH profile persists credentials between runs. Each
// fresh Vault must use its own reference rather than a previous run's key.
const keySuffix = randomBytes(6).toString("hex").toUpperCase();
const methods = [
  "capabilities.get",
  "messages.submit",
  "conversations.get",
  "help.request",
  "answers.get",
  "answers.accept",
].map((m) => "consultation." + m);
const config: any = {
  clientId: cfg.client_id,
  callback: cfg.client_origin + "/callback",
  signingKeyRef: `PERSONAL_TEST_SIGN_${keySuffix}`,
  storageKeyRef: `PERSONAL_TEST_PAP_${keySuffix}`,
  keyId: "c1",
  dataDir: join(dir, "pap"),
  caFile: join(cfg.fixtures, "ca.pem"),
  targets: [
    ...new Set([
      new URL(cfg.origin).origin,
      new URL(cfg.issuer).origin,
      new URL(cfg.resource).origin,
    ]),
  ].map((origin) => ({
    origin,
    address: "127.0.0.1",
    port: 9443,
    connectPort: cfg.port,
  })),
  personal: {
    origin: cfg.origin,
    requestOrigin: cfg.origin,
    tokenOrigins: [new URL(cfg.issuer).origin],
  },
  sites: [
    {
      id: "consultation",
      label: "公开客服",
      domain: new URL(cfg.origin).host,
      issuer: cfg.issuer,
      resource: cfg.resource,
      description: {
        title: "公开客服",
        profile: "frontvia.merchant_consultation.v1",
        methods,
        openapiUrl: cfg.resource.replace(/rpc$/, "openapi.json"),
      },
    },
  ],
};
const customerConfig = {
  dataDir: join(dir, "customer"),
  sites: [],
  storageKeyRef: `PERSONAL_TEST_CUSTOMER_${keySuffix}`,
};
const secret: any = {
  [config.signingKeyRef]: await readFile(
    join(cfg.fixtures, "c1-key.pem"),
    "utf8",
  ),
  [config.storageKeyRef]: randomBytes(32).toString("base64url"),
  [customerConfig.storageKeyRef]: randomBytes(32).toString("base64url"),
};
const secrets = { get: async (k: string) => secret[k], set: async () => {} };
const papVault = new Vault(
    join(config.dataDir, "pap.sqlite"),
    secret[config.storageKeyRef],
  ),
  customerVault = new Vault(
    join(customerConfig.dataDir, "customer.sqlite"),
    secret[customerConfig.storageKeyRef],
  );
const wire = httpsTransport(config.targets, config.caFile);
const checkedWire = async (request: any) => {
  try {
    const response = await wire(request);
    if (new URL(request.url).pathname.endsWith("poppy.json"))
      console.log(
        JSON.stringify({
          stage: "discovery",
          version: response.protocol_version,
          issuer: response.auth?.issuer,
          resources: response.apis?.map((v: any) => v.resource),
        }),
      );
    return response;
  } catch (e: any) {
    console.log(
      JSON.stringify({
        stage: "live-wire",
        path: new URL(request.url).pathname,
        error: e.code,
      }),
    );
    throw e;
  }
};
const pap = new PapService(config, secrets, papVault, checkedWire),
  customer = new CustomerService(customerConfig, pap, secrets, customerVault);
const cases: string[] = [];
let flowId: string;
let firstRequested = 0;
try {
  // The server contract uses separate reserved email identities; these phones
  // are first used through the actual DSH personal adapter.
  firstRequested = Date.now();
  await pap.personal.requestCode("+12025550101");
  await pap.personal.verify(cfg.otp);
  const f = await customer.connect("personal-live-session", "consultation");
  flowId = f.flowId;
  const asked = await customer.tool(
    "personal-live-session",
    "frontvia_consultation",
    { flowId, action: "ask", text: "介绍一下公开商品" },
    randomUUID(),
  );
  assert(asked.data.conversation_id);
  let answer: any;
  for (let i = 0; i < 100; i++) {
    answer = await customer.tool(
      "personal-live-session",
      "frontvia_consultation",
      { flowId, action: "get" },
      randomUUID(),
    );
    if (answer.data.status === "answered") break;
    await sleep(200);
  }
  assert.equal(answer.data.status, "answered");
  assert(answer.data.messages.some((m: any) => m.actor === "agent" && m.text));
  cases.push("real-phone-login-PAP-and-Customer-question-answer");
  const connection = (pap.status() as any[])[0];
  await pap.personal.logout();
  assert.equal(customer.list().length, 0);
  await assert.rejects(() =>
    customer.consultation.view("personal-live-session", flowId),
  );
  await pap.personal.requestCode("+12025550102");
  await pap.personal.verify(cfg.otp);
  assert.equal(customer.list().length, 0);
  const b = await pap.connect("consultation");
  assert.notEqual(b.connectionRef, connection.connectionRef);
  await pap.personal.logout();
  cases.push("real-logout-and-second-person-private-history-isolation");
} finally {
  customerVault.close();
  papVault.close();
}
await writeFile(join(dir, "pap.json"), JSON.stringify(config), { mode: 0o600 });
await writeFile(join(dir, "customer.json"), JSON.stringify(customerConfig), {
  mode: 0o600,
});
const home = resolve(".local/personal-login-baseline/isolated-home");
const port = await new Promise<number>((r) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => r(p));
  });
});
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
const patch = join(dir, "patch.yml");
await writeFile(
  patch,
  `- id: dsh-pap\n  config:\n    configFile: ${JSON.stringify(join(dir, "pap.json"))}\n- id: dsh-frontvia-customer\n  config:\n    configFile: ${JSON.stringify(join(dir, "customer.json"))}\n- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n` +
    disabled.map((id) => `- id: ${id}\n  disabled: true\n`).join(""),
  { mode: 0o600 },
);
const env = {
  ...process.env,
  ...secret,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: "1",
};
delete env.DEEPSEEK_API_KEY;
delete env.OPENAI_API_KEY;
delete env.ANTHROPIC_API_KEY;
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/@deepseek-ai/dsh/lib/bin.js"),
    "--profile",
    "frontvia",
    "--patch",
    patch,
    "--port",
    String(port),
    "--no-open",
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "",
  url = "";
child.stdout.on("data", (b) => {
  const s = b.toString();
  url ||=
    s.match(
      new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s]+`),
    )?.[0] ?? "";
  log += s.replace(/token=[^\s]+/g, "token=[REDACTED]");
});
child.stderr.on(
  "data",
  (b) => (log += b.toString().replace(/token=[^\s]+/g, "token=[REDACTED]")),
);
let browser: any, page: any;
const rpcErrors: { path: string; code: string }[] = [];
try {
  for (let i = 0; i < 600 && !url; i++) {
    if (child.exitCode !== null) throw new Error("isolated DSH exited");
    await sleep(100);
  }
  assert(url, "DSH readiness");
  const { chromium } = await import(
    resolve(cfg.fixtures, "../../../web/node_modules/playwright-core/index.mjs")
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors: string[] = [],
    consoleErrors: string[] = [],
    networkFailures: any[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: any) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r: any) =>
    networkFailures.push({
      path: new URL(r.url()).pathname,
      failure: r.failure()?.errorText,
    }),
  );
  page.on("response", (r: any) => {
    if (r.status() >= 400)
      networkFailures.push({
        path: new URL(r.url()).pathname,
        status: r.status(),
      });
    const path = new URL(r.url()).pathname;
    if (/^\/api\/(pap|frontvia-customer)\//.test(path))
      void r
        .json()
        .then((body: any) => {
          if (body.result?.error?.code)
            rpcErrors.push({ path, code: body.result.error.code });
        })
        .catch(() => {});
  });
  const dismissHostSignIn = async () => {
    // This is the optional DeepSeek account/API-key prompt, not Frontvia login.
    const title = page.getByRole("heading", {
      name: "Get started",
      exact: true,
    });
    if (
      await title.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    )
      await page.getByRole("button", { name: "Close", exact: true }).click();
  };
  await page.goto(url);
  await dismissHostSignIn();
  await page
    .getByRole("button", { name: "Frontvia 服务", exact: true })
    .click();
  const panel = page.locator('[aria-label="个人账号"]');
  await panel.getByRole("heading", { name: "个人账号" }).waitFor();
  // OTP cooldown runs while core acceptance and the independent host boot.
  await page
    .getByRole("textbox", { name: "手机号（含国家代码）" })
    .fill("+12025550101");
  while (Date.now() < firstRequested + 62000) await sleep(1000);
  await panel.getByRole("button", { name: "获取验证码", exact: true }).click();
  await panel
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .waitFor();
  await panel.getByRole("textbox", { name: /验证码/ }).fill(cfg.otp);
  await panel.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await panel.getByText(/已登录/).waitFor();
  await page.screenshot({
    path: join(dir, "frontvia-account-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "PAP 连接", exact: true }).click();
  const identityPanel = page.locator('[aria-label="当前身份"]');
  await identityPanel.getByText(/Frontvia 个人账号 ·/).waitFor();
  assert.equal(
    await page.locator('.pap-viewport input[type="tel"]').count(),
    0,
  );
  assert.equal(
    await page
      .locator(".pap-viewport")
      .getByRole("button", { name: "退出登录", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await page.getByRole("button", { name: "断开", exact: true }).waitFor();
  await page.screenshot({
    path: join(dir, "personal-desktop-light.png"),
    fullPage: true,
  });
  await page.reload();
  await dismissHostSignIn();
  // DSH restores the selected panel. Do not open a second copy after reload.
  if (!(await page.locator(".pap-viewport").isVisible()))
    await page.getByRole("button", { name: "PAP 连接", exact: true }).click();
  await identityPanel.getByText(/Frontvia 个人账号 ·/).waitFor();
  await page.getByRole("button", { name: "断开", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Frontvia 服务", exact: true })
    .click();
  await panel.getByText(/已登录/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  // Let the host's responsive panel transition and status refresh complete.
  await sleep(500);
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.some(
      (b) => b.textContent?.trim() === "退出登录" && !b.disabled,
    );
  });
  await page.screenshot({
    path: join(dir, "personal-mobile-dark.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await panel.getByRole("button", { name: "退出登录", exact: true }).click();
  await panel
    .getByRole("button", { name: "获取验证码", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(dir, "frontvia-account-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "PAP 连接", exact: true }).click();
  await identityPanel
    .getByText("未登录 Frontvia 个人账号", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "断开", exact: true }).count(),
    0,
  );
  await writeFile(
    join(dir, "browser-checks.json"),
    JSON.stringify(
      {
        pageErrors: errors,
        consoleErrors,
        networkFailures,
        rpcErrors,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rpcErrors, []);
  assert.deepEqual(
    networkFailures.filter((v) =>
      /^\/api\/(pap|frontvia-customer)\//.test(v.path),
    ),
    [],
  );
  cases.push(
    "actual-DSH-Frontvia-login-PAP-readonly-identity-reload-logout-desktop-mobile-themes",
  );
} catch (error) {
  await writeFile(join(dir, "rpc-errors.json"), JSON.stringify(rpcErrors), {
    mode: 0o600,
  });
  await page?.screenshot({
    path: join(dir, "browser-failure.png"),
    fullPage: true,
  });
  await writeFile(
    join(dir, "browser-failure.txt"),
    (await page?.locator("body").innerText()) ?? "No page",
    { mode: 0o600 },
  );
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (child.exitCode !== null) r();
    else child.once("exit", () => r());
  });
  await writeFile(join(dir, "host.log"), log, { mode: 0o600 });
}
await writeFile(
  join(dir, "result.json"),
  JSON.stringify(
    {
      status: "PASS",
      cases,
      limitations: [
        "Reserved OTP delivery and controlled merchant model; no real SMS or paid model",
      ],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ status: "PASS", cases }));
