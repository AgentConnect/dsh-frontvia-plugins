import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, inject } from "../src/index.js";
import { fixture } from "./fixtures/protocol.js";

test("PAP activates alone with an empty profile and exposes only owner connection status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pap-standalone-"));
  const keys = new Map<string, string>(),
    routes = new Map<string, any>(),
    cleanups: (() => void)[] = [];
  const ctx: any = {
    profileContext: { name: "standalone", dir },
    credentials: {
      resolve: async (ref: string) =>
        keys.has(ref) ? { value: keys.get(ref) } : undefined,
      set: async (ref: string, value: string) => {
        keys.set(ref, value);
      },
    },
    reflect: {
      provide: (name: string, value: unknown) => {
        ctx[name] = value;
      },
    },
    effect: (fn: () => () => void) => cleanups.push(fn()),
    connection: {
      browserPeer: { principal: { kind: "owner" } },
      fetch: {
        register: (route: any) => {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
  };
  // Accidental account access fails immediately, rather than silently succeeding with a mock login.
  Object.defineProperty(ctx, "identity", {
    get() {
      throw new Error("PAP must not access identity");
    },
  });
  const status = () =>
    routes.get("/api/pap/status").fetch(
      new Request("https://host.test/api/pap/status", {
        method: "POST",
        body: JSON.stringify({
          type: "client-request",
          rpcId: "status",
          method: "pap/status",
          payload: {},
        }),
      }),
    );
  try {
    await apply(ctx);
    assert(!inject.includes("identity"));
    const result = (await (await status()).json()).result;
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.sites, []);
    assert.deepEqual(result.value.connections, []);
    assert.equal(result.value.client.signingKeyConfigured, false);
    assert.equal("personal" in result.value, false);
    assert.equal("personalStatus" in ctx.pap, false);
    assert.equal("hostedPayment" in ctx.pap, false);
    assert.equal(keys.size, 1);
    ctx.connection.browserPeer.principal.kind = "guest";
    assert.equal((await status()).status, 403);
  } finally {
    cleanups.reverse().forEach((fn) => fn());
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unrelated authentication extension cannot force a generic service to log in", async () => {
  const f = fixture();
  let consulted = false;
  const dispose = f.service.registerAuthentication({
    id: "other.identity.v1",
    matches: () => false,
    current: () => {
      consulted = true;
      throw new Error("LOGIN_REQUIRED");
    },
    assert: () => {
      throw new Error("must not check unrelated session");
    },
    client: {
      current: () => undefined,
      ensure: async () => {
        throw new Error("must not enroll");
      },
    },
    grant: async () => {
      throw new Error("must not issue unrelated grant");
    },
  });
  try {
    const connection = await f.service.connect("a");
    await f.service.request(connection.connectionRef, "example.read", {});
    assert.equal(consulted, false);
    dispose();
    f.restart();
    assert.equal(
      (await f.service.connect("a")).connectionRef,
      connection.connectionRef,
    );
    await f.service.disconnect(connection.connectionRef);
  } finally {
    dispose();
    f.close();
  }
});

test("auxiliary requests never forward caller credentials or cross issuer origins", async () => {
  const f = fixture();
  try {
    const { connectionRef } = await f.service.connect("a");
    const before = f.record.calls.length;
    for (const request of [
      { url: "https://evil.test/data", method: "GET" as const },
      ...["Authorization", "authorization", "Cookie", "dPoP"].map((header) => ({
        url: "https://auth.test/data",
        method: "GET" as const,
        headers: { [header]: "secret" },
      })),
    ])
      await assert.rejects(
        f.service.requestBound(connectionRef, request),
        /ENDPOINT_MISMATCH/,
      );
    assert.equal(f.record.calls.length, before);
  } finally {
    f.close();
  }
});

test("the built standalone entry and core have no account or commerce runtime import", () => {
  for (const file of ["index", "core", "client"]) {
    const source = readFileSync(
      new URL(`../dist/${file}.js`, import.meta.url),
      "utf8",
    );
    assert(!source.includes("dsh-identity-client"));
    assert(!source.includes("frontvia-personal-purchase+jwt"));
    assert(!source.includes("hosted-payer/rpc"));
    if (file === "client") {
      assert(!source.includes("dsh-identity-change"));
      assert(!source.includes("打开商城"));
      assert(!source.includes("DSH 账号"));
    }
  }
});

test("an explicit client keeps its standard grant even when an optional identity extension matches", async () => {
  const f = fixture();
  const dispose = f.service.registerAuthentication({
    id: "optional.identity",
    matches: () => true,
    current: () => {
      throw new Error("must not require login for the configured client");
    },
    assert: () => {},
    client: { current: () => undefined, ensure: async () => {} },
    grant: async () => {
      throw new Error("must not change authorization mode");
    },
  });
  try {
    const { connectionRef } = await f.service.connect("a");
    assert.equal(f.service.identity(connectionRef).clientId, f.config.clientId);
    assert.equal(f.service.identity(connectionRef).personalSignedIn, undefined);
    await f.service.request(connectionRef, "example.read", {});
  } finally {
    dispose();
    f.close();
  }
});

test("a new standalone subject never inherits an account-bound subject from another resource", async () => {
  const f = fixture();
  f.vault.set("connection:managed-other", {
    id: "managed-other",
    siteId: "other-resource",
    personalIdentity: "private-account",
    authenticationProvider: "unavailable-provider",
    user: "private-account-subject",
    binding: { clientId: f.config.clientId, issuer: f.config.sites[0].issuer },
  });
  try {
    const { connectionRef } = await f.service.connect("a");
    assert.notEqual(
      f.service.identity(connectionRef).userId,
      "private-account-subject",
    );
    f.restart();
    assert.equal((await f.service.connect("a")).connectionRef, connectionRef);
  } finally {
    f.close();
  }
});
