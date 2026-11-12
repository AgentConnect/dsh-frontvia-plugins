import { test } from "node:test";
import assert from "node:assert/strict";
import { cartContactReady } from "../src/contact-fields.js";
import { uiSchemas } from "../src/ui-contract.js";

test("owner contact route accepts a manual email patch without accepting invalid email or scope fields", () => {
  const request = {sessionId:"owned-session",flowId:"00000000-0000-4000-8000-000000000001",
    actionId:"00000000-0000-4000-8000-000000000002",expected_version:"v1",patch:{email:"buyer@example.test"}};
  assert.equal(uiSchemas.contact.safeParse(request).success,true);
  assert.equal(uiSchemas.contact.safeParse({...request,patch:{email:"invalid"}}).success,false);
  assert.equal(uiSchemas.contact.safeParse({...request,tenant_id:"other-tenant"}).success,false);
});

test("checkout address readiness uses CN and US required fields, not address-object presence", () => {
  const cn = {
    shipping_address: {
      country: "CN",
      recipient: "张三",
      phone: "13800138000",
      line1: "测试街道 1 号",
    },
  };
  assert.equal(cartContactReady(cn, "CN"), true);
  assert.equal(
    cartContactReady(
      {
        shipping_address: {
          ...cn.shipping_address,
          phone: "021-12345678 转 123",
        },
      },
      "CN",
    ),
    true,
  );
  for (const address of [
    undefined,
    null,
    {},
    { country: "CN" },
    { ...cn.shipping_address, recipient: " " },
    { ...cn.shipping_address, line1: "" },
    { ...cn.shipping_address, phone: " " },
  ])
    assert.equal(cartContactReady({ shipping_address: address }, "CN"), false);
  const us = {
    email: "buyer@example.test",
    shipping_address: {
      country: "US",
      recipient: "Test",
      line1: "1 Test Street",
      city: "Boston",
      region: "MA",
      postal_code: "02110",
    },
  };
  assert.equal(cartContactReady(us, "US"), true);
  assert.equal(cartContactReady(us, "CN"), false);
  assert.equal(cartContactReady({ ...us, email: "" }, "US"), false);
  for (const field of ["city", "region", "postal_code"])
    assert.equal(
      cartContactReady(
        { ...us, shipping_address: { ...us.shipping_address, [field]: " " } },
        "US",
      ),
      false,
    );
});

test("manual carts skip addresses from the current public cart, without quote-only snapshots", () => {
  const cart = {
    id: "cart",
    version: "v1",
    fulfillment_kind: "manual",
    lines: [{ catalog: null }],
  };
  assert.equal(cartContactReady(cart, "CN"), true);
  assert.equal(cartContactReady(cart, "US"), false);
  assert.equal(cartContactReady({ ...cart, email: "invalid" }, "US"), false);
  assert.equal(cartContactReady({ ...cart, email: "buyer@example.test" }, "US"), true);
  assert.equal(cartContactReady({ ...cart, lines: [] }, "CN"), false);
  for (const kind of [undefined, null, "mixed", "physical", "unknown"])
    assert.equal(
      cartContactReady({ ...cart, fulfillment_kind: kind }, "CN"),
      false,
    );
  // Old quote terms must never override the current cart classification.
  assert.equal(
    cartContactReady(
      {
        ...cart,
        fulfillment_kind: "physical",
        lines: [
          { catalog: { public_snapshot: { fulfillment_kind: "manual" } } },
        ],
      },
      "CN",
    ),
    false,
  );
});
