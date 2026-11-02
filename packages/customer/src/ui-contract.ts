import { z } from "zod";
import { contactSchema } from "./core.js";
const ref = z.string().min(1).max(200);
const common = {
  sessionId: ref,
  flowId: z.uuid(),
  kind: z.literal("frontvia-customer").optional(),
  card: z.enum(["connection", "products", "cart", "quote", "order"]).optional(),
};
// Purchase amount, buyer identity, signing material and tokens are intentionally
// absent. The host derives these from its saved intent and current server data.
export const uiSchemas = {
  list: z.object({}).strict(),
  view: z.object(common).strict(),
  review: z.object(common).strict(),
  recover: z.object(common).strict(),
  contact: z
    .object({
      ...common,
      expected_version: ref,
      patch: contactSchema,
      actionId: z.uuid(),
    })
    .strict(),
  confirm: z.object({ ...common, intentId: z.uuid() }).strict(),
};
