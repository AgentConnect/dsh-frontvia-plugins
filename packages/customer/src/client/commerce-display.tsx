import React from "react";
import {
  Package,
  MapPin,
  ChevronDown,
  CircleCheck,
  Check,
  Truck,
} from "lucide-react";
import { Badge, Separator } from "./ui.js";
export const items = (v: any) =>
  Array.isArray(v)
    ? v
    : (v?.items ?? v?.products ?? v?.variants ?? v?.orders ?? []);
export const money = (m: any) => {
  if (m?.amount_minor !== undefined && /^\d+$/.test(m.amount_minor)) {
    const n = BigInt(m.amount_minor);
    return `${m.currency} ${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
  }
  return m?.amount_decimal !== undefined
    ? `${m.currency} ${m.amount_decimal}`
    : "待核对";
};
export function Lines({ lines = [] }: { lines?: any[] }) {
  return (
    <div className="fv-lines" aria-label="商品明细">
      {lines.map((l: any, index: number) => (
        <div className="fv-line" key={l.id ?? l.line_id ?? index}>
          <div className="fv-line-image">
            <Package aria-hidden />
          </div>
          <div className="fv-line-info">
            <p className="fv-line-title">
              {l.title ?? l.product_title ?? l.variant_title}
            </p>
            <p className="fv-line-qty">
              数量 {l.quantity}
              {l.variant_title && l.variant_title !== l.title
                ? ` · ${l.variant_title}`
                : ""}
            </p>
          </div>
          <span className="fv-line-price">
            {money(l.totals?.grand_total ?? l.total ?? l.unit_price)}
          </span>
        </div>
      ))}
    </div>
  );
}
export function Address({ cart }: { cart: any }) {
  const a = cart?.shipping_address;
  if (!a) return null;
  return (
    <details className="fv-address">
      <summary>
        <MapPin aria-hidden />
        <span>收货资料</span>
        <ChevronDown aria-hidden />
      </summary>
      <p>
        {a.recipient} · {cart.email}
      </p>
      <p>
        {[a.line1, a.line2, a.city, a.region, a.postal_code, a.country]
          .filter(Boolean)
          .join("，")}
      </p>
    </details>
  );
}
export function Totals({ totals }: { totals: any }) {
  return (
    <>
      <dl className="fv-totals">
        {[
          ["items_subtotal", "商品小计"],
          ["shipping_total", "配送费"],
          ["tax_total", "税费"],
          ["fees_total", "附加费"],
          ["duties_total", "关税"],
          ["discount_total", "优惠"],
        ]
          .filter(([key]) => totals?.[key])
          .map(([key, label]) => (
            <React.Fragment key={key}>
              <dt>{label}</dt>
              <dd>{money(totals[key])}</dd>
            </React.Fragment>
          ))}
      </dl>
      <Separator />
      <div className="fv-total">
        <span>合计</span>
        <span className="fv-total-amount">{money(totals?.grand_total)}</span>
      </div>
    </>
  );
}
export function Order({ order }: { order: any }) {
  const status = order.payment?.status;
  const paid = status === "paid" || status === "captured";
  const payment: Record<string, string> = {
    paid: "已付款",
    unpaid: "未付款",
    partially_paid: "部分付款",
    partially_refunded: "部分退款",
    captured: "已付款",
    authorized: "已授权",
    pending: "处理中",
    requires_action: "等待操作",
    not_paid: "未付款",
    failed: "失败",
    refunded: "已退款",
    voided: "付款已关闭",
  };
  const fulfillment: Record<string, string> = {
    unfulfilled: "待履约",
    partially_fulfilled: "部分履约",
    fulfilled: "已履约",
    shipped: "已发货",
    delivered: "已送达",
  };
  return (
    <article className="fv-order">
      <div className="fv-order-hero">
        <div className="fv-order-icon">
          <CircleCheck aria-hidden />
        </div>
        <div>
          <h4>{order.status === "canceled" ? "订单已取消" : "订单已创建"}</h4>
          <p className="fv-description">
            订单号：{order.display_number ?? order.id}
          </p>
        </div>
      </div>
      <dl className="fv-order-meta">
        <div>
          <dt>支付状态</dt>
          <dd>
            <Badge variant={paid ? "success" : "secondary"}>
              {paid && <Check aria-hidden />}
              {payment[status] ?? status ?? "暂未查到"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>配送进度</dt>
          <dd>
            <Badge>
              <Truck aria-hidden />
              {order.status === "canceled"
                ? "已取消"
                : (fulfillment[order.fulfillment_status] ??
                  order.fulfillment_status ??
                  "暂未查到")}
            </Badge>
          </dd>
        </div>
      </dl>
      <Lines lines={order.lines} />
      <Separator />
      <div className="fv-total">
        <span>订单合计</span>
        <span className="fv-total-amount">
          {money(order.totals?.grand_total)}
        </span>
      </div>
    </article>
  );
}
