import https from "node:https";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { fail, PapError } from "./storage.js";
export type Target = {
  origin: string;
  address: string;
  port: number;
  connectPort?: number;
};
export type WireRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};
export type Transport = (request: WireRequest) => Promise<any>;
export function httpsTransport(targets: Target[], caFile?: string): Transport {
  return async ({ url: raw, method, headers = {}, body, signal }) => {
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
          headers,
          signal,
          agent: false,
          family: isIP(target.address),
          port: target.connectPort ?? target.port,
          ca: caFile ? readFileSync(caFile) : undefined,
          rejectUnauthorized: true,
          timeout: 10000,
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
            if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300)
              return reject(new PapError(`HTTP_${res.statusCode}`));
            try {
              resolve(
                chunks.length
                  ? JSON.parse(Buffer.concat(chunks).toString())
                  : {},
              );
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
