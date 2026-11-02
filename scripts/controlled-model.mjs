// Deterministic Anthropic Messages fixture. It is not a paid model or remote Agent.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const out = resolve(".local/native/controlled-model.json");
await mkdir(resolve(".local/native"), { recursive: true });
const evidence = { requests: [], cases: {} };
function choose(body) {
  const blocks = body.messages.flatMap((m) =>
    typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : (m.content ?? []),
  );
  const calls = blocks.filter((b) => b.type === "tool_use");
  const replies = blocks
    .filter((b) => b.type === "tool_result")
    .map((b) => {
      try {
        return JSON.parse(
          typeof b.content === "string"
            ? b.content
            : b.content
                .filter((x) => x.type === "text")
                .map((x) => x.text)
                .join(""),
        );
      } catch {
        return {};
      }
    });
  const flow = replies.find((r) => r.flowId)?.flowId;
  const product = replies.find(
    (r) => r.data?.items?.[0]?.title === "Travel Mug",
  )?.data.items[0];
  const variants = replies.find((r) => r.data?.items?.[0]?.product_id)?.data
    .items;
  const added = replies.find((r) => r.cartVersion)?.cartVersion;
  const texts = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const marker = texts.includes("[controlled-orders]") ? "orders" : texts.includes("[controlled-denials]") ? "denials" : "chat";
  const tool = (name, input) => ({
    type: "tool_use",
    id: "ctl_" + randomUUID().replaceAll("-", ""),
    name,
    input,
  });
  let response;
  if (marker === "orders") {
    if(calls.length===0) response=tool('frontvia_connection',{action:'connect',siteId:'test-shop'});
    else if(calls.length===1) response=tool('frontvia_orders',{action:'list',flowId:flow});
    else response={type:'text',text:'受控模型：已读取当前买方订单列表，请查看订单卡片。'};
  } else if (marker === "denials") {
    const stage = calls.length;
    if (stage === 0)
      response = tool("frontvia_connection", {
        action: "connect",
        siteId: "test-shop",
      });
    else if (stage === 1)
      response = tool("frontvia_products", {
        action: "search",
        flowId: flow,
        query: "Mug",
      });
    else if (stage === 2)
      response = tool("frontvia_products", {
        action: "variants",
        flowId: flow,
        product_id: product?.id,
      });
    else if (stage === 3)
      response = tool("frontvia_cart", {
        action: "add",
        flowId: flow,
        variant_id: variants?.[0]?.id ?? replies[2]?.data?.items?.[0]?.id,
        quantity: 1,
      });
    else if (stage === 4)
      response = tool("frontvia_cart", {
        action: "add",
        flowId: flow,
        variant_id: variants?.[0]?.id ?? replies[2]?.data?.items?.[0]?.id,
        quantity: 1,
      });
    else if (stage === 5)
      response = tool("frontvia_checkout", { action: "confirm", flowId: flow });
    else if (stage === 6)
      response = tool("frontvia_cart", { action: "get", flowId: flow });
    else
      response = {
        type: "text",
        text: "受控模型测试已结束：读取购物车核对数量。缺失版本的重新加购与模型确认请求应被拒绝，未执行购买。",
      };
  } else
    response = {
      type: "text",
      text: "受控模型响应：此轮只验证宿主聊天与恢复，不执行购物操作。",
    };
  evidence.cases[marker] = {
    calls: calls.map((c) => ({ name: c.name, action: c.input.action })),
    errors: replies.filter((r) => r.error).map((r) => r.error.code),
    lastCartVersion: added,
    finished: response.type === "text",
  };
  return response;
}
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/messages")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2000000) {
      res.writeHead(413).end();
      return;
    }
  }
  try {
    const body = JSON.parse(raw),
      block = choose(body);
    evidence.requests.push({
      at: new Date().toISOString(),
      model: body.model,
      tools: (body.tools ?? []).map((t) => t.name),
      invalidRootSchemas: (body.tools ?? [])
        .filter((t) => t.input_schema?.type !== "object")
        .map((t) => t.name),
      piiLeak: [
        "dsh-private-ui@example.test",
        "900 DSH Private Avenue",
        "DSH Private Recipient",
      ].some((s) => raw.includes(s)),
      responseType: block.type,
    });
    await writeFile(out, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    const message = {
      id: "msg_" + randomUUID(),
      type: "message",
      role: "assistant",
      model: body.model,
      content: [block],
      stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 30 },
    };
    if (!body.stream) {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(message));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const send = (event, data) =>
      res.write(
        `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
      );
    send("message_start", {
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    });
    send("content_block_start", {
      index: 0,
      content_block:
        block.type === "text"
          ? { type: "text", text: "" }
          : { ...block, input: {} },
    });
    send("content_block_delta", {
      index: 0,
      delta:
        block.type === "text"
          ? { type: "text_delta", text: block.text }
          : {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            },
    });
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: message.stop_reason, stop_sequence: null },
      usage: { output_tokens: 30 },
    });
    send("message_stop", {});
    res.end();
  } catch {
    res.writeHead(500).end("controlled fixture error");
  }
});
server.listen(4348, "127.0.0.1", () =>
  console.log(
    "Controlled model listening on loopback 4348. No external requests.",
  ),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => server.close(() => process.exit(0)));
