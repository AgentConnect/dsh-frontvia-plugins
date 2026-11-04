import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes, createHash } from "node:crypto";
import {
  PapService,
  Vault,
  type Transport,
  type PapConfig,
} from "../src/core.js";
import { publicTransport, isPublicAddress } from "../src/network.js";
const origin = "https://merchant.test",
  issuer = origin + "/companies/a";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pap-import-")),
    storage = randomBytes(32).toString("base64url"),
    key = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
  const config: PapConfig = {
    clientId: "https://client.test/agent.json",
    callback: "https://client.test/callback",
    signingKeyRef: "SIGN",
    keyId: "one",
    sites: [],
    targets: [],
    dataDir: dir,
  };
  const exported = {
    format: "frontvia.consultation.connection.v1",
    profile: "frontvia.merchant_consultation.v1",
    discovery_url: origin + "/.well-known/poppy.json",
    openapi_url: origin + "/consultation/openapi.json",
    sites: [
      {
        id: "consult",
        label: "商家咨询",
        domain: "merchant.test",
        issuer,
        resource: origin + "/consultation/rpc",
      },
    ],
    authorization: {
      allowed_client_ids: [config.clientId],
      resource: origin + "/consultation/rpc",
      token_type: "DPoP",
    },
    service: { store_id: "a1", environment: "test" },
    verification: { service: "ready", client_connection: "unverified" },
  };
  const record = {
    calls: [] as any[],
    foreignContract: false,
    badIssuer: false,
    beforeRpc: undefined as undefined | (() => Promise<void>),
    beforeToken: undefined as undefined | (() => Promise<void>),
  };
  const wire: Transport = async (r) => {
    record.calls.push(structuredClone(r));
    if (r.url.endsWith("poppy.json"))
      return {
        protocol_version: "0.2",
        auth: { issuer: record.badIssuer ? "https://evil.test" : issuer },
        apis: ["consultation", "commerce"].map((name) => ({
          type: "openapi",
          url: `${origin}/${name}/openapi.json`,
          resource: `${origin}/${name}/rpc`,
        })),
      };
    if (r.url.includes("oauth-authorization-server"))
      return {
        issuer,
        poppy_domains: ["merchant.test"],
        token_endpoint: origin + "/token",
        authorization_endpoint: origin + "/authorize",
        revocation_endpoint: origin + "/revoke",
      };
    if (r.url.endsWith("consultation/openapi.json"))
      return {
        openapi: "3.1.0",
        info: { title: "Consultation" },
        paths: { "/consultation/rpc": { post: {} } },
        "x-profile": "frontvia.merchant_consultation.v1",
        "x-methods": [
          "consultation.capabilities.get",
          "consultation.messages.submit",
        ],
      };
    if (r.url.endsWith("commerce/openapi.json"))
      return {
        openapi: "3.1.0",
        info: { title: "Commerce" },
        paths: { "/commerce/rpc": { post: {} } },
        externalDocs: {
          url: record.foreignContract
            ? "https://other.test/openrpc.json"
            : origin + "/commerce/openrpc.json",
        },
      };
    if (r.url.endsWith("openrpc.json"))
      return {
        openrpc: "1.4.0",
        methods: [
          { name: "commerce.capabilities.get" },
          { name: "commerce.products.search" },
        ],
      };
    if (r.url.endsWith("/token")) {
      await record.beforeToken?.();
      const p = new URLSearchParams(r.body);
      return {
        access_token: `token:${p.get("resource")}`,
        token_type: "DPoP",
        session_id: createHash("sha256")
          .update(p.get("resource")!)
          .digest("hex"),
        signed_in: false,
        expires_in: 3600,
      };
    }
    await record.beforeRpc?.();
    const body = JSON.parse(r.body!);
    return { jsonrpc: "2.0", id: body.id, result: { data: { ok: true } } };
  };
  let vault = new Vault(join(dir, "pap.sqlite"), storage),
    service = new PapService(
      config,
      { get: async () => key, set: async () => {} },
      vault,
      wire,
    );
  return {
    config,
    exported,
    record,
    get service() {
      return service;
    },
    get vault() {
      return vault;
    },
    restart() {
      vault.close();
      vault = new Vault(join(dir, "pap.sqlite"), storage);
      service = new PapService(
        config,
        { get: async () => key, set: async () => {} },
        vault,
        wire,
      );
    },
    close() {
      vault.close();
    },
  };
}
test("inspect verifies two published resources without authentication; import and audience isolation survive restart", async () => {
  const f = fixture();
  try {
    const preview = await f.service.inspect(f.exported);
    assert.equal(preview.verification, "discovered");
    assert.equal(preview.sites.length, 2);
    assert.equal(f.service.sites().length, 0);
    assert.deepEqual(f.service.status(), []);
    assert.ok(
      f.record.calls.every(
        (r) => r.method === "GET" && !r.headers?.Authorization,
      ),
    );
    await f.service.importResources(
      preview.previewId,
      preview.sites.map((s) => s.resource),
    );
    f.restart();
    const sites = f.service.sites(),
      commerce = sites.find((s) =>
        s.description!.methods.includes("commerce.capabilities.get"),
      )!;
    const a = await f.service.connect("consult"),
      b = await f.service.connect(commerce.id);
    assert.equal(
      f.service.identity(a.connectionRef).userId,
      f.service.identity(b.connectionRef).userId,
    );
    await f.service.request(
      a.connectionRef,
      "consultation.capabilities.get",
      {},
    );
    await f.service.request(b.connectionRef, "commerce.capabilities.get", {});
    const requests = f.record.calls.filter((r) => r.url.endsWith("/rpc"));
    assert.notEqual(
      requests[0].headers.Authorization,
      requests[1].headers.Authorization,
    );
    const header = (r: any) =>
      JSON.parse(
        Buffer.from(r.headers.DPoP.split(".")[0], "base64url").toString(),
      );
    assert.notDeepEqual(header(requests[0]).jwk, header(requests[1]).jwk);
    const before = f.record.calls.length;
    await assert.rejects(
      f.service.request(a.connectionRef, "commerce.checkouts.confirm", {}),
      /METHOD_NOT_ADVERTISED/,
    );
    assert.equal(f.record.calls.length, before);
    const subject = f.service.identity(b.connectionRef).userId;
    f.restart();
    assert.equal(f.service.identity(b.connectionRef).userId, subject);
    assert.equal(f.service.sites().length, 2);
  } finally {
    f.close();
  }
});
test("legacy exported allowlists no longer require merchant approval; actual token authentication still runs", async () => {
  const f = fixture();
  try {
    f.exported.authorization.allowed_client_ids = [
      "https://other-client.test/agent.json",
    ];
    const preview = await f.service.inspect(f.exported);
    assert.equal(
      preview.sites.find((s) => s.id === "consult")!.clientAllowed,
      undefined,
    );
    assert.equal(
      preview.sites.find((s) => s.id !== "consult")!.clientAllowed,
      undefined,
    );
    await f.service.importResources(preview.previewId, [
      f.exported.sites[0].resource,
    ]);
    const before = f.record.calls.length;
    const c = await f.service.connect("consult");
    assert(f.record.calls.length > before);
    assert(c.connected);
  } finally {
    f.close();
  }
});
test("import rejects discovery mismatches, foreign contracts, credentials and binding replacement", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.service.inspect({ ...f.exported, private_key: "do-not-import" }),
    );
    assert.equal(f.record.calls.length, 0);
    f.record.badIssuer = true;
    await assert.rejects(f.service.inspect(f.exported), /DISCOVERY_MISMATCH/);
    f.record.badIssuer = false;
    f.record.foreignContract = true;
    await assert.rejects(
      f.service.inspect(f.exported),
      /CONTRACT_ORIGIN_MISMATCH/,
    );
    f.record.foreignContract = false;
    assert.ok(
      !f.record.calls.some((r) => r.url.startsWith("https://other.test")),
    );
    const preview = await f.service.inspect(f.exported);
    f.config.sites.push({
      ...f.exported.sites[0],
      resource: origin + "/old-resource",
    });
    await assert.rejects(
      f.service.importResources(preview.previewId, [
        f.exported.sites[0].resource,
      ]),
      /SITE_BINDING_CONFLICT/,
    );
    assert.equal(f.vault.get("imported-sites"), undefined);
    assert.equal(f.service.sites()[0].resource, origin + "/old-resource");
  } finally {
    f.close();
  }
});
test("inspection is expiring and cannot be used to add an uninspected resource", async (t) => {
  const f = fixture();
  try {
    const preview = await f.service.inspect(f.exported);
    await assert.rejects(
      f.service.importResources(preview.previewId, [origin + "/admin/rpc"]),
      /INVALID_IMPORT_SELECTION/,
    );
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 600001);
    await assert.rejects(
      f.service.importResources(preview.previewId, [
        f.exported.sites[0].resource,
      ]),
      /IMPORT_PREVIEW_EXPIRED/,
    );
    assert.deepEqual(f.service.sites(), []);
  } finally {
    f.close();
  }
});
test("public discovery blocks private/reserved addresses and DNS rebinding before HTTPS", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.168.1.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
    const wire = publicTransport([origin], (async () => [
      { address, family: address.includes(":") ? 6 : 4 },
    ]) as any);
    await assert.rejects(
      wire({ url: origin + "/poppy.json", method: "GET" }),
      /PUBLIC_HTTPS_REQUIRED/,
    );
  }
  assert.ok(isPublicAddress("1.1.1.1"));
  assert.ok(isPublicAddress("2606:4700:4700::1111"));
  let resolved = false;
  const wire = publicTransport([origin], (async () => {
    resolved = true;
    return [];
  }) as any);
  await assert.rejects(
    wire({ url: "https://unapproved.test/rpc", method: "POST" }),
    /TARGET_NOT_APPROVED/,
  );
  assert.equal(resolved, false);
});

test("removing one resource preserves identity and sibling access; restart and restore never resume old credentials", async () => {
  const f = fixture();
  try {
    const preview = await f.service.inspect(f.exported);
    await f.service.importResources(
      preview.previewId,
      preview.sites.map((s) => s.resource),
    );
    const consult = f.service.sites().find((s) => s.id === "consult")!;
    const commerce = f.service.sites().find((s) => s.id !== "consult")!;
    const a = await f.service.connect(consult.id),
      b = await f.service.connect(commerce.id);
    const identity = f.service.identity(a.connectionRef);
    const original = f.vault.get<any>(`connection:${a.connectionRef}`);
    const pendingPreview = await f.service.inspect(f.exported);
    const calls = f.record.calls.length;
    await f.service.removeSite(consult.id, consult.revision);
    assert.equal(
      f.record.calls.length,
      calls,
      "local removal does not revoke or cancel remote effects",
    );
    assert.deepEqual(
      f.service.sites().map((s) => s.id),
      [commerce.id],
    );
    const status = f.service.status(a.connectionRef);
    assert.ok(!Array.isArray(status));
    assert.equal(status.connected, false);
    await assert.rejects(
      f.service.request(a.connectionRef, "consultation.messages.submit", {}),
      /SITE_NOT_APPROVED/,
    );
    await assert.rejects(f.service.connect(consult.id), /SITE_NOT_APPROVED/);
    await assert.rejects(
      f.service.importResources(pendingPreview.previewId, [consult.resource]),
      /IMPORT_PREVIEW_EXPIRED/,
    );
    assert.equal(f.record.calls.length, calls);
    const retained = f.vault.get<any>(`connection:${a.connectionRef}`);
    assert.equal(retained.user, original.user);
    assert.equal(retained.proofKey, original.proofKey);
    assert.equal(retained.sessionId, original.sessionId);
    assert.equal(retained.accessToken, undefined);
    assert.equal(retained.refreshToken, undefined);
    assert.equal(retained.disconnected, true);
    await f.service.request(b.connectionRef, "commerce.products.search", {});
    f.restart();
    assert.deepEqual(
      f.service.sites().map((s) => s.id),
      [commerce.id],
    );
    const removed = f.service.removedSites()[0];
    const beforeRestore = f.record.calls.length;
    await f.service.restoreSite(removed.id, removed.revision);
    assert.equal(f.record.calls.length, beforeRestore);
    await assert.rejects(
      f.service.request(a.connectionRef, "consultation.messages.submit", {}),
      /CONNECTION_DISCONNECTED/,
    );
    await assert.rejects(
      f.service.renew(a.connectionRef),
      /CONNECTION_DISCONNECTED/,
    );
    await assert.rejects(
      f.service.removeSite(consult.id, consult.revision),
      /SITE_REVISION_CHANGED/,
    );
    assert.equal(f.record.calls.length, beforeRestore);
    assert.deepEqual(f.service.identity(a.connectionRef), identity);
    const reconnected = await f.service.connect(consult.id);
    assert.equal(reconnected.connectionRef, a.connectionRef);
    await f.service.request(
      a.connectionRef,
      "consultation.messages.submit",
      {},
    );
    assert.equal(f.service.removedSites().length, 0);
  } finally {
    f.close();
  }
});

test("file-configured legacy service can be removed and restored without overwriting the config or migrating credentials", async () => {
  const f = fixture();
  try {
    f.config.sites.push({ ...f.exported.sites[0] });
    const legacy = {
      id: "legacy",
      siteId: "consult",
      user: "old-subject",
      proofKey: "old-proof",
      metadata: {},
      accessToken: "old-token",
    };
    f.vault.set("connection:legacy", legacy);
    const before = structuredClone(f.config);
    await f.service.removeSite("consult", f.service.sites()[0].revision);
    f.restart();
    assert.deepEqual(f.service.sites(), []);
    assert.deepEqual(f.config, before);
    const removed = f.service.removedSites()[0];
    await f.service.restoreSite(removed.id, removed.revision);
    const status = f.service.status("legacy");
    assert.ok(!Array.isArray(status));
    assert.equal(status.bindingError, "CONNECTION_BINDING_REQUIRED");
    assert.equal(f.vault.get<any>("connection:legacy").user, legacy.user);
    assert.equal(f.record.calls.length, 0);
  } finally {
    f.close();
  }
});

test("stale deletion cannot remove a newer import and partial removal rolls back credentials and visibility", async (t) => {
  const f = fixture();
  try {
    const first = await f.service.inspect(f.exported);
    await f.service.importResources(first.previewId, [
      f.exported.sites[0].resource,
    ]);
    const old = f.service.sites()[0];
    const second = await f.service.inspect(f.exported);
    await f.service.importResources(second.previewId, [old.resource]);
    await assert.rejects(
      f.service.removeSite(old.id, old.revision),
      /SITE_REVISION_CHANGED/,
    );
    const connected = await f.service.connect(old.id);
    const stored = f.vault.get(`connection:${connected.connectionRef}`);
    const originalSet = f.vault.set.bind(f.vault);
    t.mock.method(f.vault, "set", (key: string, value: unknown) => {
      if (key === "removed-sites") throw new Error("disk failure");
      originalSet(key, value);
    });
    await assert.rejects(
      f.service.removeSite(old.id, f.service.sites()[0].revision),
      /disk failure/,
    );
    assert.equal(f.service.sites().length, 1);
    assert.deepEqual(
      f.vault.get(`connection:${connected.connectionRef}`),
      stored,
    );
    assert.equal(f.service.removedSites().length, 0);
  } finally {
    f.close();
  }
});

test("deletion drains in-flight requests and connections before disabling subsequent use", async () => {
  for (const phase of ["connect", "request"] as const) {
    const f = fixture();
    try {
      const preview = await f.service.inspect(f.exported);
      await f.service.importResources(preview.previewId, [
        f.exported.sites[0].resource,
      ]);
      const site = f.service.sites()[0];
      const existing =
        phase === "request" ? await f.service.connect(site.id) : undefined;
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pause = async () => {
        entered();
        await gate;
      };
      if (phase === "connect") f.record.beforeToken = pause;
      else f.record.beforeRpc = pause;
      const active =
        phase === "connect"
          ? f.service.connect(site.id)
          : f.service.request(
              existing!.connectionRef,
              "consultation.messages.submit",
              {},
            );
      await started;
      let removed = false;
      const deletion = f.service.removeSite(site.id, site.revision).then(() => {
        removed = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(removed, false);
      release();
      await active;
      await deletion;
      const connections = f.service.status();
      assert.ok(Array.isArray(connections));
      const connection = connections[0];
      assert.equal(connection.connected, false);
      assert.equal(f.service.sites().length, 0);
      const calls = f.record.calls.length;
      await assert.rejects(
        f.service.request(
          connection.connectionRef,
          "consultation.messages.submit",
          {},
        ),
        /SITE_NOT_APPROVED/,
      );
      assert.equal(f.record.calls.length, calls);
    } finally {
      f.close();
    }
  }
});
