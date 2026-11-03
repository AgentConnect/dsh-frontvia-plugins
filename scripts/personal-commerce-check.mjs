// Full personal shopping acceptance against an owned native-stack.py personal fixture.
// No paid model, real SMS, shared profile or live merchant writes.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import { PapService, Vault, jwt } from "../packages/pap/dist/core.js";
import { CustomerService } from "../packages/customer/dist/core.js";
const root = resolve(process.argv[2] ?? ".local/native");
const read = async (n) => JSON.parse(await readFile(join(root, n), "utf8"));
const state = await read("status.json"),
  owner = await read("owner.json");
assert.equal(state.status, "READY");
assert.equal(state.payment, "native Mock");
process.kill(owner.pid, 0);
const pc = await read("pap.json"),
  cc = await read("customer.json"),
  keys = await read("secrets.json");
assert(pc.personal && new URL(pc.personal.origin).hostname.endsWith(".test"));
assert(pc.caFile && pc.targets.every((t) => t.address === "127.0.0.1"));
assert(
  cc.sites.every(
    (s) =>
      s.mockPayment === true && !s.confirmationKeyRef && !s.confirmationKid,
  ),
);
const out = await mkdtemp(join(root, "personal-journey-"));
const secrets = { get: async (k) => keys[k], set: async () => {} };
const clients = [];
function client(label, personal = true) {
  const config = { ...pc };
  if (!personal) delete config.personal;
  const p = new Vault(join(out, label, "pap.sqlite"), keys[pc.storageKeyRef]);
  const c = new Vault(
    join(out, label, "customer.sqlite"),
    keys[cc.storageKeyRef],
  );
  const pap = new PapService(config, secrets, p),
    customer = new CustomerService(cc, pap, secrets, c);
  const value = { pap, customer, p, c };
  clients.push(value);
  return value;
}
const a = client("a"),
  b = client("b"),
  guest = client("guest", false),
  session = randomUUID(),
  cases = [];
let flow;
async function tool(name, args) {
  const value = await a.customer.tool(
    session,
    `frontvia_${name}`,
    { flowId: flow, ...args },
    randomUUID(),
  );
  for (let i = 0; a.customer.flow(session, flow).pending && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    await a.customer.tool(
      session,
      "frontvia_orders",
      { flowId: flow, action: "recover" },
      randomUUID(),
    );
  }
  assert(
    !a.customer.flow(session, flow).pending,
    "operation remained uncertain",
  );
  return value;
}
try {
  await a.pap.personal.requestCode("+12025550101");
  await a.pap.personal.verify("246810");
  const connected = await a.customer.connect(session, pc.sites[0].id);
  flow = connected.flowId;
  assert.equal(connected.cartReady, true);
  assert.equal(connected.purchaseReady, true);
  const products = await tool("products", { action: "browse" });
  assert(products.data.items.length);
  const variants = await tool("products", {
    action: "variants",
    product_id: products.data.items[0].id,
  });
  await tool("cart", {
    action: "add",
    variant_id: variants.data.items[0].id,
    quantity: 1,
  });
  let cart = a.customer.flow(session, flow).cart;
  await tool("cart", {
    action: "update",
    line_id: cart.lines[0].id,
    quantity: 2,
    expected_version: cart.version,
  });
  cart = a.customer.flow(session, flow).cart;
  assert.equal(cart.lines[0].quantity, 2);
  await tool("cart", {
    action: "update",
    line_id: cart.lines[0].id,
    quantity: 1,
    expected_version: cart.version,
  });
  cart = a.customer.flow(session, flow).cart;
  await a.customer.contact(
    session,
    flow,
    cart.version,
    {
      email: "personal-journey@example.test",
      shipping_address: {
        country: "US",
        recipient: "Fixture Buyer",
        line1: "100 Test Avenue",
        city: "San Francisco",
        region: "CA",
        postal_code: "94105",
      },
    },
    randomUUID(),
  );
  await tool("orders", { action: "recover" });
  const delivery = await tool("cart", { action: "delivery_options" }),
    group = delivery.data.delivery_groups[0];
  await tool("cart", {
    action: "delivery_select",
    group_id: group.id,
    option_id: group.options[0].id,
    expected_version: a.customer.flow(session, flow).cart.version,
  });
  await tool("checkout", {
    action: "quote",
    expected_version: a.customer.flow(session, flow).cart.version,
  });
  await tool("checkout", { action: "prepare" });
  const review = await a.customer.review(session, flow);
  assert(review.intent);
  assert(!review.order);
  const f = a.customer.flow(session, flow),
    ref = f.connectionRef;
  const now = Math.floor(Date.now() / 1000),
    claims = {
      ...f.intent.snapshot,
      idempotency_key: randomUUID(),
      nonce: randomUUID(),
      iat: now,
      exp: now + 120,
    };
  const altered = await a.pap.request(ref, "commerce.checkouts.confirm", {
    checkout_id: f.checkout.id,
    idempotency_key: claims.idempotency_key,
    confirmation: a.pap.signResourceStatement(
      ref,
      "frontvia-personal-purchase+jwt",
      { ...claims, amount_minor: "1" },
    ),
  });
  assert(altered.error);
  const key = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { format: "jwk" },
  });
  const forged = jwt(
    key.privateKey,
    { alg: "ES256", typ: "frontvia-personal-purchase+jwt", jwk: key.publicKey },
    claims,
  );
  assert(
    (
      await a.pap.request(ref, "commerce.checkouts.confirm", {
        checkout_id: f.checkout.id,
        idempotency_key: claims.idempotency_key,
        confirmation: forged,
      })
    ).error,
  );
  cases.push(
    "phone-browse-variants-add-quantity-contact-delivery-quote-review",
    "changed-amount-and-unbound-key-rejected-before-payment",
  );
  await a.customer.confirm(session, flow, review.intent.id);
  await tool("orders", { action: "recover" });
  const completed = await a.customer.view(session, flow);
  assert.equal(completed.order.payment.status, "paid");
  await a.customer.confirm(session, flow, review.intent.id);
  const orders = await tool("orders", { action: "list" });
  assert(orders.data.items.some((o) => o.id === completed.order.id));
  const resumed = new CustomerService(cc, a.pap, secrets, a.c);
  assert.equal(
    (await resumed.view(session, flow)).order.id,
    completed.order.id,
  );
  cases.push("mock-confirm-order-history-repeated-confirm-and-reload");
  await b.pap.personal.requestCode("+12025550102");
  await b.pap.personal.verify("246810");
  const bf = await b.customer.connect("second-person", pc.sites[0].id),
    br = b.customer.flow("second-person", bf.flowId).connectionRef;
  const otherOrders = await b.customer.tool(
    "second-person",
    "frontvia_orders",
    { flowId: bf.flowId, action: "list" },
    randomUUID(),
  );
  assert.equal(otherOrders.data.items.length, 0);
  for (const [method, params] of [
    ["commerce.orders.get", { order_id: completed.order.id }],
    ["commerce.carts.get", { cart_id: f.cart.id }],
    ["commerce.checkouts.get", { checkout_id: f.checkout.id }],
  ])
    assert((await b.pap.request(br, method, params)).error);
  const g = await guest.pap.connect(pc.sites[0].id),
    caps = await guest.pap.request(
      g.connectionRef,
      "commerce.capabilities.get",
      {},
    );
  assert.equal(
    caps.result.data.methods.find((m) => m.method === "commerce.carts.create")
      .availability,
    "disabled",
  );
  cases.push(
    "two-person-cart-checkout-order-isolation",
    "guest-cannot-inherit-personal-purchase",
  );
  await a.pap.personal.logout();
  assert.equal(a.customer.list().length, 0);
  await assert.rejects(() => a.customer.view(session, flow));
  assert((await b.pap.request(br, "commerce.capabilities.get", {})).result);
  cases.push("logout-revokes-old-flow-other-person-unaffected");
  await b.pap.personal.logout();
  await guest.pap.disconnect(g.connectionRef);
  const result = {
    status: "PASS",
    cases,
    orderId: completed.order.id,
    payment: "native Mock",
  };
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify({ status: "PASS", cases, evidence: out }));
} finally {
  for (const c of clients) {
    await c.pap.personal.logout().catch(() => {});
    c.c.close();
    c.p.close();
  }
}
