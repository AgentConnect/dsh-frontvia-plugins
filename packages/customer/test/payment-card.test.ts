import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentCard, paymentState } from "../src/client/payment-card.js";

const now = Date.parse("2026-11-07T06:00:00Z");
const expiry = new Date(now + 300000).toISOString();
const amount = { currency: "CNY", amount_minor: "28990" };
function view(status = "unpaid") {
  return {
    order: {
      id: "private-order-id",
      payment: { status },
      totals: { grand_total: amount },
    },
    checkout: {
      status: "completed",
      paymentAction: {
        url: "https://shop.test/pay?access=private",
        expiresAt: expiry,
      },
      paymentExpiresAt: expiry,
    },
    intent: { submitted: true },
  };
}
const render = (data: any, time = now, busy = false) =>
  renderToStaticMarkup(
    createElement(PaymentCard, {
      data,
      now: time,
      busy,
      refresh() {},
      formatPrice: (m: any) => `${m.currency} ${Number(m.amount_minor) / 100}`,
    }),
  );

test("confirmed unpaid orders show original payment link, exact order total and deadline without inferring success", () => {
  const data = {
    ...view(),
    quote: { totals: { grand_total: { currency: "CNY", amount_minor: "1" } } },
  };
  const html = render(data);
  for (const text of [
    "待付款",
    "应付金额",
    "CNY 289.9",
    "剩余约 5 分钟",
    "去付款",
    "刷新支付状态",
    'target="_blank"',
    'referrerPolicy="no-referrer"',
  ])
    assert(html.includes(text), text);
  assert.doesNotMatch(html, /已支付|private-order-id|CNY 0.01/);
  assert.match(html, /href="https:\/\/shop.test\/pay\?access=private"/);
  assert.equal(render({}), "");
});
test("inline QR is rendered as an inert image and disappears on payment, expiry or unresolved operation", () => {
  const data = {
    ...view("pending"),
    inlinePayment: true,
    paymentQr: {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      payee: "测试收款商家",
      expiresAt: expiry,
    },
  };
  const html = render(data);
  assert.match(html, /等待扫码支付/);
  assert.match(html, /src="data:image\/svg\+xml/);
  assert.match(html, /测试收款商家/);
  assert.match(html, /支付宝扫码/);
  assert.doesNotMatch(
    html,
    /href=|<svg xmlns="http:\/\/www.w3.org\/2000\/svg"><path d="M0/,
  );
  assert.doesNotMatch(render(data, now + 300001), /src="data:image/);
  assert.match(render(data, now + 300001), /付款入口已过期/);
  for (const status of ["paid", "refunded", "failed", "unknown"]) {
    assert.doesNotMatch(
      render({ ...data, order: { ...data.order, payment: { status } } }),
      /src="data:image/,
    );
  }
  assert.doesNotMatch(render({ ...data, pending: true }), /src="data:image/);
});

test("latest paid, pending, failed, refunded and canceled states suppress a stale payment link", () => {
  for (const [status, label] of [
    ["paid", "已支付"],
    ["captured", "已支付"],
    ["pending", "支付处理中"],
    ["authorized", "支付处理中"],
    ["failed", "支付未完成"],
    ["refunded", "已退款"],
    ["partially_refunded", "部分退款"],
    ["unknown", "支付结果待核对"],
  ]) {
    const html = render(view(status));
    assert(html.includes(label), status);
    assert.doesNotMatch(html, /href=|去付款|继续支付/);
  }
  const canceled = view();
  Object.assign(canceled.order, { status: "canceled" });
  assert.match(render(canceled), /付款已关闭/);
  assert.doesNotMatch(render(canceled), /href=/);
  assert.match(render({ ...view("paid"), pending: true }), /支付结果待核对/);
});

test("expiry removes payment immediately without a server refresh; expired owner metadata preserves explanation", () => {
  const expired = render(view(), now + 300000);
  assert.match(expired, /付款入口已过期/);
  assert.doesNotMatch(expired, /href=|去付款/);
  const data: any = view();
  delete data.checkout.paymentAction;
  assert.match(render(data, now + 300001), /付款入口已过期/);
  assert.match(render(data), /暂未取得可用的付款入口/);
  assert.doesNotMatch(render(data), /href=/);
  data.checkout.paymentAction = {
    url: "https://shop.test/pay",
    expiresAt: "invalid",
  };
  delete data.checkout.paymentExpiresAt;
  assert.doesNotMatch(render(data), /href=/);
});

test("partial payment labels total accurately; busy and unresolved confirmation cannot invite another payment", () => {
  assert.match(render(view("partially_paid")), /订单总额/);
  assert.match(render(view("partially_paid")), /继续支付/);
  assert.doesNotMatch(render(view("partially_paid")), /<span>应付金额/);
  assert.doesNotMatch(render(view(), now, true), /href=/);
  assert.match(render(view(), now, true), /disabled=""/);
  assert.equal(paymentState({ ...view(), pending: true }, now), "unknown");
  assert.doesNotMatch(render({ ...view(), pending: true }), /href=/);
  assert.match(
    render({ ...view(), mockPayment: true }),
    /测试环境 · Mock 支付/,
  );
});

test("cancellation receipt suppresses QR without falsely claiming the order is canceled", () => {
  const data = {
    ...view("pending"),
    pending: true,
    cancelPending: true,
    paymentQr: { svg: "private-qr", expiresAt: expiry },
  };
  const html = render(data);
  assert.match(html, /正在核对取消结果/);
  assert.doesNotMatch(html, /data:image|href=|原订单已取消/);
});
test("only host-authorized cancellation renders an owner confirmation entry", () => {
  const props = {
    now,
    busy: false,
    refresh() {},
    formatPrice: () => "CNY 0.01",
    cancel: async () => true,
  };
  const enabled = renderToStaticMarkup(
    createElement(PaymentCard, {
      ...props,
      data: { ...view(), canCancelOrder: true },
    }),
  );
  assert.match(enabled, />取消订单<\/button>/);
  assert.doesNotMatch(enabled, />确认取消订单<\/button>/);
  const disabled = renderToStaticMarkup(
    createElement(PaymentCard, {
      ...props,
      data: { ...view("paid"), canCancelOrder: false },
    }),
  );
  assert.doesNotMatch(disabled, /取消订单/);
});

test("free orders never show payment links or claim captured money", () => {
  const data = view("not_required");
  Object.assign(data.order, {
    payment_required: false,
    totals: { grand_total: { currency: "CNY", amount_minor: "0" } },
  });
  assert.equal(paymentState(data, now), "not_required");
  assert.match(render(data), /无需付款/);
  assert.doesNotMatch(render(data), /去付款|已支付|href=|支付二维码/);
  data.order.totals.grand_total.amount_minor = "1";
  assert.equal(paymentState(data, now), "unknown");
});
