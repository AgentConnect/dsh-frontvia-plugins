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
    if (intent) await call("shopping", { ...ui, intent, actionId });
    return { ui, added: !!intent, error: false };
  } catch {
    return { ui, added: false, error: true };
  }
}
