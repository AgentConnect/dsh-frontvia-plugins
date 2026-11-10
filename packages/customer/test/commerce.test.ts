import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomBytes,
  randomUUID,
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
import { isRequiredContact } from "../src/contact-fields.js";
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
    fail: "",
    price: "1234",
    purchase: true,
    generation: "one",
    methodAvailability: {} as Record<string, string>,
    variantItems: undefined as any[] | undefined,
    selectedDelivery: undefined as string | undefined,
    deliveryGroups: undefined as any[] | undefined,
    deliveryRequirements: [] as any[],
    cancelPaymentRace: false,
    paymentCalls: 0,
    paymentOverride: undefined as any,
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
    apiVersion: 2,
    hostedPayment: async (_ref, _url, checkoutId) => {
      remote.paymentCalls++;
      return {
        data: remote.paymentOverride ?? {
          checkout_id: checkoutId,
          expires_at: Math.floor(
            Date.parse(remote.checkout.next_actions[0].expires_at) / 1000,
          ),
          quote: remote.quote,
          payment: { status: "pending" },
          order_status: "open",
          can_pay: true,
          payee_name: "测试商家",
          action: {
            type: "alipay_qr",
            expires_at: remote.checkout.next_actions[0].expires_at,
          },
          qr_svg:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/><path d="M1 1h1v1H1z"/></svg>',
        },
      };
    },
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
      if (m === "commerce.products.get")
        return response({
          id: p.product_id,
          title: "Test Mug",
          description: "Ceramic mug",
        });
      if (m === "commerce.variants.list")
        return response({
          items: remote.variantItems ?? [
            { id: "variant", product_id: p.product_id, title: "Blue" },
          ],
        });
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
          requirements: remote.deliveryRequirements,
          delivery_groups: remote.deliveryGroups ?? [
            {
              id: "group",
              ...(remote.selectedDelivery
                ? { selected_option_id: remote.selectedDelivery }
                : {}),
              options: [
                {
                  id: "standard",
                  label: "Standard",
                  price_status: "known",
                  amount: { amount_minor: "500", currency },
                },
              ],
            },
          ],
        });
      const k = p.meta?.idempotency_key ?? p.idempotency_key;
      if (remote.ops.has(k)) return response(remote.ops.get(k));
      if (remote.fail === m) {
        const data = {
          operation: { id: "failed-op", status: "failed", effects: "none" },
        };
        remote.ops.set(k, data);
        return response(data);
      }
      let resource: any;
      if (m === "commerce.carts.create")
        remote.cart = {
          id: "cart",
          store_id: "store",
          version: "v1",
          lines: p.lines.map((line: any, index: number) => ({
            ...line,
            id: `line-${index}`,
            title: "Test Mug",
            unit_price: { currency, amount_minor: remote.price },
          })),
          totals: {
            grand_total: { amount_minor: remote.price, currency },
          },
        };
      else if (m.startsWith("commerce.carts.")) {
        assert.equal(p.expected_version, remote.cart.version);
        remote.cart.version = "v" + (Number(remote.cart.version.slice(1)) + 1);
        if (p.patch) Object.assign(remote.cart, p.patch);
        if (m === "commerce.carts.lines.update")
          remote.cart.lines.find((l: any) => l.id === p.line_id).quantity =
            p.quantity;
        if (m === "commerce.carts.lines.remove")
          remote.cart.lines = remote.cart.lines.filter(
            (l: any) => l.id !== p.line_id,
          );
        if (m === "commerce.carts.lines.add")
          remote.cart.lines.push({
            ...p.line,
            id: `line-${remote.cart.lines.length}`,
            title: "Test Mug",
            unit_price: { currency, amount_minor: remote.price },
          });
        if (m === "commerce.carts.delivery_option.select") {
          remote.selectedDelivery = p.option_id;
          const group = remote.deliveryGroups?.find((g) => g.id === p.group_id);
          if (group) group.selected_option_id = p.option_id;
        }
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
      if (m === "commerce.checkouts.cancel" && remote.cancelPaymentRace) {
        remote.order.payment.status = "paid";
        const data = {
          operation: {
            id: "cancel-race",
            status: "failed",
            effects: "none",
            error: { code: "PAID_ORDER_REQUIRES_MERCHANT_REFUND" },
          },
        };
        remote.ops.set(k, data);
        return response(data);
      }
      if (m === "commerce.checkouts.cancel") {
        remote.checkout.status = "canceled";
        remote.checkout.can_start_new_attempt = true;
        if (remote.order) {
          remote.order.status = "canceled";
          remote.order.payment.status = "voided";
          remote.checkout.payment_summary.status = "voided";
        }
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
          status: "open",
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
    pap,
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
  const paymentRef = {
    sessionId: "session",
    flowId: "00000000-0000-4000-8000-000000000001",
  };
  assert(uiSchemas["payment-start"].safeParse(paymentRef).success);
  for (const extra of [
    { url: "https://evil.test/pay" },
    { amount_minor: "1" },
    { checkoutId: "other" },
  ])
    assert.equal(
      uiSchemas["payment-start"].safeParse({ ...paymentRef, ...extra }).success,
      false,
    );
  assert.equal(
    schemas.frontvia_checkout.safeParse({
      flowId: paymentRef.flowId,
      action: "payment-start",
    }).success,
    false,
  );
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
test("DSH tool registration exposes direct commerce, advice and knowledge, never purchase confirm", () => {
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
test("owner QR payment stays on the confirmed order, survives restart, and hides on paid, canceled or expiry", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    await assert.rejects(
      f.service.startPayment("session-a", flow),
      /CONFIRMATION_REQUIRED/,
    );
    assert.equal(f.remote.paymentCalls, 0);
    const review = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, review.intent!.id);
    const writes = f.remote.writes;
    const qr = await f.service.startPayment("session-a", flow);
    assert.equal(qr.paymentQr?.payee, "测试商家");
    assert.equal(qr.paymentQr?.checkoutId, "checkout");
    assert.match(qr.paymentQr!.svg, /<svg/);
    assert.equal(qr.order.payment.status, "pending");
    f.restart();
    assert.ok((await f.service.view("session-a", flow)).paymentQr);
    await assert.rejects(
      f.service.startPayment("other-session", flow),
      /FLOW_NOT_OWNED/,
    );
    assert.equal(f.remote.paymentCalls, 1);
    await f.service.startPayment("session-a", flow);
    assert.equal(f.remote.paymentCalls, 2);
    assert.equal(f.remote.confirms, 1);
    assert.equal(f.remote.writes, writes);
    f.remote.order.payment.status = "paid";
    assert.equal(
      (await f.service.view("session-a", flow)).paymentQr,
      undefined,
    );
    await assert.rejects(
      f.service.startPayment("session-a", flow),
      /PAYMENT_LINK_UNAVAILABLE/,
    );
    assert.equal(f.remote.paymentCalls, 2);
    f.remote.order.payment.status = "unpaid";
    f.remote.checkout.next_actions[0].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    await assert.rejects(
      f.service.startPayment("session-a", flow),
      /PAYMENT_LINK_UNAVAILABLE/,
    );
    assert.equal(f.remote.paymentCalls, 2);
    assert.equal(modelData({ paymentQr: qr.paymentQr }).paymentQr, undefined);
  } finally {
    f.close();
  }
});
test("QR responses cannot substitute checkout, price, payee or active content", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const review = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, review.intent!.id);
    const expiry = f.remote.checkout.next_actions[0].expires_at;
    const valid = {
      checkout_id: "checkout",
      expires_at: Math.floor(Date.parse(expiry) / 1000),
      quote: f.remote.quote,
      payment: { status: "pending" },
      order_status: "open",
      can_pay: true,
      payee_name: "商家",
      action: { type: "alipay_qr", expires_at: expiry },
      qr_svg:
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
    };
    for (const patch of [
      { checkout_id: "other" },
      {
        quote: {
          totals: { grand_total: { currency: "CNY", amount_minor: "1" } },
        },
      },
      { payee_name: "" },
      { qr_svg: "<svg><script>alert(1)</script></svg>" },
      { qr_svg: '<svg><image href="https://evil.test/"/></svg>' },
      { action: { type: "redirect", expires_at: expiry } },
      { expires_at: 1 },
    ]) {
      f.remote.paymentOverride = { ...valid, ...patch };
      await assert.rejects(
        f.service.startPayment("session-a", flow),
        /PAYMENT_RESULT_UNKNOWN|INVALID_PAYMENT_QR/,
      );
      assert.equal(
        (await f.service.view("session-a", flow)).paymentQr,
        undefined,
      );
    }
    assert.equal(f.remote.confirms, 1);
  } finally {
    f.close();
  }
});
test("payment refresh preserves expired entry metadata, removes settled links and never resubmits purchase", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const reviewed = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, reviewed.intent!.id);
    const writes = f.remote.writes;
    const link = f.remote.checkout.next_actions[0];
    link.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await f.service.view("session-a", flow);
    assert.equal(expired.checkout?.paymentExpiresAt, link.expires_at);
    assert.equal(expired.checkout?.paymentAction, undefined);
    link.expires_at = new Date(Date.now() + 300000).toISOString();
    for (const status of [
      "paid",
      "captured",
      "pending",
      "authorized",
      "refunded",
      "failed",
      "unknown",
    ]) {
      f.remote.order.payment.status = status;
      assert.equal(
        (await f.service.view("session-a", flow)).checkout?.paymentAction,
        undefined,
        status,
      );
    }
    f.remote.order.payment.status = "unpaid";
    f.remote.order.status = "canceled";
    assert.equal(
      (await f.service.view("session-a", flow)).checkout?.paymentAction,
      undefined,
    );
    delete f.remote.order.status;
    assert.ok(
      (await f.service.view("session-a", flow)).checkout?.paymentAction,
    );
    link.url = "https://evil.test/pay";
    const invalid = await f.service.view("session-a", flow);
    assert.equal(invalid.checkout?.paymentExpiresAt, undefined);
    assert.equal(invalid.checkout?.paymentAction, undefined);
    assert.equal(f.remote.confirms, 1);
    assert.equal(f.remote.writes, writes);
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
for (const optional of [undefined, "   "])
  test(`CN full address reaches delivery and confirmation with ${optional === undefined ? "absent" : "blank"} city and region`, async () => {
    const f = fixture(false, true);
    try {
      const flow = await f.flow();
      await f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
        "add",
      );
      const address = {
        country: "CN",
        recipient: "测试收件人",
        phone: "13800138000",
        line1: "浙江省杭州市测试路1号",
        ...(optional === undefined
          ? {}
          : { city: optional, region: optional, postal_code: optional }),
      };
      const request = uiSchemas.contact.parse({
        sessionId: "session-a",
        flowId: flow,
        expected_version: "v1",
        patch: { shipping_address: address },
        actionId: "00000000-0000-4000-8000-000000000001",
      });
      await f.service.contact(
        "session-a",
        flow,
        request.expected_version,
        request.patch,
        request.actionId,
      );
      assert.equal(f.remote.cart.shipping_address.line1, address.line1);
      for (const field of ["city", "region", "postal_code"]) {
        assert.equal(
          Object.hasOwn(f.remote.cart.shipping_address, field),
          false,
        );
        assert.equal(isRequiredContact("CN", field), false);
      }
      f.restart();
      const restored = await f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "get" },
        "restored-address",
      );
      assert.equal(restored.contactReady, true);
      assert.equal(JSON.stringify(restored).includes(address.phone), false);
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
        "checkout",
      );
      const view = await f.service.review("session-a", flow);
      assert.equal(f.remote.confirms, 0);
      await f.service.confirm("session-a", flow, view.intent!.id);
      assert.equal(f.remote.confirms, 1);
      assert.ok(
        (await f.service.view("session-a", flow)).checkout?.paymentAction,
      );
    } finally {
      f.close();
    }
  });

test("US owner address still requires city and region before any Commerce write", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    await f.service.tool(
      "session-a",
      "frontvia_cart",
      { flowId: flow, action: "add", variant_id: "variant", quantity: 1 },
      "add",
    );
    const before = f.remote.writes;
    for (const field of ["city", "region"] as const) {
      const address = {
        country: "US",
        recipient: "Recipient",
        line1: "Street",
        city: "City",
        region: "CA",
        postal_code: "94105",
        [field]: "",
      };
      assert.equal(isRequiredContact("US", field), true);
      await assert.rejects(
        f.service.contact(
          "session-a",
          flow,
          "v1",
          { email: "owner@example.test", shipping_address: address },
          "missing-" + field,
        ),
      );
    }
    assert.equal(f.remote.writes, before);
  } finally {
    f.close();
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

test("catalog selection survives restart, switches products including empty variants, and clears on fresh browsing", async () => {
  const f = fixture();
  try {
    const flowId = await f.flow();
    const browseResult = await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId, action: "browse" },
      "catalog",
    );
    const variantResult = await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId, action: "variants", product_id: "prod" },
      "specs",
    );
    f.restart();
    let view = await f.service.view("session-a", flowId);
    assert.equal(view.variantProductId, "prod");
    assert.equal(view.variants.items[0].product_id, "prod");
    assert.equal(view.products.items[0].title, "Test Mug");
    f.remote.variantItems = [];
    await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId, action: "variants", product_id: "other" },
      "empty-specs",
    );
    view = await f.service.view("session-a", flowId);
    assert.equal(view.variantProductId, "other");
    assert.deepEqual(view.variants.items, []);
    await f.service.tool(
      "session-a",
      "frontvia_products",
      { flowId, action: "search", query: "Mug" },
      "new-search",
    );
    f.restart();
    view = await f.service.view("session-a", flowId);
    assert.equal(view.variantProductId, undefined);
    assert.equal(view.variants, undefined);
    assert.equal(view.products.items.length, 1);
    assert.equal(browseResult.catalogSnapshot.version, 1);
    assert.equal(browseResult.catalogSnapshot.variants, undefined);
    assert.equal(variantResult.catalogSnapshot.variantProductId, "prod");
    assert.equal(
      variantResult.catalogSnapshot.variants.items[0].product_id,
      "prod",
    );
    assert.equal(variantResult.catalogSnapshot.cart, undefined);
    assert.equal(f.remote.writes, 0);
  } finally {
    f.close();
  }
});

test("owner cancels the original unpaid CNY order once, retains history and removes all payment actions", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    await assert.rejects(
      f.service.cancelOrder("session-a", flow),
      /ORDER_CANCEL_UNAVAILABLE/,
    );
    const intent = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, intent.intent!.id);
    await f.service.startPayment("session-a", flow);
    const before = f.remote.writes;
    assert.equal(
      (await f.service.view("session-a", flow)).canCancelOrder,
      true,
    );
    await assert.rejects(
      f.service.cancelOrder("someone-else", flow),
      /FLOW_NOT_OWNED/,
    );
    const [one, two] = await Promise.all([
      f.service.cancelOrder("session-a", flow),
      f.service.cancelOrder("session-a", flow),
    ]);
    for (const view of [one, two]) {
      assert.equal(view.order.status, "canceled");
      assert.equal(view.checkout!.status, "canceled");
      assert.equal(view.paymentQr, undefined);
      assert.equal(view.checkout!.paymentAction, undefined);
      assert.equal(view.canCancelOrder, false);
      assert.equal(view.pending, false);
    }
    assert.equal(f.remote.writes, before + 1);
    assert.equal(f.remote.confirms, 1);
    f.restart();
    const restored = await f.service.view("session-a", flow);
    assert.equal(restored.order.id, "order");
    assert.equal(restored.checkout!.id, "checkout");
    assert.equal(restored.paymentQr, undefined);
    assert.equal(
      uiSchemas["order-cancel"].safeParse({
        sessionId: "session-a",
        flowId: flow,
        orderId: "foreign",
      }).success,
      false,
    );
    assert.equal(
      schemas.frontvia_checkout.safeParse({ flowId: flow, action: "cancel" })
        .success,
      false,
    );
  } finally {
    f.close();
  }
});

test("cancel revalidates payment, currency and advertised capability before any write", async () => {
  for (const scenario of [
    "paid",
    "authorized",
    "partial",
    "disabled",
    "usd",
    "unbound",
  ]) {
    const f = fixture(false, true);
    try {
      const flow = await prepare(f);
      const intent = await f.service.review("session-a", flow);
      await f.service.confirm("session-a", flow, intent.intent!.id);
      if (scenario === "paid") f.remote.order.payment.status = "paid";
      if (scenario === "authorized")
        f.remote.checkout.payment_summary.authorized_amount = {
          currency: "CNY",
          amount_minor: "1",
        };
      if (scenario === "partial")
        f.remote.order.payment.status = "partially_paid";
      if (scenario === "disabled")
        f.remote.methodAvailability["commerce.checkouts.cancel"] = "disabled";
      if (scenario === "usd")
        f.remote.order.totals.grand_total.currency = "USD";
      if (scenario === "unbound") f.remote.checkout.order_ids = [];
      const writes = f.remote.writes;
      await assert.rejects(
        f.service.cancelOrder("session-a", flow),
        /ORDER_CANCEL_UNAVAILABLE/,
      );
      assert.equal(f.remote.writes, writes, scenario);
    } finally {
      f.close();
    }
  }
});

test("lost cancellation response stays pending across restart and recovers without another write", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const intent = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, intent.intent!.id);
    await f.service.startPayment("session-a", flow);
    f.remote.lose = "commerce.checkouts.cancel";
    await assert.rejects(
      f.service.cancelOrder("session-a", flow),
      /NETWORK_UNCERTAIN/,
    );
    const writes = f.remote.writes;
    f.restart();
    const pending = await f.service.view("session-a", flow);
    assert.equal(pending.cancelPending, true);
    assert.equal(pending.paymentQr, undefined);
    await assert.rejects(
      f.service.cancelOrder("session-a", flow),
      /RESOLVE_PENDING_OPERATION/,
    );
    await assert.rejects(
      f.service.startPayment("session-a", flow),
      /CONFIRMATION_REQUIRED/,
    );
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "recover-cancel",
    );
    const recovered = await f.service.view("session-a", flow);
    assert.equal(recovered.pending, false);
    assert.equal(recovered.order.status, "canceled");
    assert.equal(recovered.checkout!.status, "canceled");
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
});

test("payment winning at the server cancel boundary preserves the paid order and never claims cancellation", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const intent = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, intent.intent!.id);
    await f.service.startPayment("session-a", flow);
    f.remote.cancelPaymentRace = true;
    const view = await f.service.cancelOrder("session-a", flow);
    assert.equal(view.operation.status, "failed");
    assert.equal(view.operation.effects, "none");
    assert.equal(view.order.status, "open");
    assert.equal(view.order.payment.status, "paid");
    assert.equal(view.checkout!.status, "completed");
    assert.equal(view.pending, false);
    assert.equal(view.canCancelOrder, false);
    assert.equal(view.paymentQr, undefined);
  } finally {
    f.close();
  }
});

test("manual service-page shopping browses, selects, adds and quotes without a model or purchase confirmation", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    const act = (
      intent: any,
      expected_version?: string,
      actionId = randomUUID(),
    ) =>
      f.service.shopping("session-a", flow, {
        intent,
        expected_version,
        actionId,
      });
    let view = await act({ action: "browse" });
    assert.equal(view.products.items[0].title, "Test Mug");
    view = await act({
      action: "variants",
      productId: "prod",
      productName: "Test Mug",
    });
    assert.equal(view.variants.items[0].id, "variant");
    const add = {
      action: "add",
      variantId: "variant",
      productName: "Test Mug",
      variantName: "Blue",
      quantity: 1,
    };
    const actionId = randomUUID();
    view = await act(add, undefined, actionId);
    assert.equal(view.cart.version, "v1");
    f.restart();
    await act(add, undefined, actionId);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.create").length,
      1,
    );
    view = await f.service.contact(
      "session-a",
      flow,
      "v1",
      {
        shipping_address: {
          country: "CN",
          phone: "13800138000",
          recipient: "测试收件人",
          line1: "浙江省杭州市测试路1号",
        },
      },
      randomUUID(),
    );
    view = await act({ action: "delivery-options" });
    assert.equal(view.delivery.delivery_groups[0].options[0].id, "standard");
    view = await act(
      {
        action: "delivery",
        groupId: "group",
        optionId: "standard",
        optionName: "Standard",
      },
      view.cart.version,
    );
    assert.equal(view.quote.cart_version, view.cart.version);
    assert.equal(view.checkout.status, "requires_action");
    assert.equal(view.intent, undefined);
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
    // A page reload reads the same durable flow, ready for explicit owner review.
    f.restart();
    const restored = await f.service.view("session-a", flow);
    assert.equal(restored.checkout.id, view.checkout.id);
    view = await act({ action: "requote" }, restored.cart.version);
    assert.equal(view.checkout.status, "requires_action");
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("manual actions reject stale carts, another session and unapproved purchase actions", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1 as const,
    };
    await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    const writes = f.remote.writes;
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent,
        expected_version: "stale",
        actionId: randomUUID(),
      }),
      { code: "CART_VERSION_CHANGED" },
    );
    await assert.rejects(
      f.service.shopping("other-session", flow, {
        intent,
        expected_version: "v1",
        actionId: randomUUID(),
      }),
      { code: "FLOW_NOT_OWNED" },
    );
    for (const action of ["confirm", "payment-start", "order-cancel"]) {
      assert.equal(
        uiSchemas.shopping.safeParse({
          sessionId: "session-a",
          flowId: flow,
          intent: { action },
          actionId: randomUUID(),
        }).success,
        false,
      );
    }
    assert.equal(
      uiSchemas.shopping.safeParse({
        sessionId: "session-a",
        flowId: flow,
        intent,
        actionId: randomUUID(),
        amount: "0.01",
      }).success,
      false,
    );
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
});

test("lost manual delivery receipt stops before quoting and recovers the original operation after restart", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    await f.service.shopping("session-a", flow, {
      intent: {
        action: "add",
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 1,
      },
      actionId: randomUUID(),
    });
    f.remote.lose = "commerce.carts.delivery_option.select";
    const action = {
      intent: {
        action: "delivery" as const,
        groupId: "group",
        optionId: "standard",
        optionName: "Standard",
      },
      expected_version: "v1",
      actionId: randomUUID(),
    };
    await assert.rejects(f.service.shopping("session-a", flow, action), {
      code: "NETWORK_UNCERTAIN",
    });
    assert.equal(f.remote.calls.includes("commerce.quotes.create"), false);
    assert.equal((await f.service.view("session-a", flow)).pending, true);
    f.restart();
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "manual-recover",
    );
    const recovered = await f.service.view("session-a", flow);
    assert.equal(recovered.pending, false);
    assert.equal(recovered.cart.version, "v2");
    assert.equal(recovered.quote, undefined);
    assert.equal(
      f.remote.calls.filter(
        (m) => m === "commerce.carts.delivery_option.select",
      ).length,
      1,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("simultaneous manual additions use the displayed version and only one changes the cart", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1 as const,
    };
    await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        f.service.shopping("session-a", flow, {
          intent,
          expected_version: "v1",
          actionId: randomUUID(),
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      results.filter(
        (r) =>
          r.status === "rejected" && r.reason.code === "CART_VERSION_CHANGED",
      ).length,
      1,
    );
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.lines.add").length,
      1,
    );
  } finally {
    f.close();
  }
});

test("failed manual delivery and its duplicate do not quote an unselected delivery option", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    await f.service.shopping("session-a", flow, {
      intent: {
        action: "add",
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 1,
      },
      actionId: randomUUID(),
    });
    f.remote.fail = "commerce.carts.delivery_option.select";
    const request = {
      intent: {
        action: "delivery" as const,
        groupId: "group",
        optionId: "standard",
        optionName: "Standard",
      },
      expected_version: "v1",
      actionId: randomUUID(),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.service.shopping("session-a", flow, request), {
        code: "OPERATION_NOT_COMPLETED",
      });
      f.restart();
    }
    assert.equal(f.remote.calls.includes("commerce.quotes.create"), false);
    assert.equal(
      f.remote.calls.filter(
        (m) => m === "commerce.carts.delivery_option.select",
      ).length,
      1,
    );
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("storefront starts without a chat, replays entry and edits cart with version checks", async () => {
  const f = fixture(false, true);
  try {
    const entry = randomUUID();
    const ui = await f.service.openStore("a", entry);
    assert.equal((await f.service.openStore("a", entry)).flowId, ui.flowId);
    assert.match(ui.sessionId, /^storefront:/);
    const act = (
      intent: any,
      expected_version?: string,
      actionId = randomUUID(),
    ) =>
      f.service.shopping(ui.sessionId, ui.flowId, {
        intent,
        expected_version,
        actionId,
      });
    let view = await act({ action: "product", productId: "prod" });
    assert.equal(view.products.items[0].description, "Ceramic mug");
    assert.equal(view.variantProductId, "prod");
    view = await act({
      action: "add",
      variantId: "variant",
      productName: "Test Mug",
      variantName: "Blue",
      quantity: 1,
    });
    const version = view.cart.version;
    const lineId = view.cart.lines[0].id;
    const updateId = randomUUID();
    view = await act(
      { action: "update-line", lineId, quantity: 3 },
      version,
      updateId,
    );
    assert.equal(view.cart.lines[0].quantity, 3);
    f.restart();
    const duplicate = await act(
      { action: "update-line", lineId, quantity: 3 },
      version,
      updateId,
    );
    assert.equal(duplicate.cart.version, view.cart.version);
    await assert.rejects(
      act({ action: "remove-line", lineId }, version),
      /CART_VERSION_CHANGED/,
    );
    view = await act({ action: "remove-line", lineId }, view.cart.version);
    assert.equal(view.cart.lines.length, 0);
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
    await assert.rejects(
      f.service.openStore("removed-site", randomUUID()),
      /SITE_NOT_APPROVED/,
    );
  } finally {
    f.close();
  }
});

test("storefront separates delivery, quote, review and payment; order browsing cannot retarget payment", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    const act = (intent: any, expected_version?: string) =>
      f.service.shopping("session-a", flow, {
        intent,
        expected_version,
        actionId: randomUUID(),
      });
    let view = await act({
      action: "add",
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1,
    });
    view = await f.service.contact(
      "session-a",
      flow,
      view.cart.version,
      {
        shipping_address: {
          country: "CN",
          recipient: "Test",
          phone: "13800138000",
          line1: "Test address",
        },
      },
      randomUUID(),
    );
    view = await act(
      { action: "select-delivery", groupId: "group", optionId: "standard" },
      view.cart.version,
    );
    assert.equal(
      view.delivery.delivery_groups[0].selected_option_id,
      "standard",
    );
    assert.equal(view.quote, undefined);
    assert.equal(view.checkout, undefined);
    view = await act({ action: "quote" }, view.cart.version);
    assert.ok(view.quote);
    assert.equal(view.checkout, undefined);
    view = await act({ action: "prepare" });
    view = await f.service.review("session-a", flow);
    assert.ok(view.intent);
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
    view = await f.service.confirm("session-a", flow, view.intent!.id);
    const activeOrder = view.order.id;
    const activeCheckout = view.checkout!.id;
    const originalRequest = f.service.pap.request;
    f.service.pap.request = async (ref, method, params: any, ...rest: any[]) =>
      method === "commerce.orders.get" && params.order_id === "history-order"
        ? ({
            result: {
              data: {
                id: "history-order",
                status: "completed",
                payment: { status: "paid" },
                fulfillment_status: "shipped",
                shipments: [
                  {
                    id: "shipment",
                    status: "shipped",
                    tracking: [
                      {
                        carrier: "Test",
                        tracking_number: "T123",
                        tracking_url: "https://carrier.test/T123",
                      },
                    ],
                  },
                ],
              },
            },
          } as any)
        : originalRequest(ref, method, params, ...rest);
    view = await act({ action: "order-detail", orderId: "history-order" });
    assert.equal(view.order.id, activeOrder);
    assert.equal(view.checkout!.id, activeCheckout);
    assert.equal(
      view.viewedOrder.shipments[0].tracking[0].tracking_number,
      "T123",
    );
    f.restart();
    view = await f.service.view("session-a", flow);
    assert.equal(view.viewedOrder.id, "history-order");
    assert.equal(view.order.id, activeOrder);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("removing a line from an unsubmitted checkout retires the draft and replays without duplicate writes", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    const before = await f.service.view("session-a", flow);
    const input = {
      intent: {
        action: "remove-line" as const,
        lineId: before.cart.lines[0].id,
      },
      expected_version: before.cart.version,
      actionId: randomUUID(),
    };
    const view = await f.service.shopping("session-a", flow, input);
    assert.equal(view.cart.lines.length, 0);
    assert.equal(view.checkout, undefined);
    assert.equal(view.quote, undefined);
    assert.equal(view.intent, undefined);
    f.restart();
    const writes = f.remote.writes;
    const replay = await f.service.shopping("session-a", flow, input);
    assert.equal(replay.cart.lines.length, 0);
    assert.equal(f.remote.writes, writes);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.checkouts.cancel").length,
      1,
    );
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("cart removal cannot change submitted orders or continue after uncertain draft cancellation", async () => {
  const f = fixture(false, true);
  try {
    const flow = await prepare(f);
    let view = await f.service.review("session-a", flow);
    view = await f.service.confirm("session-a", flow, view.intent!.id);
    for (const intent of [
      { action: "remove-line", lineId: view.cart.lines[0].id },
      { action: "update-line", lineId: view.cart.lines[0].id, quantity: 2 },
    ]) {
      const writes = f.remote.writes;
      await assert.rejects(
        f.service.shopping("session-a", flow, {
          intent: intent as any,
          expected_version: view.cart.version,
          actionId: randomUUID(),
        }),
        /CART_ALREADY_SUBMITTED/,
      );
      assert.equal(f.remote.writes, writes);
    }
    assert.equal(
      (await f.service.view("session-a", flow)).order.id,
      view.order.id,
    );
  } finally {
    f.close();
  }
  const g = fixture(false, true);
  try {
    const flow = await prepare(g);
    const view = await g.service.view("session-a", flow);
    g.remote.lose = "commerce.checkouts.cancel";
    await assert.rejects(
      g.service.shopping("session-a", flow, {
        intent: { action: "remove-line", lineId: view.cart.lines[0].id },
        expected_version: view.cart.version,
        actionId: randomUUID(),
      }),
    );
    assert.equal(g.remote.calls.includes("commerce.carts.lines.remove"), false);
    assert.equal(g.remote.cart.lines.length, 1);
  } finally {
    g.close();
  }
});

test("storefront scopes avoid whole-flow reads and load ten order references in one request", async (t) => {
  const f = fixture(true, true);
  try {
    const flow = await prepare(f);
    const review = await f.service.review("session-a", flow);
    await f.service.confirm("session-a", flow, review.intent!.id);
    const original = f.service.pap.request;
    f.service.pap.request = async (
      ref,
      method,
      params: any,
      signal,
      options,
    ) => {
      if (method === "commerce.orders.list") {
        f.remote.calls.push(method);
        return {
          result: {
            data: {
              items: Array.from({ length: 10 }, (_, i) => ({
                order_id: `history-${i}`,
              })),
              page: { has_more: false },
            },
          },
        } as any;
      }
      if (
        method === "commerce.orders.get" &&
        params.order_id.startsWith("history-")
      ) {
        f.remote.calls.push(method);
        return {
          result: {
            data: { ...structuredClone(f.remote.order), id: params.order_id },
          },
        } as any;
      }
      return original(ref, method, params, signal, options);
    };
    await f.service.view("session-a", flow, ["catalog"]); // warm display capabilities
    const measure = async (fn: () => Promise<any>) => {
      f.remote.calls.length = 0;
      const view = await fn();
      return { view, calls: [...f.remote.calls] };
    };
    const listed = await measure(() =>
      f.service.shopping("session-a", flow, {
        intent: { action: "orders" },
        actionId: randomUUID(),
      }),
    );
    assert.deepEqual(listed.calls, ["commerce.orders.list"]);
    assert.equal(listed.view.orders.items.length, 10);
    const catalog = await measure(() =>
      f.service.view("session-a", flow, ["catalog"]),
    );
    assert.deepEqual(catalog.calls, []);
    const order = await measure(() =>
      f.service.view("session-a", flow, ["order"]),
    );
    assert.deepEqual(order.calls, [
      "commerce.checkouts.get",
      "commerce.orders.get",
    ]);
    const detail = await measure(() =>
      f.service.shopping("session-a", flow, {
        intent: { action: "order-detail", orderId: "history-0" },
        actionId: randomUUID(),
      }),
    );
    assert.deepEqual(detail.calls, ["commerce.orders.get"]);
    const detailRefresh = await measure(() =>
      f.service.view("session-a", flow, ["order-detail"]),
    );
    assert.deepEqual(detailRefresh.calls, ["commerce.orders.get"]);
    assert.equal(detailRefresh.view.viewedOrder.id, "history-0");
    assert.equal(detailRefresh.view.order.id, "order");
    await f.service.shopping("session-a", flow, {
      intent: { action: "order-detail", orderId: "order" },
      actionId: randomUUID(),
    });
    const shared = await measure(() =>
      f.service.view("session-a", flow, ["order", "order-detail"]),
    );
    assert.deepEqual(shared.calls, [
      "commerce.checkouts.get",
      "commerce.orders.get",
    ]);
    t.diagnostic(
      "warm reads: catalog=0; active payment=2; 10-order list=1; selected history detail=1",
    );
    assert.equal(f.remote.confirms, 1);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("scoped reads stay isolated and never bypass fresh checkout or ownership validation", async () => {
  const f = fixture(true, true);
  try {
    const flow = await prepare(f);
    const saved = await f.service.view("session-a", flow, ["catalog"]);
    f.remote.cart.version = "changed-on-merchant";
    const [catalog, cart] = await Promise.all([
      f.service.view("session-a", flow, ["catalog"]),
      f.service.view("session-a", flow, ["cart"]),
    ]);
    assert.equal(catalog.cart.version, saved.cart.version);
    assert.equal(cart.cart.version, "changed-on-merchant");
    await assert.rejects(f.service.review("session-a", flow), /QUOTE_CHANGED/);
    const before = f.remote.calls.length;
    await assert.rejects(
      f.service.view("other-session", flow, ["catalog"]),
      /FLOW_NOT_OWNED/,
    );
    assert.equal(f.remote.calls.length, before);
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("catalog cache is scoped, explicit refresh reloads, and writes always revalidate capabilities", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture(true, true);
  try {
    const flow = await f.flow();
    const act = (intent: any) =>
      f.service.shopping("session-a", flow, { intent, actionId: randomUUID() });
    f.remote.calls.length = 0;
    await act({ action: "browse", query: "mug" });
    await act({ action: "browse", query: "mug" });
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.products.search").length,
      1,
    );
    await act({ action: "browse", query: "other" });
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.products.search").length,
      2,
    );
    await act({ action: "browse", query: "mug", refresh: true });
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.products.search").length,
      3,
    );
    now += 61000;
    f.remote.calls.length = 0;
    await act({ action: "browse", query: "mug" });
    assert.deepEqual(
      f.remote.calls,
      ["commerce.products.search"],
      "catalog expires at 60s but capabilities remain warm at 61s",
    );
    f.remote.generation = "new-authorization";
    f.remote.calls.length = 0;
    await act({ action: "browse", query: "mug" });
    assert.deepEqual(f.remote.calls, [
      "commerce.capabilities.get",
      "commerce.products.search",
    ]);
    f.remote.methodAvailability["commerce.carts.create"] = "unsupported";
    await assert.rejects(
      act({
        action: "add",
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 1,
      }),
      /METHOD_UNAVAILABLE|CART_PROFILE_UNAVAILABLE/,
    );
    assert.equal(
      f.remote.writes,
      0,
      "cached display capability must not authorize a revoked write",
    );
  } finally {
    f.close();
  }
});

test("product selection publishes only a complete detail and variants pair", async () => {
  const f = fixture(true, true);
  try {
    const flow = await f.flow();
    const original = f.service.pap.request;
    const started: string[] = [],
      release: (() => void)[] = [];
    f.service.pap.request = async (ref, method, params, signal, options) => {
      if (
        ["commerce.products.get", "commerce.variants.list"].includes(method)
      ) {
        started.push(method);
        await new Promise<void>((r) => release.push(r));
      }
      return original(ref, method, params, signal, options);
    };
    const result = f.service.shopping("session-a", flow, {
      intent: { action: "product", productId: "prod" },
      actionId: randomUUID(),
    });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, ["commerce.products.get"]);
    release.shift()!();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, [
      "commerce.products.get",
      "commerce.variants.list",
    ]);
    assert.equal(f.vault.get<any>(`flow:${flow}`).variantProductId, undefined);
    release.splice(0).forEach((r) => r());
    const view = await result;
    assert.equal(view.products.items[0].description, "Ceramic mug");
    assert.equal(view.variantProductId, "prod");
    assert.equal(view.variants.items[0].product_id, "prod");
  } finally {
    f.close();
  }
});

test("adding after an order opens a separate cart, preserves the order and replays one addition", async () => {
  const { openStorefrontCart } = await import(
    "../src/client/storefront-cart.js"
  );
  const f = fixture();
  try {
    const oldFlow = await prepare(f);
    const reviewed = await f.service.review("session-a", oldFlow);
    await f.service.confirm("session-a", oldFlow, reviewed.intent!.id);
    const oldOrder = copy((await f.service.view("session-a", oldFlow)).order);
    const call = async (op: string, p: any) =>
      op === "open-store"
        ? f.service.openStore(p.siteId, p.actionId)
        : f.service.shopping(p.sessionId, p.flowId, {
            intent: p.intent,
            actionId: p.actionId,
          });
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 3,
    };
    const actionId = randomUUID();
    const result = await openStorefrontCart(call, "a", actionId, intent);
    assert.equal(result?.error, false);
    assert.notEqual(result?.ui.flowId, oldFlow);
    const writes = f.remote.writes;
    f.restart();
    const replay = await openStorefrontCart(call, "a", actionId, intent);
    assert.equal(replay?.ui.flowId, result?.ui.flowId);
    assert.equal(replay?.error, false);
    assert.equal(f.remote.writes, writes);
    const cart = await f.service.view(result!.ui.sessionId, result!.ui.flowId);
    assert.equal(cart.cart.lines.length, 1);
    assert.equal(cart.cart.lines[0].quantity, 3);
    assert.equal(cart.order, undefined);
    assert.deepEqual(
      (await f.service.view("session-a", oldFlow)).order,
      oldOrder,
    );
    assert.equal(f.remote.confirms, 1);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("a lost new-cart receipt retains its reference for recovery and account changes stop before addition", async () => {
  const { openStorefrontCart } = await import(
    "../src/client/storefront-cart.js"
  );
  const f = fixture();
  try {
    const call = async (op: string, p: any) =>
      op === "open-store"
        ? f.service.openStore(p.siteId, p.actionId)
        : f.service.shopping(p.sessionId, p.flowId, {
            intent: p.intent,
            actionId: p.actionId,
          });
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1 as const,
    };
    const writes = f.remote.writes;
    assert.equal(
      await openStorefrontCart(call, "a", randomUUID(), intent, () => false),
      undefined,
    );
    assert.equal(f.remote.writes, writes);
    f.remote.lose = "commerce.carts.create";
    const result = await openStorefrontCart(call, "a", randomUUID(), intent);
    assert.equal(result?.error, true);
    assert.ok(result?.ui.flowId);
    const pending = await f.service.view(
      result!.ui.sessionId,
      result!.ui.flowId,
    );
    assert.equal(pending.pending, true);
    f.restart();
    await f.service.tool(
      result!.ui.sessionId,
      "frontvia_orders",
      { flowId: result!.ui.flowId, action: "recover" },
      "recover-new-cart",
    );
    assert.equal(
      (await f.service.view(result!.ui.sessionId, result!.ui.flowId)).pending,
      false,
    );
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.create").length,
      1,
    );
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("manual additions preserve requested quantities and reject invalid counts before any merchant write", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 4,
    };
    for (const quantity of [0, -1, 1.5, 101, NaN]) {
      const writes = f.remote.writes;
      await assert.rejects(
        f.service.shopping("session-a", flow, {
          intent: { ...intent, quantity },
          actionId: randomUUID(),
        }),
      );
      assert.equal(f.remote.writes, writes);
    }
    const cart = await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    assert.equal(cart.cart.lines[0].quantity, 4);
    const next = await f.service.shopping("session-a", flow, {
      intent: { ...intent, quantity: 2 },
      expected_version: cart.cart.version,
      actionId: randomUUID(),
    });
    assert.equal(next.cart.lines.at(-1).quantity, 2);
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("missing addition receipt remains pending without replay and identifies the operation for the UI", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1,
    };
    const first = await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    f.remote.lose = "commerce.carts.lines.add";
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent,
        expected_version: first.cart.version,
        actionId: randomUUID(),
      }),
    );
    const saved = f.vault.get<any>(`flow:${flow}`);
    const receipt = f.remote.ops.get(saved.pending);
    f.remote.ops.delete(saved.pending);
    const writes = f.remote.writes;
    for (let n = 0; n < 2; n++) {
      f.restart();
      await assert.rejects(
        f.service.tool(
          "session-a",
          "frontvia_orders",
          { flowId: flow, action: "recover" },
          `lookup-${n}`,
        ),
        /ORIGINAL_RESULT_UNKNOWN/,
      );
      const view = await f.service.view("session-a", flow);
      assert.equal(view.pending, true);
      assert.equal(view.pendingAction, "cart-add");
      assert.equal(view.order, undefined);
      assert.equal(f.remote.writes, writes);
    }
    f.remote.ops.set(saved.pending, receipt);
    await f.service.tool(
      "session-a",
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      "lookup-found",
    );
    const resolved = await f.service.view("session-a", flow);
    assert.equal(resolved.pending, false);
    assert.equal(resolved.pendingAction, undefined);
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
});

test("customer retry reuses a missing cart request exactly, survives restart and serializes double clicks", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const pap = (f.service as any).pap;
    const request = pap.request.bind(pap);
    const attempts: any[] = [];
    let disconnect = true;
    pap.request = async (
      ref: string,
      method: string,
      params: any,
      signal: any,
    ) => {
      if (method === "commerce.carts.create") {
        attempts.push(copy(params));
        if (disconnect) {
          disconnect = false;
          throw Error("NETWORK_UNCERTAIN");
        }
      }
      return request(ref, method, params, signal);
    };
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent: {
          action: "add",
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 3,
        },
        actionId: randomUUID(),
      }),
    );
    assert.equal((await f.service.view("session-a", flow)).canRetryCart, true);
    f.restart();
    const results = await Promise.all([
      f.service.retryCart("session-a", flow),
      f.service.retryCart("session-a", flow),
    ]);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.create").length,
      1,
    );
    for (const result of results) {
      assert.equal(result.pending, false);
      assert.equal(result.cart.lines[0].quantity, 3);
    }
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
  } finally {
    f.close();
  }
});

test("customer retry reconciles an existing cart receipt without submitting it again", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    f.remote.lose = "commerce.carts.create";
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent: {
          action: "add",
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 2,
        },
        actionId: randomUUID(),
      }),
    );
    const view = await f.service.retryCart("session-a", flow);
    assert.equal(view.pending, false);
    assert.equal(view.cart.lines[0].quantity, 2);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.create").length,
      1,
    );
  } finally {
    f.close();
  }
});

test("customer retry never resends on lookup errors, disabled capabilities or pending purchase confirmation", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    f.remote.lose = "commerce.carts.create";
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent: {
          action: "add",
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 1,
        },
        actionId: randomUUID(),
      }),
    );
    const pap = (f.service as any).pap,
      request = pap.request.bind(pap);
    pap.request = async (ref: string, method: string, params: any) =>
      method === "commerce.operations.lookup"
        ? { error: { code: 1002 } }
        : request(ref, method, params);
    const writes = f.remote.writes;
    await assert.rejects(
      f.service.retryCart("session-a", flow),
      /ORIGINAL_RESULT_UNKNOWN/,
    );
    assert.equal(f.remote.writes, writes);
    assert.equal((await f.service.view("session-a", flow)).pending, true);
    pap.request = request;
    f.remote.methodAvailability["commerce.carts.create"] = "disabled";
    await assert.rejects(f.service.retryCart("session-a", flow));
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
  const purchase = fixture();
  try {
    const flow = await prepare(purchase);
    const review = await purchase.service.review("session-a", flow);
    purchase.remote.lose = "commerce.checkouts.confirm";
    await assert.rejects(
      purchase.service.confirm("session-a", flow, review.intent!.id),
    );
    const confirms = purchase.remote.confirms;
    await assert.rejects(
      purchase.service.retryCart("session-a", flow),
      /CART_RETRY_UNAVAILABLE/,
    );
    assert.equal(purchase.remote.confirms, confirms);
    assert.equal(
      (await purchase.service.view("session-a", flow)).canRetryCart,
      false,
    );
  } finally {
    purchase.close();
  }
});

test("discarded addition stops blocking the cart, cannot replay after restart, and preserves the merchant cart", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1,
    };
    const first = await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    f.remote.lose = "commerce.carts.lines.add";
    const attempted = {
      intent,
      expected_version: first.cart.version,
      actionId: randomUUID(),
    };
    await assert.rejects(f.service.shopping("session-a", flow, attempted));
    const pending = f.vault.get<any>(`flow:${flow}`).pending;
    const writes = f.remote.writes;
    await assert.rejects(
      f.service.discardCartAddition("another-session", flow),
    );
    assert.equal(f.vault.get<any>(`flow:${flow}`).pending, pending);
    const view = await f.service.discardCartAddition("session-a", flow);
    assert.equal(view.pending, false);
    assert.equal(view.canDiscardCartAddition, false);
    assert.deepEqual(view.cart, f.remote.cart);
    assert.equal(f.remote.writes, writes);
    assert.equal(
      f.vault.get<any>(`flow:${flow}`).commands[pending].status,
      "discarded",
    );
    f.restart();
    await assert.rejects(
      f.service.shopping("session-a", flow, attempted),
      /OPERATION_DISCARDED/,
    );
    assert.equal(f.remote.writes, writes);
    const updated = await f.service.shopping("session-a", flow, {
      intent: {
        action: "update-line",
        lineId: view.cart.lines[0].id,
        quantity: 2,
      },
      expected_version: view.cart.version,
      actionId: randomUUID(),
    });
    assert.equal(updated.pending, false);
    assert.equal(updated.cart.lines[0].quantity, 2);
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

test("discard persists through a failed refresh but cannot discard a purchase confirmation", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const intent = {
      action: "add" as const,
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1,
    };
    const first = await f.service.shopping("session-a", flow, {
      intent,
      actionId: randomUUID(),
    });
    f.remote.lose = "commerce.carts.lines.add";
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        intent,
        expected_version: first.cart.version,
        actionId: randomUUID(),
      }),
    );
    const pap = (f.service as any).pap,
      request = pap.request.bind(pap);
    pap.request = async (ref: string, method: string, params: any) => {
      if (method === "commerce.carts.get") throw Error("NETWORK_TIMEOUT");
      return request(ref, method, params);
    };
    const writes = f.remote.writes;
    await assert.rejects(
      f.service.discardCartAddition("session-a", flow),
      /NETWORK_TIMEOUT/,
    );
    pap.request = request;
    f.restart();
    assert.equal((await f.service.view("session-a", flow)).pending, false);
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
  const purchase = fixture();
  try {
    const flow = await prepare(purchase),
      review = await purchase.service.review("session-a", flow);
    purchase.remote.lose = "commerce.checkouts.confirm";
    await assert.rejects(
      purchase.service.confirm("session-a", flow, review.intent!.id),
    );
    await assert.rejects(
      purchase.service.discardCartAddition("session-a", flow),
      /CART_DISCARD_UNAVAILABLE/,
    );
    assert.equal(
      (await purchase.service.view("session-a", flow)).pending,
      true,
    );
  } finally {
    purchase.close();
  }
});

test("delivery preparation chooses lowest known fees per group with fresh versions, preserves manual choices and never checks out", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    const act = (intent: any, version?: string) =>
      f.service.shopping("session-a", flow, {
        intent,
        expected_version: version,
        actionId: randomUUID(),
      });
    let view = await act({
      action: "add",
      variantId: "variant",
      productName: "Mug",
      variantName: "Blue",
      quantity: 1,
    });
    view = await f.service.contact(
      "session-a",
      flow,
      view.cart.version,
      {
        shipping_address: {
          country: "CN",
          recipient: "Test",
          phone: "13800138000",
          line1: "Test address",
        },
      },
      randomUUID(),
    );
    const option = (id: string, amount: string, status = "known") => ({
      id,
      label: id,
      price_status: status,
      amount: { currency: "CNY", amount_minor: amount },
    });
    f.remote.deliveryGroups = [
      { id: "single", options: [option("only", "0")] },
      {
        id: "cheapest",
        options: [
          option("express", "1000"),
          option("free", "0"),
          option("tie", "0"),
        ],
      },
      {
        id: "chosen",
        selected_option_id: "express",
        options: [option("free", "0"), option("express", "1000")],
      },
      {
        id: "integer",
        options: [
          option("big", "9007199254740993"),
          option("smaller", "9007199254740992"),
        ],
      },
      {
        id: "unknown",
        options: [
          {
            id: "input",
            label: "Input",
            amount: null,
            price_status: "requires_input",
          },
          option("estimate", "0", "estimated"),
        ],
      },
      { id: "empty", options: [] },
    ];
    const before = f.remote.calls.length;
    const originalVersion = view.cart.version;
    view = await act({ action: "prepare-delivery" }, originalVersion);
    assert.deepEqual(
      view.delivery.delivery_groups.map((g: any) => g.selected_option_id),
      ["only", "free", "express", "smaller", undefined, undefined],
    );
    assert.equal(view.cart.version, "v5"); // fixture asserts each expected_version at dispatch
    assert.equal(view.delivery.cart_version, view.cart.version);
    assert.equal(
      f.remote.calls
        .slice(before)
        .filter((m) => m === "commerce.carts.delivery_option.select").length,
      3,
    );
    assert.equal(view.quote, undefined);
    assert.equal(view.checkout, undefined);
    assert.equal(f.remote.confirms, 0);
    assert.equal(f.remote.paymentCalls, 0);
    const writes = f.remote.writes;
    await act({ action: "prepare-delivery" }, view.cart.version);
    assert.equal(f.remote.writes, writes); // remount/retry keeps existing selections
    await assert.rejects(act({ action: "prepare-delivery" }, originalVersion), {
      code: "CART_VERSION_CHANGED",
    });
    view = await act(
      { action: "select-delivery", groupId: "cheapest", optionId: "express" },
      view.cart.version,
    );
    view = await act({ action: "prepare-delivery" }, view.cart.version);
    assert.equal(
      view.delivery.delivery_groups[1].selected_option_id,
      "express",
    );
    // Merchant invalidates the selected option after an address change.
    view = await f.service.contact(
      "session-a",
      flow,
      view.cart.version,
      {
        shipping_address: {
          country: "CN",
          recipient: "Test",
          phone: "13800138000",
          line1: "New address",
        },
      },
      randomUUID(),
    );
    f.remote.deliveryGroups[1].options = [option("new-region", "300")];
    view = await act({ action: "prepare-delivery" }, view.cart.version);
    assert.equal(
      view.delivery.delivery_groups[1].selected_option_id,
      "new-region",
    );
  } finally {
    f.close();
  }
});

for (const outcome of ["fail", "lose"] as const) {
  test(`automatic delivery ${outcome} stops the sequence without quoting, replay or payment`, async () => {
    const f = fixture(false, true);
    try {
      const flow = await f.flow();
      let view = await f.service.shopping("session-a", flow, {
        intent: {
          action: "add",
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 1,
        },
        actionId: randomUUID(),
      });
      view = await f.service.contact(
        "session-a",
        flow,
        view.cart.version,
        {
          shipping_address: {
            country: "CN",
            recipient: "Test",
            phone: "13800138000",
            line1: "Test address",
          },
        },
        randomUUID(),
      );
      f.remote.deliveryGroups = ["a", "b"].map((id) => ({
        id,
        options: [
          {
            id: "standard",
            label: "Standard",
            price_status: "known",
            amount: { currency: "CNY", amount_minor: "0" },
          },
        ],
      }));
      f.remote[outcome] = "commerce.carts.delivery_option.select";
      const request = {
        intent: { action: "prepare-delivery" as const },
        expected_version: view.cart.version,
        actionId: randomUUID(),
      };
      const before = f.remote.calls.length;
      await assert.rejects(f.service.shopping("session-a", flow, request));
      await assert.rejects(f.service.shopping("session-a", flow, request));
      const calls = f.remote.calls.slice(before);
      assert.equal(
        calls.filter((m) => m === "commerce.carts.delivery_option.select")
          .length,
        1,
      );
      assert.equal(
        calls.some((m) =>
          /quotes.create|checkouts.create|orders.create/.test(m),
        ),
        false,
      );
      assert.equal(f.remote.confirms, 0);
      assert.equal(f.remote.paymentCalls, 0);
    } finally {
      f.close();
    }
  });
}

test("automatic delivery refuses stale options and blocking address requirements without a write", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    let view = await f.service.shopping("session-a", flow, {
      intent: {
        action: "add",
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 1,
      },
      actionId: randomUUID(),
    });
    view = await f.service.contact(
      "session-a",
      flow,
      view.cart.version,
      {
        shipping_address: {
          country: "CN",
          recipient: "Test",
          phone: "13800138000",
          line1: "Test address",
        },
      },
      randomUUID(),
    );
    const request = () => ({
      intent: { action: "prepare-delivery" as const },
      expected_version: view.cart.version,
      actionId: randomUUID(),
    });
    const writes = f.remote.writes;
    f.remote.deliveryRequirements = [
      { code: "ADDRESS_REQUIRED", blocking: true },
    ];
    const blocked = await f.service.shopping("session-a", flow, request());
    assert.equal(
      blocked.delivery.delivery_groups[0].selected_option_id,
      undefined,
    );
    f.remote.deliveryRequirements = [];
    const original = f.service.pap.request;
    f.service.pap.request = async (...args: Parameters<typeof original>) => {
      const result: any = await original(...args);
      if (args[1] === "commerce.carts.delivery_options.list")
        result.result.data.cart_version = "stale";
      return result;
    };
    await assert.rejects(f.service.shopping("session-a", flow, request()), {
      code: "CART_VERSION_CHANGED",
    });
    assert.equal(f.remote.writes, writes);
  } finally {
    f.close();
  }
});

test("empty, partial and whitespace cart addresses cannot trigger automatic delivery; saving a complete address unlocks it", async () => {
  const f = fixture(false, true);
  try {
    const flow = await f.flow();
    let view = await f.service.shopping("session-a", flow, {
      intent: {
        action: "add",
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 1,
      },
      actionId: randomUUID(),
    });
    const valid = {
      country: "CN",
      recipient: "Test",
      phone: "13800138000",
      line1: "Test address",
    };
    for (const address of [
      undefined,
      null,
      {},
      { country: "CN" },
      { ...valid, recipient: "" },
      { ...valid, line1: "   " },
      { ...valid, phone: "" },
      { ...valid, country: "US" },
    ]) {
      f.remote.cart.shipping_address = address;
      await f.service.tool(
        "session-a",
        "frontvia_cart",
        { flowId: flow, action: "get" },
        randomUUID(),
      );
      const before = f.remote.calls.length;
      await assert.rejects(
        f.service.shopping("session-a", flow, {
          intent: { action: "prepare-delivery" },
          expected_version: view.cart.version,
          actionId: randomUUID(),
        }),
        { code: "CONTACT_REQUIRED" },
      );
      assert.equal(
        f.remote.calls.slice(before).some((m) => m.includes("delivery")),
        false,
      );
    }
    const before = f.remote.writes;
    await assert.rejects(
      f.service.contact(
        "session-a",
        flow,
        view.cart.version,
        {
          shipping_address: { ...valid, recipient: "   " },
        },
        randomUUID(),
      ),
    );
    assert.equal(f.remote.writes, before);
    view = await f.service.contact(
      "session-a",
      flow,
      view.cart.version,
      { shipping_address: valid },
      randomUUID(),
    );
    view = await f.service.shopping("session-a", flow, {
      intent: { action: "prepare-delivery" },
      expected_version: view.cart.version,
      actionId: randomUUID(),
    });
    assert.equal(
      view.delivery.delivery_groups[0].selected_option_id,
      "standard",
    );
    assert.equal(view.quote, undefined);
    assert.equal(f.remote.confirms, 0);
  } finally {
    f.close();
  }
});

for (const status of ["failed", "pending"] as const) {
  test(`contact ${status} receipt does not advance from address A to delivery after editing B`, async () => {
    const f = fixture(false, true);
    try {
      const flow = await f.flow();
      let view = await f.service.shopping("session-a", flow, {
        intent: {
          action: "add",
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 1,
        },
        actionId: randomUUID(),
      });
      const a = {
        country: "CN",
        recipient: "Buyer",
        phone: "13800138000",
        line1: "Address A",
      };
      view = await f.service.contact(
        "session-a",
        flow,
        view.cart.version,
        { shipping_address: a },
        randomUUID(),
      );
      const b = { ...a, line1: "Address B" };
      const original = f.service.pap.request;
      f.service.pap.request = async (...args: Parameters<typeof original>) =>
        args[1] === "commerce.carts.update"
          ? {
              result: {
                data: {
                  operation: {
                    id: "save-b",
                    status,
                    effects: status === "failed" ? "none" : "unknown",
                  },
                },
              },
            }
          : original(...args);
      const before = f.remote.calls.length;
      let advanced = false;
      try {
        await f.service.contact(
          "session-a",
          flow,
          view.cart.version,
          { shipping_address: b },
          randomUUID(),
        );
        advanced = true;
        await f.service.shopping("session-a", flow, {
          intent: { action: "prepare-delivery" },
          expected_version: view.cart.version,
          actionId: randomUUID(),
        });
        assert.fail("address receipt must not report success");
      } catch (error: any) {
        assert.equal(error.code, "CONTACT_NOT_SAVED");
      }
      assert.equal(advanced, false);
      assert.deepEqual(f.remote.cart.shipping_address, a);
      assert.equal(
        f.remote.calls.slice(before).some((m) => m.includes("delivery")),
        false,
      );
      assert.equal(
        f.vault.get<any>(`flow:${flow}`).pending !== undefined,
        status === "pending",
      );
      if (status === "failed") {
        f.service.pap.request = original;
        view = await f.service.contact(
          "session-a",
          flow,
          view.cart.version,
          { shipping_address: b },
          randomUUID(),
        );
        assert.equal(view.cart.shipping_address.line1, "Address B");
      }
    } finally {
      f.close();
    }
  });
}

test("ending the first-add wait finds the created cart by receipt without another create, including after restart", async () => {
  for (const restart of [false, true]) {
    const f = fixture();
    try {
      const flow = await f.flow();
      const request = {
        intent: {
          action: "add" as const,
          variantId: "variant",
          productName: "Mug",
          variantName: "Blue",
          quantity: 3,
        },
        actionId: randomUUID(),
      };
      f.remote.lose = "commerce.carts.create";
      await assert.rejects(f.service.shopping("session-a", flow, request));
      assert.equal(f.vault.get<any>(`flow:${flow}`).cart, undefined);
      if (restart) f.restart();
      const writes = f.remote.writes;
      const view = await f.service.discardCartAddition("session-a", flow);
      assert.equal(view.pending, false);
      assert.equal(view.cart.lines[0].quantity, 3);
      assert.equal(view.cart.id, f.remote.cart.id);
      assert.equal(f.remote.writes, writes);
      f.restart();
      const replay = await f.service.shopping("session-a", flow, request);
      assert.equal(replay.cart.id, view.cart.id);
      assert.equal(f.remote.writes, writes);
    } finally {
      f.close();
    }
  }
});

test("missing first-create receipt survives ending the wait and restart; refresh recovers it without a replacement write", async () => {
  const f = fixture();
  try {
    const flow = await f.flow();
    const request = {
      intent: {
        action: "add" as const,
        variantId: "variant",
        productName: "Mug",
        variantName: "Blue",
        quantity: 2,
      },
      actionId: randomUUID(),
    };
    f.remote.lose = "commerce.carts.create";
    await assert.rejects(f.service.shopping("session-a", flow, request));
    const pending = f.vault.get<any>(`flow:${flow}`).pending;
    const receipt = f.remote.ops.get(pending);
    f.remote.ops.delete(pending);
    const writes = f.remote.writes;
    let view = await f.service.discardCartAddition("session-a", flow);
    assert.equal(view.cartCreationPending, true);
    assert.equal(view.canRetryCart, false);
    assert.equal(
      f.vault.get<any>(`flow:${flow}`).commands[pending].status,
      "pending",
    );
    f.restart();
    view = await f.service.view("session-a", flow, ["cart"]);
    assert.equal(view.cartCreationPending, true);
    await f.service.retryCart("session-a", flow); // even the explicit route must remain read-only
    await assert.rejects(
      f.service.shopping("session-a", flow, {
        ...request,
        actionId: randomUUID(),
      }),
      /RESOLVE_PENDING_OPERATION/,
    );
    assert.equal(f.remote.writes, writes);
    f.remote.ops.set(pending, receipt);
    view = await f.service.view("session-a", flow, ["cart"]);
    assert.equal(view.pending, false);
    assert.equal(view.cartCreationPending, false);
    assert.equal(view.cart.lines[0].quantity, 2);
    assert.equal(f.remote.writes, writes);
    assert.equal(
      f.remote.calls.filter((m) => m === "commerce.carts.create").length,
      1,
    );
  } finally {
    f.close();
  }
});

test("first-create recovery keeps its key when a success receipt lacks a cart reference or the cart read times out", async () => {
  for (const failure of ["missing-ref", "read-timeout"]) {
    const f = fixture();
    try {
      const flow = await f.flow();
      f.remote.lose = "commerce.carts.create";
      await assert.rejects(
        f.service.shopping("session-a", flow, {
          intent: {
            action: "add",
            variantId: "variant",
            productName: "Mug",
            variantName: "Blue",
            quantity: 1,
          },
          actionId: randomUUID(),
        }),
      );
      const key = f.vault.get<any>(`flow:${flow}`).pending;
      const original = f.service.pap.request;
      f.service.pap.request = async (...args: Parameters<typeof original>) => {
        if (failure === "read-timeout" && args[1] === "commerce.carts.get")
          throw new PapError("NETWORK_TIMEOUT");
        const result: any = await original(...args);
        if (
          failure === "missing-ref" &&
          args[1] === "commerce.operations.lookup"
        )
          delete result.result.data.result_ref;
        return result;
      };
      const view = await f.service.discardCartAddition("session-a", flow);
      assert.equal(view.cartCreationPending, true);
      assert.equal(f.vault.get<any>(`flow:${flow}`).pending, key);
      f.service.pap.request = original;
      f.restart();
      const recovered = await f.service.view("session-a", flow, ["cart"]);
      assert.equal(recovered.pending, false);
      assert.equal(recovered.cart.id, f.remote.cart.id);
      assert.equal(f.remote.writes, 1);
    } finally {
      f.close();
    }
  }
});

// Imported links have no private operator config or exported service.store_id.
test("Commerce resource links bind their first flow to authenticated capabilities", async () => {
  const f = fixture(false, true);
  try {
    f.service.config.sites = [];
    const original = f.pap.sites()[0];
    f.pap.sites = () => [
      {
        ...original,
        description: {
          methods: ["commerce.capabilities.get", "commerce.products.search", "commerce.connections.list"],
        } as any,
      },
    ];
    const ui = await f.service.openStore("a", randomUUID());
    assert.equal(f.vault.get<any>("flow:" + ui.flowId).storeId, "store");
    f.restart();
    assert.equal(f.service.list().length, 1);
    const request = f.pap.request;
    f.pap.request = async (...args: Parameters<typeof request>) => {
      const result = await request(...args);
      if (args[1] === "commerce.capabilities.get")
        result.result.data.store_id = "other-store";
      return result;
    };
    await assert.rejects(
      f.service.connect(ui.sessionId, "a"),
      /STORE_BINDING_MISMATCH/,
    );
    assert.equal(f.vault.get<any>("flow:" + ui.flowId).storeId, "store");
  } finally {
    f.close();
  }
});
