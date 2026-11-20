import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderTracking } from "../src/client/order-tracking.js";
import { orderShipments } from "../src/order-tracking.js";

const node = (id: string, type: string, day: number, tracking_number?: string) => ({
  id, type, occurred_at: `2026-11-${day}T01:00:00Z`, tracking_number, carrier: "本地测试",
  line_items: [{ id: "line", quantity: 1 }], description: id,
});
test("partial shipments retain deduplicated package events, corrections and an unattributed timeline", () => {
  const sent = node("ship","shipped",10,"old");
  const events = [node("signed","delivered",14,"new"), sent, node("replaced","tracking_replaced",12,"old"),
    node("scan","in_transit",11,"old"), sent, node("changed","tracking_corrected",12,"new"),
    node("attempt","failed_attempt",13,"new"), node("unknown","processing",10)];
  const shipments = orderShipments(events);
  assert.equal(shipments.length,3);
  assert.deepEqual(shipments.find(group => group.tracking[0]?.tracking_number === "old")?.events.map(e => e.id),
    ["replaced","scan","ship"]);
  const html = renderToStaticMarkup(createElement(OrderTracking, { order:{ shipments,
    line_items:[{id:"line",item:{title:"测试商品"},quantity:{total:3,fulfilled:2}}] } }));
  for (const label of ["测试商品 × 1","已签收","派送失败","订单物流时间线","待发商品","原运单已更正"]) assert(html.includes(label),label);
});
test("a shipped package without carrier scans remains visible", () => {
  const html = renderToStaticMarkup(createElement(OrderTracking, {order:{shipments:orderShipments([node("shipped","shipped",10,"box")]),line_items:[]}}));
  assert(html.includes("暂无承运商轨迹"));
});
test("recording an already delivered waybill preserves its carrier status and event chronology", () => {
  const shipments = orderShipments([
    node("corrected", "tracking_corrected", 21, "historical"),
    node("recorded", "shipped", 20, "historical"),
    node("signed", "delivered", 18, "historical"),
    node("transit", "in_transit", 17, "historical"),
  ]);
  assert.equal(shipments[0]?.status, "delivered");
  assert.equal(shipments[0]?.occurred_at, "2026-11-18T01:00:00Z");
  assert.deepEqual(shipments[0]?.events.map(event => event.id), ["corrected", "recorded", "signed", "transit"]);
  const html = renderToStaticMarkup(createElement(OrderTracking, { order: { shipments } }));
  assert.match(html, /historical<\/strong><p>已签收/);
});
