import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
  ),
  cv = new Vault(
    resolve(root, "adapter-check/customer.sqlite"),
    keys[cc.storageKeyRef],
  );
try {
  const customer = new CustomerService(
      cc,
      new PapService(pc, secrets, pv),
      secrets,
      cv,
    ),
    session = "native-adapter-check";
  const flow = (await read("adapter-result.json")).flowId;
  const tool = async (action, args = {}) => {
    const r = await customer.tool(
      session,
      "frontvia_checkout",
      { flowId: flow, action, ...args },
      randomUUID(),
    );
    for (let i = 0; customer.flow(session, flow).pending && i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      await customer.tool(
        session,
        "frontvia_orders",
        { flowId: flow, action: "recover" },
        randomUUID(),
      );
    }
    assert.ok(!customer.flow(session, flow).pending);
    return r;
  };
  if (!customer.flow(session, flow).checkout) {
    await customer.tool(
      session,
      "frontvia_cart",
      { flowId: flow, action: "get" },
      randomUUID(),
    );
    await tool("quote", {
      expected_version: customer.flow(session, flow).cart.version,
    });
    await tool("prepare");
  }
  await customer.review(session, flow);
  const old = customer.flow(session, flow);
  await tool("revise");
  await assert.rejects(
    customer.confirm(session, flow, old.intent.id),
    /CONFIRMATION_REQUIRED/,
  );
  await customer.tool(
    session,
    "frontvia_cart",
    { flowId: flow, action: "get" },
    randomUUID(),
  );
  await tool("quote", {
    expected_version: customer.flow(session, flow).cart.version,
  });
  await tool("prepare");
  const reviewed = await customer.review(session, flow);
  assert.notEqual(reviewed.quote.id, old.quote.id);
  assert.notEqual(reviewed.checkout.id, old.checkout.id);
  assert.equal(
    reviewed.cart.shipping_address.line1,
    old.cart.shipping_address.line1,
  );
  await writeFile(
    resolve(root, "requote-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        oldIntentRejected: true,
        cartPreserved: true,
        newQuoteId: reviewed.quote.id,
        newCheckoutId: reviewed.checkout.id,
        purchased: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: native unconfirmed checkout released, old confirmation rejected, same cart requoted and prepared. No purchase.",
  );
} finally {
  cv.close();
  pv.close();
}
