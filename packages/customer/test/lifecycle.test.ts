import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot";
import { serverResponseSchema } from "@deepseek-ai/dsh-client-connection";
import { apply, inject } from "../src/index.js";

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
    pap: { apiVersion: 2 },
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
      evaluatePluginCompatibility(manifest, {}, "0.2.1-rc.3"),
      undefined,
    );
    assert.ok(evaluatePluginCompatibility(manifest, {}, "0.2.1-rc.2"));
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
    pap: { apiVersion: 1 },
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
