import { AccountClient } from "dsh-identity-client/core";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PapService, Vault } from "dsh-pap/core";
import { PapProvider } from "dsh-pap";
import { apply } from "../src/index.js";

test("Frontvia owner routes manage the shared PAP identity without exposing credentials or model login tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frontvia-account-entry-"));
  const key = randomBytes(32).toString("base64url");
  const path = join(dir, "pap.sqlite");
  const vault = new Vault(path, key);
  const calls: { path: string; body?: any }[] = [];
  const accountConfig = {
    origin: "https://identity.test",
    requestOrigin: "https://identity.test",
    audiences: ["https://shop.test/companies/a"],
  };
  const secrets = { get: async () => undefined, set: async () => {} };
  const wire: import("dsh-pap/core").Transport = async (request) => {
    const path = new URL(request.url).pathname;
    const body = request.body ? JSON.parse(request.body) : undefined;
    calls.push({ path, body });
    if (path.endsWith("/otp/request"))
      return {
        challenge_id: "host-only-challenge",
        expires_in: 300,
        resend_after: 60,
      };
    if (path.endsWith("/otp/verify")) {
      assert.equal(body.challenge_id, "host-only-challenge");
      assert.equal(body.code, "123456");
      return {
        user_id: "person-a",
        access_token: "dsh.personal.host-only",
        expires_in: 3600,
      };
    }
    if (path.endsWith("/me")) return { user_id: "person-a" };
    if (path.endsWith("/logout")) {
      assert.equal(
        request.headers?.Authorization,
        "Bearer dsh.personal.host-only",
      );
      return {};
    }
    throw new Error("unexpected account request");
  };
  const pap = new PapService(
    {
      clientId: "https://client.test/agent.json",
      callback: "https://client.test/callback",
      signingKeyRef: "SIGNING",
      keyId: "test",
      dataDir: dir,
      sites: [],
      targets: [],
      personal: {
        origin: "https://identity.test",
        requestOrigin: "https://identity.test",
        audiences: ["https://shop.test"],
      },
    },
    { get: async () => undefined, set: async () => {} },
    vault,
    wire,
    new AccountClient(accountConfig, vault, secrets, wire, "DEVICE"),
  );
  const routes = new Map<string, any>(),
    definitions = new Map<string, any>();
  const cleanups: (() => void)[] = [];
  const ctx: any = {
    reflect: {
      provide: (name: string, value: any) => {
        ctx[name] = value;
      },
    },
    credentials: { resolve: async () => ({ value: key }), set: async () => {} },
    effect: (fn: () => (() => void) | undefined) => {
      const dispose = fn();
      if (dispose) cleanups.push(dispose);
    },
    tools: { register: (tool: any) => definitions.set(tool.name, tool) },
    systemPrompt: { section: () => {} },
    connection: {
      browserPeer: { principal: { kind: "owner" } },
      fetch: {
        register: (route: any) => {
          routes.set(route.path, route);
          return () => {};
        },
      },
    },
  };
  new PapProvider(ctx, pap);
  const configFile = join(dir, "customer.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      dataDir: join(dir, "customer"),
      storageKeyRef: "CUSTOMER_STORAGE",
      sites: [],
    }),
    { mode: 0o600 },
  );
  const call = async (operation: string, payload = {}) => {
    const response = await routes
      .get(`/api/frontvia-customer/${operation}`)
      .fetch(
        new Request(`http://localhost/api/frontvia-customer/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "client-request",
            rpcId: "account-entry",
            method: `frontvia-customer/${operation}`,
            payload,
          }),
        }),
      );
    assert.equal(
      response.headers.get("cache-control"),
      response.status === 200 ? "no-store" : null,
    );
    return response;
  };
  const result = async (op: string, payload = {}) =>
    (await (await call(op, payload)).json()).result;
  try {
    await apply(ctx, { configFile });
    ctx.connection.browserPeer.principal.kind = "guest";
    for (const op of [
      "personal-status",
      "personal-code",
      "personal-verify",
      "personal-logout",
    ])
      assert.equal((await call(op)).status, 403);
    assert.equal(calls.length, 0);
    ctx.connection.browserPeer.principal.kind = "owner";
    for (const [op, payload] of [
      ["personal-code", { phone: "+12025550101", token: "forged" }],
      ["personal-verify", { code: "123456", challenge_id: "forged" }],
      ["personal-verify", { code: "short" }],
      ["personal-logout", { userId: "another-user" }],
    ] as const)
      assert.equal(
        (await result(op, payload)).error.code,
        "INVALID_UI_REQUEST",
      );
    assert.equal(calls.length, 0);
    assert.equal((await result("personal-status")).value.signedIn, false);
    const challenge = await result("personal-code", { phone: "+12025550101" });
    assert.equal(challenge.ok, true);
    assert.equal(challenge.value.challenge.phone, "+12 •••• 0101");
    assert(!JSON.stringify(challenge).includes("host-only-challenge"));
    const login = await result("personal-verify", { code: "123456" });
    assert.equal(login.value.signedIn, true);
    assert(!JSON.stringify(login).includes("dsh.personal."));
    assert.equal(pap.personal.current().userId, "person-a");
    assert.equal((pap.personal as any).token, undefined);
    assert.equal("token" in pap.personal.current(), false);
    const identity = pap.personal.identity();
    assert.equal(
      (await result("personal-status")).value.phone,
      "+12 •••• 0101",
    );
    assert.equal(pap.personal.identity(), identity);
    assert(!readFileSync(path).includes(Buffer.from("dsh.personal.host-only")));
    assert.equal((await result("personal-logout")).value.signedIn, false);
    assert.throws(() => pap.personal.current(), {
      code: "PERSONAL_LOGIN_REQUIRED",
    });
    assert.deepEqual(
      calls.map((c) => c.path),
      [
        "/v1/auth/otp/request",
        "/v1/auth/otp/verify",
        "/v1/auth/me",
        "/v1/auth/logout",
      ],
    );
    assert(
      ![...definitions.keys()].some((name) => /personal|login|otp/.test(name)),
    );
  } finally {
    cleanups.reverse().forEach((dispose) => dispose());
    vault.close();
  }
});
