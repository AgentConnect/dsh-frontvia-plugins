import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { Vault, PapError } from "dsh-pap/core";
import { CustomerService, type PapPort } from "../src/core.js";
import { schemas } from "../src/tools.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "customer-consultation-")),
    key = randomBytes(32).toString("base64url"),
    db = join(dir, "state.sqlite");
  const methods = [
    "capabilities.get",
    "messages.submit",
    "conversations.get",
    "help.request",
    "knowledge.access",
    "knowledge.search",
    "knowledge.lookup",
    "knowledge.source",
    "knowledge.original",
    "answers.accept",
    "answers.get",
  ].map((m) => `consultation.${m}`);
  const locator = {
      collection_id: "public",
      document_id: "returns",
      version: 1,
      index_generation: 4,
      ordinal: 0,
    },
    bytes = Buffer.from("Seven day return policy");
  const remote = {
    calls: [] as any[],
    allowed: true,
    personalAccess: true,
    knowledge: true,
    current: true,
    lose: false,
    reject: "",
    tamper: false,
    submits: 0,
    convo: null as any,
    ops: new Map<string, any>(),
  };
  const respond = (data: any) => ({ result: { data: structuredClone(data) } });
  const pap = {
    apiVersion: 1,
    sites: () => [
      {
        id: "consult",
        label: "Merchant",
        domain: "shop.test",
        issuer: "https://shop.test/companies/a",
        resource: "https://shop.test/consultation/rpc",
        description: {
          profile: "frontvia.merchant_consultation.v1",
          methods,
          openapiUrl: "https://shop.test/openapi.json",
          title: "Consultation",
        },
      },
    ],
    canAccess: () => remote.personalAccess,
    identity: () => ({
      clientId: "client",
      userId: "person",
      issuer: "issuer",
      resource: "resource",
      signedIn: false,
    }),
    status: () => [],
    connect: async () => ({ connectionRef: "consult-connection" }),
    request: async (_ref: string, method: string, params: any) => {
      remote.calls.push({ method, params: structuredClone(params) });
      if (method === "consultation.capabilities.get")
        return respond({
          profile: "frontvia.merchant_consultation.v1",
          availability: "supported",
          knowledge: remote.knowledge ? "supported" : "unavailable",
          methods: remote.allowed
            ? [
                "consultation.messages.submit",
                "consultation.conversations.get",
                "consultation.help.request",
              ]
            : [],
        });
      if (
        method === "consultation.messages.submit" ||
        method === "consultation.help.request"
      ) {
        if (remote.reject)
          return {
            error: { message: remote.reject, data: { type: remote.reject } },
          };
        if (remote.ops.has(params.idempotency_key))
          return respond(remote.ops.get(params.idempotency_key));
        if (remote.convo) {
          assert.equal(params.conversation_id, remote.convo.conversation_id);
          if (method.endsWith("submit"))
            assert.equal(params.expected_version, remote.convo.version);
        }
        remote.submits++;
        remote.convo = {
          conversation_id: "conversation",
          version: remote.submits,
          status: "pending",
          messages: [],
        };
        remote.ops.set(params.idempotency_key, structuredClone(remote.convo));
        if (remote.lose) {
          remote.lose = false;
          throw new PapError("NETWORK_UNCERTAIN");
        }
        return respond(remote.convo);
      }
      if (method === "consultation.conversations.get") {
        assert.equal(params.conversation_id, "conversation");
        return respond({
          ...remote.convo,
          prepared_answers: [
            { kind: "consultation", prepared_id: "prepared", generation: 1 },
          ],
        });
      }
      if (method.startsWith("consultation.answers.")) {
        assert.deepEqual(params, {
          kind: "consultation",
          prepared_id: "prepared",
          generation: 1,
        });
        return respond({ status: "accepted" });
      }
      if (method === "consultation.knowledge.access")
        return respond({
          availability: "supported",
          status: remote.current ? "current" : "expired",
          dependencies: { status: remote.current ? "current" : "expired" },
        });
      if (!remote.current)
        return { error: { message: "KNOWLEDGE_SOURCE_EXPIRED" } };
      if (method === "consultation.knowledge.original")
        return respond({
          filename: "policy.txt",
          content_type: "text/plain",
          bytes_base64: bytes.toString("base64"),
          size: bytes.length,
          sha256: remote.tamper
            ? "bad"
            : createHash("sha256").update(bytes).digest("hex"),
        });
      if (method === "consultation.knowledge.source") {
        assert.deepEqual(params, locator);
        return respond({
          data: {
            source: { ...locator, title: "Returns", text: "Seven days" },
          },
          dependencies: [locator],
        });
      }
      return respond({
        data: {
          sources: [
            {
              ...locator,
              title: "Returns",
              text: "Seven days",
              original: { available: true },
            },
          ],
        },
        dependencies: [locator],
      });
    },
  } as unknown as PapPort;
  let vault = new Vault(db, key),
    service = new CustomerService(
      { dataDir: dir, sites: [] },
      pap,
      { get: async () => undefined, set: async () => {} },
      vault,
    );
  return {
    remote,
    get service() {
      return service;
    },
    get vault() {
      return vault;
    },
    async flow() {
      return (await service.connect("session", "consult")).flowId;
    },
    restart() {
      vault.close();
      vault = new Vault(db, key);
      service = new CustomerService(
        { dataDir: dir, sites: [] },
        pap,
        { get: async () => undefined, set: async () => {} },
        vault,
      );
    },
    close() {
      vault.close();
    },
  };
}
test("consultation lost receipt survives restart and reuses exact original request without a duplicate question", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    f.remote.lose = true;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Can I return this?" },
        "question",
      ),
      /NETWORK_UNCERTAIN/,
    );
    f.restart();
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Another question" },
        "new-question",
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    const result = await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "recover" },
      "recover",
    );
    const writes = f.remote.calls.filter((c) =>
      c.method.endsWith("messages.submit"),
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(f.remote.submits, 1);
    assert.equal(result.data.conversation_id, "conversation");
    await assert.rejects(
      f.service.tool(
        "another-session",
        "frontvia_consultation",
        { flowId: id, action: "get" },
        "get",
      ),
      /FLOW_NOT_OWNED/,
    );
    const count = f.remote.submits;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Followup" },
        "follow",
      ),
      /CONSULTATION_VERSION_REQUIRED/,
    );
    assert.equal(f.remote.submits, count);
    await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "ask", text: "Followup", expected_version: 1 },
      "follow",
    );
    assert.equal(f.remote.submits, 2);
    assert.equal(
      (await f.service.consultation.view("session", id)).pending,
      false,
    );
  } finally {
    f.close();
  }
});
test("revoked capability and canceled invocation cannot enqueue a question; definitive version failure can be reread", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    f.remote.allowed = false;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Question" },
        "one",
      ),
      /METHOD_UNAVAILABLE/,
    );
    assert.equal(f.remote.submits, 0);
    f.remote.allowed = true;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Question" },
        "canceled",
        AbortSignal.abort(),
      ),
    );
    assert.equal(
      (await f.service.consultation.view("session", id)).pending,
      false,
    );
    f.remote.reject = "VERSION_CONFLICT";
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "ask", text: "Question" },
        "version",
      ),
      /VERSION_CONFLICT/,
    );
    assert.equal(
      (await f.service.consultation.view("session", id)).pending,
      false,
    );
    f.remote.reject = "";
    await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "ask", text: "Question" },
      "fixed",
    );
    assert.equal(f.remote.submits, 1);
  } finally {
    f.close();
  }
});
test("knowledge uses owned returned locators, keeps original bytes out of model, validates download and expires old evidence", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    const result = await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "lookup", query: "returns" },
      "lookup",
    );
    const ref = result.data.data.sources[0].sourceRef;
    assert.match(ref, /^[a-f0-9]{64}$/);
    f.restart();
    const data = await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "source", sourceRef: ref },
      "source",
    );
    assert.equal(data.data.data.source.text, "Seven days");
    await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "access" },
      "access",
    );
    assert.equal(
      (await f.service.consultation.view("session", id)).knowledge.data.source
        .text,
      "Seven days",
    );
    const original = await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "original", sourceRef: ref },
      "original",
    );
    assert.ok(!JSON.stringify(original).includes("bytes_base64"));
    const download = await f.service.consultation.original("session", id, ref);
    assert.equal(download.content_type, "application/octet-stream");
    assert.equal(
      Buffer.from(download.bytes_base64, "base64").toString(),
      "Seven day return policy",
    );
    f.remote.tamper = true;
    await assert.rejects(
      f.service.consultation.original("session", id, ref),
      /INVALID_ORIGINAL_RESPONSE/,
    );
    f.remote.tamper = false;
    const before = f.remote.calls.length;
    await assert.rejects(
      f.service.consultation.original("other-session", id, ref),
      /FLOW_NOT_OWNED/,
    );
    assert.equal(f.remote.calls.length, before);
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_knowledge",
        { flowId: id, action: "source", sourceRef: "f".repeat(64) },
        "forged",
      ),
      /SOURCE_REFERENCE_REQUIRED/,
    );
    await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "lookup", query: "returns" },
      "refresh",
    );
    f.remote.current = false;
    assert.equal(
      (await f.service.consultation.view("session", id)).knowledge,
      undefined,
    );
    await assert.rejects(
      f.service.consultation.original("session", id, ref),
      /KNOWLEDGE_SOURCE_EXPIRED/,
    );
    f.remote.knowledge = false;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_knowledge",
        { flowId: id, action: "search", query: "returns" },
        "search",
      ),
      /KNOWLEDGE_UNAVAILABLE/,
    );
  } finally {
    f.close();
  }
});
test("answer receipts are scoped to pointers returned by the owned conversation", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "ask", text: "Question" },
      "question",
    );
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, action: "answer_accept", answerRef: "f".repeat(64) },
        "forged",
      ),
      /ANSWER_REFERENCE_REQUIRED/,
    );
    const current = await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "get" },
      "get",
    );
    const ref = current.data.prepared_answers[0].answerRef;
    assert.equal(
      (
        await f.service.tool(
          "session",
          "frontvia_consultation",
          { flowId: id, action: "answer_accept", answerRef: ref },
          "accept",
        )
      ).data.status,
      "accepted",
    );
    assert.equal(f.remote.submits, 1);
    assert.equal(
      schemas.frontvia_consultation.safeParse({ action: "confirm", flowId: id })
        .success,
      false,
    );
  } finally {
    f.close();
  }
});

test("personal logout hides consultation history and rejects cached views until the owning account returns", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId: id, action: "ask", text: "My private question" },
      "personal-question",
    );
    assert.equal(f.service.list().length, 1);
    f.remote.personalAccess = false;
    f.restart();
    assert.equal(f.service.list().length, 0);
    await assert.rejects(() => f.service.connect("session", "consult"), {
      code: "PERSONAL_CHAT_ACCOUNT_CHANGED",
    });
    await assert.rejects(() => f.service.consultation.view("session", id), {
      code: "PERSONAL_ACCOUNT_CHANGED",
    });
    f.remote.personalAccess = true;
    assert.equal(f.service.list()[0].flowId, id);
    assert.equal((await f.service.consultation.view("session", id)).flowId, id);
  } finally {
    f.close();
  }
});
