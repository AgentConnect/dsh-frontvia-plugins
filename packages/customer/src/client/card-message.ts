import { z } from "zod";

import {
  cardIntentSchema as intentSchema,
  type CardIntent,
} from "../shopping-action.js";
export type { CardIntent } from "../shopping-action.js";
const envelope = z.object({ flowId: z.uuid(), intent: intentSchema }).strict();
const prefix = "[Frontvia 卡片请求 v1]\n";
const clean = (name: string, fallback: string) =>
  name.replace(/\s+/g, " ").trim() || fallback;

export function cardDisplay(intent: CardIntent): string {
  switch (intent.action) {
    case "variants":
      return `查看「${clean(intent.productName, "所选商品")}」的可购买规格和价格。`;
    case "add":
      return `将「${clean(intent.productName, "所选商品")}」${intent.variantName === "Default" ? "默认规格" : clean(intent.variantName, "所选规格")}加购 1 件，并展示购物车。`;
    case "delivery":
      return `选择「${clean(intent.optionName, "所选配送方式")}」配送并重新报价，供我确认。`;
    case "delivery-options":
      return "收货资料已填写，请查询可用配送方式和运费。";
    case "requote":
      return "报价已过期，请重新报价并展示待我确认的订单。";
    case "prepare":
      return "请展示当前订单供我核对，购买由我确认。";
  }
}

function instruction(intent: CardIntent): string {
  switch (intent.action) {
    case "variants":
      return `查看商品 ${intent.productId} 的可购买规格，展示规格和真实价格。`;
    case "add":
      return `将规格 ${intent.variantId} 加购 1 件。已有购物车请先读取最新版本。完成后展示购物车卡片。`;
    case "delivery":
      return `选择配送组 ${intent.groupId} 的选项 ${intent.optionId}。先读取最新购物车版本，再选择配送、按新版本生成报价并 prepare；停在待我确认的卡片。`;
    case "delivery-options":
      return "收货资料已填写。读取最新购物车并查询可用配送方式，说明运费供我选择。";
    case "requote":
      return "报价已过期，请 revise 未确认的草稿结算，重新读取购物车版本、报价并 prepare，停在用户确认前。";
    case "prepare":
      return "请准备当前有效报价的结算，展示待我确认的卡片，不要替我确认。";
  }
}

/** Exact routing remains in the durable model text; the host renders its human label. */
export function cardMessage(flowId: string, intent: CardIntent): string {
  const value = envelope.parse({ flowId, intent });
  return (
    prefix +
    JSON.stringify(value) +
    "\n" +
    `当前购物 flowId=${value.flowId}。${instruction(value.intent)}`
  );
}

function display(text: string): string | undefined {
  if (text.startsWith(prefix)) {
    try {
      const value = envelope.parse(
        JSON.parse(text.slice(prefix.length).split("\n")[0]),
      );
      // Never conceal arbitrary appended instructions or a mismatched target.
      if (cardMessage(value.flowId, value.intent) === text)
        return cardDisplay(value.intent);
    } catch {}
    return;
  }
  // Compatibility for messages produced by earlier installed card buttons only.
  const old = /^当前购物 flowId=([0-9a-f-]{36})。(.+)$/i.exec(text);
  if (!old || !z.uuid().safeParse(old[1]).success) return;
  const reference = "([A-Za-z0-9][A-Za-z0-9._:-]{0,127})";
  let match = new RegExp(
    `^查看商品 ${reference} 的可购买规格，展示规格和真实价格。$`,
  ).exec(old[2]);
  if (match) return "查看所选商品的可购买规格和价格。";
  match = new RegExp(
    `^将规格 ${reference} 加购 1 件。已有购物车请先读取最新版本。完成后展示购物车卡片。$`,
  ).exec(old[2]);
  if (match) return "将所选规格加购 1 件，并展示购物车。";
  match = new RegExp(
    `^选择配送组 ${reference} 的选项 ${reference}。先读取最新购物车版本，再选择配送、按新版本生成报价并 prepare；停在待我确认的卡片。$`,
  ).exec(old[2]);
  if (match) return "选择所选配送方式并重新报价，供我确认。";
  for (const action of ["delivery-options", "requote", "prepare"] as const) {
    if (old[2] === instruction({ action })) return cardDisplay({ action });
  }
}

export const cardMessageRule = {
  id: "frontvia.card-message",
  order: 100,
  match(text: string, from: number) {
    if (from !== 0 || text.length > 6000) return;
    const human = display(text);
    if (human === undefined) return;
    return {
      id: "text" as const,
      start: 0,
      end: text.length,
      data: { text, display: human },
    };
  },
};
