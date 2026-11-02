import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHmac } from "node:crypto";
import { Vault, PapError } from "dsh-pap/core";
import { CustomerService, modelData, type PapPort } from "../src/core.js";
import { schemas, tools } from "../src/tools.js";
import { uiSchemas } from "../src/ui-contract.js";
const copy = (v: any) => structuredClone(v);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-customer-test-")),
    key = randomBytes(32).toString("base64url"),
    db = join(dir, "customer.sqlite");
  const remote = {
    cart: null as any,
    quote: null as any,
    checkout: null as any,
    order: null as any,
    ops: new Map<string, any>(),
    calls: [] as string[],
    writes: 0,
    confirms: 0,
    lose: "",
    price: "1234",
  };
  const identity = {
    clientId: "https://client.test/client.json",
    userId: "stable-subject",
    issuer: "https://auth.test",
    resource: "https://api.test/rpc",
    signedIn: false,
  };
  const response = (data: any) => ({ result: { data: copy(data) } });
  const pap: PapPort = {
    apiVersion: 1,
    sites: () => [{ id: "a", label: "Shop", domain: "shop.test" }],
    status: () => [],
    connect: async () => ({
      connectionRef: "connection-a",
      siteId: "a",
      label: "Shop",
      domain: "shop.test",
      issuer: identity.issuer,
      resource: identity.resource,
      signedIn: false,
      connected: true,
      expiresAt: 9999999999,
    }),
    identity: () => identity,
    request: async (_r, m, p: any) => {
      remote.calls.push(m);
      if (m === "commerce.capabilities.get")
        return response({
          store_id: "store",
          business_profiles: [
            {
              id: "frontvia.pap_subject_purchase.v1",
              availability: "supported",
            },
          ],
        });
      if (m === "commerce.connections.list")
        return response({
          items: [{ connection_id: "native", generation: 1, is_current: true }],
        });
      if (m === "commerce.products.search")
        return response({ items: [{ id: "prod", title: "Test Mug" }] });
      if (m === "commerce.variants.list")
        return response({ items: [{ id: "variant", title: "Blue" }] });
      if (m === "commerce.operations.lookup") {
        const x = remote.ops.get(p.idempotency_key);
        return x ? response(x.operation) : { error: { code: 1003 } };
      }
      if (m === "commerce.carts.get") return response(remote.cart);
      if (m === "commerce.quotes.get") return response(remote.quote);
      if (m === "commerce.checkouts.get") return response(remote.checkout);
      if (m === "commerce.orders.get") return response(remote.order);
      if (m === "commerce.orders.list")
        return response({
          items: remote.order ? [{ order_id: remote.order.id }] : [],
          page: { has_more: false, next_cursor: null },
        });
      if (m === "commerce.carts.delivery_options.list")
        return response({
          cart_id: "cart",
          cart_version: remote.cart.version,
          delivery_groups: [
            {
              id: "group",
              options: [
                {
                  id: "standard",
                  label: "Standard",
                  amount: { amount_minor: "500", currency: "USD" },
                },
              ],
            },
          ],
        });
      const k = p.meta?.idempotency_key ?? p.idempotency_key;
      if (remote.ops.has(k)) return response(remote.ops.get(k));
      let resource: any;
      if (m === "commerce.carts.create")
        remote.cart = {
          id: "cart",
          store_id: "store",
          version: "v1",
          lines: p.lines,
          totals: {
            grand_total: { amount_minor: remote.price, currency: "USD" },
          },
        };
      else if (m.startsWith("commerce.carts.")) {
        assert.equal(p.expected_version, remote.cart.version);
        remote.cart.version = "v" + (Number(remote.cart.version.slice(1)) + 1);
        if (p.patch) Object.assign(remote.cart, p.patch);
      }
      if (m.startsWith("commerce.carts.")) resource = remote.cart;
      if (m === "commerce.quotes.create") {
        assert.equal(p.expected_version, remote.cart.version);
        remote.quote = {
          id: "quote",
          cart_id: "cart",
          cart_version: remote.cart.version,
          checkout_allowed: true,
          expires_at: new Date(Date.now() + 300000).toISOString(),
          snapshot_hash: "a".repeat(64),
          lines: remote.cart.lines,
          totals: { grand_total: { amount_minor: "1734", currency: "USD" } },
        };
        resource = remote.quote;
      }
      if (m === "commerce.checkouts.create") {
        remote.checkout = {
          id: "checkout",
          cart_id: "cart",
          quote_id: "quote",
          mode: "client_confirmation",
          identity_kind: "pap_subject",
          can_start_new_attempt: false,
          status: "requires_action",
          payment_summary: {
            authorized_amount: { amount_minor: "0" },
            captured_amount: { amount_minor: "0" },
          },
          order_ids: [],
          confirmation: {
            profile: "frontvia.pap_subject_purchase.v1",
            issuer: identity.issuer,
            resource: identity.resource,
            store_id: "store",
            connection_id: "native",
            generation: 1,
            quote_id: "quote",
            snapshot_hash: remote.quote.snapshot_hash,
            amount_minor: "1734",
            currency: "USD",
          },
        };
        resource = remote.checkout;
      }
      if (m === "commerce.checkouts.cancel") {
        remote.checkout.status = "canceled";
        remote.checkout.can_start_new_attempt = true;
        resource = remote.checkout;
      }
      if (m === "commerce.checkouts.confirm") {
        const [h, c, s] = p.confirmation.split(".");
        assert.equal(
          s,
          createHmac("sha256", Buffer.from(key, "base64url"))
            .update(h + "." + c)
            .digest("base64url"),
        );
        const claims = JSON.parse(Buffer.from(c, "base64url").toString());
        assert.equal(claims.user_id, identity.userId);
        assert.equal(claims.amount_minor, "1734");
        assert.equal(claims.idempotency_key, k);
        assert.ok(claims.exp - claims.iat <= 120);
        remote.confirms++;
        remote.order = {
          id: "order",
          display_number: "1",
          payment: { status: "paid" },
          fulfillment_status: "unfulfilled",
          totals: remote.quote.totals,
        };
        remote.checkout.status = "completed";
        remote.checkout.order_ids = ["order"];
        resource = remote.checkout;
      }
      remote.writes++;
      const data = {
        operation: {
          id: "op" + remote.writes,
          status: "succeeded",
          effects: "applied",
          result_ref: { id: resource.id },
        },
        resource: copy(resource),
      };
      remote.ops.set(k, data);
      if (remote.lose === m) {
        remote.lose = "";
        throw new PapError("NETWORK_UNCERTAIN");
      }
      return response(data);
    },
  };
  let vault = new Vault(db, key),
    service = new CustomerService(
      {
        dataDir: dir,
        sites: [
          {
            siteId: "a",
            storeId: "store",
            confirmationKeyRef: "CONFIRM",
            confirmationKid: "test",
          },
        ],
      },
      pap,
      { get: async () => key, set: async () => {} },
      vault,
    );
  return {
    remote,
    db,
    get service() {
      return service;
    },
    async flow() {
      const c = await service.connect("session-a", "a");
      return c.flowId;
    },
    restart() {
      vault.close();
      vault = new Vault(db, key);
      service = new CustomerService(
        service.config,
        pap,
        { get: async () => key, set: async () => {} },
        vault,
      );
    },
    close() {
      vault.close();
    },
  };
}
async function prepare(f: ReturnType<typeof fixture>) {
  const flow = await f.flow();
  await f.service.tool(
    "session-a",
    "frontvia_cart",
    { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
    "add",
  );
  await f.service.contact(
    "session-a",
    flow,
    "v1",
    {
      email: "private@example.test",
      shipping_address: {
        country: "US",
        recipient: "Private Name",
        line1: "Secret Street",
        city: "City",
        region: "CA",
        postal_code: "12345",
      },
    },
    "contact",
  );
  await f.service.tool(
    "session-a",
    "frontvia_cart",
    {
      flowId: flow,
      action: "delivery_select",
      expected_version: "v2",
      group_id: "group",
      option_id: "standard",
    },
    "delivery",
  );
  await f.service.tool(
    "session-a",
    "frontvia_checkout",
    { flowId: flow, action: "quote", expected_version: "v3" },
    "quote",
  );
  await f.service.tool(
    "session-a",
    "frontvia_checkout",
    { flowId: flow, action: "prepare" },
    "prepare",
  );
  return flow;
}
test("full shopping, private contact, user confirmation and duplicate click produce one order", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f);
    assert.equal(f.remote.confirms, 0);
    const tool = await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "get" },
      "read",
    );
    assert.ok(!JSON.stringify(tool).includes("Secret Street"));
    assert.ok(!JSON.stringify(tool).includes("private@example.test"));
    assert.ok(!readFileSync(f.db).includes(Buffer.from("Secret Street")));
    const view = await f.service.review("session-a", flow);
    const result = await f.service.confirm("session-a", flow, view.intent!.id);
    assert.equal(result.order.id, "order");
    await f.service.confirm("session-a", flow, view.intent!.id);
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
test("order list resolves Commerce references and historical cards refresh server state", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f);
    const reviewed = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, reviewed.intent!.id);
    const listFlow = await f.flow();
    const listed = await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: listFlow, action: "list" },
      "list",
    );
    assert.equal(listed.data.items[0].id, "order");
    assert.equal(listed.data.items[0].display_number, "1");
    assert.equal(listed.data.items[0].payment.status, "paid");
    assert.equal(listed.data.items[0].totals.grand_total.amount_minor, "1734");
    assert.deepEqual(f.remote.calls.slice(-2), [
      "commerce.orders.list",
      "commerce.orders.get",
    ]);
    f.remote.order.fulfillment_status = "fulfilled";
    f.restart();
    const current = await f.service.view("session-a", listFlow);
    assert.equal(current.orders.items[0].fulfillment_status, "fulfilled");
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
test("missing/stale versions and cross-session access never write", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
      "first",
    );
    const count = f.remote.writes;
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "second",
      ),
      /CART_VERSION_REQUIRED/,
    );
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        {
          flowId: flow,
          action: "remove",
          line_id: "line",
          expected_version: "v0",
        },
        "third",
      ),
      /CART_VERSION_CHANGED/,
    );
    await assert.rejects(f.service.view("session-b", flow), /FLOW_NOT_OWNED/);
    assert.equal(f.remote.writes, count);
  } finally {
    f.close();
  }
});
test("changed amount cannot confirm", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      v = await f.service.review("session-a", flow);
    f.remote.quote.totals.grand_total.amount_minor = "9999";
    await assert.rejects(
      f.service.confirm("session-a", flow, v.intent!.id),
      /CONFIRMATION_BINDING_MISMATCH|QUOTE_CHANGED/,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});
test("expired intent and cross-session confirmation cannot buy", async (t) => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      v = await f.service.review("session-a", flow);
    await assert.rejects(
      f.service.confirm("session-b", flow, v.intent!.id),
      /FLOW_NOT_OWNED/,
    );
    t.mock.method(Date, "now", () => v.intent!.expiresAt + 1);
    await assert.rejects(
      f.service.confirm("session-a", flow, v.intent!.id),
      /CONFIRMATION_EXPIRED/,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});
test("changed arguments cannot reuse a recorded tool call", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
      "same",
    );
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 2 },
        "same",
      ),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(f.remote.writes, 1);
  } finally {
    f.close();
  }
});
test("two hosts cannot write one shopping profile concurrently; clean restart retains state", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    assert.throws(
      () => new Vault(f.db, randomBytes(32).toString("base64url")),
      /PROFILE_STORAGE_IN_USE/,
    );
    f.restart();
    assert.equal(f.service.flow("session-a", flow).id, flow);
  } finally {
    f.close();
  }
});
test("lost confirmation receipt survives restart; original operation recovered without second effect", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      v = await f.service.review("session-a", flow);
    f.remote.lose = "commerce.checkouts.confirm";
    await assert.rejects(
      f.service.confirm("session-a", flow, v.intent!.id),
      /NETWORK_UNCERTAIN/,
    );
    assert.equal(f.remote.confirms, 1);
    f.restart();
    const r = await f.service.confirm("session-a", flow, v.intent!.id);
    assert.equal(r.order.id, "order");
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
test("lost cart receipt blocks replacement writes and restores original cart", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    f.remote.lose = "commerce.carts.create";
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "add",
      ),
      /NETWORK_UNCERTAIN/,
    );
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "different",
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    f.restart();
    const r = await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "recover",
    );
    assert.equal(r.data.cart.id, "cart");
    assert.equal(f.remote.writes, 1);
  } finally {
    f.close();
  }
});
test("concurrent confirmations serialize to the original operation", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      v = await f.service.review("session-a", flow);
    await Promise.all([
      f.service.confirm("session-a", flow, v.intent!.id),
      f.service.confirm("session-a", flow, v.intent!.id),
    ]);
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
test("tool schemas reject confirm/payment, personal data and required version omissions", () => {
  assert.equal(
    schemas.frontvia_checkout.safeParse({ flowId: "x", action: "confirm" })
      .success,
    false,
  );
  assert.equal(
    schemas.frontvia_checkout.safeParse({ flowId: "x", action: "quote" })
      .success,
    false,
  );
  assert.equal(
    schemas.frontvia_cart.safeParse({
      flowId: "x",
      action: "delivery_select",
      group_id: "g",
      option_id: "o",
    }).success,
    false,
  );
  assert.equal(
    schemas.frontvia_cart.safeParse({
      flowId: "x",
      action: "get",
      email: "x@y.test",
    }).success,
    false,
  );
  assert.deepEqual(
    modelData({
      confirmation: { token: "secret" },
      shipping_address: { line1: "secret" },
      data: { token: "private", id: "public" },
    }),
    { data: { id: "public" } },
  );
});
test("opaque API pagination cursors remain intact through model output and tool input", () => {
  const cursor = "opaque-signed-page.".padEnd(4096, "x");
  assert.equal(
    modelData({ page: { next_cursor: cursor } }).page.next_cursor,
    cursor,
  );
  for (const [schema, args] of [
    [
      schemas.frontvia_products,
      { flowId: "flow", action: "search", query: "Mug" },
    ],
    [
      schemas.frontvia_products,
      { flowId: "flow", action: "variants", product_id: "product" },
    ],
    [schemas.frontvia_orders, { flowId: "flow", action: "list" }],
  ] as const) {
    assert.equal(schema.safeParse({ ...args, cursor }).success, true);
    assert.equal(
      schema.safeParse({ ...args, cursor: cursor + "x" }).success,
      false,
    );
  }
});
test("DSH tool registration exposes exactly five provider-compatible capabilities, never confirm", () => {
  const f = fixture();
  try {
    const definitions = tools(f.service);
    assert.deepEqual(
      definitions.map((t) => t.name),
      Object.keys(schemas),
    );
    for (const t of definitions) {
      assert.equal(t.parameters.type, "object");
      assert.ok(t.parameters.properties.action.enum.length);
      assert.ok(!t.parameters.properties.action.enum.includes("confirm"));
    }
  } finally {
    f.close();
  }
});
test("owner confirmation contract rejects client-controlled amounts, identities and tokens", () => {
  const payload = {
    sessionId: "s",
    flowId: "8f29b73b-7507-4991-85cc-af258ed97123",
    intentId: "5cf1d499-f394-4a1c-83b9-e0fdb174c035",
  };
  assert.equal(uiSchemas.confirm.safeParse(payload).success, true);
  for (const field of [
    "amount_minor",
    "user_id",
    "store_id",
    "confirmation",
    "token",
    "idempotency_key",
  ])
    assert.equal(
      uiSchemas.confirm.safeParse({ ...payload, [field]: "forged" }).success,
      false,
    );
});

test("revise invalidates old confirmation and preserves inputs; submitted purchases cannot be revised", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      old = await f.service.review("session-a", flow);
    await f.service.tool(
      "session-a",
      "frontvia_checkout",
      { flowId: flow, action: "revise" },
      "revise",
    );
    await assert.rejects(
      f.service.confirm("session-a", flow, old.intent!.id),
      /CONFIRMATION_REQUIRED/,
    );
    const v = await f.service.view("session-a", flow);
    assert.equal(v.cart.shipping_address.line1, "Secret Street");
    assert.equal(v.quote, undefined);
    await f.service.tool(
      "session-a",
      "frontvia_checkout",
      { flowId: flow, action: "quote", expected_version: "v3" },
      "quote-again",
    );
    await f.service.tool(
      "session-a",
      "frontvia_checkout",
      { flowId: flow, action: "prepare" },
      "prepare-again",
    );
    const next = await f.service.review("session-a", flow);
    assert.notEqual(next.intent!.id, old.intent!.id);
    await f.service.confirm("session-a", flow, next.intent!.id);
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_checkout",
        { flowId: flow, action: "revise" },
        "revise-paid",
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
