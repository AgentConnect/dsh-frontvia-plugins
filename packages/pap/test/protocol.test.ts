import { fixture } from "./fixtures/protocol.js";
import { test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { PapProvider } from "../src/index.js";
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
test("stored connections reject changed authority before credential or network use", async (t) => {
  for (const field of [
    "clientId",
    "callback",
    "issuer",
    "resource",
    "domain",
  ] as const) {
    await t.test(field, async () => {
      const f = fixture();
      try {
        const c = await f.service.connect("a"),
          ref = c.connectionRef;
        const original = structuredClone(f.config);
        const identity = f.service.identity(ref);
        if (field === "clientId" || field === "callback")
          f.config[field] += "-other";
        else f.config.sites[0][field] += "-other";
        f.restart();
        const before = f.record.calls.length;
        const status = f.service.status(ref);
        assert.ok(!Array.isArray(status));
        assert.equal(status.connected, false);
        assert.equal(status.bindingError, "CONNECTION_BINDING_CHANGED");
        assert.throws(
          () => f.service.identity(ref),
          /CONNECTION_BINDING_CHANGED/,
        );
        for (const action of [
          () => f.service.request(ref, "example.read", {}),
          () => f.service.connect("a"),
          () => f.service.renew(ref),
          () => f.service.authorize(ref, []),
          () => f.service.callback(ref, original.callback),
          () => f.service.disconnect(ref),
        ])
          await assert.rejects(action(), /CONNECTION_BINDING_CHANGED/);
        assert.equal(f.record.calls.length, before);
        Object.assign(f.config, original);
        f.restart();
        assert.deepEqual(f.service.identity(ref), identity);
        await f.service.request(ref, "example.read", {});
      } finally {
        f.close();
      }
    });
  }
});
test("legacy unbound and removed-site records remain visible but cannot send credentials", async () => {
  const f = fixture();
  try {
    const c = await f.service.connect("a"),
      key = `connection:${c.connectionRef}`;
    const stored = f.vault.get<any>(key);
    delete stored.binding;
    f.vault.set(key, stored);
    f.restart();
    const before = f.record.calls.length;
    const status = f.service.status(c.connectionRef);
    assert.ok(!Array.isArray(status));
    assert.equal(status.bindingError, "CONNECTION_BINDING_REQUIRED");
    await assert.rejects(f.service.connect("a"), /CONNECTION_BINDING_REQUIRED/);
    await assert.rejects(
      f.service.request(c.connectionRef, "example.read", {}),
      /CONNECTION_BINDING_REQUIRED/,
    );
    assert.deepEqual(f.vault.get(key), stored);
    f.config.sites = [];
    f.restart();
    assert.equal(
      (f.service.status() as any[])[0].bindingError,
      "SITE_NOT_APPROVED",
    );
    await assert.rejects(
      f.service.request(c.connectionRef, "example.read", {}),
      /SITE_NOT_APPROVED/,
    );
    assert.equal(f.record.calls.length, before);
  } finally {
    f.close();
  }
});
test("display label changes preserve the original identity and usable connection", async () => {
  const f = fixture();
  try {
    const c = await f.service.connect("a"),
      identity = f.service.identity(c.connectionRef);
    f.config.sites[0].label = "Renamed shop";
    f.restart();
    const status = f.service.status(c.connectionRef);
    assert.ok(!Array.isArray(status));
    assert.equal(status.label, "Renamed shop");
    assert.deepEqual(f.service.identity(c.connectionRef), identity);
    await f.service.request(c.connectionRef, "example.read", {});
  } finally {
    f.close();
  }
});
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

test("RPC response budget applies to one host request and does not alter authentication or later reads", async () => {
  const f = fixture();
  try {
    const connection = await f.service.connect("a");
    const provider = new PapProvider(new Context(), f.service);
    await provider.request(
      connection.connectionRef,
      "example.original",
      {},
      undefined,
      { maxResponseBytes: 1414488 },
    );
    assert.equal(f.record.calls.at(-1).maxResponseBytes, 1414488);
    await f.service.request(connection.connectionRef, "example.read", {});
    assert.equal(f.record.calls.at(-1).maxResponseBytes, undefined);
    assert(
      f.record.calls
        .filter((r) => r.url.includes("auth.test"))
        .every((r) => r.maxResponseBytes === undefined),
    );
  } finally {
    f.close();
  }
});

test("valid connection reuse avoids discovery and token issuance but explicit disconnect reconnects", async () => {
  const f = fixture();
  try {
    const first = await f.service.connect("a"),
      count = f.record.calls.length;
    const second = await f.service.connect("a");
    assert.equal(first.connectionRef, second.connectionRef);
    assert.equal(f.record.calls.length, count);
    await f.service.disconnect(first.connectionRef);
    await f.service.connect("a");
    assert(f.record.calls.length > count);
  } finally {
    f.close();
  }
});
