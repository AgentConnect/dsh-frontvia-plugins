import { z } from "zod";

// Shared by the owner form and host validation. CN accepts a complete line1
// without requiring the owner to split it into province and city fields.
export function isRequiredContact(country: string | undefined, field: string) {
  if (field === "line2") return false;
  if (country === "CN")
    return !["email", "city", "region", "postal_code"].includes(field);
  if (country === "US") return field !== "phone";
  return true;
}

const address = z
  .object({
    country: z.enum(["US", "CN"]),
    recipient: z.string().trim().min(1).max(200),
    line1: z.string().trim().min(1).max(300),
    line2: z.string().max(300).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postal_code: z.string().trim().max(40).optional(),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((v) => !v.includes("\0"))
      .optional(),
  })
  .strict();
export const contactSchema = z
  .object({ email: z.email().optional(), shipping_address: address })
  .strict()
  .superRefine((v, ctx) => {
    const a = v.shipping_address;
    if (a.country === "CN" && !a.phone)
      ctx.addIssue({
        code: "custom",
        path: ["shipping_address", "phone"],
        message: "有效收货电话必填",
      });
    for (const field of ["city", "region", "postal_code", "email"] as const) {
      if (
        isRequiredContact(a.country, field) &&
        !(field === "email" ? v.email : a[field])
      )
        ctx.addIssue({
          code: "custom",
          path: field === "email" ? [field] : ["shipping_address", field],
          message: "美国地址需要城市、州、邮箱和邮编",
        });
    }
  });

/** A merchant may return an empty or country-only address for a new cart. */
export function cartContactReady(
  cart: any,
  country: string | undefined,
): boolean {
  if (manualCart(cart)) return true;
  return (
    !!country &&
    cart?.shipping_address?.country === country &&
    contactSchema.safeParse({
      ...(cart?.email ? { email: cart.email } : {}),
      shipping_address: cart?.shipping_address,
    }).success
  );
}

/** The current cart classification is authoritative; mutable lines have no frozen catalog terms. */
export function manualCart(cart: any): boolean {
  return (
    cart?.fulfillment_kind === "manual" &&
    Array.isArray(cart.lines) &&
    cart.lines.length > 0
  );
}

export function deliveryReady(cart: any, delivery: any): boolean {
  return (
    !!cart &&
    !!delivery &&
    delivery.cart_id === cart.id &&
    delivery.cart_version === cart.version &&
    Array.isArray(delivery.delivery_groups) &&
    !delivery.requirements?.some((r: any) => r.blocking) &&
    (delivery.delivery_groups.length > 0 || manualCart(cart)) &&
    delivery.delivery_groups.every((g: any) =>
      g.options?.some((o: any) => o.id === g.selected_option_id),
    )
  );
}
