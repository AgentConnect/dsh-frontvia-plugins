import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const label = z.string().max(500);
export const cardIntentSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("variants"),
      productId: id,
      productName: label,
    })
    .strict(),
  z
    .object({
      action: z.literal("add"),
      variantId: id,
      productName: label,
      variantName: label,
      quantity: z.literal(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("delivery"),
      groupId: id,
      optionId: id,
      optionName: label,
    })
    .strict(),
  z.object({ action: z.literal("delivery-options") }).strict(),
  z.object({ action: z.literal("requote") }).strict(),
  z.object({ action: z.literal("prepare") }).strict(),
]);

export type CardIntent = z.infer<typeof cardIntentSchema>;
export const shoppingActionSchema = z
  .object({
    intent: z.union([
      cardIntentSchema,
      z
        .object({
          action: z.literal("browse"),
          cursor: z.string().min(1).max(4096).optional(),
        })
        .strict(),
    ]),
    expected_version: z.string().min(1).max(128).optional(),
    actionId: z.uuid(),
  })
  .strict();
export type ShoppingAction = z.infer<typeof shoppingActionSchema>;
