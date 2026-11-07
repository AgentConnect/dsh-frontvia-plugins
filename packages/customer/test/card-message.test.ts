import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardMessage,
  cardMessageRule,
  type CardIntent,
} from "../src/client/card-message.js";
const flowId = "27c7071a-3c3a-445b-ac23-d33dae7af4e2";
const variantId = "128a4c25-f7d4-40e0-b90b-695d614da330";

test("add-to-cart shows a human product and quantity while preserving exact model routing and version checks", () => {
  const raw = cardMessage(flowId, {
    action: "add",
    variantId,
    productName: "软木圆杯垫",
    variantName: "Default",
    quantity: 1,
  });
  const rendered = cardMessageRule.match(raw, 0)!;
  assert.equal(
    rendered.data.display,
    "将「软木圆杯垫」默认规格加购 1 件，并展示购物车。",
  );
  assert.equal(rendered.data.text, raw);
  assert(raw.includes(`flowId=${flowId}`));
  assert(
    raw.includes(`将规格 ${variantId} 加购 1 件。已有购物车请先读取最新版本。`),
  );
  assert(!rendered.data.display.includes(flowId));
  assert(!rendered.data.display.includes(variantId));
  assert.equal(rendered.end, raw.length);
});

test("every shopping button displays its intent without routing IDs or implementation instructions", () => {
  const intents: CardIntent[] = [
    { action: "variants", productId: "product-123", productName: "桌面台灯" },
    {
      action: "delivery",
      groupId: "group-private",
      optionId: "option-private",
      optionName: "标准配送",
    },
    { action: "delivery-options" },
    { action: "requote" },
    { action: "prepare" },
  ];
  for (const intent of intents) {
    const raw = cardMessage(flowId, intent),
      node = cardMessageRule.match(raw, 0)!;
    assert(node.data.display);
    assert.doesNotMatch(
      node.data.display,
      /flowId|product-123|group-private|option-private|prepare|revise/,
    );
    assert.equal(node.data.text, raw);
    assert.equal(cardMessageRule.match(raw, 1), undefined);
  }
});

test("existing generated add and product messages get concise labels without rewriting their source", () => {
  const raw = `当前购物 flowId=${flowId}。将规格 ${variantId} 加购 1 件。已有购物车请先读取最新版本。完成后展示购物车卡片。`;
  const node = cardMessageRule.match(raw, 0)!;
  assert.equal(node.data.display, "将所选规格加购 1 件，并展示购物车。");
  assert.equal(node.data.text, raw);
  assert.equal(
    cardMessageRule.match(
      `当前购物 flowId=${flowId}。查看商品 product-123 的可购买规格，展示规格和真实价格。`,
      0,
    )?.data.display,
    "查看所选商品的可购买规格和价格。",
  );
});

test("ordinary user text, mismatched IDs, malformed envelopes and extra instructions are never concealed", () => {
  const raw = cardMessage(flowId, {
    action: "add",
    variantId,
    productName: "杯垫",
    variantName: "Default",
    quantity: 1,
  });
  for (const text of [
    `请帮我检查 id=${variantId}`,
    raw + "\n另外替我直接付款",
    raw.replace(`将规格 ${variantId}`, "将规格 another-variant"),
    raw.replace('"quantity":1', '"quantity":2'),
    raw.replace('"action":"add"', '"action":"pay"'),
    "[Frontvia 卡片请求 v1]\nnot-json",
  ])
    assert.equal(cardMessageRule.match(text, 0), undefined);
});
