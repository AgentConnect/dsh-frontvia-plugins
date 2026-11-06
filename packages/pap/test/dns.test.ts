import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import type { ClientRequest, IncomingMessage } from "node:http";
import { PinnedAgents, publicTransport } from "../src/network.js";

function fixture(t: TestContext) {
  const record = {
    addresses: [{ address: "198.18.3.15", family: 4 }],
    lookups: [] as string[],
    requests: [] as {
      url: URL;
      address: string;
      options: https.RequestOptions;
    }[],
    answer: "1.1.1.1",
    extraAddresses: [] as string[],
    status: 0,
    answerName: undefined as string | undefined,
    failDns: false,
  };
  t.mock.method(dns, "lookup", async (hostname: string) => {
    record.lookups.push(hostname);
    return hostname === "dns.google"
      ? { address: "198.18.0.2", family: 4 }
      : record.addresses;
  });
  syncBuiltinESMExports();
  t.mock.method(
    https,
    "request",
    (
      url: URL,
      options: https.RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      let address = "";
      (options.lookup as any)(
        url.hostname,
        {},
        (_error: unknown, value: string) => {
          address = value;
        },
      );
      record.requests.push({ url, address, options });
      const request = new EventEmitter() as ClientRequest;
      request.destroy = () => {
        request.emit("close");
        return request;
      };
      request.end = (() => {
        queueMicrotask(() => {
          if (url.hostname === "dns.google" && record.failDns) {
            request.emit("error", new Error("DNS unavailable"));
            return;
          }
          const response = new EventEmitter() as IncomingMessage;
          response.statusCode = 200;
          callback(response);
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify(
                url.hostname === "dns.google"
                  ? {
                      Status: record.status,
                      Answer: [record.answer, ...record.extraAddresses].map(
                        (data) => ({
                          type: 1,
                          name:
                            record.answerName ??
                            url.searchParams.get("name") + ".",
                          data,
                        }),
                      ),
                    }
                  : { ok: true },
              ),
            ),
          );
          response.emit("end");
        });
        return request;
      }) as ClientRequest["end"];
      return request;
    },
  );
  const agents = new PinnedAgents();
  t.after(() => {
    agents.close();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    record,
    wire: (origin: string) => publicTransport([origin], undefined, agents),
  };
}

test("approved account and merchant origins recover from Fake-IP using public DNS and retain HTTPS authority", async (t) => {
  const f = fixture(t);
  for (const origin of [
    "https://frontvia-shop.agent-connect.cn",
    "https://store.test",
  ]) {
    const url = origin + "/openapi.json";
    f.record.addresses = [
      { address: "198.18.3.15", family: 4 },
      { address: "198.19.1.2", family: 4 },
    ];
    assert.deepEqual(
      await f.wire(origin)({
        url,
        method: "GET",
        headers: { Authorization: "DPoP fixture-token", DPoP: "fixture-proof" },
      }),
      { ok: true },
    );
    const [dnsRequest, resource] = f.record.requests.slice(-2);
    assert.equal(dnsRequest.url.origin, "https://dns.google");
    assert.equal(
      dnsRequest.url.searchParams.get("name"),
      new URL(origin).hostname,
    );
    assert.equal(dnsRequest.url.searchParams.get("type"), "A");
    assert.equal(dnsRequest.options.rejectUnauthorized, true);
    assert.equal((dnsRequest.options.headers as any).Authorization, undefined);
    assert.equal((dnsRequest.options.headers as any).DPoP, undefined);
    assert.equal(resource.address, "1.1.1.1");
    assert.equal(resource.url.href, url);
    assert.equal((resource.options.headers as any).Host, new URL(origin).host);
    assert.equal(resource.options.rejectUnauthorized, true);
    assert.equal(
      (resource.options.headers as any).Authorization,
      "DPoP fixture-token",
    );
  }
});

test("public DNS failure, foreign answers and private answers never dispatch to the merchant", async (t) => {
  const f = fixture(t),
    origin = "https://store.test";
  for (const change of [
    { answer: "127.0.0.1" },
    { answer: "198.18.1.2" },
    { answer: "192.168.1.1" },
    { extraAddresses: ["127.0.0.1"] },
    { answerName: "other.test." },
    { status: 3 },
    { failDns: true },
  ]) {
    Object.assign(
      f.record,
      {
        answer: "1.1.1.1",
        extraAddresses: [],
        answerName: undefined,
        status: 0,
        failDns: false,
      },
      change,
    );
    const before = f.record.requests.length;
    await assert.rejects(
      f.wire(origin)({ url: origin + "/rpc", method: "GET" }),
      /PUBLIC_HTTPS_REQUIRED|NETWORK_FAILURE/,
    );
    assert.deepEqual(
      f.record.requests.slice(before).map((r) => r.url.origin),
      ["https://dns.google"],
    );
  }
});

test("ordinary public DNS avoids fallback; private, mixed and literal reserved addresses stay blocked", async (t) => {
  const f = fixture(t),
    origin = "https://store.test";
  f.record.addresses = [{ address: "1.1.1.1", family: 4 }];
  await f.wire(origin)({ url: origin + "/rpc", method: "GET" });
  assert.deepEqual(f.record.lookups, ["store.test"]);
  assert.equal(f.record.requests[0].url.origin, origin);
  for (const addresses of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "192.168.1.1", family: 4 }],
    [
      { address: "198.18.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    [
      { address: "198.18.1.1", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ],
  ]) {
    f.record.addresses = addresses;
    f.record.lookups.length = 0;
    await assert.rejects(
      f.wire(origin)({ url: origin + "/rpc", method: "GET" }),
      /PUBLIC_HTTPS_REQUIRED/,
    );
    assert.deepEqual(f.record.lookups, ["store.test"]);
    assert.equal(f.record.requests.length, 1);
  }
  f.record.addresses = [{ address: "198.18.1.1", family: 4 }];
  f.record.lookups.length = 0;
  await assert.rejects(
    f.wire("https://198.18.1.1")({
      url: "https://198.18.1.1/rpc",
      method: "GET",
    }),
    /PUBLIC_HTTPS_REQUIRED/,
  );
  assert.deepEqual(f.record.lookups, ["198.18.1.1"]);
  assert.equal(f.record.requests.length, 1);
});

test("unapproved origins cannot trigger system or public DNS lookup", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.wire("https://store.test")({
      url: "https://unapproved.test/rpc",
      method: "GET",
    }),
    /TARGET_NOT_APPROVED/,
  );
  assert.deepEqual(f.record.lookups, []);
  assert.deepEqual(f.record.requests, []);
});
