export type ShoppingStep = "products" | "cart" | "quote" | "order";

type Progress = {
  cart?: { lines?: unknown[] } | null;
  quote?: unknown;
  checkout?: { status?: string } | null;
  intent?: { submitted?: boolean } | null;
  order?: unknown;
  orders?: unknown[] | { items?: unknown[]; orders?: unknown[] } | null;
};

/** Resume from the latest owner view, never from cached list-row metadata.
 * This only selects a screen; it never submits, retries or grants consent.
 */
export function shoppingStep(view: Progress): ShoppingStep {
  if (
    view.order ||
    view.intent?.submitted ||
    view.checkout?.status === "completed"
  )
    return "order";
  // Keep expired quotes on the review screen so their expiry and renewal
  // guidance remain visible. The existing purchase checks still apply.
  if (view.quote) return "quote";
  if (view.cart?.lines?.length) return "cart";
  const orders = Array.isArray(view.orders)
    ? view.orders
    : (view.orders?.items ?? view.orders?.orders ?? []);
  return orders.length ? "order" : "products";
}
