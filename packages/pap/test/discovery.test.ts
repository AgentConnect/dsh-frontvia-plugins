import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
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
function fixture(resourceOrigin = origin) {
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
    openapi_url: resourceOrigin + "/consultation/openapi.json",
    sites: [
      {
        id: "consult",
        label: "商家咨询",
        domain: "merchant.test",
        issuer,
        resource: resourceOrigin + "/consultation/rpc",
      },
    ],
    authorization: {
      allowed_client_ids: [config.clientId],
      resource: resourceOrigin + "/consultation/rpc",
      token_type: "DPoP",
    },
    service: { store_id: "a1", environment: "test" },
    verification: { service: "ready", client_connection: "unverified" },
  };
  const record = {
    calls: [] as any[],
    foreignContract: false,
    badIssuer: false,
    apis: ["consultation", "commerce"].map((name) => ({
      type: "openapi",
      url: `${resourceOrigin}/${name}/openapi.json`,
      resource: `${resourceOrigin}/${name}/rpc`,
    })),
    beforeRpc: undefined as undefined | (() => Promise<void>),
    beforeToken: undefined as undefined | (() => Promise<void>),
  };
  const wire: Transport = async (r) => {
    record.calls.push(structuredClone(r));
    if (r.url.endsWith("poppy.json"))
      return {
        protocol_version: "0.2",
        auth: { issuer: record.badIssuer ? "https://evil.test" : issuer },
        apis: record.apis,
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
            : resourceOrigin + "/commerce/openrpc.json",
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
  const secrets = { get: async () => key, set: async () => {} };
  let vault = new Vault(join(dir, "pap.sqlite"), storage),
    service = new PapService(config, secrets, vault, wire);
  return {
    config,
    exported,
    record,
    wire,
    secrets,
    get service() {
      return service;
    },
    get vault() {
      return vault;
    },
    restart() {
      vault.close();
      vault = new Vault(join(dir, "pap.sqlite"), storage);
      service = new PapService(config, secrets, vault, wire);
    },
    close() {
      vault.close();
    },
  };
}
for (const resourceOrigin of [origin, "https://store.test"])
  test(`inspect ${resourceOrigin} without authentication; import and audience isolation survive restart`, async () => {
    const f = fixture(resourceOrigin);
    try {
      if (resourceOrigin !== origin) {
        // Shared discovery can list many other shops before this exported shop.
        f.record.apis.unshift(
          ...Array.from({ length: 25 }, (_, i) => ({
            type: "openapi",
            url: `${origin}/stores/other-${i}/openapi.json`,
            resource: `${origin}/stores/other-${i}/rpc`,
          })),
          {
            type: "openapi",
            url: "https://other-store.test/openapi.json",
            resource: "https://other-store.test/rpc",
          },
        );
      }
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
      assert.deepEqual(
        f.record.calls.map((r) => r.url),
        [
          f.exported.discovery_url,
          f.exported.openapi_url,
          resourceOrigin + "/commerce/openapi.json",
          resourceOrigin + "/commerce/openrpc.json",
        ],
      );
      assert(
        preview.sites.every(
          (s) => new URL(s.resource).origin === resourceOrigin,
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
      assert.deepEqual(
        requests.map((r) => r.url),
        [
          resourceOrigin + "/consultation/rpc",
          resourceOrigin + "/commerce/rpc",
        ],
      );
      for (const r of requests) {
        const claims = JSON.parse(
          Buffer.from(r.headers.DPoP.split(".")[1], "base64url").toString(),
        );
        assert.equal(claims.htu, r.url);
        assert.equal(r.headers.Authorization, `DPoP token:${r.url}`);
      }
      assert(
        f.record.calls
          .filter((r) => r.url.endsWith("/token"))
          .every((r) => r.url === origin + "/token"),
      );
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

test("cross-origin import rejects unpublished resources and mismatched issuer, URLs and profiles before saving", async () => {
  const f = fixture("https://store.test");
  try {
    const mismatches: [string, (config: typeof f.exported) => void, RegExp][] =
      [
        [
          "domain",
          (c) => {
            c.sites[0].domain = "other.test";
          },
          /IMPORT_BINDING_MISMATCH/,
        ],
        [
          "issuer",
          (c) => {
            c.sites[0].issuer = "https://other.test/companies/a";
          },
          /DISCOVERY_MISMATCH/,
        ],
        [
          "resource",
          (c) => {
            c.sites[0].resource = c.authorization.resource =
              "https://other.test/rpc";
          },
          /DISCOVERY_MISMATCH/,
        ],
        [
          "openapi",
          (c) => {
            c.openapi_url = "https://other.test/openapi.json";
          },
          /IMPORT_BINDING_MISMATCH/,
        ],
        [
          "profile",
          (c) => {
            c.profile = "different.profile.v1";
          },
          /IMPORT_BINDING_MISMATCH/,
        ],
      ];
    for (const [name, mutate, expected] of mismatches) {
      const exported = structuredClone(f.exported);
      mutate(exported);
      f.record.calls.length = 0;
      await assert.rejects(f.service.inspect(exported), expected, name);
      assert(
        f.record.calls.every(
          (r) => r.method === "GET" && !r.url.startsWith("https://other.test"),
        ),
        name,
      );
      assert.equal(f.vault.get("imported-sites"), undefined);
    }
    f.record.foreignContract = true;
    await assert.rejects(
      f.service.inspect(f.exported),
      /CONTRACT_ORIGIN_MISMATCH/,
    );
    assert(!f.record.calls.some((r) => r.url.startsWith("https://other.test")));
  } finally {
    f.close();
  }
});

test("every declared resource needs a verified contract on its own origin", async () => {
  const f = fixture("https://store.test");
  try {
    f.exported.sites.push({
      ...f.exported.sites[0],
      id: "commerce",
      resource: "https://store.test/commerce/rpc",
    });
    f.record.apis[1].url = "https://other.test/commerce/openapi.json";
    await assert.rejects(
      f.service.inspect(f.exported),
      /INVALID_SERVICE_CONTRACT/,
    );
    assert(!f.record.calls.some((r) => r.url.startsWith("https://other.test")));
    assert.equal(f.vault.get("imported-sites"), undefined);
  } finally {
    f.close();
  }
});

test("production import transport permits the declared resource origin but blocks private DNS; explicit TLS targets connect", async () => {
  const f = fixture("https://localhost");
  const dir = mkdtempSync(join(tmpdir(), "pap-cross-origin-tls-"));
  const key = join(dir, "key.pem"),
    cert = join(dir, "cert.pem"),
    cnf = join(dir, "cert.cnf");
  writeFileSync(
    cnf,
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=merchant.test\n[ext]\nsubjectAltName=DNS:merchant.test,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-config",
      cnf,
    ],
    { stdio: "ignore" },
  );
  const server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const value = await f.wire({
          url: `https://${req.headers.host}${req.url}`,
          method: req.method!,
          headers: {
            ...(req.headers.authorization
              ? { Authorization: req.headers.authorization }
              : {}),
            ...(req.headers.dpop ? { DPoP: String(req.headers.dpop) } : {}),
          },
          body: body || undefined,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      } catch {
        res.writeHead(500);
        res.end("{}");
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const target = {
    origin,
    address: "127.0.0.1",
    port: 443,
    connectPort: (server.address() as { port: number }).port,
  };
  f.config.targets.push(target);
  f.config.caFile = cert;
  const service = new PapService(f.config, f.secrets, f.vault);
  try {
    // No injected Transport: exercise inspect's real destination allowlist and
    // publicTransport's DNS check. localhost is declared but never public.
    await assert.rejects(service.inspect(f.exported), /PUBLIC_HTTPS_REQUIRED/);
    assert.deepEqual(
      f.record.calls.map((r) => r.url),
      [f.exported.discovery_url],
    );
    assert.equal(f.vault.get("imported-sites"), undefined);

    // The isolated TLS fixture is now explicitly approved, as for local stacks.
    f.config.targets.push({ ...target, origin: "https://localhost" });
    const preview = await service.inspect(f.exported);
    assert.equal(preview.sites.length, 2);
    assert(
      f.record.calls.every(
        (r) => r.method === "GET" && !r.headers?.Authorization,
      ),
    );
    await service.importResources(
      preview.previewId,
      preview.sites.map((s) => s.resource),
    );
    for (const site of preview.sites) {
      const connection = await service.connect(site.id);
      const method = site.description.methods[0];
      const reply = await service.request(connection.connectionRef, method, {});
      assert.deepEqual(reply.result.data, { ok: true });
    }
    const requests = f.record.calls.filter((r) => r.method === "POST");
    assert.deepEqual(
      requests.map((r) => r.url),
      [
        origin + "/token",
        "https://localhost/consultation/rpc",
        origin + "/token",
        "https://localhost/commerce/rpc",
      ],
    );
    for (const r of requests.filter((r) => r.url.endsWith("/rpc"))) {
      assert.equal(r.headers.Authorization, `DPoP token:${r.url}`);
      const claims = JSON.parse(
        Buffer.from(r.headers.DPoP.split(".")[1], "base64url").toString(),
      );
      assert.equal(claims.htu, r.url);
    }
  } finally {
    service.close();
    f.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
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

test("neutral Commerce export imports without an Agent and cannot choose identity trust", async () => {
  const f = fixture();
  try {
    f.record.apis = f.record.apis.filter((a) =>
      a.resource.endsWith("/commerce/rpc"),
    );
    const exported = {
      ...f.exported,
      format: "frontvia.connection.v1",
      profile: "frontvia.commerce.v1",
      openapi_url: origin + "/commerce/openapi.json",
      sites: [
        {
          ...f.exported.sites[0],
          id: "commerce",
          label: "商品与订单",
          resource: origin + "/commerce/rpc",
        },
      ],
      authorization: {
        admission: "automatic",
        client_identity: "independent",
        resource: origin + "/commerce/rpc",
        token_type: "DPoP",
        identity_profile: "dsh.identity_assertion.v1",
      },
    };
    const preview = await f.service.inspect(exported);
    await f.service.importResources(preview.previewId, [
      origin + "/commerce/rpc",
    ]);
    assert.equal(f.service.sites().length, 1);
    assert.equal(f.service.sites()[0].resource, origin + "/commerce/rpc");
    assert(!f.record.calls.some((r) => r.url.includes("/consultation/")));
    await assert.rejects(
      f.service.inspect({
        ...exported,
        authorization: {
          ...exported.authorization,
          identity_issuer: "https://attacker.test",
        },
      }),
    );
  } finally {
    f.close();
  }
});
for (const resourceOrigin of [origin, "https://store.test"]) {
  test(`single-service link imports only its consultation and survives restart: ${resourceOrigin}`, async () => {
    const f = fixture(resourceOrigin);
    try {
      const resource = f.exported.sites[0].resource;
      const link = f.exported.discovery_url + "#" + new URLSearchParams({resource});
      f.record.apis.unshift(...Array.from({length:25}, (_,i)=>({type:"openapi",resource:`${resourceOrigin}/other-${i}/rpc`,url:`${resourceOrigin}/other-${i}/openapi.json`})));
      const preview = await f.service.inspect(link);
      assert.deepEqual(preview.sites.map(s=>s.resource), [resource]);
      assert.deepEqual(f.record.calls.map(r=>r.url), [f.exported.discovery_url,f.exported.openapi_url]);
      assert(f.record.calls.every(r=>r.method==="GET"&&!r.headers?.authorization&&!r.body));
      assert.equal(f.service.sites().length,0);
      await f.service.importResources(preview.previewId,[resource]);
      const site = f.service.sites()[0];
      const connection = await f.service.connect(site.id);
      await f.service.request(connection.connectionRef,"consultation.capabilities.get",{});
      f.restart();
      assert.equal(f.service.sites()[0].id,site.id);
      assert.equal(f.service.sites().length,1);
      await f.service.request(connection.connectionRef,"consultation.messages.submit",{});
    } finally { f.close(); }
  });
}

test("link import reuses the prior JSON binding and does not replace client identity", async () => {
  const f=fixture();
  try {
    const resource=f.exported.sites[0].resource;
    const json=await f.service.inspect(f.exported);
    await f.service.importResources(json.previewId,[resource]);
    const connection=await f.service.connect('consult');
    const identity=f.service.identity(connection.connectionRef);
    const preview=await f.service.inspect(f.exported.discovery_url+'#'+new URLSearchParams({resource}));
    assert.equal(preview.sites[0].id,'consult');
    await f.service.importResources(preview.previewId,[resource]);
    assert.equal(f.service.sites().length,1);
    assert.deepEqual(f.service.identity(connection.connectionRef),identity);
    assert.equal(f.service.sites()[0].service?.store_id,'a1');
  } finally { f.close(); }
});

test("link rejects absent, duplicated or substituted resources without fetching their contracts",async()=>{
  for(const mode of ['missing','duplicate','foreign'] as const){
    const f=fixture();
    try{
      const resource=mode==='foreign'?'https://other.test/consultation/rpc':f.exported.sites[0].resource;
      if(mode==='missing')f.record.apis=[];
      if(mode==='duplicate')f.record.apis.push(f.record.apis[0]);
      await assert.rejects(f.service.inspect(f.exported.discovery_url+'#'+new URLSearchParams({resource})),/DISCOVERY_MISMATCH/);
      assert.deepEqual(f.record.calls.map(r=>r.url),[f.exported.discovery_url]);
      assert.equal(f.service.sites().length,0);
    }finally{f.close();}
  }
});

test("malformed or credential-bearing links are rejected before network I/O",async()=>{
  const f=fixture();
  try{
    const resource=f.exported.sites[0].resource,hash='#'+new URLSearchParams({resource});
    for(const link of [
      f.exported.discovery_url,
      f.exported.discovery_url+hash+'&resource='+encodeURIComponent(resource),
      f.exported.discovery_url+hash+'&token=secret',
      f.exported.discovery_url.replace('https:','http:')+hash,
      f.exported.discovery_url.replace('https://','https://user:secret@')+hash,
      f.exported.discovery_url+'?token=secret'+hash,
      origin+'/other.json'+hash,
      f.exported.discovery_url+'#'+new URLSearchParams({resource:'http://store.test/rpc'}),
    ])await assert.rejects(f.service.inspect(link));
    assert.equal(f.record.calls.length,0);
  }finally{f.close();}
});

test("consultation link cannot silently become a Commerce connection",async()=>{
  const f=fixture();
  try{
    const resource=origin+'/commerce/rpc';
    await assert.rejects(f.service.inspect(f.exported.discovery_url+'#'+new URLSearchParams({resource})),/INVALID_SERVICE_CONTRACT|IMPORT_BINDING_MISMATCH/);
    assert.equal(f.service.sites().length,0);
  }finally{f.close();}
});

for (const firstFormat of ['link', 'json'] as const) {
  for (const overlappingPreviews of [false, true]) {
    test(`mixed imports retain one connection: ${firstFormat} first, overlapping=${overlappingPreviews}`, async () => {
      const f = fixture();
      try {
        const resource = f.exported.sites[0].resource;
        const link = f.exported.discovery_url + '#' + new URLSearchParams({resource});
        const inputs = firstFormat === 'link' ? [link, f.exported] : [f.exported, link];
        const first = await f.service.inspect(inputs[0]);
        let second = overlappingPreviews ? await f.service.inspect(inputs[1]) : undefined;
        await f.service.importResources(first.previewId, [resource]);
        const original = f.service.sites()[0]!;
        const connection = await f.service.connect(original.id);
        const identity = f.service.identity(connection.connectionRef);
        second ??= await f.service.inspect(inputs[1]);
        await f.service.importResources(second.previewId, [resource]);
        assert.equal(f.service.sites().length, 1);
        assert.equal(f.service.sites()[0]!.id, original.id);
        assert.equal(f.service.sites()[0]!.service?.store_id, 'a1');
        assert.equal((await f.service.connect(original.id)).connectionRef, connection.connectionRef);
        assert.deepEqual(f.service.identity(connection.connectionRef), identity);
        f.restart();
        assert.equal(f.service.sites().length, 1);
        await f.service.request(connection.connectionRef, 'consultation.messages.submit', {});
      } finally { f.close(); }
    });
  }
}

test('stale link preview keeps metadata from a newer JSON import', async () => {
  const f = fixture();
  try {
    const resource = f.exported.sites[0].resource;
    const initial = await f.service.inspect(f.exported);
    await f.service.importResources(initial.previewId, [resource]);
    const stale = await f.service.inspect(f.exported.discovery_url + '#' + new URLSearchParams({resource}));
    const latest = await f.service.inspect({...f.exported, service: {...f.exported.service, publication_revision: 8}});
    await f.service.importResources(latest.previewId, [resource]);
    await f.service.importResources(stale.previewId, [resource]);
    assert.equal(f.service.sites().length, 1);
    assert.equal(f.service.sites()[0]!.service?.publication_revision, 8);
  } finally { f.close(); }
});
