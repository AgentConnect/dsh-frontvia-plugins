import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const label = z.string().max(500);
const addToCartIntentSchema = z
  .object({
    action: z.literal("add"),
    variantId: id,
    productName: label,
    variantName: label,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();
export const cardIntentSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("variants"),
      productId: id,
      productName: label,
    })
    .strict(),
  addToCartIntentSchema.extend({ quantity: z.literal(1) }),
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
      addToCartIntentSchema,
      z
        .object({
          action: z.literal("product"),
          productId: id,
          refresh: z.boolean().optional(),
        })
        .strict(),
      z
        .object({
          action: z.literal("variant-page"),
          productId: id,
          cursor: z.string().min(1).max(4096),
        })
        .strict(),
      z
        .object({
          action: z.literal("update-line"),
          lineId: id,
          quantity: z.number().int().min(1).max(100),
        })
        .strict(),
      z.object({ action: z.literal("remove-line"), lineId: id }).strict(),
      z
        .object({
          action: z.literal("select-delivery"),
          groupId: id,
          optionId: id,
        })
        .strict(),
      z.object({ action: z.literal("prepare-delivery") }).strict(),
      z.object({ action: z.literal("quote") }).strict(),
      z.object({ action: z.literal("edit-cart") }).strict(),
      z
        .object({
          action: z.literal("orders"),
          cursor: z.string().min(1).max(4096).optional(),
        })
        .strict(),
      z.object({ action: z.literal("order-detail"), orderId: id }).strict(),
      z
        .object({
          action: z.literal("browse"),
          refresh: z.boolean().optional(),
          query: z.string().trim().max(300).optional(),
          cursor: z.string().min(1).max(4096).optional(),
        })
        .strict(),
    ]),
    expected_version: z.string().min(1).max(128).optional(),
    actionId: z.uuid(),
  })
  .strict();
export type ShoppingAction = z.infer<typeof shoppingActionSchema>;
