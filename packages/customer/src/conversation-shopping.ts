import { fail } from "dsh-frontvia-pap/core";

export const shoppingProfile = "frontvia.conversation_purchase.v1";
export const shoppingSupported = (cap: any) =>
  cap?.shopping?.profile === shoppingProfile &&
  cap.shopping.availability === "supported" &&
  cap.shopping.country === "CN" &&
  cap.shopping.currency === "CNY" &&
  cap.shopping.confirmation === "owner_message" &&
  cap.shopping.payment === "hosted_alipay";

const states = [
  "requires_confirmation",
  "processing",
  "payment_pending",
  "paid",
  "partially_refunded",
  "refunded",
  "closed",
  "expired",
  "payment_expired",
  "unavailable",
];
const money = (value: any) =>
  value?.currency === "CNY" &&
  typeof value.amount_minor === "string" &&
  /^\d{1,15}$/.test(value.amount_minor);
export function shoppingView(value: any, site: any, now = Date.now()): any {
  if (!value) return null;
  if (value.profile !== shoppingProfile || !states.includes(value.state))
    fail("SHOPPING_RESPONSE_INVALID");
  if (value.state === "unavailable")
    return { profile: shoppingProfile, state: "unavailable" };
  const q = value.summary;
  if (
    typeof value.summary_id !== "string" ||
    typeof value.summary_digest !== "string" ||
    !Number.isSafeInteger(value.expires_at) ||
    !q ||
    !Array.isArray(q.lines) ||
    !q.lines.length ||
    q.lines.length > 100 ||
    !q.lines.every(
      (line: any) =>
        typeof line.title === "string" &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        money(line.line_total),
    ) ||
    q.shipping_address?.country !== "CN" ||
    !["recipient", "phone", "line1"].every(
      (k) =>
        typeof q.shipping_address[k] === "string" &&
        q.shipping_address[k].trim(),
    ) ||
    !["region", "city", "line2", "postal_code"].every(
      (k) =>
        q.shipping_address[k] == null ||
        typeof q.shipping_address[k] === "string",
    ) ||
    q.totals?.complete !== true ||
    !money(q.totals.grand_total) ||
    ![
      "items_subtotal",
      "shipping_total",
      "discount_total",
      "tax_total",
      "duties_total",
      "fees_total",
    ].every((k) => q.totals[k] === null || money(q.totals[k]))
  )
    fail("SHOPPING_RESPONSE_INVALID");
  const out = structuredClone(value);
  if (out.state === "requires_confirmation") {
    if (
      typeof out.confirmation?.text !== "string" ||
      !/^确认购买 [A-Z0-9]{16}$/.test(out.confirmation.text)
    )
      fail("SHOPPING_RESPONSE_INVALID");
    if (out.expires_at * 1000 <= now) {
      out.state = "expired";
      out.confirmation = null;
    }
  } else out.confirmation = null;
  if (out.payment) {
    let url: URL, issuer: URL;
    try {
      url = new URL(out.payment.url);
      issuer = new URL(site.issuer);
    } catch {
      return fail("SHOPPING_PAYMENT_LINK_INVALID");
    }
    if (
      url.protocol !== "https:" ||
      url.origin !== issuer.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !==
        `${issuer.pathname.replace(/\/$/, "")}/pay/${out.checkout?.id}` ||
      !url.searchParams.get("access") ||
      !url.searchParams.get("expires") ||
      [...url.searchParams.keys()].some(
        (k) => !["access", "expires"].includes(k),
      ) ||
      url.searchParams.getAll("access").length !== 1 ||
      url.searchParams.getAll("expires").length !== 1
    )
      fail("SHOPPING_PAYMENT_LINK_INVALID");
    if (
      out.state !== "payment_pending" ||
      !Number.isFinite(Date.parse(out.payment.expires_at)) ||
      Date.parse(out.payment.expires_at) <= now
    )
      out.payment = null;
  }
  return out;
}

/** The UI gets full originals. Models never get bearer links or a usable purchase command. */
export function consultationModelData(value: any): any {
  if (Array.isArray(value)) return value.map(consultationModelData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            ![
              "confirmation",
              "confirmation_code",
              "confirmation_instruction",
              "summary",
              "summary_digest",
              "payment_link",
              "next_actions",
            ].includes(k) && !(k === "payment" && typeof v === "object"),
        )
        .map(([k, v]) => [k, consultationModelData(v)]),
    );
  if (typeof value === "string")
    return value
      .replace(
        /https:\/\/[^\s<>"']+\/pay\/[^\s<>"']+/gu,
        "[请在购物卡片打开付款页]",
      )
      .replace(/确认购买\s+[A-Za-z0-9_-]{4,80}/gu, "[请由用户在购物卡片确认]");
  return value;
}
