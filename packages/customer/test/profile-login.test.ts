import { AccountClient } from "dsh-frontvia-client/core";
const defaultPersonalConfig = {
  origin: "https://identity.test",
  requestOrigin: "https://dsh.test",
  audiences: ["https://shop.test/companies/a"],
};
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply as applyPap } from "dsh-frontvia-pap";
import { apply as applyCustomer } from "../src/index.js";
import {
  openProfileVault,
  PapError,
  PapService,
  profileStorage,
  type Secrets,
  type Transport,
} from "dsh-frontvia-pap/core";

function credentialStore() {
  const values = new Map<string, string>();
  const secrets: Secrets = {
    get: async (ref) => values.get(ref),
    set: async (ref, value) => {
      values.set(ref, value);
    },
  };
  return { values, secrets };
}

test("a DSH profile installing both bundles without config registers the login, list and PAP status routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-frontvia-install-"));
  const { values, secrets } = credentialStore();
  const cleanups: (() => void)[] = [];
  const routes = new Map<string, any>();
  const ctx: any = {
    profileContext: { name: "desktop", dir },
    credentials: {
      resolve: async (key: string) => ({ value: await secrets.get(key) }),
      set: secrets.set,
    },
    reflect: {
      provide: (name: string, value: any) => {
        ctx[name] = value;
      },
    },
    connection: {
      browserPeer: { principal: { kind: "owner" } },
      fetch: {
        register(route: any) {
          routes.set(route.path, route);
          return () => {
            routes.delete(route.path);
          };
        },
      },
    },
    effect: (fn: () => () => void) => cleanups.push(fn()),
    systemPrompt: { section() {} },
    tools: { register() {} },
  };
  async function call(method: string) {
    const path = "/api/" + method;
    const response = await routes.get(path).fetch(
      new Request("http://localhost" + path, {
        method: "POST",
        body: JSON.stringify({
          type: "client-request",
          rpcId: "install",
          method,
          payload: {},
        }),
      }),
    );
    const body = await response.json();
    assert.equal(body.result.ok, true);
    return body.result.value;
  }
  try {
    const accountVault = await openProfileVault(
      join(dir, "identity.sqlite"),
      "IDENTITY",
      secrets,
    );
    cleanups.push(() => accountVault.close());
    ctx.frontviaIdentity = {
      account: new AccountClient(
        defaultPersonalConfig,
        accountVault,
        secrets,
        async () => {
          throw new Error("unexpected network");
        },
        "DEVICE",
      ),
    };
    await applyPap(ctx);
    await applyCustomer(ctx);
    assert.deepEqual(await call("frontvia-customer/list"), {
      flows: [],
      sites: [],
    });
    assert.equal("personal" in (await call("frontvia-pap/status")), false);
    assert.equal(
      (await call("frontvia-customer/personal-status")).signedIn,
      false,
    );
    assert.ok(routes.has("/api/frontvia-customer/personal-verify"));
    assert.equal(
      values.size,
      3,
      "the identity, PAP and customer vaults have separate encryption keys",
    );
  } finally {
    cleanups.reverse().forEach((dispose) => dispose());
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default account verifies an existing session after restart, isolates profiles and prompts for OTP again after revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-frontvia-restore-"));
  const { secrets } = credentialStore();
  let me: "ok" | "offline" | "revoked" = "ok";
  const wire: Transport = async (request) => {
    assert.equal(new URL(request.url).origin, defaultPersonalConfig.origin);
    if (request.url.endsWith("/otp/request"))
      return { challenge_id: "opaque", expires_in: 300, resend_after: 0 };
    if (request.url.endsWith("/otp/verify"))
      return {
        user_id: "first",
        access_token: "dsh.personal.first",
        expires_in: 3600,
      };
    assert.ok(request.url.endsWith("/me"));
    assert.equal(request.headers?.Authorization, "Bearer dsh.personal.first");
    if (me !== "ok")
      throw new PapError(me === "revoked" ? "HTTP_401" : "NETWORK_UNCERTAIN");
    return { user_id: "first" };
  };
  async function start(name: string) {
    const config = {
      ...profileStorage({ name, dir: join(dir, name) }, "pap"),
      targets: [],
      personal: defaultPersonalConfig,
    };
    const vault = await openProfileVault(
      join(config.dataDir, "pap.sqlite"),
      config.storageKeyRef,
      secrets,
    );
    const account = new AccountClient(
      defaultPersonalConfig,
      vault,
      secrets,
      wire,
      "DEVICE",
    );
    const service = new PapService(config, secrets, vault, wire);
    return {
      service,
      account,
      close() {
        service.close();
        vault.close();
      },
    };
  }
  let host = await start("desktop");
  try {
    assert.equal((await host.account.refresh()).signedIn, false);
    await host.account.requestCode("+12025550101");
    await host.account.verify("123456");
    host.close();
    host = await start("desktop");
    assert.equal((await host.account.refresh()).signedIn, true);
    const other = await start("another");
    try {
      assert.equal((await other.account.refresh()).signedIn, false);
    } finally {
      other.close();
    }
    me = "offline";
    await assert.rejects(host.account.refresh(), {
      code: "NETWORK_UNCERTAIN",
    });
    me = "ok";
    assert.equal((await host.account.refresh()).signedIn, true);
    me = "revoked";
    assert.equal((await host.account.refresh()).signedIn, false);
    assert.ok((await host.account.requestCode("+12025550101")).challenge);
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
