import React, { useEffect, useState } from "react";
import {
  CircleCheck,
  CreditCard,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge, Button, Spinner } from "./ui.js";

/** Only the owner view supplies payment links. Catalog history never owns payment state. */
export function paymentState(data: any, now: number) {
  const status =
    data.order?.payment?.status ?? data.checkout?.payment_summary?.status;
  const expiry = Date.parse(
    data.paymentQr?.expiresAt ??
      data.checkout?.paymentExpiresAt ??
      data.checkout?.paymentAction?.expiresAt,
  );
  if (data.cancelPending) return "canceling";
  if (data.pending) return "unknown";
  if (status === "refunded") return "refunded";
  if (status === "partially_refunded") return "partially_refunded";
  if (["paid", "captured"].includes(status)) return "paid";
  if (
    ["canceled", "failed"].includes(data.order?.status) ||
    data.checkout?.status === "canceled" ||
    status === "voided"
  )
    return "closed";
  if (status === "failed" || data.checkout?.status === "failed")
    return "failed";
  if (
    data.paymentQr &&
    [
      "pending",
      "unpaid",
      "requires_action",
      "not_paid",
      "partially_paid",
    ].includes(status)
  )
    return expiry > now ? "scan" : "expired";
  if (status === "pending" && Number.isFinite(expiry) && expiry <= now)
    return "expired";
  if (["pending", "processing", "authorized"].includes(status))
    return "processing";
  if (
    !["unpaid", "not_paid", "requires_action", "partially_paid"].includes(
      status,
    )
  )
    return "unknown";
  if (Number.isFinite(expiry) && expiry <= now) return "expired";
  if (status === "partially_paid") return "partially_paid";
  return "unpaid";
}

const labels = {
  canceling: [
    "正在核对取消结果",
    "正在确认支付关闭及订单取消，请查询原订单结果，暂勿付款。",
  ],
  scan: [
    "等待扫码支付",
    "请使用支付宝扫描下方二维码。已付款时，请等待原订单结果更新。",
  ],
  unpaid: ["待付款", "订单已确认，完成付款后会在这里更新支付和配送进度。"],
  partially_paid: [
    "部分付款",
    "已收到部分款项，剩余应付金额请在原订单付款页核对。",
  ],
  paid: ["已支付", "商家已确认收款，配送进度见下方订单。"],
  processing: ["支付处理中", "正在等待支付渠道确认，请刷新原订单结果。"],
  expired: [
    "付款入口已过期",
    "原订单已保留。刷新付款信息；若仍不可用，请联系商家处理原订单。",
  ],
  failed: [
    "支付未完成",
    "支付渠道返回失败。请刷新核对原订单，或联系商家继续处理。",
  ],
  closed: ["付款已关闭", "原订单已取消或付款已关闭。"],
  refunded: ["已退款", "商家已确认退款，到账时间以支付渠道为准。"],
  partially_refunded: ["部分退款", "商家已确认部分退款，详情请查看原订单。"],
  unknown: ["支付结果待核对", "暂未确认原订单的支付结果，请刷新查询。"],
} as const;

export function PaymentCard({
  data,
  now,
  busy,
  refresh,
  formatPrice,
  start,
  cancel,
}: {
  data: any;
  now: number;
  busy: boolean;
  refresh: () => void;
  formatPrice: (amount: any) => string;
  start?: () => void;
  cancel?: () => Promise<boolean>;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    setConfirmCancel(false);
  }, [data.order?.id, data.canCancelOrder]);
  if (!data.order && !data.intent?.submitted) return null;
  const state = paymentState(data, now);
  const [title, description] = labels[state];
  const action = data.checkout?.paymentAction;
  const expires = Date.parse(
    data.paymentQr?.expiresAt ??
      data.checkout?.paymentExpiresAt ??
      action?.expiresAt,
  );
  const payable = ["unpaid", "partially_paid"].includes(state);
  const validLink =
    payable &&
    Number.isFinite(expires) &&
    expires > now &&
    typeof action?.url === "string" &&
    /^https:\/\//.test(action.url);
  const minutes = Math.max(1, Math.ceil((expires - now) / 60000));
  return (
    <section className="fv-payment fv-stack" aria-label="订单支付">
      <div className="fv-between">
        <h4 className="fv-row">
          {state === "paid" ? (
            <CircleCheck aria-hidden />
          ) : (
            <CreditCard aria-hidden />
          )}
          订单支付
        </h4>
        <Badge variant={state === "paid" ? "success" : "secondary"}>
          {title}
        </Badge>
      </div>
      <div className="fv-total">
        <span>{state === "unpaid" ? "应付金额" : "订单总额"}</span>
        <span className="fv-total-amount">
          {formatPrice(
            data.order?.totals?.grand_total ?? data.quote?.totals?.grand_total,
          )}
        </span>
      </div>
      <p className="fv-muted" role="status">
        {description}
      </p>
      {data.mockPayment && <p className="fv-muted">测试环境 · Mock 支付</p>}
      {state === "scan" && (
        <div className="fv-payment-qr">
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.paymentQr.svg)}`}
            alt="原订单支付宝付款二维码"
            width="280"
            height="280"
          />
          <p>收款方：{data.paymentQr.payee}</p>
          <p className="fv-muted">二维码剩余约 {minutes} 分钟 · 支付宝扫码</p>
        </div>
      )}
      {validLink && state !== "scan" && (
        <p className="fv-muted">
          付款入口剩余约 {minutes} 分钟 · 支付方式在付款页选择
        </p>
      )}
      {payable && !validLink && (
        <p className="fv-muted">暂未取得可用的付款入口，请刷新付款信息。</p>
      )}
      <div className="fv-payment-actions">
        {data.inlinePayment &&
          start &&
          (validLink || state === "processing") && (
            <Button disabled={busy} onClick={start}>
              {busy ? <Spinner /> : <CreditCard aria-hidden />}获取支付二维码
            </Button>
          )}
        {validLink && !busy && !data.inlinePayment && (
          <a
            className="fv-button"
            href={action.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            onClick={(event) => {
              if (Date.now() >= expires) {
                event.preventDefault();
                refresh();
              }
            }}
          >
            <ExternalLink aria-hidden />
            {state === "partially_paid" ? "继续支付" : "去付款"}
          </a>
        )}
        <Button variant="outline" disabled={busy} onClick={refresh}>
          {busy ? <Spinner /> : <RefreshCw aria-hidden />}
          {busy ? "正在核对支付…" : "刷新支付状态"}
        </Button>
        {data.canCancelOrder && cancel && !confirmCancel && (
          <Button
            variant="ghost"
            className="fv-cancel-order"
            disabled={busy}
            onClick={() => setConfirmCancel(true)}
          >
            <X aria-hidden />
            取消订单
          </Button>
        )}
      </div>
      {data.canCancelOrder && cancel && confirmCancel && (
        <div className="fv-confirm-box" role="group" aria-label="确认取消订单">
          <p>确认取消这笔未付款订单？取消成功后，原付款二维码将失效。</p>
          <p className="fv-muted">
            如果付款已完成，将保留订单并提示联系商家处理。
          </p>
          <div className="fv-payment-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmCancel(false)}
            >
              保留订单
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void cancel().then((ok) => {
                  if (ok) setConfirmCancel(false);
                });
              }}
            >
              {busy && <Spinner />}确认取消订单
            </Button>
          </div>
        </div>
      )}
      {validLink && !data.inlinePayment && (
        <p className="fv-muted">
          将在付款页完成授权。返回后自动同步，支付成功以商家确认结果为准。
        </p>
      )}
      {(data.inlinePayment || state === "scan") && (
        <p className="fv-muted">
          卡片会自动核对支付进度，付款成功以商家确认结果为准。
        </p>
      )}
    </section>
  );
}
