import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, sign, verify } from "node:crypto";
// @ts-expect-error Standalone Node provisioning entrypoint has no runtime TS dependency.
import { preparePublicClient } from "../../../scripts/prepare-public-client.mjs";

test("public client preparation exports only a matching ES256 public key and keeps independent purchase/signing secrets private", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pap-public-client-"));
  const dir = join(parent, "identity");
  const id = "https://buyer.example.com/dsh/agent.json";
  const manifest = await preparePublicClient(dir, id);
  const json = async (file: string) =>
    JSON.parse(await readFile(join(dir, file), "utf8"));
  const metadata = await json("public/agent.json"),
    jwks = await json("public/jwks.json"),
    secrets = await json("bootstrap-secrets.json");
  assert.equal(metadata.client_id, id);
  assert.deepEqual(metadata.redirect_uris, [
    "https://buyer.example.com/dsh/callback",
  ]);
  assert.equal(metadata.jwks_uri, "https://buyer.example.com/dsh/jwks.json");
  assert.equal(jwks.keys[0].d, undefined);
  assert.equal(jwks.keys[0].kid, manifest.keyId);
  const assertion = Buffer.from("PAP client assertion");
  const signature = sign("sha256", assertion, {
    key: secrets[manifest.refs.signing],
    dsaEncoding: "ieee-p1363",
  });
  assert.ok(
    verify(
      "sha256",
      assertion,
      {
        key: createPublicKey({ key: jwks.keys[0], format: "jwk" }),
        dsaEncoding: "ieee-p1363",
      },
      signature,
    ),
  );
  assert.equal(
    Buffer.from(secrets[manifest.refs.confirmation], "base64url").length,
    32,
  );
  for (const file of manifest.publicFiles) {
    const text = await readFile(join(dir, "public", file), "utf8");
    assert.ok(!text.includes(secrets[manifest.refs.confirmation]));
    assert.ok(!text.includes("PRIVATE KEY"));
  }
  assert.equal(
    (await stat(join(dir, "bootstrap-secrets.json"))).mode & 0o777,
    0o600,
  );
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  await assert.rejects(preparePublicClient(dir, id), /EEXIST/);
  assert.deepEqual(
    await json("bootstrap-secrets.json"),
    secrets,
    "second run never rotates existing credentials",
  );
});

test("public identity preparation rejects fixture and unsafe URLs before creating files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pap-public-denied-"));
  for (const id of [
    "http://buyer.example.com/agent.json",
    "https://agent.test/c1/agent.json",
    "https://buyer.example.com:8443/agent.json",
    "https://u:p@buyer.example.com/agent.json",
    "https://buyer.example.com/agent.json?q=secret",
    "https://127.0.0.1/agent.json",
  ]) {
    const directory = join(root, "rejected");
    await assert.rejects(
      preparePublicClient(directory, id),
      /PUBLIC_CLIENT_URL_REQUIRED/,
    );
    await assert.rejects(stat(directory), /ENOENT/);
  }
});
