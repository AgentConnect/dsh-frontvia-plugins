import React, { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Spinner } from "./ui.js";

const labels: Record<string, string> = {
  requires_confirmation: "核对订单",
  processing: "正在核对原订单",
  payment_pending: "待付款",
  paid: "已付款",
  partially_refunded: "已部分退款",
  refunded: "已退款",
  closed: "支付已关闭",
  expired: "报价已失效",
  payment_expired: "付款期限已过",
  unavailable: "暂时无法核对订单",
};
const money = (v: any) => {
  if (v === null) return "已计入总额";
  const n = BigInt(v.amount_minor);
  return `¥${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
};
export function ConversationShopping({
  shopping: s,
  busy,
  onConfirm,
}: {
  shopping: any;
  busy: boolean;
  onConfirm: (intentId: string) => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [s?.intentId]);
  if (!s) return null;
  const q = s.summary,
    a = q?.shipping_address;
  return (
    <section className="fv-cny-purchase" aria-label="人民币购物订单">
      <div className="fv-between">
        <span className="fv-section-title">本次购物</span>
        <Badge>{labels[s.state] ?? "待核对"}</Badge>
      </div>
      {q && (
        <>
          <ul className="fv-cny-lines">
            {q.lines.map((line: any, i: number) => (
              <li key={i}>
                <div>
                  <span>{line.title}</span>
                  <p className="fv-muted">
                    {[
                      line.variant_title,
                      ...(line.attributes ?? []).map(
                        (v: any) => `${v.name ?? v.key}：${v.value}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    · {line.quantity} 件
                  </p>
                </div>
                <span>{money(line.line_total)}</span>
              </li>
            ))}
          </ul>
          <div className="fv-cny-address">
            <span className="fv-muted">收货信息</span>
            <p>
              {a.recipient} · {a.phone}
            </p>
            <p>
              {[a.region, a.city, a.line1, a.line2, a.postal_code]
                .filter(Boolean)
                .join(" ")}
            </p>
          </div>
          <dl className="fv-cny-totals">
            {[
              ["商品小计", "items_subtotal"],
              ["运费", "shipping_total"],
              ["优惠", "discount_total"],
              ["税费", "tax_total"],
              ["关税", "duties_total"],
              ["其他费用", "fees_total"],
              ["应付金额", "grand_total"],
            ].map(([label, key]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{money(q.totals[key])}</dd>
              </div>
            ))}
          </dl>
          {q.delivery_selections?.length > 0 && (
            <p className="fv-muted">
              配送：
              {q.delivery_selections
                .map((v: any) => v.option?.label)
                .filter(Boolean)
                .join("、")}
            </p>
          )}
        </>
      )}
      {s.state === "requires_confirmation" && s.intentId && (
        <div className="fv-stack">
          <p className="fv-muted">
            确认后生成待付款订单并预留库存，付款仍由你本人完成。
          </p>
          {s.expires_at && (
            <p className="fv-muted">
              报价有效至 {new Date(s.expires_at * 1000).toLocaleString("zh-CN")}
            </p>
          )}
          <label className="fv-cny-consent">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            我已核对商品、收货信息和应付金额
          </label>
          <Button
            disabled={busy || !checked}
            onClick={() => onConfirm(s.intentId)}
          >
            <ShieldCheck aria-hidden />
            {busy ? "正在提交确认…" : "确认购买"}
          </Button>
        </div>
      )}
      {s.state === "processing" && (
        <p role="status">
          <Spinner />
          {s.recovery_required
            ? "原购物请求结果待核对。请在对话中要求商家恢复原操作，不要重新下单。"
            : "正在查询原订单，请勿重复下单或付款。"}
        </p>
      )}
      {s.state === "payment_pending" && (
        <div className="fv-stack">
          <p className="fv-muted">
            请在付款页核对收款方，通过支付宝完成付款。截止时间：
            {new Date(s.checkout.expires_at).toLocaleString("zh-CN")}
          </p>
          {s.payment ? (
            <a
              className="fv-button"
              href={s.payment.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              <ExternalLink aria-hidden />
              去支付宝付款
            </a>
          ) : (
            <p>付款入口暂不可用，请刷新原订单。</p>
          )}
          <p className="fv-muted">
            返回后会重新查询支付结果；打开或关闭付款页不代表付款成功。
          </p>
        </div>
      )}
      {["paid", "partially_refunded", "refunded"].includes(s.state) && (
        <p role="status">
          {labels[s.state]}，请勿重复付款。可在对话中继续查询原订单或申请售后。
        </p>
      )}
      {["expired", "payment_expired", "unavailable", "closed"].includes(
        s.state,
      ) && (
        <Alert>
          <AlertDescription>
            {s.state === "expired"
              ? "商品、地址或报价有效期已变化。请在对话中重新核对方案，再确认新报价。"
              : s.state === "payment_expired"
                ? "付款期限已过，请先核对原订单及支付关闭结果。"
                : s.state === "closed"
                  ? "原支付已关闭。请查询原订单后再决定下一步。"
                  : "暂时无法取得当前订单状态。请刷新重试，已有订单和付款不会重新提交。"}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
