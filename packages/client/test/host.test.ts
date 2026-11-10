import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { apply } from "../src/index.js";
import { Vault, profileStorage } from "../src/core.js";
import { serverResponseSchema } from "@deepseek-ai/dsh-client-connection";

test("independent owner routes and offline device migration never import a personal bearer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "identity-host-")),
    routes = new Map<string, any>(),
    dispose: (() => void)[] = [];
  const credentials = new Map<string, string>(),
    storageKey = randomBytes(32).toString("base64url");
  const profile = { name: "isolated", dir };
  const old = join(dir, "legacy.sqlite"),
    configFile = join(dir, "identity.json");
  const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  credentials.set("OLD_STORAGE", storageKey);
  credentials.set("OLD_DEVICE", privateKey);
  const device = {
    clientId: "https://legacy.test/v1/personal/pap/devices/known/agent.json",
    signingKeyRef: "OLD_DEVICE",
    keyId: "legacy",
    callback: "https://legacy.test/v1/personal/pap/devices/known/callback",
  };
  const vault = new Vault(old, storageKey);
  vault.set("pap-device", device);
  vault.set("personal-account", {
    login: { token: "never-copy-this-bearer" },
    challenge: { code: "never-copy-this-otp" },
  });
  vault.close();
  writeFileSync(
    configFile,
    JSON.stringify({
      origin: "https://identity.test",
      requestOrigin: "https://dsh.test",
      audiences: ["https://shop.test/companies/a"],
      legacy: {
        origin: "https://legacy.test",
        subjects: ["00000000-0000-4000-8000-000000000001"],
      },
      legacyVault: {
        path: old,
        keyRef: "OLD_STORAGE",
        deviceKeyRef: "OLD_DEVICE",
      },
    }),
    { mode: 0o600 },
  );
  const ctx: any = {
    profileContext: profile,
    reflect: { provide: (name: string, v: any) => (ctx[name] = v) },
    credentials: {
      resolve: async (r: any) => ({
        value: credentials.get(r.ref ?? r.key ?? r),
      }),
      set: async (r: any, v: string) => credentials.set(r.ref ?? r.key ?? r, v),
    },
    effect: (fn: () => any) => {
      const d = fn();
      if (d) dispose.push(d);
    },
    connection: {
      browserPeer: { principal: { kind: "owner" } },
      fetch: {
        register: (r: any) => {
          routes.set(r.path, r);
          return () => routes.delete(r.path);
        },
      },
    },
  };
  const otherIdentity = { kind: "other-identity" };
  ctx.identity = otherIdentity;
  // credentialRef is an opaque branded string in the host SDK.
  try {
    await apply(ctx, { configFile });
    assert.equal(ctx.identity, otherIdentity);
    assert.notEqual(ctx.frontviaIdentity, otherIdentity);
    assert(
      [...routes.keys()].every((path) =>
        path.startsWith("/api/frontvia-identity/"),
      ),
    );
    assert(!routes.has("/api/identity/status"));
    const call = async (op: string, payload: any = {}) =>
      routes.get("/api/frontvia-identity/" + op).fetch(
        new Request("http://localhost/api/frontvia-identity/" + op, {
          method: "POST",
          body: JSON.stringify({
            type: "client-request",
            rpcId: "owner-test",
            method: "frontvia-identity/" + op,
            payload,
          }),
        }),
      );
    const status = await call("status");
    assert.equal(status.headers.get("cache-control"), "no-store");
    const message = serverResponseSchema.parse(await status.json());
    assert(message.result.ok);
    assert.equal((message.result as any).value.signedIn, false);
    assert(!JSON.stringify(message).includes("never-copy"));
    const invalid = await call("status", { token: "injected" });
    assert.equal(
      (await invalid.json()).result.error.code,
      "INVALID_UI_REQUEST",
    );
    ctx.connection.browserPeer.principal.kind = "guest";
    assert.equal(
      (await call("requestCode", { phone: "+8613800000000" })).status,
      403,
    );
    assert.throws(
      () => ctx.frontviaIdentity.account.current(),
      /PERSONAL_LOGIN_REQUIRED/,
    );
  } finally {
    for (const d of dispose.reverse()) d();
  }
  const reduced = JSON.parse(readFileSync(configFile, "utf8"));
  delete reduced.legacyVault;
  writeFileSync(configFile, JSON.stringify(reduced), { mode: 0o600 });
  dispose.length = 0;
  try {
    await apply(ctx, { configFile });
    assert.equal(ctx.identity, otherIdentity);
    assert.notEqual(ctx.frontviaIdentity, otherIdentity);
    assert(
      [...routes.keys()].every((path) =>
        path.startsWith("/api/frontvia-identity/"),
      ),
    );
    assert(!routes.has("/api/identity/status"));
    assert.equal(
      ctx.frontviaIdentity.account.device.current()?.clientId,
      device.clientId,
    );
  } finally {
    for (const d of dispose.reverse()) d();
  }
  try {
    const paths = profileStorage(profile, "identity"),
      key = credentials.get(paths.storageKeyRef)!;
    const migrated = new Vault(join(paths.dataDir, "identity.sqlite"), key);
    assert.deepEqual(migrated.get("pap-device"), device);
    assert.equal(migrated.get("personal-account"), undefined);
    migrated.close();
    const retained = new Vault(old, storageKey);
    assert.equal(
      retained.get<any>("personal-account").login.token,
      "never-copy-this-bearer",
    );
    retained.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
