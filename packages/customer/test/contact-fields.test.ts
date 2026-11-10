import { test } from "node:test";
import assert from "node:assert/strict";
import { cartContactReady } from "../src/contact-fields.js";

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

test("manual carts skip addresses only with complete current snapshots", () => {
  const line = { catalog: { public_snapshot: { fulfillment_kind: "manual" } } };
  const cart = { id: "cart", version: "v1", lines: [line] };
  assert.equal(cartContactReady(cart, "CN"), true);
  for (const lines of [
    [],
    [{}],
    [line, {}],
    [line, { catalog: { public_snapshot: { fulfillment_kind: "physical" } } }],
  ])
    assert.equal(cartContactReady({ ...cart, lines }, "CN"), false);
});
