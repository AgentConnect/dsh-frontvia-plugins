import { AccountClient } from "dsh-identity-client/core";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Vault } from "dsh-pap/core";
import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot";
import { serverResponseSchema } from "@deepseek-ai/dsh-client-connection";
import { apply, inject } from "../src/index.js";

test("built PAP and Customer bundles preserve connection errors through tools and owner routes", async () => {
  const papBundle = await import(
    new URL("../../pap/dist/index.js", import.meta.url).href
  );
  const customerBundle = await import(
    new URL("../dist/index.js", import.meta.url).href
  );
  const dir = mkdtempSync(join(tmpdir(), "dsh-built-errors-")),
    key = randomBytes(32).toString("base64url"),
    papDir = join(dir, "pap"),
    customerDir = join(dir, "customer"),
    flowId = "00000000-0000-4000-8000-000000000002";
  const papConfig = join(dir, "pap.json"),
    customerConfig = join(dir, "customer.json");
  writeFileSync(
    papConfig,
    JSON.stringify({
      dataDir: papDir,
      storageKeyRef: "PAP_STORAGE",
      signingKeyRef: "SIGNING",
      keyId: "test",
      clientId: "https://client.test/client.json",
      callback: "https://client.test/callback",
      targets: [],
      sites: [
        {
          id: "a",
          label: "Test",
          domain: "shop.test",
          issuer: "https://auth.test",
          resource: "https://api.test/rpc",
        },
      ],
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    customerConfig,
    JSON.stringify({
      dataDir: customerDir,
      storageKeyRef: "CUSTOMER_STORAGE",
      sites: [
        {
          siteId: "a",
          storeId: "store",
          confirmationKeyRef: "CONFIRM",
          confirmationKid: "test",
        },
      ],
    }),
    { mode: 0o600 },
  );
  const legacy = new Vault(join(papDir, "pap.sqlite"), key);
  legacy.set("connection:legacy", {
    id: "legacy",
    siteId: "a",
    user: "subject",
    proofKey: "unused",
    metadata: {},
  });
  legacy.set("personal-account", {
    generation: "saved-login-attempt",
    challenge: {
      id: "host-only-otp-challenge",
      phone: "+12 •••• 0101",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      resendAt: Math.floor(Date.now() / 1000) + 60,
    },
  });
  legacy.close();
  const customer = new Vault(join(customerDir, "customer.sqlite"), key);
  customer.set(`flow:${flowId}`, {
    id: flowId,
    sessionId: "s",
    connectionRef: "legacy",
    siteId: "a",
    storeId: "store",
    connection: null,
    commands: {},
    cart: { id: "cart" },
  });
  customer.close();
  const cleanups: (() => void)[] = [],
    routes = new Map<string, any>(),
    definitions = new Map<string, any>();
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
  const accountVault = new Vault(join(dir, "identity.sqlite"), key);
  cleanups.push(() => accountVault.close());
  ctx.identity = {
    account: new AccountClient(
      {
        origin: "https://identity.test",
        requestOrigin: "https://identity.test",
        audiences: ["https://auth.test"],
      },
      accountVault,
      { get: async () => key, set: async () => {} },
      async () => {
        throw new Error("unexpected identity network");
      },
      "DEVICE",
    ),
  };
  try {
    await papBundle.apply(ctx, { configFile: papConfig });
    await customerBundle.apply(ctx, { configFile: customerConfig });
    for (const operation of [
      "personal-status",
      "personal-code",
      "personal-verify",
      "personal-logout",
    ]) {
      assert.equal(routes.has(`/api/pap/${operation}`), false);
      assert.equal(routes.has(`/api/frontvia-customer/${operation}`), true);
    }
    const tool = await definitions
      .get("frontvia_connection")
      .execute(
        { action: "connect", siteId: "a" },
        { agent: { id: "s" }, callId: "connect" },
      );
    assert.equal(tool.error.code, "CONNECTION_BINDING_REQUIRED");
    const response = await routes.get("/api/frontvia-customer/view").fetch(
      new Request("http://localhost/api/frontvia-customer/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "built-route",
          method: "frontvia-customer/view",
          payload: { sessionId: "s", flowId },
        }),
      }),
    );
    const envelope = serverResponseSchema.parse(await response.json());
    assert.equal(envelope.result.ok, false);
    if (!envelope.result.ok)
      assert.equal(envelope.result.error.code, "CONNECTION_BINDING_REQUIRED");
    const call = async (operation: string, payload = {}) => {
      const route = routes.get(`/api/${operation}`);
      return route.fetch(
        new Request(`http://localhost/api/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "client-request",
            rpcId: "configuration",
            method: operation,
            payload,
          }),
        }),
      );
    };
    const status = (await (await call("pap/status")).json()).result.value;
    assert.equal("personal" in status, false);
    assert(!JSON.stringify(status).includes("host-only-otp-challenge"));
    const site = status.sites[0];
    ctx.connection.browserPeer.principal.kind = "guest";
    assert.equal(
      (await call("pap/remove", { siteId: site.id, revision: site.revision }))
        .status,
      403,
    );
    assert.equal(
      (await call("pap/restore", { siteId: site.id, revision: site.revision }))
        .status,
      403,
    );
    ctx.connection.browserPeer.principal.kind = "owner";
    const invalid = await (
      await call("pap/remove", {
        siteId: site.id,
        revision: site.revision,
        extra: "not allowed",
      })
    ).json();
    assert.equal(invalid.result.error.code, "INVALID_CONFIGURATION_ACTION");
    assert.equal(
      (
        await (
          await call("pap/remove", { siteId: site.id, revision: site.revision })
        ).json()
      ).result.ok,
      true,
    );
    const deleted = (await (await call("pap/status")).json()).result.value;
    assert.equal(deleted.sites.length, 0);
    assert.equal(deleted.connections[0].connectionRef, "legacy");
    const history = (await (await call("frontvia-customer/list")).json()).result
      .value;
    assert.equal(history.flows[0].flowId, flowId);
    assert.equal(definitions.has("pap_remove"), false);
    assert.equal(
      (
        await (
          await call("pap/restore", {
            siteId: site.id,
            revision: deleted.removedSites[0].revision,
          })
        ).json()
      ).result.ok,
      true,
    );
    assert.equal(
      ctx.pap.status("legacy").bindingError,
      "CONNECTION_BINDING_REQUIRED",
    );
  } finally {
    cleanups.reverse().forEach((fn) => fn());
  }
});

test("Customer activation fails closed before registering routes or tools on incompatible PAP", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "dsh-lifecycle-")),
    configFile = join(dataDir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({ dataDir, storageKeyRef: "TEST_STORAGE", sites: [] }),
    { mode: 0o600 },
  );
  const cleanups: (() => void)[] = [],
    tools: unknown[] = [],
    routes: unknown[] = [];
  const ctx = {
    pap: { apiVersion: 1 },
    credentials: {
      resolve: async () => ({ value: randomBytes(32).toString("base64url") }),
      set: async () => {},
    },
    effect: (fn: () => () => void) => {
      cleanups.push(fn());
    },
    tools: { register: (v: unknown) => tools.push(v) },
    connection: { fetch: { register: (v: unknown) => routes.push(v) } },
  };
  try {
    await assert.rejects(
      apply(ctx as any, { configFile }),
      /PAP_VERSION_UNSUPPORTED/,
    );
    assert.deepEqual(tools, []);
    assert.deepEqual(routes, []);
    assert.ok(inject.includes("pap"));
  } finally {
    cleanups.forEach((f) => f());
  }
});
test("both bundles are accepted only on the approved DSH baseline without an exemption", () => {
  for (const name of ["pap", "customer"]) {
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../../${name}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      evaluatePluginCompatibility(manifest, {}, "0.2.2-rc.1"),
      undefined,
    );
    assert.ok(evaluatePluginCompatibility(manifest, {}, "0.2.1-rc.3"));
    assert.ok(evaluatePluginCompatibility(manifest, {}, "0.2.2-rc.2"));
  }
});

test("owner UI route preserves a business failure in the actual DSH response contract", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "dsh-ui-failure-"));
  const configFile = join(dataDir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({ dataDir, storageKeyRef: "TEST_STORAGE", sites: [] }),
    { mode: 0o600 },
  );
  const cleanups: (() => void)[] = [];
  const routes = new Map<string, any>();
  const ctx = {
    identity: { account: { device: {} } },
    pap: {
      apiVersion: 2,
      registerAuthentication: () => () => {},
      registerStatement: () => () => {},
    },
    credentials: {
      resolve: async () => ({ value: randomBytes(32).toString("base64url") }),
      set: async () => {},
    },
    effect: (fn: () => (() => void) | undefined) => {
      const dispose = fn();
      if (dispose) cleanups.push(dispose);
    },
    tools: { register: () => {} },
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
  try {
    await apply(ctx as any, { configFile });
    const route = routes.get("/api/frontvia-customer/view");
    const response = await route.fetch(
      new Request("http://localhost/api/frontvia-customer/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "test-business-failure",
          method: "frontvia-customer/view",
          payload: {
            sessionId: "session-a",
            flowId: "00000000-0000-4000-8000-000000000001",
          },
        }),
      }),
    );
    const envelope = serverResponseSchema.parse(await response.json());
    assert.equal(envelope.result.ok, false);
    if (!envelope.result.ok) {
      assert.equal(envelope.result.error.code, "FLOW_NOT_OWNED");
      assert.deepEqual(envelope.result.error.details, {});
    }
  } finally {
    cleanups.forEach((fn) => fn());
  }
});
