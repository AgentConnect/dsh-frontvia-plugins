// Isolated rendered-component acceptance. Synthetic merchant and payment only.
// Start with node scripts/cny-ui-fixture.mjs; no DSH profile or real credentials.
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(".local/cny-ui");
await mkdir(directory, { recursive: true });
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{ConsultationCard}from'../../packages/customer/src/client/consultation.tsx';
import css from'../../packages/customer/src/client/styles.css';
const style=document.createElement('style');style.textContent=css;document.head.append(style);
const call=async(op,payload)=>{const r=await fetch('/api/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const v=await r.json();if(v.error)throw new Error(v.error);return v;};
createRoot(document.getElementById('app')).render(<div className="fv fv-inline"><ConsultationCard ui={{flowId:'058231ab-3002-49ae-ac13-f2ffe9ea1060',sessionId:'synthetic-cny-ui',card:'consultation'}} call={call}/></div>);`;
await writeFile(resolve(directory, "entry.tsx"), entry);
const bundle = await build({
  entryPoints: [resolve(directory, "entry.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"development"' },
});
const m = (amount_minor) => ({ currency: "CNY", amount_minor });
const expiry = new Date(Date.now() + 1800000).toISOString();
const shopping = {
  profile: "frontvia.conversation_purchase.v1",
  state: "requires_confirmation",
  intentId: "6840a4a8-a821-4602-9f9a-972deef21434",
  summary: {
    lines: [
      {
        title: "轻量折叠旅行包",
        variant_title: "岩灰色 / 35L",
        attributes: [{ name: "面料", value: "防泼水" }],
        quantity: 1,
        line_total: m("9900"),
      },
    ],
    shipping_address: {
      country: "CN",
      recipient: "测试收件人",
      phone: "13800138000",
      region: "上海市",
      city: "浦东新区",
      line1: "测试路 100 号（合成测试地址）",
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
    delivery_selections: [{ option: { label: "普通快递" } }],
  },
  checkout: { id: "synthetic-order", expires_at: expiry },
  payment: null,
};
let confirmations = 0,
  reads = 0;
const view = () => ({
  capabilities: {
    shopping: { availability: "supported" },
    agent: { name: "Frontvia 测试商家" },
  },
  shopping,
  pending: false,
  conversation: {
    status: "answered",
    messages: [
      {
        id: "m1",
        actor: "agent",
        text: "已根据你选择的商品和配送信息准备好订单，请在购物卡片核对。",
      },
    ],
  },
});
const server = createServer(async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
    return;
  }
  if (req.url?.startsWith("/api/") || req.url?.startsWith("/__fixture/")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/shopping-confirm") {
      if (
        input.intentId !== shopping.intentId ||
        Object.keys(input).some(
          (k) => !["flowId", "sessionId", "card", "intentId"].includes(k),
        )
      ) {
        res.end(JSON.stringify({ error: "SHOPPING_REVIEW_REQUIRED" }));
        return;
      }
      confirmations++;
      shopping.state = "payment_pending";
      delete shopping.intentId;
      shopping.payment = {
        url: "https://shop.test/companies/a/pay/synthetic-order?expires=2000000000&access=SYNTHETIC",
        expires_at: expiry,
      };
    }
    if (req.url === "/__fixture/paid") {
      shopping.state = "paid";
      shopping.payment = null;
    }
    if (req.url === "/__fixture/stats") {
      res.end(JSON.stringify({ confirmations, reads }));
      return;
    }
    if (req.url === "/api/view") reads++;
    res.end(JSON.stringify(view()));
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frontvia CNY 隔离交互验收</title><style>body{margin:0;background:#fafafa;font:400 15px/1.6 system-ui;color:#222}main{max-width:1100px;padding:30px;margin:auto}body.dark{background:#141414;--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#222;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-border-l2:#333;--dsw-alias-button-primary-fill:#eee;--dsw-alias-button-primary-hover:#ddd;--dsw-alias-label-primary-inverted:#171717}small{color:#888}a{text-decoration:none}@media(max-width:520px){main{padding:12px}}</style><main><small>隔离验收 · 合成商品与支付数据</small><div id="app"></div></main><script src="/bundle.js"></script></html>`,
  );
});
server.listen(0, "127.0.0.1", () =>
  console.log(`CNY_FIXTURE_URL=http://127.0.0.1:${server.address().port}`),
);
