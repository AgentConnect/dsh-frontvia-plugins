export function orderLabel(order: any): string {
  if (order.display_number != null) return `订单 #${order.display_number}`;
  const id = String(order.id ?? order.order_id ?? "");
  return id ? `订单 ${id.length > 12 ? `…${id.slice(-12)}` : id}` : "订单";
}

/** Presentation only: missing reference fields never imply unpaid or successful. */
export function orderStatus(order: any): {
  label: string;
  variant: "secondary" | "success" | "warning";
} {
  if (order.status === "canceled")
    return { label: "已取消", variant: "secondary" };
  const payment = order.payment?.status;
  if (payment === "refunded") return { label: "已退款", variant: "secondary" };
  if (payment === "partially_refunded")
    return { label: "部分退款", variant: "secondary" };
  if (payment === "voided")
    return { label: "付款已关闭", variant: "secondary" };
  if (
    ["unpaid", "not_paid", "partially_paid", "requires_action"].includes(
      payment,
    )
  )
    return {
      label: payment === "partially_paid" ? "部分付款" : "待付款",
      variant: "warning",
    };
  if (payment === "failed") return { label: "支付失败", variant: "warning" };
  if (payment === "pending") return { label: "支付处理中", variant: "warning" };
  if (order.fulfillment_status === "delivered" || order.status === "completed")
    return { label: "已完成", variant: "success" };
  if (order.fulfillment_status === "shipped")
    return { label: "已发货", variant: "secondary" };
  if (["paid", "captured"].includes(payment))
    return { label: "已付款", variant: "success" };
  if (payment === "not_required" && order.payment_required === false)
    return { label: "无需付款 · 待交付", variant: "secondary" };
  if (payment === "authorized")
    return { label: "支付已授权", variant: "secondary" };
  return { label: "状态待查看", variant: "secondary" };
}

/** Only enrich references from this flow's already returned data. No extra reads. */
export function storefrontOrders(data: any): any[] {
  const page = Array.isArray(data?.orders)
    ? data.orders
    : (data?.orders?.items ?? []);
  const rows = new Map<string, any>();
  for (const order of [data?.order, ...page]) {
    const id = order?.id ?? order?.order_id;
    if (typeof id !== "string" || !id) continue;
    const detail =
      data?.order?.id === id
        ? data.order
        : data?.viewedOrder?.id === id
          ? data.viewedOrder
          : undefined;
    rows.set(id, { ...order, ...detail, id });
  }
  return [...rows.values()];
}
