import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolResult } from "../src/client/tool-result.js";
const message = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

test("catalog feedback exposes returned product names and exact prices before the turn footer exists", () => {
  const summary = summarizeToolResult(
    "frontvia_products",
    message({
      data: {
        items: [
          {
            id: "internal-id",
            title: "折叠旅行包",
            price_range: {
              minimum: { currency: "USD", amount_decimal: "99.00" },
            },
          },
        ],
        page: { has_more: false, next_cursor: null },
      },
      ui: {
        kind: "frontvia-customer",
        card: "products",
        flowId: "flow",
        sessionId: "session",
      },
    }),
  );
  assert.equal(summary.title, "找到 1 件商品");
  assert.deepEqual(summary.products, [
    { title: "折叠旅行包", price: "USD 99.00" },
  ]);
  assert.equal(summary.detail, undefined);
  assert(!JSON.stringify(summary).includes("internal-id"));
  const next = summarizeToolResult(
    "frontvia_products",
    message({
      data: {
        items: [],
        page: { has_more: true, next_cursor: "opaque-secret" },
      },
    }),
  );
  assert.equal(next.title, "没有找到匹配的商品");
  assert.match(next.detail!, /下一页/);
  assert(!JSON.stringify(next).includes("opaque-secret"));
});

test("product errors and consultation progress have user-facing feedback instead of raw JSON or shopping placeholders", () => {
  const error = summarizeToolResult(
    "frontvia_products",
    message({
      error: { code: "INVALID_PARAMS" },
      nextStep: "internal recovery instruction",
    }),
  );
  assert.equal(error.error, true);
  assert.match(error.title, /商品查询未完成/);
  assert(!JSON.stringify(error).includes("INVALID_PARAMS"));
  assert(!JSON.stringify(error).includes("internal"));
  assert.match(
    summarizeToolResult(
      "frontvia_products",
      message({ error: { code: "PERSONAL_LOGIN_REQUIRED" } }),
    ).title,
    /Frontvia 服务登录/,
  );
  assert.equal(
    summarizeToolResult(
      "frontvia_consultation",
      message({ data: {}, ui: { card: "consultation" } }),
    ).title,
    "商家咨询已更新",
  );
  assert.equal(
    summarizeToolResult("frontvia_products", {
      content: [{ type: "text", text: "Untrusted raw server failure" }],
      isError: true,
    }).error,
    true,
  );
});
