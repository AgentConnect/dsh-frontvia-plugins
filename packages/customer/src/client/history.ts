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
        seq: event.seq,
        callId: String(m.source?.callId ?? d.subCallId ?? event.seq),
      }
    : null;
}
const add = (state: any, event: any) => {
  const c = card(event);
  return c
    ? {
        turn: c.turn,
        cards: [
          ...(state?.cards ?? []).filter((x: any) => x.callId !== c.callId),
          c,
        ].slice(-8),
      }
    : state;
};
export const historyDefinition = {
  kind: "frontvia-customer-cards",
  match(event: any) {
    return card(event) ? { id: String(event.data.turn), role: "start" } : null;
  },
  start(_c: any, m: any) {
    return add(null, m.event);
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
