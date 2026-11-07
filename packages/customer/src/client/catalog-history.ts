export type CatalogSnapshot = {
  products?: any;
  variants?: any;
  variantProductId?: string;
};

/** Display evidence only. Never merge a historical cart, quote, intent or order. */
export function catalogSnapshot(
  result: any,
  previous?: CatalogSnapshot,
): CatalogSnapshot {
  if (result.catalogSnapshot?.version === 1) {
    const { products, variants, variantProductId } = result.catalogSnapshot;
    return structuredClone({ products, variants, variantProductId });
  }
  // Older conversations already contain the actual tool response. Carry only
  // earlier product metadata from this same flow, never today's catalog.
  if (result.ui.card === "products") {
    const data = result.data;
    if (Array.isArray(data?.items)) {
      const variants = data.items.some(
        (v: any) => v.product_id || v.unit_price,
      );
      return structuredClone(
        variants
          ? {
              products: previous?.products,
              variants: data,
              variantProductId: data.items[0]?.product_id,
            }
          : { products: data },
      );
    }
    if (data?.id) return structuredClone({ products: { items: [data] } });
  }
  return structuredClone(previous ?? {});
}

export function withHistoricalCatalog(live: any, catalog?: CatalogSnapshot) {
  if (!live || !catalog) return live;
  return {
    ...live,
    products: catalog.products,
    variants: catalog.variants,
    variantProductId: catalog.variantProductId,
    historicalCatalog: true,
  };
}
