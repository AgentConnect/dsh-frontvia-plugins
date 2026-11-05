import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, chmodSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

export class PapError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PapError";
  }
}
export function fail(code: string): never {
  throw new PapError(code);
}
export const canonical = (value: any): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`
      : JSON.stringify(value);

/** Only encrypted client state; never a source of remote authorization or transaction truth. */
export class Vault {
  private db: DatabaseSync;
  private lease: DatabaseSync;
  private key: Buffer;
  constructor(path: string, key: string) {
    this.key = Buffer.from(key, "base64url");
    if (this.key.length !== 32 || this.key.toString("base64url") !== key)
      fail("INVALID_STORAGE_KEY");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    for (const target of [path, `${path}.lease`])
      try {
        if (lstatSync(target).isSymbolicLink()) fail("UNSAFE_STORAGE_PATH");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    // A separate SQLite lease holds an OS-backed lock without delaying durable
    // state commits. It is released even after process death; never delete a lock.
    this.lease = new DatabaseSync(`${path}.lease`);
    chmodSync(`${path}.lease`, 0o600);
    try {
      this.lease.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
    } catch {
      this.lease.close();
      fail("PROFILE_STORAGE_IN_USE");
    }
    try {
      this.db = new DatabaseSync(path);
      chmodSync(path, 0o600);
      this.db.exec(
        "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
      );
    } catch (e) {
      this.lease.close();
      throw e;
    }
  }
  get<T>(id: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM records WHERE id=?").get(id);
    if (!row) return;
    const v = JSON.parse(String(row.value));
    const d = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(v.n, "base64url"),
    );
    d.setAAD(Buffer.from(id));
    d.setAuthTag(Buffer.from(v.t, "base64url"));
    return JSON.parse(
      Buffer.concat([
        d.update(Buffer.from(v.b, "base64url")),
        d.final(),
      ]).toString(),
    );
  }
  set(id: string, value: unknown) {
    const n = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, n);
    c.setAAD(Buffer.from(id));
    const b = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(
        id,
        JSON.stringify({
          n: n.toString("base64url"),
          t: c.getAuthTag().toString("base64url"),
          b: b.toString("base64url"),
        }),
      );
  }
  firstRecordId(): string | undefined {
    return this.db.prepare("SELECT id FROM records LIMIT 1").get()?.id as string | undefined;
  }
  keys(prefix: string): string[] {
    return this.db
      .prepare("SELECT id FROM records ORDER BY id")
      .all()
      .map((r) => String(r.id))
      .filter((k) => k.startsWith(prefix));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
    this.lease.close();
    this.key.fill(0);
  }
}
export class Serial {
  private queues = new Map<string, Promise<void>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    this.queues.set(key, done);
    await before;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(key) === done) this.queues.delete(key);
    }
  }
}
