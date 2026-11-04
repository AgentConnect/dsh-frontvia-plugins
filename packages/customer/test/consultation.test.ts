import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { Vault, PapError } from "dsh-pap/core";
import { CustomerService, type PapPort } from "../src/core.js";
import { schemas, tools } from "../src/tools.js";
import {
  shoppingProfile,
  shoppingView,
  consultationModelData,
} from "../src/conversation-shopping.js";

const purchase = () => {
  const m = (amount_minor: string) => ({ currency: "CNY", amount_minor });
  return {
    profile: shoppingProfile,
    state: "requires_confirmation",
    summary_id: "summary-1",
    summary_digest: "digest-1",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    confirmation: { text: "确认购买 ABCDEF0123456789" },
    checkout: null,
    payment: null,
    summary: {
      lines: [
        {
          title: "折叠旅行包",
          variant_title: "黑色",
          quantity: 1,
          line_total: m("9900"),
        },
      ],
      shipping_address: {
        country: "CN",
        recipient: "测试收件人",
        phone: "13800138000",
        region: "上海",
        city: "上海",
        line1: "测试路 1 号",
      },
      totals: {
        complete: true,
        items_subtotal: m("9900"),
        shipping_total: m("600"),
        discount_total: m("0"),
        tax_total: m("0"),
        duties_total: m("0"),
        fees_total: m("0"),
        grand_total: m("10500"),
      },
    },
  };
};
async function purchaseFlow(f: ReturnType<typeof fixture>) {
  f.remote.shoppingCapability = true;
  const flowId = await f.flow();
  await f.service.tool(
    "session",
    "frontvia_consultation",
    { flowId, action: "ask", text: "购买一件旅行包" },
    "prepare",
  );
  f.remote.convo.status = "answered";
  f.remote.shopping = purchase();
  return { flowId, view: await f.service.consultation.view("session", flowId) };
}

test("CNY confirmation is owner-only, bound to displayed quote/version, and idempotent across restart", async () => {
  const f = fixture();
  try {
    const { flowId, view } = await purchaseFlow(f);
    const intent = view.shopping.intentId;
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        {
          flowId,
          action: "ask",
          text: "确认购买 ABCDEF0123456789",
          expected_version: f.remote.convo.version,
        },
        "model-consent",
      ),
      /PURCHASE_OWNER_CONFIRMATION_REQUIRED/,
    );
    assert.equal(f.remote.submits, 1);
    await f.service.consultation.confirmShopping("session", flowId, intent);
    const submit = f.remote.calls
      .filter((c) => c.method === "consultation.messages.submit")
      .at(-1);
    assert.equal(submit.params.text, "确认购买 ABCDEF0123456789");
    assert.equal(submit.params.expected_version, 1);
    f.restart();
    await f.service.consultation.confirmShopping("session", flowId, intent);
    assert.equal(f.remote.submits, 2);
    await assert.rejects(
      f.service.consultation.confirmShopping(
        "different-session",
        flowId,
        intent,
      ),
      /FLOW_NOT_OWNED/,
    );
    f.remote.personalAccess = false;
    await assert.rejects(
      f.service.consultation.confirmShopping("session", flowId, intent),
      /PERSONAL_ACCOUNT_CHANGED/,
    );
  } finally {
    f.close();
  }
});

test("CNY lost confirmation preserves the original key and cannot be replaced by another purchase", async () => {
  const f = fixture();
  try {
    const { flowId, view } = await purchaseFlow(f);
    f.remote.lose = true;
    await assert.rejects(
      f.service.consultation.confirmShopping(
        "session",
        flowId,
        view.shopping.intentId,
      ),
      /NETWORK_UNCERTAIN/,
    );
    const original = structuredClone(
      f.remote.calls.filter((c) => c.method.endsWith("messages.submit")).at(-1)
        .params,
    );
    f.restart();
    await assert.rejects(
      f.service.consultation.confirmShopping(
        "session",
        flowId,
        view.shopping.intentId,
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    await assert.rejects(
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId, action: "ask", text: "再买一个", expected_version: 2 },
        "new-purchase",
      ),
      /RESOLVE_PENDING_OPERATION/,
    );
    await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId, action: "recover" },
      "recover",
    );
    assert.deepEqual(
      f.remote.calls.filter((c) => c.method.endsWith("messages.submit")).at(-1)
        .params,
      original,
    );
    assert.equal(f.remote.submits, 2);
  } finally {
    f.close();
  }
});

test("CNY changed amount, expiry, conversation version or withdrawn capability requires new review", async () => {
  for (const change of ["amount", "expiry", "version", "capability"]) {
    const f = fixture(true);
    try {
      const { flowId, view } = await purchaseFlow(f);
      const readsBefore = f.remote.calls.filter(
        (call) => call.method === "consultation.capabilities.get",
      ).length;
      if (change === "amount")
        f.remote.shopping.summary.totals.grand_total.amount_minor = "10501";
      if (change === "expiry") f.remote.shopping.expires_at = 1;
      if (change === "version") f.remote.convo.version++;
      if (change === "capability") f.remote.shoppingCapability = false;
      await assert.rejects(
        f.service.consultation.confirmShopping(
          "session",
          flowId,
          view.shopping.intentId,
        ),
        /SHOPPING_REVIEW_REQUIRED|SHOPPING_UNAVAILABLE/,
      );
      assert.equal(f.remote.submits, 1);
      assert.equal(
        f.remote.calls.filter(
          (call) => call.method === "consultation.capabilities.get",
        ).length,
        readsBefore + 1,
        "owner confirmation refreshes authority even while display metadata is cached",
      );
    } finally {
      f.close();
    }
  }
});

test("CNY refresh reads current payment, isolates bearer link from model, and rejects foreign payment origins", async () => {
  const f = fixture();
  try {
    const { flowId } = await purchaseFlow(f);
    const expiry = new Date(Date.now() + 600000).toISOString();
    const url = `https://shop.test/companies/a/pay/checkout-1?expires=${Math.floor(Date.parse(expiry) / 1000)}&access=private-bearer`;
    f.remote.shopping = {
      ...purchase(),
      state: "payment_pending",
      checkout: {
        id: "checkout-1",
        status: "requires_action",
        expires_at: expiry,
        payment_summary: { status: "requires_action" },
      },
      payment: { url, expires_at: expiry },
      confirmation: null,
    };
    f.remote.convo.messages = [
      {
        id: "answer",
        actor: "agent",
        text: `订单已建立\n${url}\n确认购买 ABCDEF0123456789`,
      },
    ];
    const view = await f.service.consultation.view("session", flowId);
    assert.equal(view.shopping.payment.url, url);
    const result = await f.service.tool(
      "session",
      "frontvia_consultation",
      { flowId, action: "get" },
      "read",
    );
    assert(!JSON.stringify(result).includes("private-bearer"));
    assert(!JSON.stringify(result).includes("ABCDEF0123456789"));
    f.remote.shopping.state = "paid";
    f.remote.shopping.checkout.payment_summary.status = "paid";
    assert.equal(
      (await f.service.consultation.view("session", flowId)).shopping.payment,
      null,
    );
    assert.equal(
      f.remote.submits,
      1,
      "reload does not submit a question, purchase or payment",
    );
    f.remote.shopping.state = "payment_pending";
    f.remote.shopping.payment.url = url.replace("shop.test", "attacker.test");
    await assert.rejects(
      f.service.consultation.view("session", flowId),
      /SHOPPING_PAYMENT_LINK_INVALID/,
    );
    const incomplete = purchase();
    delete (incomplete.summary.totals as any).shipping_total;
    assert.throws(
      () =>
        shoppingView(incomplete, { issuer: "https://shop.test/companies/a" }),
      /SHOPPING_RESPONSE_INVALID/,
    );
    assert(
      !JSON.stringify(
        consultationModelData({
          nested: [{ text: url, confirmation_code: "SECRET" }],
        }),
      ).includes("SECRET"),
    );
  } finally {
    f.close();
  }
});

function fixture(cache = false) {
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
    originalBytes: bytes,
    originalMetadata: { available: true } as any,
    originalSize: undefined as number | undefined,
    originalEncoding: undefined as string | undefined,
    submits: 0,
    convo: null as any,
    ops: new Map<string, any>(),
    shopping: undefined as any,
    shoppingCapability: false,
  };
  const respond = (data: any) => ({ result: { data: structuredClone(data) } });
  const pap = {
    apiVersion: 1,
    ...(cache ? {capabilityCacheKey: () => remote.personalAccess ? "one" : undefined} : {}),
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
    request: async (
      _ref: string,
      method: string,
      params: any,
      _signal?: AbortSignal,
      options?: any,
    ) => {
      remote.calls.push({ method, params: structuredClone(params), options });
      if (method === "consultation.capabilities.get")
        return respond({
          profile: "frontvia.merchant_consultation.v1",
          availability: "supported",
          knowledge: remote.knowledge ? "supported" : "unavailable",
          shopping: remote.shoppingCapability
            ? {
                profile: shoppingProfile,
                availability: "supported",
                country: "CN",
                currency: "CNY",
                confirmation: "owner_message",
                payment: "hosted_alipay",
              }
            : undefined,
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
          shopping: remote.shopping,
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
          bytes_base64:
            remote.originalEncoding ?? remote.originalBytes.toString("base64"),
          size: remote.originalSize ?? remote.originalBytes.length,
          sha256: remote.tamper
            ? "bad"
            : createHash("sha256").update(remote.originalBytes).digest("hex"),
        });
      if (method === "consultation.knowledge.source") {
        assert.deepEqual(params, locator);
        return respond({
          data: {
            source: { ...locator, title: "Returns", text: "Seven days" },
            original: remote.originalMetadata,
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

test("help accepts 300 UTF-16 units, rejects longer input before persistence, and resumes legacy rejected commands", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    const call = (args: any, key: string) =>
      f.service.tool(
        "session",
        "frontvia_consultation",
        { flowId: id, ...args },
        key,
      );
    await call({ action: "ask", text: "Help with returns" }, "ask");
    for (const reason of ["中".repeat(300), "😀".repeat(150)]) {
      const args = { flowId: id, action: "help", reason };
      assert(schemas.frontvia_consultation.safeParse(args).success);
      await call(args, reason.slice(0, 2));
    }
    const before = f.vault.get<any>(`consultation:${id}`);
    for (const reason of [
      "a".repeat(301),
      "中".repeat(1000),
      "😀".repeat(150) + "a",
      " ",
      null,
    ]) {
      const args = { flowId: id, action: "help", reason };
      assert.equal(
        schemas.frontvia_consultation.safeParse(args).success,
        false,
      );
      await assert.rejects(call(args, "invalid"), /INVALID_PARAMS/);
    }
    let stored = f.vault.get<any>(`consultation:${id}`);
    assert.deepEqual(stored.commands, before.commands);
    assert.equal(stored.pending, undefined);
    assert.equal(
      f.remote.calls.filter((c) => c.method === "consultation.help.request")
        .length,
      2,
    );
    // Reopen an encrypted command written by the old 1000-character client.
    stored.commands.legacy = {
      method: "consultation.help.request",
      params: {
        conversation_id: "conversation",
        idempotency_key: "original-key",
        reason: "a".repeat(301),
      },
      inputHash: "old-client",
      status: "pending",
    };
    stored.pending = "legacy";
    f.vault.set(`consultation:${id}`, stored);
    f.restart();
    f.remote.reject = "INVALID_PARAMS";
    await assert.rejects(
      call({ action: "recover" }, "recover"),
      /INVALID_PARAMS/,
    );
    stored = f.vault.get<any>(`consultation:${id}`);
    assert.equal(stored.pending, undefined);
    assert.equal(stored.commands.legacy.status, "done");
    assert.equal(stored.commands.legacy.params.idempotency_key, "original-key");
    f.remote.reject = "";
    await call(
      {
        action: "ask",
        text: "Corrected question",
        expected_version: f.remote.convo.version,
      },
      "next-question",
    );
    await call({ action: "help", reason: "Please help" }, "next-help");
    assert.equal(
      (await f.service.consultation.view("session", id)).pending,
      false,
    );
  } finally {
    f.close();
  }
});

test("original download budgets cover 700 KiB and 1 MiB, reject over-limit, malformed and withdrawn files", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    const lookup = await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "lookup", query: "returns" },
      "lookup",
    );
    const ref = lookup.data.data.sources[0].sourceRef;
    for (const size of [700 * 1024, 900 * 1024, 1024 * 1024]) {
      f.remote.originalBytes = Buffer.alloc(size, 0xab);
      const file = await f.service.consultation.original("session", id, ref);
      assert.deepEqual(
        Buffer.from(file.bytes_base64, "base64"),
        f.remote.originalBytes,
      );
      const request = f.remote.calls.at(-1);
      assert.equal(
        request.options.maxResponseBytes,
        4 * Math.ceil((1024 * 1024) / 3) + 16 * 1024,
      );
    }
    // 1 MiB + 1 can have the SAME padded Base64 length as 1 MiB.
    f.remote.originalBytes = Buffer.alloc(1024 * 1024 + 1);
    await assert.rejects(
      f.service.consultation.original("session", id, ref),
      /INVALID_ORIGINAL_RESPONSE/,
    );
    f.remote.originalBytes = Buffer.from("valid");
    for (const size of [-1, 1.5, 1024 * 1024 + 1, 4]) {
      f.remote.originalSize = size;
      await assert.rejects(
        f.service.consultation.original("session", id, ref),
        /INVALID_ORIGINAL_RESPONSE/,
      );
    }
    f.remote.originalSize = undefined;
    f.remote.originalEncoding = f.remote.originalBytes.toString("base64") + "!";
    await assert.rejects(
      f.service.consultation.original("session", id, ref),
      /INVALID_ORIGINAL_RESPONSE/,
    );
    f.remote.originalEncoding = undefined;
    f.remote.current = false;
    await assert.rejects(
      f.service.consultation.original("session", id, ref),
      /KNOWLEDGE_SOURCE_EXPIRED/,
    );
    assert(
      f.remote.calls
        .filter((c) => c.method !== "consultation.knowledge.original")
        .every((c) => c.options === undefined),
    );
  } finally {
    f.close();
  }
});

test("exact source metadata carries explicit original availability to its own UI source", async () => {
  const f = fixture();
  try {
    const id = await f.flow();
    const lookup = await f.service.tool(
      "session",
      "frontvia_knowledge",
      { flowId: id, action: "lookup", query: "returns" },
      "lookup",
    );
    const ref = lookup.data.data.sources[0].sourceRef;
    for (const metadata of [
      { available: true, size: 7 },
      { available: false, reason: "not_file" },
      { available: false, reason: "original_too_large" },
      undefined,
    ]) {
      f.remote.originalMetadata = metadata;
      await f.service.tool(
        "session",
        "frontvia_knowledge",
        { flowId: id, action: "source", sourceRef: ref },
        "source",
      );
      f.restart();
      const source = (await f.service.consultation.view("session", id))
        .knowledge.data.source;
      assert.equal(source.sourceRef, ref);
      assert.deepEqual(source.original, metadata);
    }
  } finally {
    f.close();
  }
});

test("exported consultation tool submits a second question with the server integer version after restart", async () => {
  const f = fixture();
  try {
    const flowId = await f.flow();
    const invoke = (args: any, callId: string) =>
      tools(f.service)
        .find((t) => t.name === "frontvia_consultation")!
        .execute({ flowId, ...args }, {
          agent: { id: "session" },
          callId,
          signal: new AbortController().signal,
        } as any) as Promise<any>;
    const first = await invoke(
      { action: "ask", text: "信任的三个维度是什么？" },
      "first",
    );
    assert.equal(first.error, undefined);
    f.remote.convo.status = "answered";
    f.restart();
    const current = await invoke({ action: "get" }, "read-current");
    assert.equal(current.data.version, 1);
    const second = await invoke(
      {
        action: "ask",
        text: "它是否也面向企业？",
        expected_version: current.data.version,
      },
      "followup",
    );
    assert.equal(second.error, undefined);
    assert.equal(f.remote.submits, 2);
    const writes = f.remote.calls.filter(
      (c) => c.method === "consultation.messages.submit",
    );
    assert.equal(
      writes[1].params.conversation_id,
      writes[0].params.conversation_id ?? "conversation",
    );
    assert.equal(writes[1].params.expected_version, 1);
    assert.equal(writes[1].params.text, "它是否也面向企业？");
    await assert.rejects(
      invoke(
        { action: "ask", text: "不能把字符串版本写入", expected_version: "2" },
        "invalid-version",
      ),
      /expected_version.*integer/,
    );
    assert.equal(f.remote.submits, 2);
    const invalid = await invoke(
      { action: "ask", text: "负版本无效", expected_version: -1 },
      "negative-version",
    );
    assert.equal(invalid.error.code, "INVALID_TOOL_ARGUMENTS");
    assert.equal(f.remote.submits, 2);
    assert.equal(
      (await f.service.consultation.view("session", flowId)).pending,
      false,
    );
  } finally {
    f.close();
  }
});

test("consultation metadata reuse never caches source authority or allows a revoked write", async () => {
 const f=fixture(true);try{
  const flow=await f.flow();const count=()=>f.remote.calls.filter(v=>v.method==='consultation.capabilities.get').length;
  await Promise.all(Array.from({length:5},()=>f.service.consultation.view('session',flow)));
  assert.equal(count(),1);
  await f.service.tool('session','frontvia_knowledge',{flowId:flow,action:'lookup',query:'returns'},'lookup');
  await f.service.consultation.view('session',flow);
  assert(f.remote.calls.some(v=>v.method==='consultation.knowledge.access'));
  f.remote.current=false;
  const value=await f.service.consultation.view('session',flow);assert.equal(value.knowledge,undefined);
  f.remote.allowed=false;
  await assert.rejects(f.service.tool('session','frontvia_consultation',{flowId:flow,action:'ask',text:'hello'},'ask'),/METHOD_UNAVAILABLE/);
  assert.equal(f.remote.submits,0);
  f.remote.personalAccess=false;await assert.rejects(f.service.consultation.view('session',flow),/PERSONAL_ACCOUNT_CHANGED/);
 }finally{f.close();}
});
