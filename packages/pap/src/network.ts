import https from "node:https";
import { createHash } from "node:crypto";
import { isIP, BlockList } from "node:net";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { readFileSync } from "node:fs";
import { fail, PapError } from "./storage.js";
export type Target = {
  origin: string;
  address: string;
  port: number;
  connectPort?: number;
  systemCa?: boolean;
  /** Verified DNS answer set; internal transport identity, not authorization. */
  addressSet?: string;
};
export type WireRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
};
export type Transport = (request: WireRequest) => Promise<any>;
/** Owned by one PAP service. Pools never bypass per-request destination checks. */
export class PinnedAgents {
  private resolver?: PublicHostResolver;
  resolve(hostname: string, options: { all: true; verbatim: true }) {
    return (this.resolver ??= new PublicHostResolver(this)).resolve(
      hostname,
      options,
    );
  }
  private pools = new Map<string, { key: string; agent: https.Agent }>();
  private retired = new Map<https.Agent, ReturnType<typeof setTimeout>>();
  get(target: Target, ca?: Buffer) {
    const key = JSON.stringify([
      target.address,
      target.port,
      target.connectPort,
      target.addressSet,
      ca ? createHash("sha256").update(ca).digest("hex") : "system",
    ]);
    const previous = this.pools.get(target.origin);
    if (previous?.key === key) return previous.agent;
    this.invalidate(target.origin);
    if (this.pools.size >= 32) this.invalidate(this.pools.keys().next().value!);
    const agent = new https.Agent({
      keepAlive: true,
      maxSockets: 4,
      maxFreeSockets: 2,
      timeout: 30000,
      scheduling: "lifo",
    });
    this.pools.set(target.origin, { key, agent });
    return agent;
  }
  invalidate(origin: string) {
    const agent = this.pools.get(origin)?.agent;
    this.pools.delete(origin);
    if (!agent) return;
    // Stop reusing the old identity without interrupting already admitted
    // requests (including the agent's bounded queue). Node calls this hook only
    // after queued requests have been assigned, when a socket becomes idle.
    agent.keepSocketAlive = () => false;
    for (const sockets of Object.values(agent.freeSockets))
      for (const socket of sockets ?? []) socket.destroy();
    // Every request already has a <=45s absolute deadline. Keep shutdown bounded
    // even if a peer never finishes or a socket fails to emit its final event.
    const timer = setTimeout(() => {
      agent.destroy();
      this.retired.delete(agent);
    }, 50000);
    timer.unref();
    this.retired.set(agent, timer);
  }
  close() {
    this.resolver?.clear();
    for (const { agent } of this.pools.values()) agent.destroy();
    this.pools.clear();
    for (const [agent, timer] of this.retired) {
      clearTimeout(timer);
      agent.destroy();
    }
    this.retired.clear();
  }
}
export function httpsTransport(
  targets: Target[],
  caFile?: string,
  agents = new PinnedAgents(),
): Transport {
  return async ({
    url: raw,
    method,
    headers = {},
    body,
    signal,
    timeoutMs = 10000,
    maxResponseBytes = 1024 * 1024,
  }) => {
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 1 ||
      maxResponseBytes > 2 * 1024 * 1024
    )
      fail("INVALID_RESPONSE_LIMIT");
    const url = new URL(raw),
      target = targets.find((t) => t.origin === url.origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !target ||
      !isIP(target.address) ||
      target.port !== Number(url.port || 443)
    )
      fail("TARGET_NOT_APPROVED");
    if (signal?.aborted) fail("ABORTED");
    const ca = caFile && !target.systemCa ? readFileSync(caFile) : undefined;
    return new Promise((resolve, reject) => {
      let settled = false,
        deadline: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
      };
      const succeed = (value: unknown) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(value);
        }
      };
      const failed = (error: Error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      };
      const abort = () => {
        failed(new PapError("ABORTED"));
        req.destroy();
      };
      const timeout = () => {
        failed(new PapError("NETWORK_UNCERTAIN"));
        req.destroy();
      };
      const req = https.request(
        url,
        {
          method,
          // A pinned dial port is a transport detail, not the HTTP authority.
          headers: { ...headers, Host: url.host },
          signal,
          agent: agents.get(target, ca),
          family: isIP(target.address),
          port: target.connectPort ?? target.port,
          ca,
          rejectUnauthorized: true,
          timeout: Math.min(45000, Math.max(1000, timeoutMs)),
          lookup: (_host, _options, cb) =>
            cb(null, target.address, isIP(target.address)),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (b: Buffer) => {
            size += b.length;
            if (size > maxResponseBytes) {
              const error = new PapError("RESPONSE_LIMIT");
              failed(error);
              res.destroy(error);
            } else chunks.push(b);
          });
          res.on("error", (error) =>
            failed(
              error instanceof PapError
                ? error
                : new PapError("NETWORK_FAILURE"),
            ),
          );
          res.on("end", () => {
            try {
              const value = chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString())
                : {};
              if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
                if (
                  headers["Content-Type"] === "application/json" &&
                  value.jsonrpc === "2.0" &&
                  value.error &&
                  typeof value.id === "string"
                )
                  return succeed(value);
                return failed(new PapError(`HTTP_${res.statusCode}`));
              }
              succeed(value);
            } catch {
              const status = res.statusCode ?? 0;
              failed(
                new PapError(
                  status >= 400 ? `HTTP_${status}` : "INVALID_RESPONSE",
                ),
              );
            }
          });
        },
      );
      // ClientRequest may not emit error until a pooled socket becomes available.
      // Settle deadline/cancellation directly, then destroy to prevent queued I/O.
      deadline = setTimeout(
        timeout,
        Math.min(45000, Math.max(1000, timeoutMs)),
      );
      deadline.unref();
      req.on("close", cleanup);
      req.on("timeout", timeout);
      req.on("error", () =>
        failed(new PapError(signal?.aborted ? "ABORTED" : "NETWORK_UNCERTAIN")),
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      if (body) req.write(body);
      req.end();
    });
  };
}

const private4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  private4.addSubnet(address, prefix, "ipv4");
const public6 = new BlockList();
public6.addSubnet("2000::", 3, "ipv6");
const reserved6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  reserved6.addSubnet(address, prefix, "ipv6");
export const isPublicAddress = (address: string) =>
  isIP(address) === 4
    ? !private4.check(address, "ipv4")
    : isIP(address) === 6 &&
      public6.check(address, "ipv6") &&
      !reserved6.check(address, "ipv6");

// publicTransport checks the approved origin before resolving it. A proxy's
// all-Fake-IP answer can be replaced with public DNS; private/mixed answers and
// literal IPs must retain the normal rejection path. TLS still binds the host.
const frontviaAccountHost = "frontvia-shop.agent-connect.cn";
export const frontviaAccountOrigin = "https://" + frontviaAccountHost;
/** Cache only the slow Fake-IP fallback. System DNS and destination validation
 * still run on every request, so a private/mixed answer cannot use an old pin. */
export class PublicHostResolver {
  private entries = new Map<
    string,
    { expires: number; addresses: LookupAddress[] }
  >();
  private pending = new Map<string, Promise<LookupAddress[]>>();
  private generation = 0;
  constructor(
    private agents: PinnedAgents,
    private clock = Date.now,
  ) {}
  clear() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }
  async resolve(
    hostname: string,
    options: { all: true; verbatim: true },
  ): Promise<LookupAddress[]> {
    const addresses = await lookup(hostname, options);
    if (
      isIP(hostname) ||
      !addresses.length ||
      !addresses.every(
        (a) => isIP(a.address) === 4 && /^198\.(18|19)\./.test(a.address),
      )
    ) {
      this.entries.delete(hostname);
      return addresses;
    }
    const cached = this.entries.get(hostname);
    if (cached && cached.expires > this.clock())
      return structuredClone(cached.addresses);
    this.entries.delete(hostname);
    const existing = this.pending.get(hostname);
    if (existing) return structuredClone(await existing);
    const generation = this.generation;
    const request = this.fallback(hostname, generation);
    this.pending.set(hostname, request);
    try {
      return structuredClone(await request);
    } finally {
      if (this.pending.get(hostname) === request) this.pending.delete(hostname);
    }
  }
  private async fallback(
    hostname: string,
    generation: number,
  ): Promise<LookupAddress[]> {
    const resolver = await lookup("dns.google");
    const dns = httpsTransport(
      [{ origin: "https://dns.google", address: resolver.address, port: 443 }],
      undefined,
      this.agents,
    );
    const reply = await dns({
      url:
        "https://dns.google/resolve?" +
        new URLSearchParams({ name: hostname, type: "A" }),
      method: "GET",
      timeoutMs: 4000,
      maxResponseBytes: 16384,
    });
    if (reply?.Status !== 0 || !Array.isArray(reply.Answer)) return [];
    const answers = reply.Answer.filter(
      (r: any) =>
        r?.type === 1 &&
        typeof r.name === "string" &&
        r.name.replace(/\.$/, "") === hostname &&
        typeof r.data === "string" &&
        isIP(r.data) === 4,
    );
    const addresses = answers.map((r: any) => ({ address: r.data, family: 4 }));
    // Missing/zero/invalid TTL means no caching. Never cache a partially private answer.
    const ttl = Math.min(
      60,
      ...answers.map((r: any) =>
        Number.isFinite(r.TTL) && r.TTL > 0 ? r.TTL : 0,
      ),
    );
    if (
      addresses.length &&
      addresses.every((a: LookupAddress) => isPublicAddress(a.address)) &&
      ttl > 0 &&
      generation === this.generation
    ) {
      if (this.entries.size >= 64)
        this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(hostname, {
        expires: this.clock() + ttl * 1000,
        addresses,
      });
    }
    return addresses;
  }
}
export async function resolvePublicHost(
  hostname: string,
  options: { all: true; verbatim: true },
): Promise<LookupAddress[]> {
  const agents = new PinnedAgents();
  try {
    return await agents.resolve(hostname, options);
  } finally {
    agents.close();
  }
}

/** User-imported origins use public DNS with a pinned address per request. */
export function publicTransport(
  origins: string[],
  resolve: typeof resolvePublicHost | undefined = undefined,
  agents = new PinnedAgents(),
): Transport {
  return async (request) => {
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !origins.includes(url.origin) ||
      (url.port && url.port !== "443")
    )
      fail("TARGET_NOT_APPROVED");
    const addresses = await (
      resolve ?? ((host, options) => agents.resolve(host, options))
    )(url.hostname, {
      all: true,
      verbatim: true,
    }).catch(() => fail("NETWORK_FAILURE"));
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicAddress(a.address))
    ) {
      agents.invalidate(url.origin);
      fail("PUBLIC_HTTPS_REQUIRED");
    }
    // DNS answer order alone is not a new destination/configuration generation.
    const verified = [...new Set(addresses.map((a) => a.address))].sort();
    return httpsTransport(
      [
        {
          origin: url.origin,
          address: verified[0],
          port: 443,
          addressSet: JSON.stringify(verified),
        },
      ],
      undefined,
      agents,
    )(request);
  };
}
