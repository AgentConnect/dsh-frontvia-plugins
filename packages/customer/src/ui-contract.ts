import { z } from "zod";
import { shoppingActionSchema } from "./shopping-action.js";
import { viewScopes } from "./view-scope.js";
import { contactSchema, manualContactSchema } from "./contact-fields.js";
const ref = z.string().min(1).max(200);
const common = {
  sessionId: ref,
  flowId: z.uuid(),
  kind: z.literal("frontvia-customer").optional(),
  card: z
    .enum(["connection", "products", "cart", "quote", "order", "consultation"])
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
  "order-cancel": z.object(common).strict(),
  "payment-start": z.object(common).strict(),
  recover: z.object(common).strict(),
  "retry-cart": z.object(common).strict(),
  "discard-cart-add": z.object(common).strict(),
  original: z
    .object({ ...common, sourceRef: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
  contact: z
    .object({
      ...common,
      expected_version: ref,
      patch: manualContactSchema.or(contactSchema),
      actionId: z.uuid(),
    })
    .strict(),
  confirm: z.object({ ...common, intentId: z.uuid() }).strict(),
  "shopping-confirm": z.object({ ...common, intentId: z.uuid() }).strict(),
};
