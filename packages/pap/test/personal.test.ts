import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomBytes,
  createHash,
  generateKeyPairSync,
  createPublicKey,
  verify,
} from "node:crypto";
import {
  PapService,
  Vault,
  PapError,
  type PapConfig,
  type Transport,
} from "../src/core.js";

function fixture(managed = false) {
  const dir = mkdtempSync(join(tmpdir(), "pap-personal-")),
    path = join(dir, "pap.sqlite"),
    key = randomBytes(32).toString("base64url");
  const signing = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  const config: PapConfig = {
    clientId: "https://client.test/client.json",
    callback: "https://client.test/callback",
    signingKeyRef: "SIGN",
    keyId: "one",
    dataDir: dir,
    targets: [],
    personal: {
      origin: "https://identity.test",
      requestOrigin: "https://identity.test",
      tokenOrigins: ["https://shop.test"],
    },
    sites: [
      {
        id: "shop",
        label: "Shop",
        domain: "shop.test",
        issuer: "https://shop.test/companies/a",
        resource: "https://shop.test/consultation/rpc",
      },
    ],
  };
  const policy = managed
    ? {
        dataDir: dir,
        sites: config.sites,
        targets: config.targets,
        personal: config.personal,
        deviceSigningKeyRef: "DEVICE",
      }
    : config;
  const keys = new Map([["SIGN", signing]]);
  const secrets = {
    get: async (ref: string) => keys.get(ref),
    set: async (ref: string, value: string) => {
      keys.set(ref, value);
    },
  };
  let user = "a",
    session = 0,
    block: Promise<void> | undefined,
    logoutFail = false;
  const requests: any[] = [];
  const wire: Transport = async (r) => {
    requests.push(r);
    if (r.url.endsWith("/pap/devices")) {
      const { jwk } = JSON.parse(r.body!);
      const kid = createHash("sha256")
        .update(
          JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
        )
        .digest("base64url");
      return {
        client_id: r.url + "/" + kid + "/agent.json",
        callback: r.url + "/" + kid + "/callback",
        kid,
        registry_version: 2,
      };
    }
    if (r.url.endsWith("/otp/request")) {
      user = JSON.parse(r.body!).target.endsWith("01") ? "a" : "b";
      return { challenge_id: "challenge", expires_in: 300, resend_after: 0 };
    }
    if (r.url.endsWith("/otp/verify")) {
      await block;
      return {
        user_id: user,
        access_token: "fv.personal.v1." + user,
        expires_in: 86400,
      };
    }
    if (r.url.endsWith("/personal/logout")) {
      if (logoutFail) throw new PapError("NETWORK_UNCERTAIN");
      return {};
    }
    if (r.url.endsWith("/personal/me")) return { user_id: user };
    if (r.url.endsWith("poppy.json"))
      return {
        protocol_version: "0.2",
        auth: { issuer: config.sites[0].issuer },
        apis: [{ type: "openapi", resource: config.sites[0].resource }],
      };
    if (r.url.includes("oauth-authorization-server"))
      return {
        issuer: config.sites[0].issuer,
        poppy_domains: ["shop.test"],
        token_endpoint: config.sites[0].issuer + "/oauth/token",
        authorization_endpoint: config.sites[0].issuer + "/oauth/authorize",
        revocation_endpoint: config.sites[0].issuer + "/oauth/revoke",
      };
    if (r.url.endsWith("oauth/token")) {
      const f = new URLSearchParams(r.body);
      assert.equal(
        f.get("grant_type"),
        "urn:frontvia:params:oauth:grant-type:personal",
      );
      assert.equal(f.get("personal_token"), "fv.personal.v1." + user);
      await block;
      return {
        access_token: "access-" + user,
        token_type: "DPoP",
        session_id: "session-" + ++session,
        signed_in: false,
        expires_in: 300,
      };
    }
    const q = JSON.parse(r.body!);
    await block;
    return {
      jsonrpc: "2.0",
      id: q.id,
      result: { data: "private-answer-" + user },
    };
  };
  let vault = new Vault(path, key),
    service = new PapService(policy, secrets, vault, wire);
  return {
    config,
    requests,
    keys,
    path,
    get service() {
      return service;
    },
    get vault() {
      return vault;
    },
    block(p?: Promise<void>) {
      block = p;
    },
    failLogout(v: boolean) {
      logoutFail = v;
    },
    restart() {
      vault.close();
      vault = new Vault(path, key);
      service = new PapService(policy, secrets, vault, wire);
    },
    async login(phone = "+12025550101") {
      await service.personal.requestCode(phone);
      await service.personal.verify("123456");
    },
  };
}
test("phone identity survives restart and re-login; switch hides previous connections and forces fresh tokens", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.service.connect("shop"), {
      code: "PERSONAL_LOGIN_REQUIRED",
    });
    await f.login();
    const first = await f.service.connect("shop"),
      identity = f.service.identity(first.connectionRef);
    assert.equal(first.personalSignedIn, true);
    assert.equal(first.signedIn, false);
    assert(
      !JSON.stringify(f.service.personal.status()).includes("fv.personal"),
    );
    assert(!readFileSync(f.path).includes(Buffer.from("fv.personal.v1.a")));
    f.restart();
    assert.equal((f.service.status() as any[]).length, 1);
    assert.deepEqual(f.service.identity(first.connectionRef), identity);
    await f.service.personal.logout();
    assert.deepEqual(f.service.status(), []);
    assert.throws(() => f.service.identity(first.connectionRef));
    await f.login("+12025550102");
    const other = await f.service.connect("shop");
    assert.notEqual(other.connectionRef, first.connectionRef);
    assert.notEqual(
      f.service.identity(other.connectionRef).userId,
      identity.userId,
    );
    await assert.rejects(
      () =>
        f.service.request(
          first.connectionRef,
          "consultation.conversations.get",
          {},
        ),
      { code: "PERSONAL_ACCOUNT_CHANGED" },
    );
    await f.service.personal.logout();
    await f.login();
    assert.equal((f.service.status() as any[])[0].connected, false);
    const again = await f.service.connect("shop");
    assert.equal(again.connectionRef, first.connectionRef);
    assert.equal(again.connected, true);
    assert.deepEqual(f.service.identity(again.connectionRef), identity);
    await f.service.renew(first.connectionRef);
    assert.equal((f.service.status() as any[]).length, 1);
  } finally {
    f.vault.close();
  }
});
test("imported token origin cannot collect personal credentials; logout uncertainty blocks local use and restart", async () => {
  const f = fixture();
  try {
    await f.login();
    f.config.personal!.tokenOrigins = [];
    await assert.rejects(() => f.service.connect("shop"), {
      code: "PERSONAL_TOKEN_ORIGIN_UNTRUSTED",
    });
    assert(!f.requests.some((r) => r.url.endsWith("oauth/token")));
    f.config.personal!.tokenOrigins = ["https://shop.test"];
    const c = await f.service.connect("shop");
    f.failLogout(true);
    await assert.rejects(() => f.service.personal.logout(), {
      code: "PERSONAL_LOGOUT_PENDING",
    });
    f.restart();
    assert(f.service.personal.status().logoutPending);
    assert.throws(() => f.service.identity(c.connectionRef));
    await assert.rejects(() => f.login(), { code: "PERSONAL_LOGOUT_PENDING" });
    f.failLogout(false);
    await f.service.personal.logout();
    assert(!f.service.personal.status().logoutPending);
  } finally {
    f.vault.close();
  }
});
test("logout while token or resource response is in flight cannot restore access or return the previous account data", async () => {
  const f = fixture();
  try {
    await f.login();
    const c = await f.service.connect("shop");
    let release!: () => void;
    f.block(new Promise((r) => (release = r)));
    const pending = f.service.request(
      c.connectionRef,
      "consultation.conversations.get",
      {},
    );
    await new Promise((r) => setTimeout(r, 10));
    await f.service.personal.logout();
    release();
    await assert.rejects(() => pending, { code: "PERSONAL_LOGIN_REQUIRED" });
    assert.deepEqual(f.service.status(), []);
    f.block();
    await f.login();
    f.block(new Promise((r) => (release = r)));
    const renewal = f.service.renew(c.connectionRef);
    await new Promise((r) => setTimeout(r, 10));
    await f.service.personal.logout();
    release();
    await assert.rejects(() => renewal, { code: "PERSONAL_LOGIN_REQUIRED" });
    assert.deepEqual(f.service.status(), []);
  } finally {
    f.vault.close();
  }
});
test("logout racing OTP verification revokes the newly issued parent login instead of forgetting a live credential", async () => {
  const f = fixture();
  try {
    await f.service.personal.requestCode("+12025550101");
    let release!: () => void;
    f.block(new Promise((r) => (release = r)));
    const verifying = f.service.personal.verify("123456");
    await new Promise((r) => setTimeout(r, 10));
    const out = f.service.personal.logout();
    release();
    await assert.rejects(() => verifying, { code: "PERSONAL_ACCOUNT_CHANGED" });
    await out;
    assert(!f.service.personal.status().signedIn);
    assert(
      f.requests.some(
        (r) =>
          r.url.endsWith("/personal/logout") &&
          r.headers.Authorization === "Bearer fv.personal.v1.a",
      ),
    );
  } finally {
    f.vault.close();
  }
});

test("personal purchase statements use the current resource proof key and cannot survive logout or account switch", async () => {
  const f = fixture();
  try {
    await f.login();
    const c = await f.service.connect("shop");
    const claims = {
      client_id: f.config.clientId,
      issuer: f.config.sites[0].issuer,
      resource: f.config.sites[0].resource,
      checkout_id: "owned-checkout",
      amount_minor: "1734",
      nonce: "fresh-consent",
    };
    const typ = "frontvia-personal-purchase+jwt";
    const token = f.service.signResourceStatement(c.connectionRef, typ, claims);
    const [h, body, signature] = token.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    assert.equal(header.typ, typ);
    assert.equal(header.jwk.d, undefined);
    assert(
      verify(
        "sha256",
        Buffer.from(`${h}.${body}`),
        {
          key: createPublicKey({ key: header.jwk, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    );
    const request = f.requests.findLast((r) => r.url.endsWith("oauth/token"));
    const proofHeader = JSON.parse(
      Buffer.from(request.headers.DPoP.split(".")[0], "base64url").toString(),
    );
    assert.equal(header.jwk.x, proofHeader.jwk.x);
    assert.equal(header.jwk.y, proofHeader.jwk.y);
    assert.throws(
      () =>
        f.service.signResourceStatement(c.connectionRef, typ, {
          ...claims,
          resource: "https://other.test/rpc",
        }),
      /STATEMENT_BINDING_MISMATCH/,
    );
    await f.service.personal.logout();
    assert.throws(
      () => f.service.signResourceStatement(c.connectionRef, typ, claims),
      /PERSONAL_/,
    );
    await f.login("+12025550102");
    assert.throws(
      () => f.service.signResourceStatement(c.connectionRef, typ, claims),
      /PERSONAL_ACCOUNT_CHANGED/,
    );
  } finally {
    f.vault.close();
  }
});

test("replacing a lost device key creates a fresh connection and never sends an old flow under the new key", async () => {
  const f = fixture(true);
  try {
    await f.login();
    const original = await f.service.connect("shop");
    const oldId = f.service.identity(original.connectionRef).clientId;
    f.keys.delete("DEVICE");
    const fresh = await f.service.connect("shop");
    assert.notEqual(fresh.connectionRef, original.connectionRef);
    assert.notEqual(f.service.identity(fresh.connectionRef).clientId, oldId);
    assert.equal(
      (f.service.status(original.connectionRef) as { bindingError?: string })
        .bindingError,
      "DEVICE_IDENTITY_REPLACED",
    );
    const before = f.requests.length;
    await assert.rejects(
      f.service.request(original.connectionRef, "anything.get", {}),
      { code: "DEVICE_IDENTITY_REPLACED" },
    );
    assert.equal(f.requests.length, before);
    f.restart();
    assert.equal(
      (await f.service.connect("shop")).connectionRef,
      fresh.connectionRef,
    );
    assert.equal((f.service.status() as unknown[]).length, 2);
  } finally {
    f.vault.close();
  }
});
