export type ToolSummary = {
  error?: boolean;
  title: string;
  detail?: string;
  products?: { title: string; price?: string }[];
};

function valueOf(message: any) {
  for (const block of message?.content ?? []) {
    if (block.type !== "text") continue;
    try {
      const value = JSON.parse(block.text);
      if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    } catch {}
  }
}
function price(value: any) {
  if (typeof value?.currency !== "string") return undefined;
  if (typeof value.amount_decimal === "string")
    return `${value.currency} ${value.amount_decimal}`;
  if (
    typeof value.amount_minor === "string" &&
    /^\d+$/.test(value.amount_minor)
  ) {
    const n = BigInt(value.amount_minor);
    return `${value.currency} ${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
  }
}

/** Human-readable feedback only. Never dump protocol errors or internal IDs. */
export function summarizeToolResult(name: string, message: any): ToolSummary {
  const value = valueOf(message);
  if (value?.error || message?.isError || !value) {
    const errors: Record<string, string> = {
      PERSONAL_LOGIN_REQUIRED: "请先到 Frontvia 服务登录个人账号。",
      PERSONAL_ACCOUNT_CHANGED: "账号已变化，请登录原账号或新建聊天。",
      PERSONAL_CHAT_ACCOUNT_CHANGED: "此聊天属于另一账号，请新建聊天。",
      METHOD_UNAVAILABLE: "当前连接尚未开通这项服务，操作未执行。",
      PURCHASE_PROFILE_UNAVAILABLE: "当前连接尚未开通购物服务，操作未执行。",
      METHOD_NOT_ADVERTISED: "商家暂未开放这项服务。",
      NETWORK_TIMEOUT: "商家响应超时，请稍后重试。",
      CONNECTION_DISCONNECTED: "连接已断开，请到 PAP 连接重新连接商家。",
      CANCELLED: "操作已取消。",
      ABORTED: "操作已取消。",
    };
    return {
      error: true,
      title:
        errors[value?.error?.code] ??
        (name === "frontvia_products"
          ? "商品查询未完成。请浏览商品目录，或使用具体关键词重试。"
          : "Frontvia 操作未完成，请检查连接或稍后重试。"),
    };
  }
  if (name === "frontvia_products") {
    const data = value.data;
    const rows = Array.isArray(data?.items)
      ? data.items
      : data?.id
        ? [data]
        : [];
    const variants = rows.some((v: any) => v.product_id || v.unit_price);
    return {
      title: rows.length
        ? `找到 ${rows.length} ${variants ? "项规格" : "件商品"}`
        : "没有找到匹配的商品",
      detail:
        data?.page?.has_more === true
          ? "还有更多商品，可以继续查看下一页。"
          : undefined,
      products: rows.slice(0, 20).map((p: any) => ({
        title: typeof p.title === "string" ? p.title : "未命名商品",
        price: price(
          p.unit_price ?? p.price_range?.minimum ?? p.price_range?.min,
        ),
      })),
    };
  }
  if (name === "frontvia_connection")
    return {
      title: value.ui
        ? "商家服务已连接"
        : `发现 ${Array.isArray(value.sites) ? value.sites.length : 0} 项商家服务`,
    };
  const labels: Record<string, string> = {
    frontvia_consultation: "商家咨询已更新",
    frontvia_knowledge: "商家知识查询已完成",
    frontvia_cart: "购物车已更新",
    frontvia_checkout: "结算信息已更新，请核对卡片",
    frontvia_orders: "订单查询已更新",
  };
  return { title: labels[name] ?? "Frontvia 服务结果已更新" };
}
