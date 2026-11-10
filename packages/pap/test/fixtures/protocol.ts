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
} from "../../src/core.js";
const pair = () =>
  generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-frontvia-pap-test-")),
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
    paymentBeforeReturn: undefined as (() => void) | undefined,
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
    if (r.url.endsWith("/hosted-payer/rpc")) {
      record.paymentBeforeReturn?.();
      return { data: { payment: { status: "pending" } } };
    }
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
        grant_types_supported: [
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "authorization_code",
          "refresh_token",
        ],
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
    get vault() {
      return vault;
    },
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
