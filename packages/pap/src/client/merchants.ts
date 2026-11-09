export type MerchantSite = {
  id: string;
  label: string;
  domain: string;
  issuer?: string;
  service?: { store_id?: string };
};

/** Display grouping only. Never combine different bindings by hostname or label. */
export function groupMerchants<T extends MerchantSite>(sites: T[]) {
  const groups = new Map<
    string,
    { key: string; title: string; domain: string; storeId?: string; sites: T[] }
  >();
  for (const site of sites) {
    const storeId = site.service?.store_id;
    const key =
      site.issuer && storeId
        ? JSON.stringify([site.issuer, storeId])
        : JSON.stringify([site.id]);
    let group = groups.get(key);
    if (!group) {
      group = { key, title: "", domain: site.domain, storeId, sites: [] };
      groups.set(key, group);
    }
    group.sites.push(site);
    const label = site.label.trim();
    if (
      !group.title &&
      label &&
      label !== site.id &&
      !/JSON-RPC|transport|Frontvia merchant consultation|商家购物服务|商家咨询服务/i.test(
        label,
      )
    )
      group.title = label;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    title: group.title || group.domain || "商家服务",
  }));
}
