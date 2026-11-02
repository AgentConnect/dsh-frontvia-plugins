// Real PAP + Commerce adapter check; never confirms a purchase. Run after native-stack.py.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PapService, Vault } from "../packages/pap/dist/core.js";
import { CustomerService } from "../packages/customer/dist/core.js";
const root = resolve(".local/native"),
  read = async (n) => JSON.parse(await readFile(resolve(root, n), "utf8"));
const pc = await read("pap.json"),
  cc = await read("customer.json"),
  keys = await read("secrets.json");
const secrets = { get: async (k) => keys[k], set: async () => {} };
const pv = new Vault(
  resolve(root, "adapter-check/pap.sqlite"),
  keys[pc.storageKeyRef],
);
const cv = new Vault(
  resolve(root, "adapter-check/customer.sqlite"),
  keys[cc.storageKeyRef],
);
try {
  const pap = new PapService(pc, secrets, pv),
    customer = new CustomerService(cc, pap, secrets, cv);
  const session = "native-adapter-check",
    flow = (await customer.connect(session, "test-shop")).flowId;
  let i = 0;
  const tool = async (name, args) => {
    const v = await customer.tool(
      session,
      `frontvia_${name}`,
      { flowId: flow, ...args },
      `native-${++i}`,
    );
    for (let t = 0; customer.flow(session, flow).pending && t < 30; t++) {
      await new Promise((r) => setTimeout(r, 200));
      await customer.tool(
        session,
        "frontvia_orders",
        { flowId: flow, action: "recover" },
        `read-${++i}`,
      );
    }
    if (customer.flow(session, flow).pending)
      throw new Error("Native operation remained pending");
    return v;
  };
  const search = await tool("products", { action: "search", query: "Mug" });
  const variants = await tool("products", {
    action: "variants",
    product_id: search.data.items[0].id,
  });
  await tool("cart", {
    action: "add",
    variant_id: variants.data.items[0].id,
    quantity: 1,
  });
  let cart = customer.flow(session, flow).cart;
  await customer.contact(
    session,
    flow,
    cart.version,
    {
      email: "dsh-native-check@example.test",
      shipping_address: {
        country: "US",
        recipient: "DSH Acceptance",
        line1: "100 Test Avenue",
        city: "San Francisco",
        region: "CA",
        postal_code: "94105",
      },
    },
    "native-contact",
  );
  await tool("orders", { action: "recover" });
  const delivery = await tool("cart", { action: "delivery_options" });
  await writeFile(
    resolve(root, "delivery-wire.json"),
    JSON.stringify(delivery.data, null, 2),
    { mode: 0o600 },
  );
  cart = customer.flow(session, flow).cart;
  const group = delivery.data.delivery_groups[0],
    option = group.options[0];
  await tool("cart", {
    action: "delivery_select",
    group_id: group.id,
    option_id: option.id,
    expected_version: cart.version,
  });
  await tool("checkout", {
    action: "quote",
    expected_version: customer.flow(session, flow).cart.version,
  });
  await tool("checkout", { action: "prepare" });
  const review = await customer.review(session, flow);
  await writeFile(
    resolve(root, "adapter-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        flowId: flow,
        cart: review.cart.id,
        checkout: review.checkout,
        amount: review.quote.totals.grand_total,
        purchaseConfirmed: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS: actual PAP, product, cart, address, delivery, quote, checkout and review. No purchase confirmation.",
  );
} finally {
  cv.close();
  pv.close();
}
