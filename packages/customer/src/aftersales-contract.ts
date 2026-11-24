import { z } from "zod";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const amount = z.string().regex(/^(0|[1-9]\d{0,15})$/);
const quantity = z.number().int().positive();
const nonnegative = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(2000);
const currency = z.enum(["USD", "CNY"]);
export const aftersalesKind = z.enum(["cancel_order", "refund_only", "return_and_refund"]);
const stage = z.enum(["pending_merchant","waiting_return","refunding","refunded","withdrawn","rejected","closed"]);
const selection = z.object({ line_id: z.uuid(), quantity }).strict();
const caseSummary = z.object({ id: z.uuid(), order_id: z.uuid(), kind: aftersalesKind, revision: quantity, stage, updated_at: z.string() });
export const aftersalesCase = caseSummary.extend({
  reason: z.string(),
  decision_reason: z.string().nullish(),
  currency,
  requested_minor: amount,
  original_shipping_refund_minor: amount,
  digital_access: z.enum(["available","not_granted","revocation_pending","revoked"]).nullish(),
  cancellation_pending: z.boolean().optional(),
  lines: z.array(selection.extend({merchant_review:z.boolean().optional()})),
  return: z.object({
    status: z.string(),
    items: z.array(selection.extend({received:nonnegative,damaged:nonnegative})),
  }).nullable(),
  return_instructions: z.object({recipient:z.string(),address:z.string(),delivery_notes:z.string()}).nullable(),
  refund: z.object({state:z.string(),amount_minor:amount,shipping_minor:amount.nullish(),currency,reason:z.string()}).nullable(),
  allowed_actions: z.array(z.string()),
});
export const aftersalesCases = z.object({
  items:z.array(caseSummary),
  page:z.object({has_more:z.boolean(),next_cursor:z.string().nullable()}),
});
const policy = z.object({allowed:z.boolean(),reason:z.string().optional(),merchant_review:z.boolean().optional()});
export const aftersalesEligibility = z.object({
  order_id:z.uuid(),
  lines:z.array(z.object({id:z.uuid(),title:z.string().nullish(),kind:z.string(),quantity:nonnegative,
    packed:nonnegative,shipped:nonnegative,unshipped:nonnegative,refund_only:policy.nullish(),return_and_refund:policy.nullish()})),
  allowed:z.array(aftersalesKind),
  reasons:z.array(z.string()),
  currency:currency.nullish(),
  captured_minor:amount.nullish(),
  refundable_minor:amount.nullish(),
  original_shipping_minor:amount.nullish(),
  refund_opportunity:z.enum(["used","held","available","unavailable"]),
  support:z.object({support_contact:z.string().nullable(),support_hours:z.string().nullable()}),
  active_case:aftersalesCase.nullable(),
});
export const aftersalesOutcome = z.object({
  operation_id: reference.optional(),
  order_id:z.uuid().optional(),
  case_id:z.uuid().optional(),
  status:z.enum(["performed","performing","awaiting_approval","already_active"]),
  effect:z.literal("none").optional(),
  reason:z.string().optional(),
});
export const aftersalesIntentOutcome=z.union([aftersalesOutcome,z.object({
  status:z.literal("unobserved"),order_id:z.uuid(),intent_id:z.uuid(),
})]);

export const aftersalesChange = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("cancel_order"),reason}).strict(),
  z.object({kind:z.enum(["refund_only","return_and_refund"]),reason,
    lines:z.array(selection).min(1).max(100),requested_minor:amount,shipping_minor:amount}).strict(),
  z.object({kind:z.literal("withdraw"),case_id:z.uuid(),revision:quantity,reason,not_sent:z.boolean()}).strict(),
]);
export type AftersalesChange = z.infer<typeof aftersalesChange>;
export type AftersalesCase = z.infer<typeof aftersalesCase>;
export type AftersalesEligibility = z.infer<typeof aftersalesEligibility>;
export type AftersalesView = {
  eligibility: AftersalesEligibility;
  selected: AftersalesCase | null;
  historyDeferred?: true;
  history: z.infer<typeof aftersalesCases>;
  pending?: { phase:"confirm"|"reconciling"; input:AftersalesChange };
  message?: "recorded"|"no_effect"|"terms_changed";
};
