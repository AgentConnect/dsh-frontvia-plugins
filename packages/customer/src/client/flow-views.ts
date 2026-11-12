import type { ViewScope } from "../view-scope.js";
type Ref = { sessionId: string; flowId: string };
type State = { value?: any; error?: Error };
type Interest = { scope?: () => ViewScope; visible?: () => boolean };
type Entry = {
  ref: Ref;
  state: State;
  listeners: Map<(state: State) => void, Interest>;
  version: number;
  pending?: Promise<any>;
  queued?: boolean;
  queuedScopes?: ViewScope[];
  holds: number;
  ticks: number;
  timer?: ReturnType<typeof setInterval>;
};
/** Number of 15-second ticks between refreshes. Settled views require explicit refresh. */
export function pollCadence(data: any, scopes: ViewScope[]): number {
  if (!data) return 0;
  if (data.pending || data.cancelPending) return 1;
  if (
    !scopes.some((s) =>
      ["all", "checkout", "order", "order-detail"].includes(s),
    )
  )
    return 0;
  const orders = [
    ...(scopes.some((s) => s !== "order-detail") ? [data.order] : []),
    ...(scopes.includes("order-detail") ? [data.viewedOrder] : []),
  ].filter(Boolean);
  const cadence = (order: any) => {
    if(order.business_status)return ["completed","canceled","closed_refunded","archived"].includes(order.business_status)?0:order.business_status==="closing"?1:4;
    const payment =
      order.payment?.status ?? data.checkout?.payment_summary?.status;
    if (
      order.status === "canceled" ||
      payment === "voided" ||
      payment === "refunded"
    )
      return 0;
    if (
      ["paid", "captured", "not_required", "partially_refunded"].includes(
        payment,
      )
    )
      return ["delivered"].includes(order.fulfillment_status) ||
        order.status === "completed"
        ? 0
        : 4;
    return 1;
  };
  const rates = orders.map(cadence).filter((n) => n > 0);
  if (rates.length) return Math.min(...rates);
  return !orders.length &&
    data.intent?.submitted &&
    data.checkout?.status !== "canceled"
    ? 1
    : 0;
}

/** Same-flow cards share results; only visible interests drive reads and polling. */
export class FlowViews {
  private entries = new Map<string, Entry>();
  private snapshots = new Map<string, { expires: number; state: State }>();
  constructor(
    private read: (ref: Ref & { scopes: ViewScope[] }) => Promise<any>,
    private interval = 15000,
    private active = () => true,
    private clock = Date.now,
  ) {}
  private key(ref: Ref) {
    return JSON.stringify([ref.sessionId, ref.flowId]);
  }
  private scopes(entry: Entry): ViewScope[] {
    return [
      ...new Set(
        [...entry.listeners.values()]
          .filter((v) => v.visible?.() !== false)
          .map((v) => v.scope?.() ?? "checkout"),
      ),
    ];
  }
  private emit(entry: Entry) {
    for (const listener of entry.listeners.keys()) listener(entry.state);
  }
  subscribe(
    ref: Ref,
    listener: (state: State) => void,
    interest: Interest = {},
  ) {
    const key = this.key(ref);
    let entry = this.entries.get(key);
    let restored = false;
    if (!entry) {
      const snapshot = this.snapshots.get(key);
      this.snapshots.delete(key);
      const state =
        snapshot && snapshot.expires > this.clock() ? snapshot.state : {};
      restored = !!state.value;
      entry = {
        ref: { sessionId: ref.sessionId, flowId: ref.flowId },
        state,
        listeners: new Map(),
        version: 0,
        holds: 0,
        ticks: 0,
      };
      this.entries.set(key, entry);
      const own = entry;
      if (this.interval)
        own.timer = setInterval(() => {
          const scopes = this.scopes(own),
            cadence = pollCadence(own.state.value, scopes);
          if (!this.active() || own.holds || !scopes.length || !cadence) {
            own.ticks = 0;
            return;
          }
          if (++own.ticks >= cadence) {
            own.ticks = 0;
            void this.refresh(ref).catch(() => {});
          }
        }, this.interval);
    }
    const own = entry;
    own.listeners.set(listener, interest);
    listener(own.state);
    if ((!own.state.value || restored) && interest.visible?.() !== false)
      void this.refresh(ref).catch(() => {});
    return () => {
      own.listeners.delete(listener);
      if (!own.listeners.size) {
        clearInterval(own.timer);
        if (this.entries.get(key) === own) {
          this.entries.delete(key);
          // Short-lived display only; remount always revalidates. Account changes
          // clear both maps. Bound retained snapshots to roughly four MiB.
          if (
            own.state.value &&
            !own.state.error &&
            JSON.stringify(own.state.value).length <= 256 * 1024
          ) {
            if (this.snapshots.size >= 8)
              this.snapshots.delete(this.snapshots.keys().next().value!);
            this.snapshots.set(key, {
              expires: this.clock() + 60000,
              state: own.state,
            });
          }
        }
      }
    };
  }
  refresh(ref: Ref, requestedScopes?: ViewScope[]): Promise<any> {
    const key = this.key(ref),
      entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.pending) return entry.pending;
    const scopes = requestedScopes ?? this.scopes(entry);
    if (entry.state.value?.pending && !scopes.includes("checkout"))
      scopes.push("checkout");
    if (!scopes.length) return Promise.resolve(entry.state.value);
    const version = ++entry.version;
    const current = () =>
      this.entries.get(key) === entry && version === entry.version;
    const pending = Promise.resolve()
      .then(() => this.read({ ...entry.ref, scopes }))
      .then(
        (value) => {
          if (current()) {
            entry.state = { value };
            this.emit(entry);
          }
          return value;
        },
        (error) => {
          this.snapshots.delete(key);
          // Never retain private data after an ownership/login rejection.
          if (current()) {
            entry.state = { error };
            this.emit(entry);
          }
          throw error;
        },
      );
    entry.pending = pending;
    const done = () => {
      if (entry.pending === pending) entry.pending = undefined;
      this.drain(entry);
    };
    void pending.then(done, done);
    return pending;
  }
  private drain(entry: Entry) {
    if (
      entry.queued &&
      !entry.holds &&
      !entry.pending &&
      this.entries.get(this.key(entry.ref)) === entry
    ) {
      entry.queued = false;
      const scopes = entry.queuedScopes;
      entry.queuedScopes = undefined;
      void this.refresh(entry.ref, scopes).catch(() => {});
    }
  }
  /** Do not enqueue new background reads while an owner operation is in progress. */
  hold(ref: Ref) {
    const entry = this.entries.get(this.key(ref));
    if (entry) entry.holds++;
    return () => {
      if (entry) {
        entry.holds = Math.max(0, entry.holds - 1);
        entry.ticks = 0;
        this.drain(entry);
      }
    };
  }
  publish(ref: Ref, value: any) {
    this.snapshots.delete(this.key(ref));
    const entry = this.entries.get(this.key(ref));
    if (!entry) return;
    ++entry.version;
    entry.state = { value };
    entry.ticks = 0;
    this.emit(entry);
  }
  invalidate(ref: Ref, scopes?: ViewScope[]) {
    this.snapshots.delete(this.key(ref));
    const entry = this.entries.get(this.key(ref));
    if (!entry) return;
    if (entry.pending || entry.holds) {
      ++entry.version;
      entry.queued = true;
      if (scopes)
        entry.queuedScopes = [
          ...new Set([...(entry.queuedScopes ?? []), ...scopes]),
        ];
    } else void this.refresh(ref, scopes).catch(() => {});
  }
  refreshAll() {
    for (const entry of this.entries.values())
      if (this.scopes(entry).length) this.invalidate(entry.ref);
  }
  clear() {
    this.snapshots.clear();
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      clearInterval(entry.timer);
      ++entry.version;
      entry.state = {};
      this.emit(entry);
    }
  }
}
