import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { httpsTransport, PinnedAgents } from "../src/network.js";

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
  let writes=0;
  let appliedSlow=0, slowAdmitted:(()=>void)|undefined, releaseSlow:(()=>void)|undefined;
  const held:(()=>void)[]=[];let holdReady:(()=>void)|undefined,holdArrivals=0;
  let originalBytes = 700 * 1024;
  const sockets=new Set<unknown>();
  const server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      assert.equal(req.headers.host, "merchant.test");
      sockets.add(req.socket);
      if(req.url==='/hold'){
        holdArrivals++;held.push(()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
        if(held.length===4)holdReady?.();return;
      }
      if(req.url==='/slow-write'){
        appliedSlow++;releaseSlow=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({applied:true}));};
        slowAdmitted?.();return;
      }
      if(req.url==="/uncertain"){writes++;req.socket.destroy();return;}
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
  const agents=new PinnedAgents();
  try {
    const wire = httpsTransport([target], cert, agents);
    const original = { ...request, url: target.origin + "/original" };
    await wire(request);await wire(request);
    assert.equal(sockets.size,1,'sequential requests reuse one TLS connection');
    await Promise.all(Array.from({length:12},()=>wire(request)));
    assert(sockets.size<=4,'per-authority concurrency is bounded');
    const beforeRotation=sockets.size;
    await httpsTransport([{...target,addressSet:'changed-verified-dns-set'}],cert,agents)(request);
    assert.equal(sockets.size,beforeRotation+1,'changed DNS identity cannot reuse an old socket');
    for(const reason of ['dns-change','pool-eviction']){
      const admitted=new Promise<void>(resolve=>{slowAdmitted=resolve;});
      const pending=wire({...request,url:target.origin+'/slow-write'});
      await admitted;
      const previous:number=sockets.size;
      if(reason==='pool-eviction'){
        for(let i=0;i<32;i++)agents.get({...target,origin:`https://idle-${i}.test`},readFileSync(cert));
        await wire(request);
      }else{
        await httpsTransport([{...target,addressSet:'new-verified-address-set'}],cert,agents)(request);
      }
      assert.equal(sockets.size,previous+1,'new requests must use a replacement pool');
      releaseSlow!();assert.deepEqual(await pending,{applied:true},`${reason} must preserve an admitted write`);
    }
    assert.equal(appliedSlow,2,'retiring pools never duplicates an admitted write');
    const occupied=new Promise<void>(resolve=>{holdReady=resolve;});
    const blocking=Array.from({length:4},()=>wire({...request,url:target.origin+'/hold',timeoutMs:5000}));
    await occupied;
    const controller=new AbortController();
    const cancelled=wire({...request,url:target.origin+'/hold',signal:controller.signal}).then(()=> 'sent',e=>e.code);
    controller.abort();
    let guard:ReturnType<typeof setTimeout>|undefined;
    try {
      assert.equal(await Promise.race([cancelled,new Promise(resolve=>{guard=setTimeout(()=>resolve('still queued'),300);})]),'ABORTED');
    } finally {clearTimeout(guard);}
    const started=performance.now();
    await assert.rejects(wire({...request,url:target.origin+'/hold',timeoutMs:1000}),/NETWORK_UNCERTAIN/);
    assert(performance.now()-started<1800,'deadline must settle while all sockets remain busy');
    assert.equal(holdArrivals,4);
    for(const release of held)release();
    await Promise.all(blocking);await wire(request);
    assert.equal(holdArrivals,4,'cancelled/timed-out queued writes must never be sent later');
    await assert.rejects(wire({...request,url:target.origin+'/uncertain'}),/NETWORK_UNCERTAIN/);
    assert.equal(writes,1,'a lost response never automatically replays a write');

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
    for (const limit of [Infinity, NaN, -1, 0, 8 * 1024 * 1024 + 1])
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
    agents.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
