import { test } from "node:test";
import assert from "node:assert/strict";
import { orderStatus, storefrontOrders } from "../src/client/order-summary.js";

test("canceled orders are neutral even with a paid snapshot; references never imply unpaid", () => {
  assert.deepEqual(
    orderStatus({ status: "canceled", payment: { status: "paid" } }),
    { label: "已取消", variant: "secondary" },
  );
  assert.deepEqual(orderStatus({ order_id: "reference" }), {
    label: "状态待查看",
    variant: "secondary",
  });
  assert.equal(
    orderStatus({ payment: { status: "refunded" }, status: "completed" }).label,
    "已退款",
  );
  assert.equal(orderStatus({ payment: { status: "unpaid" } }).label, "待付款");
  assert.equal(
    orderStatus({ payment: { status: "paid" }, fulfillment_status: "shipped" })
      .label,
    "已发货",
  );
});

test("order list deduplicates the current order and enriches only this flow's listed references without retargeting payment", () => {
  const data = {
    order: { id: "current", status: "canceled", display_number: 7 },
    viewedOrder: {
      id: "history",
      status: "completed",
      lines: [{ title: "杯垫", quantity: 1 }],
    },
    orders: {
      items: [
        { order_id: "current", created_at: "2026-11-07" },
        { order_id: "history" },
        { order_id: "unknown" },
      ],
    },
  };
  const original = structuredClone(data);
  const rows = storefrontOrders(data);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["current", "history", "unknown"],
  );
  assert.equal(rows[0].status, "canceled");
  assert.equal(rows[0].created_at, "2026-11-07");
  assert.equal(rows[1].lines[0].title, "杯垫");
  assert.equal(rows[2].status, undefined);
  assert.deepEqual(data, original);
  assert.equal(storefrontOrders({ ...data, orders: { items: [] } }).length, 1);
  assert.deepEqual(
    storefrontOrders({ orders: { items: [{ order_id: "unknown" }] } }).map(
      (row) => row.id,
    ),
    ["unknown"],
  );
});

test('domain progress wins over refund or shipment shorthand; delivery is not completion',()=>{
 assert.equal(orderStatus({business_status:'awaiting_closure',status:'completed',payment:{status:'refunded'}}).label,'退款后待结案');
 assert.equal(orderStatus({business_status:'closed_refunded',status:'canceled'}).label,'已关闭（已退款）');
 assert.notEqual(orderStatus({fulfillment_status:'delivered',payment:{status:'paid'}}).label,'已完成');
 assert.equal(orderStatus({business_status:'fulfilling',payment:{status:'partially_refunded'}}).label,'履约中');
});
