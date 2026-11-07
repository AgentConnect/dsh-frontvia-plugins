import type { ViewScope } from "../view-scope.js";
import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Empty,
  EmptyTitle,
  EmptyDescription,
  Field,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldLabel,
  Input,
  Separator,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./ui.js";
import { items, money, Lines, Totals, Order } from "./commerce-display.js";
import { productImage } from "./product-image.js";
import { PaymentCard } from "./payment-card.js";
import { isRequiredContact } from "../contact-fields.js";
import type { ShoppingAction } from "../shopping-action.js";
type Action = (operation: string, payload?: any) => Promise<boolean>;
type Props = {
  data: any;
  busy: boolean;
  error: string;
  action: Action;
  now: number;
  startShopping?: () => void;
  onViewChange?: (scope: ViewScope, refresh?: boolean) => void;
};
const steps = [
  "填写收货地址",
  "选择配送方式",
  "核对订单信息",
  "选择支付方式",
  "支付订单",
];
const shippingStatus: Record<string, string> = {
  pending: "待处理",
  ready: "待发货",
  shipped: "已发货",
  delivered: "已送达",
  canceled: "已取消",
  unknown: "暂未更新",
};
const contactFields = [
  ["recipient", "收货人", "shipping name", 200],
  ["phone", "联系电话", "shipping tel", 40],
  ["line1", "完整收货地址", "shipping address-line1", 300],
  ["region", "省 / 州 / 地区", "shipping address-level1", 100],
  ["city", "城市", "shipping address-level2", 100],
  ["postal_code", "邮编", "shipping postal-code", 40],
  ["email", "联系邮箱", "email", 254],
] as const;
function AddressForm({
  data,
  busy,
  action,
  next,
}: {
  data: any;
  busy: boolean;
  action: Action;
  next: () => Promise<void>;
}) {
  const id = useId();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...data.cart.shipping_address,
    email: data.cart.email ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
          const { email, ...address } = form;
          const ok = await action("contact", {
            expected_version: data.cart.version,
            actionId: crypto.randomUUID(),
            patch: {
              ...(email?.trim() ? { email: email.trim() } : {}),
              shipping_address: { ...address, country: data.pricing.country },
            },
          });
          if (ok) await next();
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      }}
      className="fv-stack"
    >
      <FieldGroup>
        {contactFields.map(([key, label, autoComplete, max]) => (
          <Field
            key={key}
            className={key === "line1" ? "fv-wide" : undefined}
            data-disabled={busy || saving}
          >
            <FieldLabel htmlFor={`${id}-${key}`}>
              {label}
              {!isRequiredContact(data.pricing.country, key) && "（选填）"}
            </FieldLabel>
            <Input
              id={`${id}-${key}`}
              name={key}
              autoComplete={autoComplete}
              required={isRequiredContact(data.pricing.country, key)}
              maxLength={max}
              type={
                key === "email" ? "email" : key === "phone" ? "tel" : "text"
              }
              value={form[key] ?? ""}
              disabled={busy || saving}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </Field>
        ))}
      </FieldGroup>
      <p className="fv-muted">
        配送国家 / 地区：{data.pricing.country === "CN" ? "中国" : "美国"}
        。收货资料仅用于配送，不会发送给 AI 模型。
      </p>
      <Button type="submit" disabled={busy || saving}>
        {saving && <Spinner />}保存地址，选择配送
        <ArrowRight data-icon="inline-end" />
      </Button>
    </form>
  );
}
function Logistics({ order }: { order: any }) {
  const shipments = order.shipments ?? [];
  return (
    <Card>
      <CardHeader>
        <Truck />
        <CardTitle>物流与配送</CardTitle>
        <CardDescription>以商家提供的最新信息为准</CardDescription>
      </CardHeader>
      <CardContent>
        {shipments.length ? (
          shipments.map((shipment: any) => (
            <div key={shipment.id} className="fv-stack">
              <Badge>{shippingStatus[shipment.status] ?? "暂未更新"}</Badge>
              {(shipment.tracking ?? []).map((tracking: any, index: number) => (
                <div key={index}>
                  <p>{tracking.carrier ?? "承运商未提供"}</p>
                  <p>运单号：{tracking.tracking_number ?? "暂未提供"}</p>
                  {typeof tracking.tracking_url === "string" &&
                    /^https:\/\//.test(tracking.tracking_url) && (
                      <a
                        href={tracking.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        查看承运商物流
                      </a>
                    )}
                </div>
              ))}
            </div>
          ))
        ) : (
          <Empty>
            <EmptyTitle>暂无运单信息</EmptyTitle>
            <EmptyDescription>
              商家发货并提供物流信息后，会显示在这里。
            </EmptyDescription>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
export function Storefront({
  data,
  busy,
  error,
  action,
  now,
  startShopping,
  onViewChange,
}: Props) {
  const [tab, setTab] = useState("products");
  const [step, setStep] = useState<number>();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(false);
  const [notice, setNotice] = useState("");
  const [orderDetail, setOrderDetail] = useState(false);
  const [paymentSelected, setPaymentSelected] = useState(false);
  useEffect(() => {
    onViewChange?.(
      tab === "products"
        ? "catalog"
        : tab === "orders"
          ? orderDetail
            ? "order-detail"
            : "order"
          : tab === "cart"
            ? "cart"
            : "checkout",
      !orderDetail,
    );
  }, [tab, orderDetail, onViewChange]);
  const initialized = useRef(false);
  const shop = (intent: ShoppingAction["intent"]) =>
    action("shopping", {
      intent,
      expected_version: data?.cart?.version,
      actionId: crypto.randomUUID(),
    });
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    if (data.variantProductId && data.variants) setDetail(true);
    if (data.intent?.submitted || data.order) setTab("orders");
    else if (data.quote) setTab("checkout");
    // A restored view is display-only. Keep it visible while revalidating the
    // current catalog, even when the persisted flow already contains products.
    if (!data.intent?.submitted && !data.order && !data.quote)
      void shop(
        data.variantProductId
          ? {
              action: "product",
              productId: data.variantProductId,
              refresh: true,
            }
          : { action: "browse", refresh: true },
      );
  }, [data]);
  const locked = !!data?.intent?.submitted || !!data?.order;
  const blocked = busy || !!data?.pending;
  const checkoutStep = locked
    ? 4
    : (step ??
      (data?.intent
        ? 3
        : data?.quote
          ? 2
          : data?.cart?.shipping_address
            ? 1
            : 0));
  const quoteExpired = !data?.quote || Date.parse(data.quote.expires_at) <= now;
  const intentExpired = !data?.intent || data.intent.expiresAt <= now;
  const cartLines = locked ? [] : (data?.cart?.lines ?? []);
  const orderCount = (
    data?.order?.lines ??
    data?.quote?.lines ??
    data?.cart?.lines ??
    []
  ).reduce((sum: number, line: any) => sum + line.quantity, 0);
  const count = cartLines.reduce(
    (sum: number, line: any) => sum + line.quantity,
    0,
  );
  const edit = async () => {
    if (await shop({ action: "edit-cart" })) {
      setStep(0);
      setTab("cart");
      setPaymentSelected(false);
    }
  };
  const browse = async (cursor?: string) => {
    if (await shop({ action: "browse", query, cursor })) setDetail(false);
  };
  const product = items(data?.products).find(
    (p: any) => p.id === data?.variantProductId,
  );
  const image = productImage(product);
  const selectedOrder = orderDetail ? data?.viewedOrder : data?.order;
  return (
    <section
      className="fv-storefront fv-stack"
      aria-label="店铺商城"
      aria-busy={busy}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action("view")}
          >
            重新加载
          </Button>
        </Alert>
      )}
      {!data ? (
        <div role="status">
          <Skeleton className="fv-skeleton-block" />
          <p>正在读取店铺…</p>
        </div>
      ) : (
        <>
          {data.pending && (
            <Alert variant="warning">
              <AlertDescription>
                上次操作结果尚未明确，请先核对结果。
              </AlertDescription>
              <Button disabled={busy} onClick={() => action("recover")}>
                核对原操作
              </Button>
            </Alert>
          )}
          {data.cartReady === false && (
            <Alert>
              <AlertDescription>
                当前商家仅开放商品浏览，购物车暂不可用。
              </AlertDescription>
            </Alert>
          )}
          {notice && (
            <p role="status" className="fv-store-notice">
              <Check />
              {notice}
              <Button variant="ghost" size="sm" onClick={() => setTab("cart")}>
                查看购物车
              </Button>
            </p>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              if (value === "products" && !data.products) void browse();
              if (value === "orders") {
                setOrderDetail(false);
                void shop({ action: "orders" });
              }
            }}
          >
            <div className="fv-shop-navigation">
              <TabsList aria-label="店铺导航">
                <TabsTrigger value="products">
                  <ShoppingBag />
                  商品
                </TabsTrigger>
                <TabsTrigger value="cart">
                  <ShoppingCart />
                  购物车 {count > 0 ? `(${count})` : ""}
                </TabsTrigger>
                <TabsTrigger
                  value="checkout"
                  disabled={!cartLines.length && !locked}
                >
                  <CreditCard />
                  结账
                </TabsTrigger>
                <TabsTrigger value="orders">
                  <Package />
                  我的订单
                </TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon"
                aria-label="刷新店铺数据"
                disabled={busy}
                onClick={() =>
                  tab === "products"
                    ? detail && data.variantProductId
                      ? shop({
                          action: "product",
                          productId: data.variantProductId,
                          refresh: true,
                        })
                      : shop({ action: "browse", query, refresh: true })
                    : action("view")
                }
              >
                {busy ? <Spinner /> : <RefreshCw />}
              </Button>
            </div>
            <TabsContent value="products">
              <div className="fv-stack">
                {detail ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => browse()}
                      disabled={busy}
                    >
                      <ArrowLeft data-icon="inline-start" />
                      返回商品列表
                    </Button>
                    <div className="fv-product-detail">
                      <div className="fv-detail-image">
                        {image ? (
                          <img
                            src={image}
                            alt={product?.title ?? "商品"}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Package />
                        )}
                      </div>
                      <div className="fv-stack">
                        <p className="fv-eyebrow">商品详情</p>
                        <h3>{product?.title ?? "选择商品规格"}</h3>
                        <p className="fv-product-description">
                          {product?.description ?? "商家暂未提供商品介绍。"}
                        </p>
                        <Separator />
                        <h4>规格与库存</h4>
                        {items(data.variants).length ? (
                          items(data.variants).map((v: any) => {
                            const unavailable =
                              ["out_of_stock", "unavailable"].includes(
                                v.availability?.status,
                              ) || v.availability?.quantity_available === 0;
                            return (
                              <Card key={v.id}>
                                <CardHeader>
                                  <CardTitle>
                                    {v.title === "Default"
                                      ? "默认规格"
                                      : v.title}
                                  </CardTitle>
                                  <CardDescription>
                                    {v.selected_options
                                      ?.map((o: any) => `${o.name}：${o.value}`)
                                      .join(" · ") || v.sku}
                                  </CardDescription>
                                </CardHeader>
                                <CardContent>
                                  <p className="fv-price">
                                    {money(v.unit_price)}
                                  </p>
                                  <p className="fv-muted">
                                    {unavailable
                                      ? "暂时缺货"
                                      : v.availability?.quantity_available !=
                                          null
                                        ? `可购 ${v.availability.quantity_available} 件`
                                        : "库存以下单时核对为准"}
                                  </p>
                                </CardContent>
                                <CardFooter>
                                  <Button
                                    disabled={
                                      blocked ||
                                      unavailable ||
                                      !data.cartReady ||
                                      locked ||
                                      !!data.checkout
                                    }
                                    onClick={async () => {
                                      if (
                                        await shop({
                                          action: "add",
                                          variantId: v.id,
                                          productName: product?.title ?? "商品",
                                          variantName: v.title ?? "默认规格",
                                          quantity: 1,
                                        })
                                      )
                                        setNotice("已加入购物车");
                                    }}
                                  >
                                    <ShoppingCart data-icon="inline-start" />
                                    加入购物车
                                  </Button>
                                </CardFooter>
                              </Card>
                            );
                          })
                        ) : (
                          <Empty>
                            <EmptyTitle>暂无可购买规格</EmptyTitle>
                          </Empty>
                        )}
                        {data.variants?.page?.has_more &&
                          data.variants.page.next_cursor && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                shop({
                                  action: "variant-page",
                                  productId: data.variantProductId,
                                  cursor: data.variants.page.next_cursor,
                                })
                              }
                            >
                              下一页规格
                            </Button>
                          )}
                        {(locked || data.checkout) && (
                          <p className="fv-muted">
                            {locked
                              ? "这次购物已提交订单，可在店铺顶部开始新的购物。"
                              : "已准备结账，如需加购请先返回购物车修改。"}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="fv-section-heading">
                      <div>
                        <h3>店内商品</h3>
                        <p className="fv-description">
                          发现喜欢的，选好规格再加入购物车。
                        </p>
                      </div>
                      <form
                        className="fv-search-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void browse();
                        }}
                      >
                        <Field>
                          <FieldLabel
                            className="fv-sr-only"
                            htmlFor="fv-product-query"
                          >
                            搜索商品
                          </FieldLabel>
                          <Input
                            id="fv-product-query"
                            placeholder="搜索店内商品"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            maxLength={300}
                          />
                        </Field>
                        <Button variant="outline" type="submit" disabled={busy}>
                          <Search data-icon="inline-start" />
                          搜索
                        </Button>
                      </form>
                    </div>
                    {items(data.products).length ? (
                      <div className="fv-catalog-grid">
                        {items(data.products).map((p: any) => (
                          <Card className="fv-catalog-item" key={p.id}>
                            <div className="fv-catalog-image">
                              {productImage(p) ? (
                                <img
                                  loading="lazy"
                                  src={productImage(p)}
                                  alt={p.title}
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <Package />
                              )}
                            </div>
                            <CardHeader>
                              <CardTitle>{p.title}</CardTitle>
                              <CardDescription>
                                {p.subtitle ?? "查看商品介绍与可选规格"}
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <p className="fv-price">
                                {money(
                                  p.price_range?.minimum ??
                                    p.price_range?.min ??
                                    p.price_range?.min_price ??
                                    p.unit_price ??
                                    p.price,
                                )}
                              </p>
                            </CardContent>
                            <CardFooter>
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={async () => {
                                  if (
                                    await shop({
                                      action: "product",
                                      productId: p.id,
                                    })
                                  ) {
                                    setDetail(true);
                                    setNotice("");
                                  }
                                }}
                              >
                                查看详情
                                <ArrowRight data-icon="inline-end" />
                              </Button>
                            </CardFooter>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Empty>
                        <ShoppingBag />
                        <EmptyTitle>
                          {busy ? "正在查找商品" : "暂无匹配商品"}
                        </EmptyTitle>
                        <EmptyDescription>
                          可以换个关键词，或稍后再来。
                        </EmptyDescription>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => browse()}
                        >
                          刷新商品
                        </Button>
                      </Empty>
                    )}
                    {data.products?.page?.has_more &&
                      data.products.page.next_cursor && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => browse(data.products.page.next_cursor)}
                        >
                          下一页商品
                        </Button>
                      )}
                  </>
                )}
              </div>
            </TabsContent>
            <TabsContent value="cart">
              <div className="fv-stack">
                <div className="fv-section-heading">
                  <h3>购物车</h3>
                  <Badge>{count} 件商品</Badge>
                </div>
                {cartLines.length ? (
                  <div className="fv-checkout-layout">
                    <div className="fv-stack">
                      {cartLines.map((line: any) => (
                        <div className="fv-cart-item" key={line.id}>
                          <div className="fv-line-image">
                            <Package />
                          </div>
                          <div className="fv-stack">
                            <h4>
                              {line.title ??
                                line.product_title ??
                                line.variant_title}
                            </h4>
                            <p className="fv-muted">{line.variant_title}</p>
                            <div className="fv-row">
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`减少 ${line.title ?? "商品"} 数量`}
                                disabled={
                                  blocked || locked || line.quantity <= 1
                                }
                                onClick={() =>
                                  shop({
                                    action: "update-line",
                                    lineId: line.id,
                                    quantity: line.quantity - 1,
                                  })
                                }
                              >
                                −
                              </Button>
                              <span aria-label="商品数量">{line.quantity}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`增加 ${line.title ?? "商品"} 数量`}
                                disabled={
                                  blocked || locked || line.quantity >= 100
                                }
                                onClick={() =>
                                  shop({
                                    action: "update-line",
                                    lineId: line.id,
                                    quantity: line.quantity + 1,
                                  })
                                }
                              >
                                +
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`移除 ${line.title ?? "商品"}`}
                                disabled={blocked || locked}
                                onClick={() =>
                                  shop({
                                    action: "remove-line",
                                    lineId: line.id,
                                  })
                                }
                              >
                                <Trash2 data-icon="inline-start" />
                                移除
                              </Button>
                            </div>
                          </div>
                          <span className="fv-price">
                            {money(
                              line.totals?.grand_total ??
                                line.total ??
                                line.unit_price,
                            )}
                          </span>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        onClick={() => setTab("products")}
                      >
                        <ArrowLeft data-icon="inline-start" />
                        继续选购
                      </Button>
                    </div>
                    <Card className="fv-checkout-summary">
                      <CardHeader>
                        <CardTitle>订单摘要</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Totals totals={data.cart.totals} />
                        <p className="fv-muted">
                          配送费用与最终金额将在结账时核对。
                        </p>
                      </CardContent>
                      <CardFooter>
                        {locked ? (
                          <Button onClick={() => setTab("orders")}>
                            查看已提交订单
                          </Button>
                        ) : (
                          <div className="fv-stack">
                            {data.checkout && (
                              <Button
                                variant="outline"
                                disabled={blocked}
                                onClick={edit}
                              >
                                返回修改购物车
                              </Button>
                            )}
                            <Button
                              disabled={blocked || !data.purchaseReady}
                              onClick={() => {
                                setTab("checkout");
                                setStep(undefined);
                              }}
                            >
                              去结账
                              <ArrowRight data-icon="inline-end" />
                            </Button>
                            {!data.purchaseReady && (
                              <p className="fv-muted">商家购买服务尚未就绪。</p>
                            )}
                          </div>
                        )}
                      </CardFooter>
                    </Card>
                  </div>
                ) : (
                  <Empty>
                    <ShoppingCart />
                    <EmptyTitle>
                      {locked ? "购物车已清空" : "购物车还是空的"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {locked
                        ? "已提交的商品保留在订单中，不再占用购物车。"
                        : "去逛逛，选一件喜欢的商品。"}
                    </EmptyDescription>
                    <Button
                      disabled={busy}
                      onClick={
                        locked ? startShopping : () => setTab("products")
                      }
                    >
                      {locked ? "开始新的购物" : "浏览商品"}
                    </Button>
                    {locked && (
                      <Button variant="ghost" onClick={() => setTab("orders")}>
                        查看原订单
                      </Button>
                    )}
                  </Empty>
                )}
              </div>
            </TabsContent>
            <TabsContent value="checkout">
              <div className="fv-stack">
                <h3>结账</h3>
                <ol className="fv-checkout-steps" aria-label="结账进度">
                  {steps.map((label, index) => (
                    <li
                      key={label}
                      aria-current={checkoutStep === index ? "step" : undefined}
                      data-complete={index < checkoutStep}
                    >
                      <span>
                        {index < checkoutStep ? <Check /> : index + 1}
                      </span>
                      {label}
                    </li>
                  ))}
                </ol>
                {cartLines.length || locked ? (
                  <div className="fv-checkout-layout">
                    <div className="fv-stack">
                      {checkoutStep < 4 && (
                        <div className="fv-section-heading">
                          <h4>{steps[checkoutStep]}</h4>
                          {checkoutStep > 0 && (
                            <Button
                              variant="ghost"
                              disabled={blocked}
                              onClick={() => {
                                if (data.checkout) void edit();
                                else setStep(checkoutStep - 1);
                              }}
                            >
                              返回修改
                            </Button>
                          )}
                        </div>
                      )}
                      {checkoutStep === 0 && (
                        <AddressForm
                          key={data.cart.id}
                          data={data}
                          busy={blocked}
                          action={action}
                          next={async () => {
                            if (await shop({ action: "delivery-options" }))
                              setStep(1);
                          }}
                        />
                      )}
                      {checkoutStep === 1 && (
                        <>
                          <Button
                            variant="outline"
                            disabled={blocked}
                            onClick={() => shop({ action: "delivery-options" })}
                          >
                            <RefreshCw data-icon="inline-start" />
                            查询配送方式
                          </Button>
                          {(data.delivery?.delivery_groups ?? []).map(
                            (group: any) => (
                              <Card key={group.id}>
                                <CardHeader>
                                  <CardTitle>
                                    {group.label ?? "配送选项"}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="fv-stack">
                                    {group.options.map((option: any) => (
                                      <div
                                        className="fv-delivery"
                                        key={option.id}
                                      >
                                        <Truck />
                                        <div className="fv-delivery-copy">
                                          <p>{option.label}</p>
                                          <span>{money(option.amount)}</span>
                                        </div>
                                        <Button
                                          variant="outline"
                                          disabled={blocked}
                                          onClick={async () => {
                                            if (
                                              await shop({
                                                action: "select-delivery",
                                                groupId: group.id,
                                                optionId: option.id,
                                              })
                                            )
                                              setNotice("");
                                          }}
                                        >
                                          {group.selected_option_id ===
                                          option.id
                                            ? "已选择"
                                            : "选择此配送"}
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </CardContent>
                              </Card>
                            ),
                          )}
                          <p className="fv-muted">
                            请为每组商品选择配送方式，下一步将核对最终费用。
                          </p>
                          <Button
                            disabled={
                              blocked ||
                              !data.delivery?.delivery_groups?.length ||
                              !data.delivery.delivery_groups.every(
                                (group: any) => group.selected_option_id,
                              )
                            }
                            onClick={async () => {
                              if (await shop({ action: "quote" })) setStep(2);
                            }}
                          >
                            核对订单信息
                            <ArrowRight data-icon="inline-end" />
                          </Button>
                        </>
                      )}
                      {checkoutStep === 2 && (
                        <>
                          <Lines lines={data.quote?.lines ?? cartLines} />
                          <Separator />
                          <div className="fv-stack">
                            <h4>送至</h4>
                            <p>
                              {data.cart.shipping_address?.recipient} ·{" "}
                              {data.cart.shipping_address?.phone}
                            </p>
                            <p>
                              {[
                                data.cart.shipping_address?.region,
                                data.cart.shipping_address?.city,
                                data.cart.shipping_address?.line1,
                                data.cart.shipping_address?.postal_code,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </p>
                          </div>
                          {quoteExpired && (
                            <Alert variant="warning">
                              <AlertDescription>
                                报价已过期，请重新核对当前价格。
                              </AlertDescription>
                            </Alert>
                          )}
                          <Button
                            disabled={blocked || !data.purchaseReady}
                            onClick={async () => {
                              if (quoteExpired) {
                                if (!(await shop({ action: "requote" })))
                                  return;
                              } else if (
                                !data.checkout &&
                                !(await shop({ action: "prepare" }))
                              )
                                return;
                              if (await action("review")) {
                                setStep(3);
                                setPaymentSelected(false);
                              }
                            }}
                          >
                            {busy && <Spinner />}核对并继续
                            <ArrowRight data-icon="inline-end" />
                          </Button>
                        </>
                      )}
                      {checkoutStep === 3 && (
                        <>
                          <Card>
                            <CardHeader>
                              <CardTitle>商家收银台</CardTitle>
                              <CardDescription>
                                选择后确认购买，进入原订单的付款流程。
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <FieldSet className="fv-payment-method">
                                <FieldLegend>支付方式</FieldLegend>
                                <label>
                                  <input
                                    type="radio"
                                    name="payment-method"
                                    checked={paymentSelected}
                                    onChange={() => setPaymentSelected(true)}
                                    disabled={blocked}
                                  />
                                  <CreditCard />
                                  商家提供的支付方式
                                </label>
                                <p className="fv-muted">
                                  {data.pricing.currency === "CNY"
                                    ? "商家提供支付宝扫码时，将在下一步显示二维码。"
                                    : "可用的支付渠道在商家付款页中选择。"}
                                </p>
                              </FieldSet>
                            </CardContent>
                          </Card>
                          <p>
                            确认以上商品、收货信息及应付金额后，点击下方按钮提交订单。
                          </p>
                          {intentExpired || quoteExpired ? (
                            <Button
                              disabled={blocked}
                              onClick={() => setStep(2)}
                            >
                              报价已失效，重新核对
                            </Button>
                          ) : (
                            <Button
                              disabled={
                                blocked ||
                                !paymentSelected ||
                                !data.purchaseReady
                              }
                              onClick={async () => {
                                if (
                                  await action("confirm", {
                                    intentId: data.intent.id,
                                  })
                                )
                                  setStep(4);
                              }}
                            >
                              确认购买 ·{" "}
                              {money(data.quote?.totals?.grand_total)}
                            </Button>
                          )}
                        </>
                      )}
                      {checkoutStep === 4 && (
                        <>
                          <PaymentCard
                            data={data}
                            now={now}
                            busy={busy}
                            formatPrice={money}
                            refresh={() => action("view")}
                            start={() => action("payment-start")}
                            cancel={() => action("order-cancel")}
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              setTab("orders");
                              setOrderDetail(false);
                              void shop({ action: "orders" });
                            }}
                          >
                            查看订单与物流
                            <ArrowRight data-icon="inline-end" />
                          </Button>
                        </>
                      )}
                    </div>
                    <Card className="fv-checkout-summary">
                      <CardHeader>
                        <CardTitle>本次订单</CardTitle>
                        <CardDescription>
                          {locked ? orderCount : count} 件商品
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Totals
                          totals={data.quote?.totals ?? data.cart?.totals}
                        />
                      </CardContent>
                      <CardFooter>
                        <p className="fv-muted">
                          {data.mockPayment
                            ? "测试商店 · Mock 支付"
                            : "金额与状态由商家实时核对"}
                        </p>
                      </CardFooter>
                    </Card>
                  </div>
                ) : (
                  <Empty>
                    <EmptyTitle>先挑选商品，再开始结账</EmptyTitle>
                    <Button onClick={() => setTab("products")}>去选购</Button>
                  </Empty>
                )}
              </div>
            </TabsContent>
            <TabsContent value="orders">
              <div className="fv-stack">
                <div className="fv-section-heading">
                  <div>
                    <h3>我的订单</h3>
                    <p className="fv-description">
                      查看支付结果、订单详情与配送进度。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => shop({ action: "orders" })}
                  >
                    <RefreshCw data-icon="inline-start" />
                    刷新订单
                  </Button>
                </div>
                {selectedOrder && (
                  <div className="fv-stack">
                    {orderDetail && (
                      <Button
                        variant="ghost"
                        onClick={() => setOrderDetail(false)}
                      >
                        <ArrowLeft data-icon="inline-start" />
                        返回当前购物
                      </Button>
                    )}
                    <Order order={selectedOrder} />
                    {!orderDetail && (
                      <PaymentCard
                        data={data}
                        now={now}
                        busy={busy}
                        formatPrice={money}
                        refresh={() => action("view")}
                        start={() => action("payment-start")}
                        cancel={() => action("order-cancel")}
                      />
                    )}
                    <Logistics order={selectedOrder} />
                  </div>
                )}
                {!selectedOrder && !items(data.orders).length && (
                  <Empty>
                    <Package />
                    <EmptyTitle>还没有订单</EmptyTitle>
                    <EmptyDescription>
                      下单后，可在这里查看订单和物流状态。
                    </EmptyDescription>
                    <Button
                      variant="outline"
                      onClick={() => setTab("products")}
                    >
                      继续逛店
                    </Button>
                  </Empty>
                )}
                {items(data.orders).length > 0 && (
                  <>
                    <Separator />
                    <h4>店铺订单记录</h4>
                    <div className="fv-record-list">
                      {items(data.orders).map((order: any) => (
                        <Button
                          variant="ghost"
                          key={order.id ?? order.order_id}
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await shop({
                                action: "order-detail",
                                orderId: order.id ?? order.order_id,
                              })
                            )
                              setOrderDetail(true);
                          }}
                        >
                          <Package data-icon="inline-start" />
                          订单{" "}
                          {order.display_number ??
                            order.id ??
                            order.order_id}{" "}
                          {order.totals?.grand_total
                            ? ` · ${money(order.totals.grand_total)}`
                            : " · 查看详情"}
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      ))}
                    </div>
                    {data.orders.page?.has_more &&
                      data.orders.page.next_cursor && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            shop({
                              action: "orders",
                              cursor: data.orders.page.next_cursor,
                            })
                          }
                        >
                          下一页订单
                        </Button>
                      )}
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
}
