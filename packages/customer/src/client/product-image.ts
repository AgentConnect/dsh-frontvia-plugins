export function productImage(product: any): string | undefined {
  const url = product?.images?.[0]?.url;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
