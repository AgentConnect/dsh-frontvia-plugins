import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceIdentity } from "../src/device.js";
import { PersonalAccount } from "../src/personal.js";
import { Vault, PapError } from "../src/storage.js";
import type { Transport } from "../src/network.js";

test("device enrollment retries with the same local key, verifies authority and coalesces concurrent merchant connections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pap-device-"));
  const vault = new Vault(
    join(dir, "device.sqlite"),
    randomBytes(32).toString("base64url"),
  );
  const values = new Map<string, string>();
  const secrets = {
    get: async (k: string) => values.get(k),
    set: async (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const origin = "https://company.test";
  let attempts = 0;
  const kids: string[] = [];
  const wire: Transport = async (req) => {
    if (req.url.endsWith("/otp/request"))
      return { challenge_id: "opaque", expires_in: 300, resend_after: 0 };
    if (req.url.endsWith("/otp/verify"))
      return {
        user_id: "person",
        access_token: "fv.personal.test-device",
        expires_in: 3600,
      };
    assert.equal(req.url, origin + "/v1/personal/pap/devices");
    const jwk = JSON.parse(req.body!).jwk;
    assert.equal(jwk.d, undefined);
    const [header, claims, signature] = req.headers!.DPoP.split(".");
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part, "base64url").toString());
    assert.deepEqual(decode(header).jwk, jwk);
    assert.ok(
      verify(
        "sha256",
        Buffer.from(header + "." + claims),
        {
          key: createPublicKey({ key: jwk, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    );
    assert.equal(decode(claims).htu, req.url);
    assert.equal(
      decode(claims).ath,
      createHash("sha256")
        .update("fv.personal.test-device")
        .digest("base64url"),
    );
    const kid = createHash("sha256")
      .update(
        JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
      )
      .digest("base64url");
    kids.push(kid);
    attempts++;
    if (attempts === 1) throw new PapError("NETWORK_UNCERTAIN");
    if (attempts === 2)
      return {
        kid,
        client_id: "https://foreign.test/agent.json",
        callback: "https://foreign.test/callback",
      };
    const base = req.url + "/test-ticket";
    return {
      kid,
      client_id: base + "/agent.json",
      callback: base + "/callback",
    };
  };
  const account = new PersonalAccount(
    { origin, requestOrigin: origin, tokenOrigins: [origin] },
    vault,
    wire,
  );
  const device = new DeviceIdentity("DEVICE", account, vault, secrets, wire);
  try {
    await assert.rejects(device.ensure(), { code: "PERSONAL_LOGIN_REQUIRED" });
    assert.equal(values.size, 0);
    await account.requestCode("+12025550101");
    await account.verify("123456");
    await assert.rejects(device.ensure(), { code: "NETWORK_UNCERTAIN" });
    await assert.rejects(device.ensure(), { code: "INVALID_DEVICE_IDENTITY" });
    assert.equal(device.current(), undefined);
    const [a, b] = await Promise.all([device.ensure(), device.ensure()]);
    assert.deepEqual(a, b);
    assert.equal(attempts, 3);
    assert.equal(new Set(kids).size, 1);
    assert.deepEqual(
      await new DeviceIdentity(
        "DEVICE",
        account,
        vault,
        secrets,
        wire,
      ).ensure(),
      a,
    );
    assert.equal(attempts, 3);
  } finally {
    vault.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
