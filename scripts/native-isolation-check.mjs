import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { PapService, Vault, jwt } from "../packages/pap/dist/core.js";
import { httpsTransport } from "../packages/pap/src/network.ts";
import { CustomerService } from "../packages/customer/dist/core.js";
const root = resolve(".local/native"),
  read = async (n) => JSON.parse(await readFile(resolve(root, n), "utf8"));
const pc = await read("pap.json"),
  cc = await read("customer.json"),
  secrets = await read("secrets.json");
const folder = await mkdtemp(resolve(root, "isolation-")),
  vault = new Vault(resolve(folder, "pap.sqlite"), secrets[pc.storageKeyRef]);
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push({ name, status: "PASS" });
};
const secretPort = { get: async (k) => secrets[k], set: async () => {} };
try {
  const pap = new PapService(pc, secretPort, vault),
    c = await pap.connect("test-shop"),
    state = vault.get(`connection:${c.connectionRef}`);
  const wire = httpsTransport(pc.targets, pc.caFile),
    url = pc.sites[0].resource;
  const proof = (extra = {}) =>
    jwt(
      state.proofKey,
      {
        typ: "dpop+jwt",
        alg: "ES256",
        jwk: createPublicKey(state.proofKey).export({ format: "jwk" }),
      },
      {
        htm: "POST",
        htu: url,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
        ath: createHash("sha256").update(state.accessToken).digest("base64url"),
        ...extra,
      },
    );
  const call = (p) =>
    wire({
      url,
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "commerce.capabilities.get",
        params: {},
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${state.accessToken}`,
        DPoP: p,
      },
    });
  await check("DPoP request binding rejects a wrong resource", () =>
    assert.rejects(call(proof({ htu: url + "/wrong" })), /HTTP_40[13]/),
  );
  await check("expired DPoP proof rejected", () =>
    assert.rejects(
      call(proof({ iat: Math.floor(Date.now() / 1000) - 600 })),
      /HTTP_40[13]/,
    ),
  );
  await check("DPoP replay rejected", async () => {
    const p = proof();
    assert.ok((await call(p)).result);
    await assert.rejects(call(p), /HTTP_40[13]/);
  });
  await check(
    "resource-scoped token rejected at another merchant endpoint",
    async () => {
      const foreign = url.replace("/stores/store-a/", "/stores/another-store/");
      assert.notEqual(foreign, url);
      await assert.rejects(
        wire({
          url: foreign,
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "commerce.orders.list",
            params: {},
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `DPoP ${state.accessToken}`,
            DPoP: proof({ htu: foreign }),
          },
        }),
        /HTTP_40[134]/,
      );
    },
  );
  await check("configured issuer mismatch rejected", async () => {
    const bad = new PapService(
      {
        ...pc,
        sites: [{ ...pc.sites[0], issuer: pc.sites[0].issuer + "/wrong" }],
      },
      secretPort,
      vault,
    );
    await assert.rejects(bad.discover("test-shop"), /DISCOVERY_MISMATCH/);
  });
  await check("configured resource mismatch rejected", async () => {
    const bad = new PapService(
      { ...pc, sites: [{ ...pc.sites[0], resource: url + "/wrong" }] },
      secretPort,
      vault,
    );
    await assert.rejects(bad.discover("test-shop"), /DISCOVERY_MISMATCH/);
  });
  await check("renewal retains the same PAP subject and session", async () => {
    state.expiresAt = 0;
    vault.set(`connection:${c.connectionRef}`, state);
    await pap.request(c.connectionRef, "commerce.capabilities.get", {});
    const renewed = vault.get(`connection:${c.connectionRef}`);
    assert.equal(renewed.user, state.user);
    assert.equal(renewed.sessionId, state.sessionId);
  });
  const cv = new Vault(
    resolve(folder, "customer.sqlite"),
    secrets[cc.storageKeyRef],
  );
  try {
    await check(
      "wrong merchant configuration fails before shopping",
      async () => {
        const bad = new CustomerService(
          { ...cc, sites: [{ ...cc.sites[0], storeId: "another-store" }] },
          pap,
          secretPort,
          cv,
        );
        await assert.rejects(
          bad.connect("wrong-store", "test-shop"),
          /PURCHASE_PROFILE_UNAVAILABLE/,
        );
      },
    );
  } finally {
    cv.close();
  }
  const realLog = await read("browser-confirm.json");
  await check(
    "independent PAP subject cannot read the purchased order",
    async () => {
      const r = await pap.request(c.connectionRef, "commerce.orders.get", {
        order_id: realLog.orderId,
      });
      assert.ok(r.error);
      assert.equal(r.result, undefined);
    },
  );
  await check("unregistered client rejected", async () => {
    const rejected = new Vault(
      resolve(folder, "unregistered.sqlite"),
      secrets[pc.storageKeyRef],
    );
    try {
      const u = new URL(pc.clientId);
      u.pathname = "/unregistered/agent.json";
      const bad = new PapService(
        { ...pc, clientId: u.href },
        secretPort,
        rejected,
      );
      await assert.rejects(bad.connect("test-shop"));
    } finally {
      rejected.close();
    }
  });
  await writeFile(
    resolve(root, "isolation-result.json"),
    JSON.stringify({ status: "PASS", results }, null, 2),
  );
  console.log(JSON.stringify({ status: "PASS", results }));
} finally {
  vault.close();
}
