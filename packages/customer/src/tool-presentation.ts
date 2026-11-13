/** Durable display evidence is independent of model-facing text spill/truncation. */
export function presentationResult(meta: any) {
  const value = meta?.frontviaCustomer;
  const ui = value?.ui;
  return value?.version === 1 && ui?.kind === "frontvia-customer" &&
    typeof ui.flowId === "string" && typeof ui.sessionId === "string" &&
    typeof ui.card === "string" ? value : null;
}

export function toolPresentation(value: any) {
  if (!value?.ui) return null;
  // No cart, quote, payment or order state: authoritative reads still own those.
  const display = {
    version: 1,
    ui: value.ui,
    ...(value.catalogSnapshot ? { catalogSnapshot: value.catalogSnapshot } : {}),
  };
  return presentationResult({ frontviaCustomer: display })
    ? { frontviaCustomer: display } : null;
}

export function renderToolValue(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return JSON.stringify(value);
  // The model already receives the catalog in data; do not duplicate UI history.
  const { catalogSnapshot: _, ...data } = value;
  return JSON.stringify(data);
}
