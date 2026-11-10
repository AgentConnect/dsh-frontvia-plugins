import { CatalogTerms } from "./catalog-terms.js";
import React from "react";
import {
  Package,
  MapPin,
  ChevronDown,
  CircleCheck,
  CircleX,
  Check,
  Truck,
} from "lucide-react";
import { orderStatus } from "./order-summary.js";
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
            {l.buyer_note && (
              <p className="fv-muted">购买备注：{l.buyer_note}</p>
            )}
            <CatalogTerms terms={l.catalog?.public_snapshot} compact />
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
  const manual = order.fulfillment_kind === "manual";
  const status = order.payment?.status;
  const paid = status === "paid" || status === "captured";
  const summary = orderStatus(order);
  const payment: Record<string, string> = {
    paid: "已付款",
    not_required: "无需付款",
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
    unfulfilled: manual ? "待交付" : "待履约",
    partially_fulfilled: manual ? "部分交付" : "部分履约",
    fulfilled: manual ? "已交付" : "已履约",
    partially_shipped: "部分发货",
    shipped: "已发货",
    partially_delivered: manual ? "部分交付" : "部分送达",
    delivered: manual ? "已交付" : "已送达",
  };
  return (
    <article className="fv-order">
      <div className="fv-order-hero">
        <div className="fv-order-icon" data-variant={summary.variant}>
          {order.status === "canceled" ? (
            <CircleX aria-hidden />
          ) : summary.variant === "success" ? (
            <CircleCheck aria-hidden />
          ) : (
            <Package aria-hidden />
          )}
        </div>
        <div>
          <h4>{summary.label}</h4>
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
          <dt>{manual ? "交付进度" : "配送进度"}</dt>
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
      {order.manual_deliveries?.items?.map((record: any) => (
        <section key={record.record_id} className="fv-stack">
          <h4>{record.kind === "correction" ? "交付更正" : "商家交付"}</h4>
          <p className="fv-product-description">{record.content}</p>
          {record.links
            ?.filter((url: string) => /^https:\/\//.test(url))
            .map((url: string) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                打开交付资料
              </a>
            ))}
          <p className="fv-muted">{record.created_at}</p>
        </section>
      ))}
      {order.shipments?.map((shipment: any) => (
        <section key={shipment.id} className="fv-stack">
          <h4>物流配送</h4>
          {shipment.tracking?.map((tracking: any, i: number) => (
            <p key={i}>
              {tracking.carrier} {tracking.tracking_number}
            </p>
          ))}
          {shipment.logistics?.snapshot ? (
            <>
              <p>物流状态：{shipment.logistics.snapshot.status}</p>
              <ol>
                {shipment.logistics.snapshot.events?.map(
                  (event: any, i: number) => (
                    <li key={i}>
                      <time>{event.time}</time> · {event.description}
                    </li>
                  ),
                )}
              </ol>
            </>
          ) : (
            <p className="fv-muted">暂无物流轨迹</p>
          )}
          {shipment.logistics?.query?.state === "failed" && (
            <p className="fv-muted">
              最新物流查询未成功，已保留上次轨迹。请稍后刷新。
            </p>
          )}
        </section>
      ))}
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
