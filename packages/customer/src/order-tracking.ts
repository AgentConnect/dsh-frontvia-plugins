interface TrackingEvent {
  id: string;
  occurred_at: string;
  type: string;
  tracking_number?: string;
  tracking_url?: string;
  carrier?: string;
  description?: string;
  line_items: { id: string; quantity: number }[];
}

const carrierStates = new Set([
  "in_transit", "out_for_delivery", "available_for_pickup", "delivered", "tracking_update",
  "failed_attempt", "undeliverable", "returning_to_sender", "returned_to_sender",
]);

export function currentTrackingEvent(history: TrackingEvent[]): TrackingEvent {
  const latest = history[0]!;
  // A historical waybill can already have scans when the merchant records shipment.
  // Its carrier status still applies after recording or linking the waybill.
  return latest.type === "shipped" || latest.type === "tracking_corrected"
    ? history.find(event => carrierStates.has(event.type)) ?? latest
    : latest;
}

/** Project the append-only Order log for the buyer, including a single notice for each correction. */
export function buyerTrackingEvents(events: TrackingEvent[]): TrackingEvent[] {
  const unique = [...new Map(events.filter(event => typeof event?.id === "string").map(event => [event.id, event])).values()];
  const waybill = (event: TrackingEvent) => JSON.stringify([event.carrier ?? null, event.tracking_number]);
  const replaced = new Map<string, number>();
  const corrected = new Map<string, number>();
  for (const event of unique) {
    if (event.type !== "tracking_replaced" && event.type !== "tracking_corrected") continue;
    const times = event.type === "tracking_replaced" ? replaced : corrected;
    const key = waybill(event);
    times.set(key, Math.max(times.get(key) ?? -Infinity, Date.parse(event.occurred_at)));
  }
  return unique.flatMap(event => {
    if (event.type === "tracking_replaced") return [];
    const key = waybill(event);
    const retired = replaced.get(key);
    const visible = retired === undefined || ((corrected.get(key) ?? -Infinity) >= retired && Date.parse(event.occurred_at) >= retired);
    if (event.type === "tracking_corrected") {
      const {id, occurred_at, type, line_items} = event;
      return [{id, occurred_at, type, line_items, ...(visible ? {carrier: event.carrier, tracking_number: event.tracking_number} : {})}];
    }
    return visible ? [event] : [];
  });
}

export function orderShippingProgress(order: any, events: TrackingEvent[]) {
  if (!order.fulfillment?.expectations?.some((entry: any) => entry.method_type === "shipping")) return;
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event?.type !== "shipped" || typeof event.id !== "string" || seen.has(event.id)) continue;
    seen.add(event.id);
    for (const item of event.line_items ?? []) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return;
      counts.set(item.id, (counts.get(item.id) ?? 0) + item.quantity);
    }
  }
  const pending: {id: string; quantity: number}[] = [];
  let total = 0, shipped = 0;
  for (const line of order.line_items) {
    const quantity = line.quantity?.total;
    const sent = counts.get(line.id) ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || sent > quantity) return;
    total += quantity;
    shipped += sent;
    if (sent < quantity) pending.push({id: line.id, quantity: quantity - sent});
  }
  if (total) return {pending, status: shipped === total ? "shipped" : shipped ? "partially_shipped" : "unfulfilled"};
}

/** Standard Order events have no package ID. Only a carrier and waybill identify a timeline. */
export function orderShipments(events: TrackingEvent[]) {
  const groups = new Map<string, TrackingEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    if (!event || typeof event.id !== "string" || seen.has(event.id)) continue;
    if (event.type === "tracking_corrected" && !event.tracking_number) continue;
    seen.add(event.id);
    const key = event.tracking_number ? JSON.stringify([event.carrier ?? null, event.tracking_number]) : "order";
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, history]) => {
    history.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    const latest = currentTrackingEvent(history);
    const tracking = latest.tracking_number ? [{
      carrier: latest.carrier, tracking_number: latest.tracking_number,
      tracking_url: history.find(event => event.tracking_url)?.tracking_url,
    }] : [];
    return { id, tracking, status: latest.type === "tracking_corrected" ? "awaiting_tracking" : latest.type,
      occurred_at: latest.occurred_at, events: history.filter(event => event.type !== "tracking_corrected") };
  });
}


/** Used for a fresh wire Order and for local orders saved by an earlier client. */
export function projectOrderShipping(order: any) {
  const events = order.fulfillment?.events ?? [];
  const progress = orderShippingProgress(order, events);
  const visible = buyerTrackingEvents(events);
  if (order.fulfillment?.events) order.fulfillment = {...order.fulfillment, events: visible};
  order.shipments = orderShipments(visible);
  if (progress) {
    order.fulfillment_status = progress.status;
    order.pending_items = progress.pending;
  }
}
