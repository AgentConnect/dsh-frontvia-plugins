import React from "react";
import { currentTrackingEvent } from "../order-tracking.js";

const states: Record<string, string> = {
  processing: "备货中", shipped: "已发货", in_transit: "运输中", tracking_update: "轨迹更新",
  out_for_delivery: "派送中", available_for_pickup: "待取件", delivered: "已签收",
  tracking_replaced: "原运单已更正", tracking_corrected: "已启用更正后的运单",
  failed_attempt: "派送失败", undeliverable: "无法送达", returning_to_sender: "退回中",
  returned_to_sender: "已退回", canceled: "已取消",
};

function Time({ value }: { value: string }) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? <time dateTime={value}>{new Date(timestamp).toLocaleString("zh-CN")}</time> : null;
}

export function OrderTracking({ order }: { order: any }) {
  const lines = order.line_items ?? [];
  const pending = lines.filter((line: any) => line.quantity.total > line.quantity.fulfilled);
  const shipments = order.shipments ?? [];
  if (!shipments.length && !order.fulfillment?.expectations?.some((e: any) => e.method_type === "shipping")) return null;
  function items(event: any) {
    return (event.line_items ?? []).map((item: any) => {
      const line = lines.find((l: any) => l.id === item.id);
      return line ? `${line.item.title} × ${item.quantity}` : undefined;
    }).filter(Boolean).join("、");
  }
  return <section className="fv-stack" aria-label="物流与配送">
    <h4>物流与配送</h4>
    {shipments.map((shipment: any) => {
      const latest = currentTrackingEvent(shipment.events);
      const tracking = shipment.tracking[0];
      return <section key={shipment.id} className="fv-stack">
        <strong>{tracking ? [tracking.carrier, tracking.tracking_number].filter(Boolean).join(" · ") : "订单物流时间线"}</strong>
        <p>{states[latest.type] ?? latest.type} · <Time value={latest.occurred_at} /></p>
        {items(latest) && <p>{items(latest)}</p>}
        {latest.description && <p>{latest.description}</p>}
        {shipment.events.every((event: any) => event.type === "shipped") && <p>已发货，暂无承运商轨迹。</p>}
        <details><summary>查看轨迹（{shipment.events.length}）</summary><ol>
          {shipment.events.map((event: any) => <li key={event.id}>
            <Time value={event.occurred_at} /> · {states[event.type] ?? event.type}
            {event.description && <> · {event.description}</>}{items(event) && <> · {items(event)}</>}
          </li>)}
        </ol></details>
      </section>;
    })}
    {!!pending.length && <div><strong>待发商品</strong><ul>{pending.map((line: any) =>
      <li key={line.id}>{line.item.title} × {line.quantity.total - line.quantity.fulfilled}</li>)}</ul></div>}
  </section>;
}
