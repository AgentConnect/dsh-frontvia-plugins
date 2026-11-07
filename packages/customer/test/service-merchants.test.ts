import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serviceMerchants,
  resolveServiceSelection,
  readServiceSelection,
  saveServiceSelection,
  type ServiceSite,
  type ServiceFlow,
} from "../src/client/service-merchants.js";
const site = (
  id: string,
  store = "store-a",
  issuer = "https://auth.test/company/a",
): ServiceSite => ({
  id,
  issuer,
  domain: "mall.test",
  label: "JSON-RPC commerce transport",
  service: { store_id: store },
});
const flow = (
  flowId: string,
  siteId: string,
  kind = "shopping",
  updatedAt = "2026-11-07T10:00:00Z",
): ServiceFlow => ({
  flowId,
  siteId,
  kind,
  updatedAt,
  sessionId: `session-${flowId}`,
});

test("one merchant groups consultation and commerce while same-domain stores and issuers stay separate", () => {
  const sites = [
    site("a-shop"),
    { ...site("a-consult"), label: "人民包邮店" },
    site("b-shop", "store-b"),
    site("c-shop", "store-a", "https://auth.test/company/c"),
  ];
  const merchants = serviceMerchants(sites, [
    flow("a", "a-shop"),
    flow("consult", "a-consult", "consultation"),
    flow("b", "b-shop"),
    flow("c", "c-shop"),
  ]);
  assert.equal(merchants.length, 3);
  const a = merchants.find((m) => m.flows.some((f) => f.flowId === "a"))!;
  assert.equal(a.title, "人民包邮店");
  assert.deepEqual(
    a.flows.map((f) => f.flowId),
    ["a", "consult"],
  );
  assert.equal(a.sites.length, 2);
  const b = merchants.find((m) => m.storeId === "store-b")!;
  // A previously selected A flow cannot appear in B's panel or history.
  assert.equal(
    resolveServiceSelection(merchants, { merchantKey: b.key, flowId: "a" }).flow
      ?.flowId,
    "b",
  );
  assert.deepEqual(
    b.flows.map((f) => f.flowId),
    ["b"],
  );
});

test("configured merchants without history stay visible and removed connections do not attach to another store", () => {
  const merchants = serviceMerchants(
    [site("empty"), { id: "unrelated", label: "Other API" }],
    [flow("old", "removed-a"), flow("older", "removed-b")],
  );
  assert.equal(merchants.length, 3);
  assert.equal(merchants[0].sites[0].id, "empty");
  assert.equal(resolveServiceSelection(merchants).flow, undefined);
  assert.deepEqual(
    merchants.slice(1).map((m) => m.flows.length),
    [1, 1],
  );
  // Without an issuer/store binding, equal domains and labels are not identity.
  assert.equal(
    serviceMerchants(
      [
        { ...site("x"), issuer: undefined },
        { ...site("y"), issuer: undefined },
      ],
      [],
    ).length,
    2,
  );
});

test("opening a merchant prefers shopping even with newer consultation, and explicit history selection survives refresh", () => {
  const sites = [site("a"), site("consult")];
  const flows = [
    flow("old-cart", "a", "shopping", "2026-11-01T10:00:00Z"),
    flow("new-cart", "a"),
    flow("answer", "consult", "consultation", "2026-11-07T12:00:00Z"),
  ];
  const merchants = serviceMerchants(sites, flows);
  assert.equal(resolveServiceSelection(merchants).flow?.flowId, "new-cart");
  const saved = { merchantKey: merchants[0].key, flowId: "old-cart" };
  const entries = new Map<string, string>();
  const storage = {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    },
  };
  saveServiceSelection(storage, saved);
  assert.deepEqual(readServiceSelection(storage), saved);
  assert.equal(
    resolveServiceSelection(
      serviceMerchants(sites, [...flows].reverse()),
      readServiceSelection(storage),
    ).flow?.flowId,
    "old-cart",
  );
  // Account B's list is authoritative even if old IDs survived a browser restart.
  const current = serviceMerchants(sites, [flow("account-b-cart", "a")]);
  assert.equal(
    resolveServiceSelection(current, readServiceSelection(storage)).flow
      ?.flowId,
    "account-b-cart",
  );
  saveServiceSelection(storage);
  assert.deepEqual(readServiceSelection(storage), {
    merchantKey: undefined,
    flowId: undefined,
  });
});

test("unavailable or corrupt browser storage does not prevent merchant selection", () => {
  assert.deepEqual(readServiceSelection({ getItem: () => "not-json" }), {});
  assert.deepEqual(
    readServiceSelection({
      getItem: () => {
        throw new Error("disabled");
      },
    }),
    {},
  );
  assert.doesNotThrow(() =>
    saveServiceSelection(
      {
        setItem: () => {
          throw new Error("full");
        },
        removeItem() {},
      },
      { merchantKey: "a" },
    ),
  );
  assert.equal(resolveServiceSelection([]).flow, undefined);
});
