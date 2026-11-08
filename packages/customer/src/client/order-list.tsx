import React from "react";
import { ArrowRight, Package } from "lucide-react";
import { Badge, Button } from "./ui.js";
import { money } from "./commerce-display.js";
import { orderLabel, orderStatus, storefrontOrders } from "./order-summary.js";

export function OrderList({
  data,
  busy,
  open,
}: {
  data: any;
  busy: boolean;
  open: (id: string) => void;
}) {
  const orders = storefrontOrders(data);
  return (
    <ul className="fv-order-list" aria-label="订单列表">
      {orders.map((order) => {
        const status = orderStatus(order);
        const lines = Array.isArray(order.lines) ? order.lines : [];
        const first = lines[0];
        const title =
          first?.title ?? first?.product_title ?? first?.variant_title;
        const quantity = lines.reduce(
          (sum: number, line: any) =>
            sum + (Number.isFinite(line.quantity) ? line.quantity : 0),
          0,
        );
        const date = order.created_at ? new Date(order.created_at) : undefined;
        return (
          <li key={order.id} className="fv-order-row">
            <div className="fv-order-row-header">
              <div className="fv-row">
                <h4 title={order.id}>{orderLabel(order)}</h4>
              </div>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <div className="fv-order-row-body">
              <div className="fv-order-product-icon" aria-hidden>
                <Package />
              </div>
              <div className="fv-order-row-summary">
                <p>
                  {title
                    ? `${title}${lines.length > 1 ? ` 等 ${lines.length} 种商品` : ""}`
                    : "查看订单商品与配送信息"}
                </p>
                <p className="fv-muted">
                  {quantity > 0 ? `共 ${quantity} 件` : "商品信息待查看"}
                  {date && Number.isFinite(date.getTime()) && (
                    <>
                      {" "}
                      ·{" "}
                      {date.toLocaleString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  )}
                </p>
              </div>
              <div className="fv-order-row-total">
                <span className="fv-muted">订单金额</span>
                <span>
                  {order.totals?.grand_total
                    ? money(order.totals.grand_total)
                    : "待查看"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label={`查看详情：${orderLabel(order)}`}
                onClick={() => open(order.id)}
              >
                查看详情
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
