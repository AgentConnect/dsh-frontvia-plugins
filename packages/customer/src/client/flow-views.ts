type Ref = { sessionId: string; flowId: string };
type State = { value?: any; error?: Error };
type Entry = {
  ref: Ref;
  state: State;
  listeners: Set<(state: State) => void>;
  version: number;
  pending?: Promise<any>;
  queued?: boolean;
  timer?: ReturnType<typeof setInterval>;
};

/** One read-only live view per mounted shopping flow, shared by its cards. */
export class FlowViews {
  private entries = new Map<string, Entry>();
  constructor(
    private read: (ref: Ref) => Promise<any>,
    private interval = 15000,
    private active = () => true,
  ) {}
  private key(ref: Ref) {
    return JSON.stringify([ref.sessionId, ref.flowId]);
  }
  private emit(entry: Entry) {
    for (const listener of entry.listeners) listener(entry.state);
  }
  subscribe(ref: Ref, listener: (state: State) => void) {
    const key = this.key(ref);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        ref: { sessionId: ref.sessionId, flowId: ref.flowId },
        state: {},
        listeners: new Set(),
        version: 0,
      };
      this.entries.set(key, entry);
      if (this.interval)
        entry.timer = setInterval(() => {
          if (this.active()) void this.refresh(ref).catch(() => {});
        }, this.interval);
    }
    const own = entry;
    own.listeners.add(listener);
    listener(own.state);
    if (!own.state.value) void this.refresh(ref).catch(() => {});
    return () => {
      own.listeners.delete(listener);
      if (!own.listeners.size) {
        clearInterval(own.timer);
        if (this.entries.get(key) === own) this.entries.delete(key);
      }
    };
  }
  refresh(ref: Ref): Promise<any> {
    const key = this.key(ref),
      entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.pending) return entry.pending;
    const version = ++entry.version;
    const current = () =>
      this.entries.get(key) === entry && version === entry.version;
    const pending = Promise.resolve()
      .then(() => this.read(entry.ref))
      .then(
        (value) => {
          if (current()) {
            entry.state = { value };
            this.emit(entry);
          }
          return value;
        },
        (error) => {
          // A rejected ownership/login check must not leave private stale data visible.
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
      if (entry.queued && this.entries.get(key) === entry) {
        entry.queued = false;
        void this.refresh(ref).catch(() => {});
      }
    };
    void pending.then(done, done);
    return pending;
  }
  publish(ref: Ref, value: any) {
    const entry = this.entries.get(this.key(ref));
    if (!entry) return;
    ++entry.version; // An older read cannot overwrite a completed local action.
    entry.state = { value };
    this.emit(entry);
  }
  invalidate(ref: Ref) {
    const entry = this.entries.get(this.key(ref));
    if (!entry) return;
    if (entry.pending) {
      ++entry.version;
      entry.queued = true;
    } else void this.refresh(ref).catch(() => {});
  }
  refreshAll() {
    for (const e of this.entries.values()) this.invalidate(e.ref);
  }
  clear() {
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
