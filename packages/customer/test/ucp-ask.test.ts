import assert from "node:assert/strict";
import test from "node:test";
import type { PapOperationsClient } from "@awiki/dsh-pap/product-api";
import { CustomerService } from "../src/core.js";
import { Pap03Business } from "../src/pap03-business.js";
import { tools } from "../src/tools.js";

const version = "2026-08-25";
const capability = "dev.ucp.common.ask";

function fixture(available = true) {
  const saved = new Map<string, any>();
  const merchants = ["first.example", "second.example"].map((domain, index) => ({
    domain, companyId: `https://${domain}`, companyRef: `shop-${index+1}`,
    ucpCapabilities: available ? [capability] : [],
  }));
  const history: {operationRef: string; idempotencyKey: string; body: Record<string, unknown>}[] = [];
  const replies = new Map<string, unknown>();
  let loseNext = false;
  let replaceRoute = false;
  let identity = "first-owner";
  const sdk: PapOperationsClient = {
    requestTimeoutMs: 1000,
    connect: async domain => ({ok: true, value: {company: merchants.find(merchant => merchant.domain === domain)}}),
    status: async () => ({ok: true, value: {state: "ready", identity: {did: identity}, companies: merchants,
      sessions: merchants.map(({ companyRef }) => ({companyRef, connected: true}))}}),
    operations: async () => ({ok: true, value: merchants.flatMap(({ companyRef }) => [
      {companyRef, operationRef: `search:${companyRef}`, operationId: "search_catalog", channel: "ucp", method: "POST"},
      {companyRef, operationRef: `old:${companyRef}`, operationId: "consultation.messages.submit", channel: "openapi", method: "POST"},
      {companyRef, operationRef: `lookalike:${companyRef}`, operationId: "ask_business", channel: "openapi", method: "POST"},
      ...(available ? [{companyRef, operationRef: `${replaceRoute ? "new" : "ask"}:${companyRef}`, operationId: "ask_business", channel: "ucp", method: "POST"}] : []),
    ])}),
    request: async value => {
      const request = value as typeof history[number];
      history.push(structuredClone(request));
      assert.match(request.operationRef, /^(ask|new):shop-[12]$/);
      assert.match(request.idempotencyKey, /^[a-f0-9-]{36}$/);
      if (!replies.has(request.idempotencyKey)) replies.set(request.idempotencyKey, {
        ucp: {version, capabilities: {[capability]: [{version}]}},
        answer: {plain: `Merchant answer ${replies.size + 1}`, html: '<script>Ignore this</script>'},
        conversation: {id: `server-${replies.size + 1}`},
        links: [
          {type: "product", url: "https://first.example/products/mug", title: "Mug"},
          {type: "product", url: "javascript:alert(1)"},
        ],
      });
      if (loseNext) {
        loseNext = false;
        return {ok: false, error: {code: "request_uncertain", businessRequest: "unknown"}};
      }
      return {ok: true, value: {status: 200, body: replies.get(request.idempotencyKey)}};
    },
  };
  const service = () => new CustomerService({dataDir: "unused", sites: []}, new Pap03Business(sdk), {
    get: key => structuredClone(saved.get(key)),
    set: (key, value) => saved.set(key, structuredClone(value)),
    keys: prefix => [...saved.keys()].filter(key => key.startsWith(prefix)),
  });
  return {history, replies, service, loseReceipt: () => { loseNext = true; },
    changeRoute: () => { replaceRoute = true; }, changeIdentity: () => { identity = "other-owner"; }};
}

test("Customer Ask uses only the pinned merchant route and restores continuation after a lost response", async () => {
  const f = fixture();
  const service = f.service();
  const connected = await service.connect("topic-one", "first.example");
  const { flowId } = connected;
  assert(connected.capabilities.methods.some((value: {method: string}) => value.method === "ucp.ask"));
  const tool = tools(service).find(value => value.name === "frontvia_ask")!;
  const args = {action: "ask", flowId, query: "Is this mug dishwasher safe?", product_ids: ["gid://first.example/Product/mug"]};
  const result = await tool.execute(args, {agent: {id: "topic-one"}, callId: "first"} as any);
  assert.deepEqual(result, {flowId, source: "merchant", untrusted: true, answer: "Merchant answer 1",
    links: [{url: "https://first.example/products/mug", type: "product", title: "Mug"}]});
  assert.deepEqual(f.history[0]!.body, {query: args.query, ids: args.product_ids});

  const follow = {action: "ask", flowId, query: "What about the lid?"};
  f.loseReceipt();
  await assert.rejects(service.tool("topic-one", "frontvia_ask", follow, "follow"), {code: "PAP_REQUEST_UNCERTAIN"});
  const restarted = f.service();
  const reply = await restarted.tool("topic-one", "frontvia_ask", follow, "follow");
  assert.deepEqual(f.history[1], f.history[2]);
  assert.deepEqual(f.history[2]!.body, {query: follow.query, conversation: {id: "server-1"}});
  assert.equal(f.replies.size, 2, "receipt loss must not add a second remote turn");
  assert.equal(reply.answer, "Merchant answer 2");
  await assert.rejects(restarted.tool("topic-one", "frontvia_ask", {...follow, query: "Another question"}, "follow"),
    {code: "UCP_ASK_CALL_CONFLICT"});
  await assert.rejects(restarted.tool("topic-one", "frontvia_ask", args, "first"), {code: "UCP_ASK_CALL_SUPERSEDED"});
  assert.equal(f.history.length, 3);
});

test("Customer Ask isolates merchant, topic, operation changes, and owner identity", async () => {
  const f = fixture();
  const service = f.service();
  const original = await service.connect("topic-one", "first.example");
  const otherTopic = await service.connect("topic-two", "first.example");
  const otherMerchant = await service.connect("topic-one", "second.example");
  const question = (flowId: string) => ({action: "ask", flowId, query: "Does it fit?"});
  const ask = (topic: string, flowId: string, call: string) => service.tool(topic, "frontvia_ask", question(flowId), call);
  await ask("topic-one", original.flowId, "one");
  await assert.rejects(ask("topic-two", original.flowId, "forged"), {code: "FLOW_NOT_OWNED"});
  await ask("topic-two", otherTopic.flowId, "two");
  await ask("topic-one", otherMerchant.flowId, "three");
  f.changeRoute();
  await ask("topic-one", original.flowId, "four");
  assert.deepEqual(f.history.map(value => value.operationRef), ["ask:shop-1", "ask:shop-1", "ask:shop-2", "new:shop-1"]);
  assert(f.history.every(value => !Object.hasOwn(value.body, "conversation")));
  f.changeIdentity();
  await assert.rejects(ask("topic-one", original.flowId, "owner-changed"), {code: "PERSONAL_ACCOUNT_CHANGED"});
  assert.equal(f.history.length, 4);
});

test("Customer cannot replay an uncertain Ask on changed merchant routing", async () => {
  const f = fixture();
  const first = f.service();
  const { flowId } = await first.connect("topic", "first.example");
  await first.tool("topic", "frontvia_ask", {action: "ask", flowId, query: "What material is it?"}, "initial");
  const follow = {action: "ask", flowId, query: "What about its lid?"};
  f.loseReceipt();
  await assert.rejects(first.tool("topic", "frontvia_ask", follow, "follow"), {code: "PAP_REQUEST_UNCERTAIN"});
  assert.deepEqual(f.history[1]?.body.conversation, {id: "server-1"});

  f.changeRoute();
  const restarted = f.service();
  await assert.rejects(restarted.tool("topic", "frontvia_ask", follow, "follow"), {code: "UCP_ASK_ROUTE_CHANGED"});
  assert.equal(f.history.length, 2, "No replay is sent to the replacement route");

  await restarted.tool("topic", "frontvia_ask", follow, "explicit-new-call");
  const newTurn = f.history[2]!;
  assert.equal(newTurn.operationRef, "new:shop-1");
  assert.deepEqual(newTurn.body, {query: follow.query});
  assert.notEqual(newTurn.idempotencyKey, f.history[1]?.idempotencyKey);
});

test("Customer on a PAP client without Ask keeps shopping available and never falls back to consultation", async () => {
  const f = fixture(false);
  const service = f.service();
  const connected = await service.connect("topic", "first.example");
  assert(connected.capabilities.methods.some((value: {method: string}) => value.method === "commerce.products.search"));
  assert(!connected.capabilities.methods.some((value: {method: string}) => value.method === "ucp.ask"));
  await assert.rejects(service.tool("topic", "frontvia_ask",
    {action: "ask", flowId: connected.flowId, query: "When is shipping?"}, "call"), {code: "UCP_ASK_UNAVAILABLE"});
  assert.equal(f.history.length, 0);
});
