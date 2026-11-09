export function productImages(product: any): { url: string; alt?: string }[] {
  const seen = new Set<string>();
  if (!Array.isArray(product?.images)) return [];
  return product.images.flatMap((image: any) => {
    try {
      if (typeof image?.url !== "string") return [];
      const url = new URL(image.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return [];
      seen.add(url.href);
      return [
        {
          url: url.href,
          ...(typeof image.alt === "string" ? { alt: image.alt } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}
export function productImage(product: any): string | undefined {
  return productImages(product)[0]?.url;
}
