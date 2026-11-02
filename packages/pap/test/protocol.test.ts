import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify,
  createHash,
} from "node:crypto";
import {
  PapService,
  Vault,
  type PapConfig,
  type Transport,
} from "../src/core.js";
const pair = () =>
  generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-pap-test-")),
    keys = pair(),
    secret = randomBytes(32).toString("base64url"),
    db = join(dir, "state.sqlite");
  const config: PapConfig = {
    clientId: "https://client.test/client.json",
    callback: "https://client.test/callback",
    signingKeyRef: "SIGNING",
    keyId: "one",
    dataDir: dir,
    targets: [],
    sites: [
      {
        id: "a",
        label: "A",
        domain: "shop.test",
        issuer: "https://auth.test/a",
        resource: "https://api.test/rpc",
      },
    ],
  };
  const record = {
    signedIn: false,
    token: "private-access",
    calls: [] as any[],
    badIssuer: false,
    session: "session-1",
    expiry: 3600,
    refreshes: 0,
    revoked: false,
  };
  const decode = (jwt: string, key: any) => {
    const [h, p, s] = jwt.split(".");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(h + "." + p),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(s, "base64url"),
      ),
    );
    return JSON.parse(Buffer.from(p, "base64url").toString());
  };
  const transport: Transport = async (r) => {
    record.calls.push(r);
    if (r.url.endsWith("/poppy.json"))
      return {
        protocol_version: "0.2",
        auth: { issuer: config.sites[0].issuer },
        apis: [{ type: "openapi", resource: config.sites[0].resource }],
      };
    if (r.url.includes("oauth-authorization-server"))
      return {
        issuer: record.badIssuer ? "https://evil.test" : config.sites[0].issuer,
        poppy_domains: ["shop.test"],
        token_endpoint: "https://auth.test/token",
        authorization_endpoint: "https://auth.test/authorize",
        revocation_endpoint: "https://auth.test/revoke",
      };
    if (r.url === "https://auth.test/token") {
      const p = new URLSearchParams(r.body),
        a = decode(p.get("client_assertion")!, keys.publicKey);
      assert.equal(a.sub, config.clientId);
      assert.equal(a.aud, config.sites[0].issuer);
      const dpop = r.headers!.DPoP,
        header = JSON.parse(
          Buffer.from(dpop.split(".")[0], "base64url").toString(),
        );
      const proof = decode(
        dpop,
        createPublicKey({ key: header.jwk, format: "jwk" }),
      );
      assert.equal(proof.htu, r.url);
      assert.equal(proof.htm, "POST");
      assert.ok(!proof.ath);
      if (p.get("grant_type") === "authorization_code") {
        assert.ok(p.get("code_verifier"));
        record.signedIn = true;
      } else if (p.get("grant_type") === "refresh_token") {
        assert.equal(p.get("refresh_token"), "private-refresh");
        record.refreshes++;
      } else {
        const s = decode(p.get("assertion")!, keys.publicKey);
        assert.notEqual(s.sub, config.clientId);
      }
      return {
        access_token: record.token,
        token_type: "DPoP",
        session_id: record.session,
        expires_in: record.expiry,
        signed_in: record.signedIn,
        ...(record.signedIn ? { refresh_token: "private-refresh" } : {}),
      };
    }
    if (r.url === "https://auth.test/revoke") {
      record.revoked = true;
      return {};
    }
    const body = JSON.parse(r.body!);
    const h = JSON.parse(
      Buffer.from(r.headers!.DPoP.split(".")[0], "base64url").toString(),
    );
    const p = decode(
      r.headers!.DPoP,
      createPublicKey({ key: h.jwk, format: "jwk" }),
    );
    assert.equal(
      p.ath,
      createHash("sha256").update(record.token).digest("base64url"),
    );
    assert.equal(p.htu, config.sites[0].resource);
    return { jsonrpc: "2.0", id: body.id, result: { data: { ok: true } } };
  };
  const secrets = { get: async () => keys.privateKey, set: async () => {} };
  let vault = new Vault(db, secret),
    service = new PapService(config, secrets, vault, transport);
  return {
    config,
    record,
    transport,
    db,
    secret,
    get service() {
      return service;
    },
    close: () => vault.close(),
    restart() {
      vault.close();
      vault = new Vault(db, secret);
      service = new PapService(config, secrets, vault, transport);
    },
  };
}
test("actual ES256 assertions and DPoP; encrypted stable identity survives restart", async () => {
  const f = fixture();
  try {
    const c = await f.service.connect("a");
    const subject = f.service.identity(c.connectionRef).userId;
    await f.service.request(c.connectionRef, "example.read", {});
    assert.ok(!JSON.stringify(f.service.status()).includes("private-access"));
    assert.ok(!readFileSync(f.db).includes(Buffer.from("private-access")));
    f.restart();
    const c2 = await f.service.connect("a");
    assert.equal(c2.connectionRef, c.connectionRef);
    assert.equal(f.service.identity(c2.connectionRef).userId, subject);
    await f.service.request(c2.connectionRef, "example.read", {});
  } finally {
    f.close();
  }
});
test("reject discovery issuer mismatch and unknown site before authentication", async () => {
  const f = fixture();
  try {
    f.record.badIssuer = true;
    await assert.rejects(f.service.connect("a"), /ISSUER_MISMATCH/);
    await assert.rejects(f.service.connect("other"), /SITE_NOT_APPROVED/);
    assert.equal(
      f.record.calls.filter((x) => x.url.endsWith("/token")).length,
      0,
    );
  } finally {
    f.close();
  }
});
test("Direct Sign-In callback binds issuer, state, callback origin and PKCE; account refresh and revoke", async () => {
  const f = fixture();
  try {
    const c = await f.service.connect("a");
    const { url } = await f.service.authorize(c.connectionRef, ["orders:read"]);
    const q = new URL(url).searchParams;
    assert.equal(q.get("code_challenge_method"), "S256");
    const cb = new URL(f.config.callback);
    cb.search = new URLSearchParams({
      code: "one",
      state: q.get("state")!,
      iss: f.config.sites[0].issuer,
    }).toString();
    await assert.rejects(
      f.service.callback(
        c.connectionRef,
        cb.toString().replace("client.test", "evil.test"),
      ),
      /CALLBACK_REJECTED/,
    );
    await assert.rejects(
      f.service.callback(c.connectionRef, cb + "&state=duplicate"),
      /CALLBACK_REJECTED/,
    );
    await f.service.callback(c.connectionRef, cb.toString());
    await assert.rejects(
      f.service.callback(c.connectionRef, cb.toString()),
      /CALLBACK_REJECTED/,
    );
    await f.service.renew(c.connectionRef);
    assert.equal(f.record.refreshes, 1);
    await f.service.disconnect(c.connectionRef);
    assert.equal(f.record.revoked, true);
    await assert.rejects(
      f.service.request(c.connectionRef, "example.read", {}),
      /CONNECTION_DISCONNECTED/,
    );
    await assert.rejects(
      f.service.connect("a"),
      /ACCOUNT_REAUTHORIZATION_REQUIRED/,
    );
  } finally {
    f.close();
  }
});
test("session identity replacement and signed-in downgrade are rejected", async () => {
  const f = fixture();
  try {
    const c = await f.service.connect("a");
    f.record.session = "other";
    await assert.rejects(f.service.renew(c.connectionRef), /SESSION_CHANGED/);
  } finally {
    f.close();
  }
});
test("expired sessions renew before resource access and explicit disconnect is not silently renewed", async () => {
  const f = fixture();
  try {
    f.record.expiry = 1;
    const c = await f.service.connect("a");
    const before = f.record.calls.length;
    await f.service.request(c.connectionRef, "example.read", {});
    assert.equal(
      f.record.calls.slice(before).filter((x) => x.url.endsWith("/token"))
        .length,
      1,
    );
    await f.service.disconnect(c.connectionRef);
    await assert.rejects(
      f.service.request(c.connectionRef, "example.read", {}),
      /CONNECTION_DISCONNECTED/,
    );
  } finally {
    f.close();
  }
});
