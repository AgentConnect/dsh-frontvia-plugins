/** Read scopes affect display refresh only; purchase/mutation validation stays in the host. */
export const viewScopes = [
  "all",
  "catalog",
  "cart",
  "checkout",
  "order",
  "order-detail",
] as const;
export type ViewScope = (typeof viewScopes)[number];
