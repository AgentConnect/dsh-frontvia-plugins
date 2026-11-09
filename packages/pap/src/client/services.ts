export type ServiceSite = {
  id: string;
  label: string;
  domain: string;
  issuer?: string;
};
export function groupServices<T extends ServiceSite>(sites: T[]) {
  const groups = new Map<
    string,
    { key: string; title: string; domain: string; sites: T[] }
  >();
  for (const site of sites) {
    const key = site.issuer
      ? JSON.stringify([site.domain, site.issuer])
      : JSON.stringify([site.id]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: site.domain,
        domain: site.issuer ?? site.domain,
        sites: [],
      };
      groups.set(key, group);
    }
    group.sites.push(site);
  }
  return [...groups.values()];
}
