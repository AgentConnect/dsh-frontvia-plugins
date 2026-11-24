import type { ShoppingAction } from "../shopping-action.js";

export type AddToNewCart = Extract<ShoppingAction["intent"], { action: "add" }>;
export type StartShopping = (intent?: AddToNewCart) => Promise<boolean>;

// Keep the new reference even when an addition fails: uncertain mutations must
// be recovered on that cart, never retried by silently opening another one.
export async function openStorefrontCart(
  call: (op: string, payload?: any) => Promise<any>,
  siteId: string,
  actionId: string,
  intent?: AddToNewCart,
  active: () => boolean = () => true,
) {
  const ui = await call("open-store", { siteId, actionId });
  if (!active()) return undefined;
  try {
    if (!intent) return { ui, added: false, error: false };
    const result = await call("shopping", { sessionId: ui.sessionId, flowId: ui.flowId, intent, actionId });
    const added = !result?.pending && result?.cart?.lines?.some((line: {variant_id?: string; quantity: number}) =>
      line.variant_id === intent.variantId && line.quantity >= intent.quantity) === true;
    return { ui, added, error: !added };
  } catch {
    return { ui, added: false, error: true };
  }
}
