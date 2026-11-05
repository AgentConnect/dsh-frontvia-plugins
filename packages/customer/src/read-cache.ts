/** Process-local display metadata only; never used to authorize business effects. */
export class ReadCache {
  private entries = new Map<string, { expires: number; value?: any; pending?: Promise<any> }>();
  constructor(private ttl = 30000, private clock = Date.now) {}
  clear() { this.entries.clear(); }
  async get<T>(key: string | undefined, read: () => Promise<T>, fresh = false): Promise<T> {
    if (!key || fresh) { this.clear(); return read(); }
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.clock()) {
      return structuredClone(existing.pending ? await existing.pending : existing.value);
    }
    if (this.entries.size >= 128) this.entries.delete(this.entries.keys().next().value!);
    const entry: { expires: number; value?: T; pending?: Promise<T> } = { expires: this.clock() + this.ttl };
    this.entries.set(key, entry);
    entry.pending = read();
    try {
      const value = await entry.pending;
      if (this.entries.get(key) === entry) { entry.value = structuredClone(value); delete entry.pending; }
      return structuredClone(value);
    } catch (error) { this.clear(); throw error; }
  }
}
/** Only concurrent readers share work. No result is retained across invocations. */
export class SharedReads {
  private pending = new Map<string, Promise<any>>();
  clear() { this.pending.clear(); }
  run<T>(key: string, read: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key); if (previous) return previous;
    const value = read(); this.pending.set(key, value);
    const done = () => { if (this.pending.get(key) === value) this.pending.delete(key); };
    void value.then(done, done); return value;
  }
}
