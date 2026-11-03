import https from "node:https";
import { isIP, BlockList } from "node:net";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { fail, PapError } from "./storage.js";
export type Target = {
  origin: string;
  address: string;
  port: number;
  connectPort?: number;
  systemCa?: boolean;
};
export type WireRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export type Transport = (request: WireRequest) => Promise<any>;
export function httpsTransport(targets: Target[], caFile?: string): Transport {
  return async ({
    url: raw,
    method,
    headers = {},
    body,
    signal,
    timeoutMs = 10000,
  }) => {
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
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          // A pinned dial port is a transport detail, not the HTTP authority.
          headers: { ...headers, Host: url.host },
          signal,
          agent: false,
          family: isIP(target.address),
          port: target.connectPort ?? target.port,
          ca: caFile && !target.systemCa ? readFileSync(caFile) : undefined,
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
            if (size > 1024 * 1024) res.destroy(new PapError("RESPONSE_LIMIT"));
            else chunks.push(b);
          });
          res.on("error", () => reject(new PapError("NETWORK_FAILURE")));
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
                  return resolve(value);
                return reject(new PapError(`HTTP_${res.statusCode}`));
              }
              resolve(value);
            } catch {
              reject(new PapError("INVALID_RESPONSE"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new PapError("NETWORK_TIMEOUT")));
      req.on("error", () =>
        reject(new PapError(signal?.aborted ? "ABORTED" : "NETWORK_UNCERTAIN")),
      );
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

/** User-imported origins use public DNS with a pinned address per request. */
export function publicTransport(
  origins: string[],
  resolve = lookup,
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
    const addresses = await resolve(url.hostname, {
      all: true,
      verbatim: true,
    }).catch(() => fail("NETWORK_FAILURE"));
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      fail("PUBLIC_HTTPS_REQUIRED");
    return httpsTransport([
      { origin: url.origin, address: addresses[0].address, port: 443 },
    ])(request);
  };
}
