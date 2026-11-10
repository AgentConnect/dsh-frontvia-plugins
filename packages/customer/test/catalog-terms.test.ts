import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  attributeText,
  coverageText,
  CatalogTerms,
} from "../src/client/catalog-terms.js";
import { deliveryReady } from "../src/contact-fields.js";
import { Order } from "../src/client/commerce-display.js";

test("public values preserve false, zero, selected enum labels and escape descriptions", () => {
  assert.equal(
    attributeText({ value: { type: "boolean", value: false } }),
    "否",
  );
  assert.equal(
    attributeText({
      value: { type: "number", value: "0" },
      unit_label: "千克",
    }),
    "0 千克",
  );
  assert.equal(
    attributeText({
      value: { type: "enum", value_id: "a" },
      enum_labels: [{ id: "a", label: "红色" }],
    }),
    "红色",
  );
  const html = renderToStaticMarkup(
    createElement(CatalogTerms, {
      terms: {
        brand: { state: "unbranded" },
        fulfillment_kind: "manual",
        delivery_instructions: "<script>unsafe</script>",
        public_documents: [
          {
            document_id: "d",
            title: "资料",
            source: { kind: "link", url: "javascript:alert(1)" },
          },
        ],
      },
    }),
  );
  assert.match(html, /无品牌/);
  assert.match(html, /无需收货地址/);
  assert.doesNotMatch(html, /<script>|javascript:/);
});
test("empty delivery groups are ready only for current complete manual cart", () => {
  const cart = {
    id: "a",
    version: "v1",
    fulfillment_kind: "manual",
    lines: [{ catalog: null }],
  };
  const delivery = {
    cart_id: "a",
    cart_version: "v1",
    delivery_groups: [],
    requirements: [],
  };
  assert.equal(deliveryReady(cart, delivery), true);
  for (const value of [
    { ...delivery, cart_version: "v0" },
    { ...delivery, requirements: [{ blocking: true }] },
  ])
    assert.equal(deliveryReady(cart, value), false);
  assert.equal(deliveryReady({ ...cart, lines: [] }, delivery), false);
  assert.equal(
    deliveryReady({ ...cart, fulfillment_kind: "mixed" }, delivery),
    false,
  );
});
test("orders display preserved promises, delivery records and logistics without current catalog reads", () => {
  const order = {
    id: "o",
    status: "open",
    payment: { status: "not_required" },
    payment_required: false,
    fulfillment_status: "unfulfilled",
    totals: { grand_total: { currency: "CNY", amount_minor: "0" } },
    lines: [
      {
        title: "商品",
        quantity: 1,
        catalog: { public_snapshot: { model: "成交时型号" } },
      },
    ],
    manual_deliveries: {
      items: [
        {
          record_id: "d",
          kind: "delivery",
          content: "交付内容",
          links: ["https://example.test/material"],
          created_at: "2026-11-10",
        },
      ],
    },
    shipments: [
      {
        id: "s",
        tracking: [{ carrier: "快递", tracking_number: "123" }],
        logistics: {
          snapshot: {
            status: "运输中",
            events: [{ time: "2026-11-10", description: "已揽收" }],
          },
          query: { state: "failed" },
        },
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(Order, { order }));
  for (const text of ["成交时型号", "交付内容", "已揽收", "无需付款"])
    assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /已付款/);
});

test("included service coverage does not imply nationwide availability", () => {
  assert.equal(
    coverageText([{ country_code: "CN", province_codes: ["11", "31"] }]),
    "北京、上海",
  );
});
