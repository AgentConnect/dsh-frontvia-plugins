import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomBytes,
  createHmac,
  generateKeyPairSync,
  createPublicKey,
  verify,
} from "node:crypto";
import { Vault, PapError, jwt } from "dsh-pap/core";
import { CustomerService, modelData, type PapPort } from "../src/core.js";
import { schemas, tools } from "../src/tools.js";
import { uiSchemas } from "../src/ui-contract.js";
import { shoppingReference } from "../src/client/history.js";
import { shoppingStep } from "../src/client/shopping-progress.js";
const copy = (v: any) => structuredClone(v);
function fixture(cache = false, cny = false, language?: string) {
  const currency = cny ? "CNY" : "USD",
    country = cny ? "CN" : "US",
    locale = language ?? (cny ? "zh-CN" : "en-US");
  const profile = cny
    ? "frontvia.personal_purchase.v1"
    : "frontvia.pap_subject_purchase.v1";
  const proof = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
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
    searches: [] as any[],
    writes: 0,
    confirms: 0,
    lose: "",
    price: "1234",
    purchase: true,
    generation: "one",
    methodAvailability: {} as Record<string, string>,
  };
  const identity = {
    clientId: "https://client.test/client.json",
    userId: "stable-subject",
    issuer: "https://auth.test",
    resource: "https://api.test/rpc",
    signedIn: false,
    personalSignedIn: cny,
  };
  const response = (data: any) => ({ result: { data: copy(data) } });
  const pap: PapPort = {
    apiVersion: 1,
    ...(cny
      ? {
          signResourceStatement: (_ref: string, typ: string, claims: any) =>
            jwt(
              proof,
              {
                alg: "ES256",
                typ,
                jwk: createPublicKey(proof).export({ format: "jwk" }),
              },
              claims,
            ),
        }
      : {}),
    ...(cache ? { capabilityCacheKey: () => remote.generation } : {}),
    sites: () => [
      {
        revision: "fixture-revision",
        id: "a",
        label: "Shop",
        domain: "shop.test",
        issuer: identity.issuer,
        resource: identity.resource,
        description: undefined,
        service: undefined,
        clientAllowed: undefined,
      },
    ],
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
          default_context: { country, currency, locale },
          methods: [
            "capabilities.get",
            "connections.list",
            "products.search",
            "products.get",
            "variants.list",
            "carts.create",
            "carts.get",
            "carts.update",
            "carts.lines.add",
            "carts.lines.update",
            "carts.lines.remove",
            "carts.delivery_options.list",
            "carts.delivery_option.select",
            "quotes.create",
            "quotes.get",
            "checkouts.create",
            "checkouts.get",
            "checkouts.cancel",
            "checkouts.confirm",
            "orders.list",
            "orders.get",
            "operations.lookup",
          ].map((m) => ({
            method: `commerce.${m}`,
            availability:
              remote.methodAvailability[`commerce.${m}`] ?? "supported",
          })),
          business_profiles: [
            {
              id: profile,
              availability: remote.purchase ? "supported" : "disabled",
            },
          ],
        });
      if (m === "commerce.connections.list")
        return response({
          items: [{ connection_id: "native", generation: 1, is_current: true }],
        });
      if (m === "commerce.products.search") {
        remote.searches.push(copy(p));
        if ("query" in p && !p.query)
          return { error: { code: "INVALID_PARAMS" } };
        return response({
          items: [{ id: "prod", title: "Test Mug" }],
          page: {
            has_more: !!p.page?.cursor,
            next_cursor: p.page?.cursor ? "next-page" : null,
          },
        });
      }
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
                  amount: { amount_minor: "500", currency },
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
            grand_total: { amount_minor: remote.price, currency },
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
          totals: { grand_total: { amount_minor: "1734", currency } },
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
            profile,
            ...(cny ? { user_id: identity.userId } : {}),
            issuer: identity.issuer,
            resource: identity.resource,
            store_id: "store",
            connection_id: "native",
            generation: 1,
            quote_id: "quote",
            snapshot_hash: remote.quote.snapshot_hash,
            amount_minor: "1734",
            currency,
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
        if (cny)
          assert(
            verify(
              "sha256",
              Buffer.from(h + "." + c),
              { key: createPublicKey(proof), dsaEncoding: "ieee-p1363" },
              Buffer.from(s, "base64url"),
            ),
          );
        else
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
          payment: { status: cny ? "unpaid" : "paid" },
          fulfillment_status: "unfulfilled",
          totals: remote.quote.totals,
        };
        remote.checkout.status = "completed";
        remote.checkout.order_ids = ["order"];
        if (cny)
          remote.checkout.next_actions = [
            {
              type: "redirect",
              purpose: "payment",
              url: "https://auth.test/companies/a/pay/checkout?access=v2.secret",
              expires_at: new Date(Date.now() + 300000).toISOString(),
            },
          ];
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
    country,
    currency,
    db,
    get vault() {
      return vault;
    },
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
        country: f.country,
        ...(f.country === "CN" ? { phone: "+8613800000000" } : {}),
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
test("sidebar list selection opens the owning flow through the strict UI contract", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      row = f.service.list()[0];
    const ui = shoppingReference(row);
    const args = uiSchemas.view.parse(ui);
    const view = await f.service.view(args.sessionId, args.flowId);
    assert.equal(view.flowId, flow);
    assert.equal(shoppingStep(view), "quote");
    assert.equal(view.cart.shipping_address.line1, "Secret Street");
    assert.ok(uiSchemas.review.safeParse(ui).success);
    assert.ok(uiSchemas.recover.safeParse(ui).success);
    assert.ok(!uiSchemas.view.safeParse({ ...row, card: "cart" }).success);
    await assert.rejects(
      f.service.view("other-session", args.flowId),
      /FLOW_NOT_OWNED/,
    );
  } finally {
    f.close();
  }
});
test("resuming a shopping record follows the current cart instead of its old card hint", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const view = () => f.service.view("session-a", flow);
    assert.equal(shoppingStep(await view()), "products");
    await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId: flow, action: "search" },
      "browse",
    );
    assert.equal(shoppingStep(await view()), "products");
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
      "add",
    );
    assert.equal(shoppingStep(await view()), "cart");
    // The cart still exists after its final item is removed remotely.
    f.remote.cart.lines = [];
    f.restart();
    const empty = await view();
    assert.ok(empty.cart.id);
    assert.equal(shoppingStep(empty), "products");
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});
test("resuming a quoted record keeps expired pricing visible without confirming", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f);
    const review = await f.service.review("session-a", flow);
    assert.equal(review.intent?.submitted, false);
    assert.equal(shoppingStep(review), "quote");
    f.remote.quote.expires_at = "2000-01-01T00:00:00Z";
    f.restart();
    const expired = await f.service.view("session-a", flow);
    assert.equal(shoppingStep(expired), "quote");
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});
test(
  "reconnect serializes with cart writes instead of overwriting their journal",
  { timeout: 5000 },
  async () => {
    const f = fixture();
    let release!: () => void;
    try {
      const flow = await f.flow(),
        port = f.service.pap,
        request = port.request.bind(port);
      let entered!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const waiting = new Promise<void>((r) => {
        entered = r;
      });
      port.request = async (...args) => {
        if (args[1] === "commerce.capabilities.get") {
          entered();
          await gate;
        }
        return request(...args);
      };
      const reconnect = f.service.connect("session-a", "a");
      await waiting;
      const write = f.service.tool(
        "session-a",
        "frontvia_cart",
        {
          flowId: flow,
          action: "add",
          variant_id: "variant",
          quantity: 1,
        },
        "concurrent-add",
      );
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(f.remote.writes, 0);
      release();
      await Promise.all([reconnect, write]);
      f.restart();
      const saved = f.service.flow("session-a", flow);
      assert.equal(saved.cart.id, "cart");
      assert.equal(Object.keys(saved.commands).length, 1);
      assert.equal(Object.values(saved.commands)[0].status, "done");
      assert.equal(f.remote.writes, 1);
    } finally {
      release?.();
      f.close();
    }
  },
);
test("reconnect preserves an uncertain write and its original key across restart", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    f.remote.lose = "commerce.carts.create";
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        {
          flowId: flow,
          action: "add",
          variant_id: "variant",
          quantity: 1,
        },
        "lost-add",
      ),
      /NETWORK_UNCERTAIN/,
    );
    const original = f.service.flow("session-a", flow).pending;
    await f.service.connect("session-a", "a");
    f.restart();
    assert.equal(f.service.flow("session-a", flow).pending, original);
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "lookup",
    );
    const saved = f.service.flow("session-a", flow);
    assert.equal(saved.cart.id, "cart");
    assert.equal(saved.commands[original!].status, "done");
    assert.equal(f.remote.writes, 1);
  } finally {
    f.close();
  }
});
test("a pre-dispatch abort leaves no pending command and the same invocation can be explicitly retried", async () => {
  const f = fixture();
  try {
    const flow = await f.flow(),
      controller = new AbortController();
    const args = {
      flowId: flow,
      action: "add",
      variant_id: "variant",
      quantity: 1,
    };
    controller.abort();
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        args,
        "cancelled-add",
        controller.signal,
      ),
      { name: "AbortError" },
    );
    assert.equal(f.remote.writes, 0);
    assert.equal(f.service.flow("session-a", flow).pending, undefined);
    assert.deepEqual(f.service.flow("session-a", flow).commands, {});
    f.restart();
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "lookup",
    );
    await f.service.tool("session-a", "frontvia_cart", args, "cancelled-add");
    assert.equal(f.remote.writes, 1);
    assert.equal(f.service.flow("session-a", flow).cart.id, "cart");
  } finally {
    f.close();
  }
});
for (const lostReceipt of [false, true]) {
  test(`failed confirmation with no effects permits fresh consent (${lostReceipt ? "recovered after restart" : "immediate receipt"})`, async () => {
    const f = fixture();
    try {
      const flow = await prepare(f),
        review = await f.service.review("session-a", flow);
      const port = f.service.pap,
        request = port.request.bind(port);
      let rejectOnce = true,
        originalKey = "";
      port.request = async (ref, method, params: any, signal) => {
        if (method !== "commerce.checkouts.confirm" || !rejectOnce)
          return request(ref, method, params, signal);
        rejectOnce = false;
        originalKey = params.idempotency_key;
        const data = {
          operation: {
            id: "rejected-confirm",
            status: "failed",
            effects: "none",
            result_ref: { id: "checkout" },
          },
          resource: copy(f.remote.checkout),
        };
        f.remote.ops.set(originalKey, data);
        if (lostReceipt) throw new PapError("NETWORK_UNCERTAIN");
        return { result: { data } };
      };
      if (lostReceipt) {
        await assert.rejects(
          f.service.confirm("session-a", flow, review.intent!.id),
          /NETWORK_UNCERTAIN/,
        );
        f.restart();
        await f.service.tool(
          "session-a",
          "frontvia_orders",
          { flowId: flow, action: "recover" },
          "recover-failure",
        );
      } else await f.service.confirm("session-a", flow, review.intent!.id);
      const saved = f.service.flow("session-a", flow);
      assert.equal(saved.pending, undefined);
      assert.equal(saved.intent, undefined);
      assert.equal(
        shoppingStep(await f.service.view("session-a", flow)),
        "quote",
      );
      assert.equal(saved.commands[originalKey].status, "done");
      assert.equal(
        saved.commands[originalKey].params.idempotency_key,
        originalKey,
      );
      assert.equal(f.remote.confirms, 0);
      await assert.rejects(
        f.service.confirm("session-a", flow, review.intent!.id),
        /CONFIRMATION_REQUIRED/,
      );
      if (lostReceipt) {
        await f.service.tool(
          "session-a",
          "frontvia_checkout",
          { flowId: flow, action: "revise" },
          "revise-after-failure",
        );
        await f.service.tool(
          "session-a",
          "frontvia_checkout",
          { flowId: flow, action: "quote", expected_version: "v3" },
          "new-quote",
        );
        await f.service.tool(
          "session-a",
          "frontvia_checkout",
          { flowId: flow, action: "prepare" },
          "new-checkout",
        );
      }
      const next = await f.service.review("session-a", flow);
      assert.notEqual(next.intent!.id, review.intent!.id);
      assert.equal(next.intent!.submitted, false);
      assert.equal(f.remote.confirms, 0);
      assert.notEqual(
        f.service.flow("session-a", flow).intent!.key,
        originalKey,
      );
      await f.service.confirm("session-a", flow, next.intent!.id);
      await f.service.confirm("session-a", flow, next.intent!.id);
      assert.equal(f.remote.confirms, 1);
      assert.equal(
        f.service.flow("session-a", flow).commands[originalKey].result.operation
          .status,
        "failed",
      );
    } finally {
      f.close();
    }
  });
}
test("legacy completed failed/no-effect records retire stale consent without replay", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f);
    await f.service.review("session-a", flow);
    const saved = f.service.flow("session-a", flow),
      oldIntent = saved.intent!;
    oldIntent.token = "previously-submitted-token";
    saved.commands[oldIntent.key] = {
      key: oldIntent.key,
      method: "commerce.checkouts.confirm",
      params: { idempotency_key: oldIntent.key, confirmation: oldIntent.token },
      status: "done",
      result: {
        operation: { id: "failed-op", status: "failed", effects: "none" },
      },
    };
    f.vault.set(`flow:${flow}`, saved);
    f.restart();
    const view = await f.service.view("session-a", flow);
    assert.equal(view.intent, undefined);
    const next = await f.service.review("session-a", flow);
    assert.notEqual(next.intent!.id, oldIntent.id);
    assert.equal(f.remote.confirms, 0);
    assert.equal(
      f.service.flow("session-a", flow).commands[oldIntent.key].status,
      "done",
    );
  } finally {
    f.close();
  }
});
test("failed confirmation with uncertain effects stays blocked without new consent or writes", async () => {
  const f = fixture();
  try {
    const flow = await prepare(f),
      review = await f.service.review("session-a", flow);
    const port = f.service.pap,
      request = port.request.bind(port);
    port.request = async (ref, method, params: any, signal) => {
      if (method !== "commerce.checkouts.confirm")
        return request(ref, method, params, signal);
      const data = {
        operation: { id: "uncertain", status: "failed", effects: "unknown" },
        resource: copy(f.remote.checkout),
      };
      f.remote.ops.set(params.idempotency_key, data);
      return { result: { data } };
    };
    const result = await f.service.confirm(
      "session-a",
      flow,
      review.intent!.id,
    );
    assert.equal(result.pending, true);
    assert.equal(shoppingStep(result), "order");
    assert.equal(result.intent!.submitted, true);
    f.restart();
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "lookup-uncertain",
    );
    await assert.rejects(
      f.service.review("session-a", flow),
      /RESOLVE_PENDING_OPERATION/,
    );
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_checkout",
        { flowId: flow, action: "revise" },
        "blocked-revise",
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    assert.equal(
      f.service.flow("session-a", flow).intent!.id,
      review.intent!.id,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});
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
    assert.equal(shoppingStep(r), "order");
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
test("DSH tool registration exposes provider-compatible direct commerce and knowledge tools, never purchase confirm", () => {
  const f = fixture();
  try {
    const definitions = tools(f.service);
    assert.deepEqual(
      definitions.map((t) => t.name),
      Object.keys(schemas).filter((n) => n !== "frontvia_consultation"),
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

test("merchant purchase disabled still permits catalogue while blocking writes before journal admission", async () => {
  const f = fixture();
  try {
    f.remote.purchase = false;
    const flow = await f.flow();
    const products = await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId: flow, action: "search", query: "mug" },
      "search",
    );
    assert.equal(products.data.items[0].title, "Test Mug");
    assert.equal(
      (await f.service.view("session-a", flow)).purchaseReady,
      false,
    );
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "add",
      ),
      /PURCHASE_PROFILE_UNAVAILABLE/,
    );
    assert.equal(f.remote.writes, 0);
    assert.equal((await f.service.view("session-a", flow)).pending, false);
  } finally {
    f.close();
  }
});
test("fresh merchant capabilities revoke previously supported methods and unverified is not usable", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    for (const availability of ["disabled", "unverified", "unsupported"]) {
      f.remote.methodAvailability["commerce.products.search"] = availability;
      const before = f.remote.calls.filter(
        (m) => m === "commerce.products.search",
      ).length;
      await assert.rejects(
        f.service.tool(
          "session-a",
          "frontvia_products",
          { flowId: flow, action: "search", query: "mug" },
          availability,
        ),
        /METHOD_UNAVAILABLE/,
      );
      assert.equal(
        f.remote.calls.filter((m) => m === "commerce.products.search").length,
        before,
      );
    }
    f.remote.methodAvailability["commerce.carts.create"] = "disabled";
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "add",
      ),
      /METHOD_UNAVAILABLE/,
    );
    assert.equal(f.remote.writes, 0);
  } finally {
    f.close();
  }
});
test("a merchant exposing confirmation does not create a missing client confirmation credential", async () => {
  const f = fixture();
  try {
    f.service.config.sites[0].confirmationKeyRef = undefined;
    f.service.config.sites[0].confirmationKid = undefined;
    const flow = await prepare(f);
    assert.equal(
      (await f.service.view("session-a", flow)).purchaseReady,
      false,
    );
    await assert.rejects(
      f.service.review("session-a", flow),
      /PURCHASE_CONFIRMATION_UNAVAILABLE/,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("browse and legacy blank searches omit the query, retain pagination, and return one catalog page", async () => {
  const f = fixture();
  try {
    const flowId = await f.flow();
    const tool = tools(f.service).find((t) => t.name === "frontvia_products")!;
    for (const [index, args] of [
      { action: "browse" },
      { action: "search", query: "" },
      { action: "search", query: "  " },
      { action: "search" },
      { action: "search", query: "  Mug  ", cursor: "opaque-page" },
    ].entries()) {
      const result: any = await tool.execute({ ...args, flowId }, {
        agent: { id: "session-a" },
        callId: `catalog-${index}`,
      } as any);
      assert.equal(result.error, undefined);
      assert.equal(f.remote.searches.length, index + 1);
      const params = f.remote.searches.at(-1);
      if (index < 4) {
        assert.equal(Object.hasOwn(params, "query"), false);
        assert.equal(result.catalog.mode, "browse");
        assert.equal(result.catalog.hasMore, false);
        assert.match(result.nextStep, /没有下一页/);
      } else {
        assert.equal(params.query, "Mug");
        assert.equal(params.page.cursor, "opaque-page");
        assert.equal(result.catalog.mode, "search");
        assert.equal(result.catalog.hasMore, true);
        assert.equal(result.data.page.next_cursor, "next-page");
      }
      assert.equal(result.catalog.returnedCount, 1);
      assert.equal(result.data.items[0].title, "Test Mug");
    }
    assert.equal(f.remote.writes, 0);
    assert(!f.remote.calls.includes("commerce.variants.list"));
    const invalid: any = await tool.execute(
      { action: "browse", flowId, query: "unexpected search keyword" },
      { agent: { id: "session-a" }, callId: "invalid-catalog" } as any,
    );
    assert.equal(invalid.error.code, "INVALID_TOOL_ARGUMENTS");
    assert.match(invalid.nextStep, /browse/);
    assert.equal(f.remote.searches.length, 5);
  } finally {
    f.close();
  }
});

test("cart availability matches fresh authority and unavailable add stops before any remote write", async () => {
  const f = fixture();
  try {
    const flowId = await f.flow();
    assert.equal((await f.service.view("session-a", flowId)).cartReady, true);
    f.remote.methodAvailability["commerce.carts.create"] = "disabled";
    assert.equal((await f.service.view("session-a", flowId)).cartReady, false);
    const tool = tools(f.service).find((t) => t.name === "frontvia_cart")!;
    const result: any = await tool.execute(
      { action: "add", flowId, variant_id: "variant", quantity: 1 },
      { agent: { id: "session-a" }, callId: "blocked-add" } as any,
    );
    assert.equal(result.error.code, "METHOD_UNAVAILABLE");
    assert.match(result.nextStep, /操作没有执行/);
    assert.match(result.nextStep, /不要重试/);
    assert.equal(f.remote.writes, 0);
    assert.equal((await f.service.view("session-a", flowId)).pending, false);
    delete f.remote.methodAvailability["commerce.carts.create"];
    f.remote.purchase = false;
    assert.equal((await f.service.view("session-a", flowId)).cartReady, false);
    f.remote.purchase = true;
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { action: "add", flowId, variant_id: "variant", quantity: 1 },
      "allowed-add",
    );
    f.remote.methodAvailability["commerce.carts.lines.add"] = "disabled";
    assert.equal((await f.service.view("session-a", flowId)).cartReady, false);
    delete f.remote.methodAvailability["commerce.carts.lines.add"];
    assert.equal((await f.service.view("session-a", flowId)).cartReady, true);
  } finally {
    f.close();
  }
});

test("exported cart tool preserves opaque string versions while consultation uses numeric revisions", async () => {
  const f = fixture();
  try {
    const flowId = await f.flow();
    const tool = tools(f.service).find((t) => t.name === "frontvia_cart")!;
    const invoke = (args: any, callId: string) =>
      tool.execute({ flowId, ...args }, {
        agent: { id: "session-a" },
        callId,
      } as any) as Promise<any>;
    assert.equal(
      (
        await invoke(
          { action: "add", variant_id: "variant", quantity: 1 },
          "first-line",
        )
      ).error,
      undefined,
    );
    assert.equal(f.remote.cart.version, "v1");
    const result = await invoke(
      {
        action: "add",
        variant_id: "variant",
        quantity: 1,
        expected_version: "v1",
      },
      "next-line",
    );
    assert.equal(result.error, undefined);
    assert.equal(f.remote.cart.version, "v2");
    const writes = f.remote.writes;
    await assert.rejects(
      invoke(
        {
          action: "add",
          variant_id: "variant",
          quantity: 1,
          expected_version: 2,
        },
        "numeric-commerce-version",
      ),
      /expected_version.*string/,
    );
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
});

test("browse and concurrent card reads reuse capabilities; mutations and changed generation recheck", async () => {
  const f = fixture(true);
  try {
    const flow = await f.flow();
    const count = () =>
      f.remote.calls.filter((m) => m === "commerce.capabilities.get").length;
    assert.equal(count(), 1);
    await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId: flow, action: "browse" },
      "browse",
    );
    await Promise.all(
      Array.from({ length: 5 }, () => f.service.view("session-a", flow)),
    );
    assert.equal(count(), 1);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.products.search").length,
      1,
    );
    f.remote.generation = "two";
    await f.service.view("session-a", flow);
    assert.equal(count(), 2);
    f.remote.methodAvailability["commerce.carts.create"] = "unavailable";
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "add",
      ),
      /METHOD_UNAVAILABLE/,
    );
    assert.equal(count(), 3);
    assert.equal(f.remote.writes, 0);
  } finally {
    f.close();
  }
});

test("CNY uses direct Commerce, owner ES256 confirmation and private original payment link", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const view = await f.service.review("session-a", flow);
    assert.equal(view.pricing.currency, "CNY");
    assert.equal(view.cart.shipping_address.country, "CN");
    assert.equal(f.remote.confirms, 0);
    const submitted = await f.service.confirm(
      "session-a",
      flow,
      view.intent!.id,
    );
    assert.equal(f.remote.confirms, 1);
    assert.equal(submitted.order?.payment.status, "unpaid");
    assert(
      submitted.checkout?.paymentAction?.url.startsWith("https://auth.test/"),
    );
    assert(!JSON.stringify(modelData(f.remote.checkout)).includes("access=v2"));
    assert(f.remote.calls.every((m) => m.startsWith("commerce.")));
    await f.service.confirm("session-a", flow, view.intent!.id);
    assert.equal(f.remote.confirms, 1);
    f.remote.checkout.next_actions[0].url = "https://evil.test/pay";
    assert.equal(
      (await f.service.view("session-a", flow)).checkout?.paymentAction,
      undefined,
    );
  } finally {
    f.close();
  }
});
test("owner contact omits blank optional address values from actual Commerce writes", async () => {
  for (const cny of [true, false]) {
    const f = fixture(false, cny);
    try {
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
          ...(cny ? {} : { email: "owner@example.test" }),
          shipping_address: {
            country: f.country,
            recipient: "Recipient",
            line1: "Street",
            city: "City",
            region: cny ? "浙江省" : "CA",
            postal_code: cny ? "   " : "94105",
            phone: cny ? "+8613800000000" : "",
          },
        },
        "save-contact",
      );
      assert.equal(f.remote.cart.version, "v2");
      assert.equal(
        Object.hasOwn(
          f.remote.cart.shipping_address,
          cny ? "postal_code" : "phone",
        ),
        false,
      );
      assert.equal(
        f.remote.cart.shipping_address[cny ? "phone" : "postal_code"],
        cny ? "+8613800000000" : "94105",
      );
      assert.equal(Object.hasOwn(f.remote.cart, "email"), !cny);
      const refreshed = await f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "get" },
        "read-contact",
      );
      assert.equal(refreshed.contactReady, true);
      assert.equal(JSON.stringify(refreshed).includes("+8613800000000"), false);
    } finally {
      f.close();
    }
  }
});
test("CNY delivery requires a phone and refuses a foreign-country patch without dispatch", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
      "add",
    );
    const before = f.remote.writes;
    await assert.rejects(
      f.service.contact(
        "session-a",
        flow,
        "v1",
        {
          shipping_address: {
            country: "CN",
            recipient: "Name",
            line1: "Street",
            city: "City",
            region: "Province",
          },
        },
        "missing-phone",
      ),
    );
    await assert.rejects(
      f.service.contact(
        "session-a",
        flow,
        "v1",
        {
          email: "a@example.test",
          shipping_address: {
            country: "US",
            recipient: "Name",
            line1: "Street",
            city: "City",
            region: "CA",
            postal_code: "12345",
          },
        },
        "foreign",
      ),
      /ADDRESS_COUNTRY_MISMATCH/,
    );
    assert.equal(f.remote.writes, before);
  } finally {
    f.close();
  }
});

for (const locale of ["en-US", "zh-CN"])
  test(`US/USD ${locale} preserves pricing through browse, owner confirmation and order reads`, async () => {
    const f = fixture(false, false, locale);
    try {
      const flow = await prepare(f);
      await f.service.tool(
        "session-a",
        "frontvia_products",
        { flowId: flow, action: "browse" },
        "browse-locale",
      );
      assert.deepEqual(f.remote.searches.at(-1).context, {
        country: "US",
        currency: "USD",
        locale,
      });
      const view = await f.service.review("session-a", flow);
      assert.deepEqual(view.pricing, {
        country: "US",
        currency: "USD",
        locale,
      });
      assert.equal(view.cart.shipping_address.country, "US");
      assert.equal(f.remote.confirms, 0);
      await f.service.confirm("session-a", flow, view.intent!.id);
      const restored = await f.service.view("session-a", flow);
      assert.equal(restored.pricing.locale, locale);
      assert.equal(restored.order?.totals.grand_total.currency, "USD");
      assert.equal(f.remote.confirms, 1);
    } finally {
      f.close();
    }
  });

test("unsupported store locale is rejected before cart writes", async () => {
  const f = fixture(false, false, "fr-FR");
  try {
    const flow = await f.flow();
    await assert.rejects(
      f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "unsupported-locale",
      ),
      /PRICING_CONTEXT_UNSUPPORTED/,
    );
    assert.equal(f.remote.writes, 0);
  } finally {
    f.close();
  }
});
