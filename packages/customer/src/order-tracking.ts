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

/** Standard Order events have no package ID. Only a carrier and waybill identify a timeline. */
export function orderShipments(events: TrackingEvent[]) {
  const groups = new Map<string, TrackingEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    if (!event || typeof event.id !== "string" || seen.has(event.id)) continue;
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
    return { id, tracking, status: latest.type, occurred_at: latest.occurred_at, events: history };
  });
}
