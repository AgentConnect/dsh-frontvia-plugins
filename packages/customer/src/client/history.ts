import { catalogSnapshot } from "./catalog-history.js";
/** Only pass the UI route's public reference, never list-row metadata. */
export function shoppingReference(flow: {
  flowId: string;
  sessionId: string;
  kind?: string;
}) {
  return {
    flowId: flow.flowId,
    sessionId: flow.sessionId,
    card:
      flow.kind === "consultation"
        ? ("consultation" as const)
        : ("cart" as const),
  };
}

export function readResult(message: any) {
  for (const b of message?.content ?? []) {
    if (b.type === "text") {
      try {
        const v = JSON.parse(b.text);
        if (
          v?.ui?.kind === "frontvia-customer" &&
          typeof v.ui.flowId === "string" &&
          typeof v.ui.sessionId === "string"
        )
          return v;
      } catch {}
    }
  }
  return null;
}
function card(event: any) {
  const d = event.data;
  const m =
    event.type === "tool/result"
      ? d?.message
      : event.type === "tool/ptc-dispatch"
        ? d
        : null;
  const v = readResult(m);
  return v && Number.isInteger(d.turn)
    ? {
        turn: d.turn,
        ui: v.ui,
        result: v,
        seq: event.seq,
        callId: String(m.source?.callId ?? d.subCallId ?? event.seq),
      }
    : null;
}
const add = (state: any, event: any) => {
  const c = card(event);
  if (!c) return state;
  const key = JSON.stringify([c.ui.sessionId, c.ui.flowId]);
  const catalog = catalogSnapshot(c.result, state?.catalogs?.[key]);
  const { result: _, ...reference } = c;
  const catalogs = { ...state?.catalogs, [key]: catalog };
  // This is a bounded reconstruction aid, not another transcript store.
  for (const old of Object.keys(catalogs).slice(0, -16)) delete catalogs[old];
  return c
    ? {
        turn: c.turn,
        catalogs,
        cards: [
          ...(state?.cards ?? []).filter((x: any) => x.callId !== c.callId),
          { ...reference, catalog },
        ].slice(-8),
      }
    : state;
};
export const historyDefinition = {
  kind: "frontvia-customer-cards",
  match(event: any) {
    return card(event) ? { id: String(event.data.turn), role: "start" } : null;
  },
  start(_c: any, m: any, reader?: any) {
    return add(
      {
        catalogs: reader?.previous("frontvia-customer-cards")?.state?.catalogs,
      },
      m.event,
    );
  },
  update(c: any, m: any) {
    return add(c.state, m.event);
  },
  buildLocationData(c: any, scope: any, previous: any) {
    if (scope !== "turn" || !c.state) return null;
    if (previous?.value === c.state) return previous;
    return {
      kind: "turn",
      turn: c.state.turn,
      key: "frontvia-customer-cards",
      value: c.state,
    };
  },
};
