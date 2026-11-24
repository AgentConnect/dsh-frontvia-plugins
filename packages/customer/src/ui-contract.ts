import { z } from "zod";
import { shoppingActionSchema } from "./shopping-action.js";
import { viewScopes } from "./view-scope.js";
import { contactSchema, manualContactSchema } from "./contact-fields.js";
import { aftersalesChange } from "./aftersales-contract.js";
const ref = z.string().min(1).max(200);
const common = {
  sessionId: ref,
  flowId: z.uuid(),
  kind: z.literal("frontvia-customer").optional(),
  card: z
    .enum(["connection", "products", "cart", "quote", "order", "consultation", "aftersales"])
    .optional(),
};
// Purchase amount, buyer identity, signing material and tokens are intentionally
// absent. The host derives these from its saved intent and current server data.
export const uiSchemas = {
  "identity-status": z.object({}).strict(),
  list: z.object({}).strict(),
  "open-store": z.object({ siteId: ref, actionId: z.uuid() }).strict(),
  view: z
    .object({
      ...common,
      scopes: z.array(z.enum(viewScopes)).min(1).max(6).optional(),
    })
    .strict(),
  shopping: shoppingActionSchema.extend(common).strict(),
  review: z.object(common).strict(),
  "prepare-purchase": z.object({ ...common, actionId: z.uuid() }).strict(),
  "reopen-ucp-draft": z.object({ ...common, actionId: z.uuid() }).strict(),
  "approve-handoff": z.object({
    ...common, actionId: z.uuid(), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).strict(),
  "confirm-ucp": z.object({ ...common, actionId: z.uuid() }).strict(),
  "cancel-ucp-checkout": z.object({ ...common, actionId: z.uuid() }).strict(),
  "refresh-ucp-checkout": z.object(common).strict(),
  "order-cancel": z.object(common).strict(),
  "payment-start": z.object(common).strict(),
  recover: z.object(common).strict(),
  "recover-status": z.object(common).strict(),
  "retry-cart": z.object(common).strict(),
  "discard-cart-add": z.object(common).strict(),
  "order-file": z.object({ ...common, order_id: z.uuid() }).strict(),
  "aftersales-view": z.object({ ...common, order_id:z.uuid(), case_id:z.uuid().optional(), cursor:z.string().max(4096).optional() }).strict(),
  "aftersales-change": z.object({ ...common, order_id:z.uuid(), input:aftersalesChange }).strict(),
  original: z
    .object({ ...common, sourceRef: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
  contact: z
    .object({
      ...common,
      expected_version: ref,
      checkout_id: ref.optional(),
      patch: manualContactSchema.or(contactSchema),
      actionId: z.uuid(),
    })
    .strict(),
  confirm: z.object({ ...common, intentId: z.uuid() }).strict(),
  "shopping-confirm": z.object({ ...common, intentId: z.uuid() }).strict(),
};
