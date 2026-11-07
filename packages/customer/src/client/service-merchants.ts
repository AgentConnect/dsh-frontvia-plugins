export type ServiceFlow = {
  flowId: string;
  sessionId: string;
  siteId: string;
  kind?: string;
  updatedAt: string;
  pending?: boolean;
};
export type ServiceSite = {
  id: string;
  label?: string;
  domain?: string;
  issuer?: string;
  service?: { store_id?: string };
  description?: { methods?: string[] };
};
export type Merchant = {
  key: string;
  title: string;
  domain?: string;
  storeId?: string;
  sites: ServiceSite[];
  flows: ServiceFlow[];
};
export type ServiceSelection = { merchantKey?: string; flowId?: string };
export const flowKind = (flow: ServiceFlow) =>
  flow.kind === "consultation" ? "consultation" : "shopping";
const title = (site: ServiceSite) => {
  const label = site.label?.trim();
  return label &&
    label !== site.id &&
    !/JSON-RPC|transport|Frontvia merchant consultation|商家购物服务|商家咨询服务/i.test(
      label,
    )
    ? label
    : undefined;
};

/** Group only by the complete issuer and store binding, never by display name
 * or hostname. Removed connections are hidden here without deleting history. */
export function serviceMerchants(
  sites: ServiceSite[],
  flows: ServiceFlow[],
): Merchant[] {
  const groups = new Map<string, Merchant>();
  const keys = new Map<string, string>();
  for (const site of sites) {
    if (
      !site.service?.store_id &&
      !site.description?.methods?.some((m) =>
        /^(commerce|consultation|knowledge)\./.test(m),
      ) &&
      !flows.some((f) => f.siteId === site.id)
    )
      continue;
    const key =
      site.issuer && site.service?.store_id
        ? JSON.stringify([site.issuer, site.service.store_id])
        : JSON.stringify([site.id]);
    keys.set(site.id, key);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: "",
        domain: site.domain,
        storeId: site.service?.store_id,
        sites: [],
        flows: [],
      };
      groups.set(key, group);
    }
    group.sites.push(site);
  }
  for (const flow of flows) {
    const key = keys.get(flow.siteId);
    if (key !== undefined) groups.get(key)?.flows.push(flow);
  }
  for (const group of groups.values()) {
    group.flows.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.flowId.localeCompare(b.flowId),
    );
    group.title ||=
      group.sites.map(title).find(Boolean) ?? group.domain ?? "商家服务";
  }
  return [...groups.values()].sort(
    (a, b) =>
      (b.flows[0]?.updatedAt ?? "").localeCompare(
        a.flows[0]?.updatedAt ?? "",
      ) ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
}

/** Saved IDs are preferences, not authority: only this account's returned
 * records can be selected, and a flow must belong to the selected merchant. */
export function resolveServiceSelection(
  merchants: Merchant[],
  saved: ServiceSelection = {},
) {
  const merchant =
    merchants.find((m) => m.key === saved.merchantKey) ?? merchants[0];
  const flow =
    merchant?.flows.find((f) => f.flowId === saved.flowId) ??
    merchant?.flows.find((f) => flowKind(f) === "shopping") ??
    merchant?.flows[0];
  return { merchant, flow };
}
const selectionKey = "frontvia-service-selection-v1";
export function readServiceSelection(
  storage: Pick<Storage, "getItem">,
): ServiceSelection {
  try {
    const saved = JSON.parse(storage.getItem(selectionKey) ?? "{}");
    return {
      merchantKey:
        typeof saved?.merchantKey === "string" ? saved.merchantKey : undefined,
      flowId: typeof saved?.flowId === "string" ? saved.flowId : undefined,
    };
  } catch {
    return {};
  }
}
export function saveServiceSelection(
  storage: Pick<Storage, "setItem" | "removeItem">,
  selection?: ServiceSelection,
) {
  try {
    if (selection) storage.setItem(selectionKey, JSON.stringify(selection));
    else storage.removeItem(selectionKey);
  } catch {
    /* Selection still works when browser storage is unavailable. */
  }
}
