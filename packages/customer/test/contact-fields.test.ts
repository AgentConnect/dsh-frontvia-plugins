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
  for (const address of [
    undefined,
    null,
    {},
    { country: "CN" },
    { ...cn.shipping_address, recipient: " " },
    { ...cn.shipping_address, line1: "" },
    { ...cn.shipping_address, phone: "123" },
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
