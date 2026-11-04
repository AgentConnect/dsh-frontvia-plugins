import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { httpsTransport } from "../src/network.js";

test("pinned HTTPS verifies host certificate, preserves RPC business errors and separates system CA from fixture CA", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pap-network-")),
    key = join(dir, "key.pem"),
    cert = join(dir, "cert.pem"),
    cnf = join(dir, "cert.cnf");
  writeFileSync(
    cnf,
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=merchant.test\n[ext]\nsubjectAltName=DNS:merchant.test\nbasicConstraints=critical,CA:TRUE\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-config",
      cnf,
    ],
    { stdio: "ignore" },
  );
  let originalBytes = 700 * 1024;
  const server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      assert.equal(req.headers.host, "merchant.test");
      if (req.url === "/original") {
        res.writeHead(200, { "content-type": "application/json" });
        // Stream the actual Base64 JSON envelope through the bounded reader.
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: "original",
          result: {
            data: {
              filename: "large.pdf",
              size: originalBytes,
              bytes_base64: Buffer.alloc(originalBytes, 0xab).toString(
                "base64",
              ),
              sha256: "a".repeat(64),
              content_type: "application/pdf",
            },
          },
        });
        for (let offset = 0; offset < body.length; offset += 8192)
          res.write(body.slice(offset, offset + 8192));
        res.end();
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "original",
          error: {
            code: -32000,
            message: "VERSION_CONFLICT",
            data: { type: "VERSION_CONFLICT" },
          },
        }),
      );
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const target = {
    origin: "https://merchant.test",
    address: "127.0.0.1",
    port: 443,
    connectPort: port,
  };
  const request = {
    url: target.origin + "/rpc",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "original",
      method: "consultation.messages.submit",
      params: {},
    }),
  };
  try {
    const wire = httpsTransport([target], cert);
    const original = { ...request, url: target.origin + "/original" };
    const maxResponseBytes = 4 * Math.ceil((1024 * 1024) / 3) + 16 * 1024;
    for (const size of [700 * 1024, 900 * 1024, 1024 * 1024]) {
      originalBytes = size;
      const downloaded = await wire({ ...original, maxResponseBytes });
      assert.equal(
        Buffer.from(downloaded.result.data.bytes_base64, "base64").length,
        size,
      );
    }
    await assert.rejects(wire(original), /RESPONSE_LIMIT/);
    originalBytes = 1100 * 1024;
    await assert.rejects(
      wire({ ...original, maxResponseBytes }),
      /RESPONSE_LIMIT/,
    );
    for (const limit of [Infinity, NaN, -1, 0, 2 * 1024 * 1024 + 1])
      await assert.rejects(
        wire({ ...original, maxResponseBytes: limit }),
        /INVALID_RESPONSE_LIMIT/,
      );
    const value = await wire(request);
    assert.equal(value.error.data.type, "VERSION_CONFLICT");
    assert.equal(value.id, "original");
    await assert.rejects(
      httpsTransport(
        [target],
        cert,
      )({
        ...request,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      /HTTP_400/,
    );
    await assert.rejects(
      httpsTransport([{ ...target, systemCa: true }], cert)(request),
      /NETWORK_UNCERTAIN/,
    );
    await assert.rejects(
      httpsTransport(
        [{ ...target, origin: "https://other.test" }],
        cert,
      )({ ...request, url: "https://other.test/rpc" }),
      /NETWORK_UNCERTAIN/,
    );
    await assert.rejects(
      httpsTransport(
        [target],
        cert,
      )({ ...request, url: "https://unapproved.test/rpc" }),
      /TARGET_NOT_APPROVED/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
