import type { StartShopping } from "./storefront-cart.js";
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
import { OrderList } from "./order-list.js";
import { storefrontOrders } from "./order-summary.js";
import { ProductGallery } from "./product-gallery.js";
import { productImage } from "./product-image.js";
import { PaymentCard, paymentState } from "./payment-card.js";
import { isRequiredContact, cartContactReady } from "../contact-fields.js";
import type { ShoppingAction } from "../shopping-action.js";
type Action = (operation: string, payload?: any) => Promise<boolean>;
type Props = {
  draftScope: string;
  data: any;
  busy: boolean;
  error: string;
  errorCode?: string;
  action: Action;
  now: number;
  startShopping?: StartShopping;
  addedQuantity?: number;
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
  form,
  setForm,
}: {
  form: Record<string, string>;
  setForm: (value: Record<string, string>) => void;
  data: any;
  busy: boolean;
  action: Action;
  next: () => Promise<void>;
}) {
  const id = useId();
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
/** Drafts survive read failures, but never cross account/session/flow boundaries. */
export function Storefront(props: Props) {
  return <StorefrontContent key={props.draftScope} {...props} />;
}
function StorefrontContent({
  data,
  busy,
  error,
  errorCode,
  action,
  now,
  startShopping,
  addedQuantity,
  onViewChange,
}: Props) {
  const [addressDraft, setAddressDraft] = useState<{
    cartId: string;
    values: Record<string, string>;
  }>();
  useEffect(() => {
    // A missing read result must not clear the local draft. A different cart must.
    if (data?.cart?.id && addressDraft && addressDraft.cartId !== data.cart.id)
      setAddressDraft(undefined);
  }, [data?.cart?.id, addressDraft?.cartId]);
  const [tab, setTab] = useState("products");
  const [step, setStep] = useState<number>();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(false);
  const [notice, setNotice] = useState(
    addedQuantity ? `已加入 ${addedQuantity} 件商品` : "",
  );
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [addedVariant, setAddedVariant] = useState<string>();
  const [startingCart, setStartingCart] = useState(false);
  useEffect(() => {
    if (!notice || !data) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice, !!data]);
  const [orderDetail, setOrderDetail] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const ordersRequested = useRef(false);
  const [ordersAfterFirstPage, setOrdersAfterFirstPage] = useState(false);
  const [paymentSelected, setPaymentSelected] = useState(false);
  useEffect(() => {
    onViewChange?.(
      tab === "products"
        ? "catalog"
        : tab === "orders"
          ? showOrderDetails && orderDetail
            ? "order-detail"
            : "order"
          : tab === "cart"
            ? "cart"
            : "checkout",
      !(showOrderDetails && orderDetail),
    );
  }, [tab, orderDetail, showOrderDetails, onViewChange]);
  const initialized = useRef(false);
  const checkedPending = useRef(false);
  useEffect(() => {
    if (!data?.pending) {
      checkedPending.current = false;
      return;
    }
    if (busy || checkedPending.current) return;
    const timer = setTimeout(
      () => {
        checkedPending.current = true;
        void action(
          data.canDiscardCartAddition ? "discard-cart-add" : "recover",
        );
      },
      data.canDiscardCartAddition ? 0 : 1500,
    );
    return () => clearTimeout(timer);
  }, [data?.pending, data?.canDiscardCartAddition, busy]);
  const shop = async (intent: ShoppingAction["intent"]) => {
    if (intent.action === "add" && (data?.intent?.submitted || data?.order)) {
      if (!startShopping) return false;
      setStartingCart(true);
      try {
        return await startShopping(intent);
      } finally {
        setStartingCart(false);
      }
    }
    return action("shopping", {
      intent,
      expected_version: data?.cart?.version,
      actionId: crypto.randomUUID(),
    });
  };
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    if (!addedQuantity && data.variantProductId && data.variants)
      setDetail(true);
    if (data.intent?.submitted || data.order) setTab("orders");
    else if (data.quote || data.cart?.lines?.length) setTab("cart");
    // A restored view is display-only. Keep it visible while revalidating the
    // current catalog, even when the persisted flow already contains products.
    if (
      !data.intent?.submitted &&
      !data.order &&
      !data.quote &&
      !data.cart?.lines?.length
    )
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
  useEffect(() => {
    if (
      tab !== "orders" ||
      !data ||
      busy ||
      data.orders ||
      ordersRequested.current
    )
      return;
    ordersRequested.current = true;
    void shop({ action: "orders" });
  }, [tab, data, busy]);
  const locked = !!data?.intent?.submitted || !!data?.order;
  const blocked = busy || startingCart || !!data?.pending;
  useEffect(() => {
    if (tab !== "checkout" || !data?.order) return;
    if (
      ["paid", "closed", "refunded", "partially_refunded"].includes(
        paymentState(data, now),
      )
    ) {
      setOrderDetail(false);
      setShowOrderDetails(true);
      setTab("orders");
    }
  }, [tab, data, now]);
  const contactReady = cartContactReady(data?.cart, data?.pricing?.country);
  const checkoutStep = locked
    ? 4
    : !contactReady
      ? 0
      : (step ?? (data?.intent ? 3 : data?.quote ? 2 : 1));
  const deliveryRequested = useRef(false);
  const [preparingDelivery, setPreparingDelivery] = useState(false);
  const prepareDelivery = async () => {
    setPreparingDelivery(true);
    try {
      await shop({ action: "prepare-delivery" });
    } finally {
      setPreparingDelivery(false);
    }
  };
  useEffect(() => {
    if (tab !== "checkout" || checkoutStep !== 1) {
      deliveryRequested.current = false;
      return;
    }
    if (blocked || deliveryRequested.current || !data?.cart) return;
    deliveryRequested.current = true;
    void prepareDelivery();
  }, [tab, checkoutStep, blocked, data?.cart]);
  const deliveryCurrent =
    !!data?.delivery &&
    !!data?.cart &&
    data.delivery.cart_id === data?.cart?.id &&
    data?.delivery?.cart_version === data?.cart?.version;
  const deliveryGroups = deliveryCurrent
    ? (data.delivery.delivery_groups ?? [])
    : [];
  const deliveryReady =
    deliveryGroups.length > 0 &&
    !data.delivery.requirements?.some((r: any) => r.blocking) &&
    deliveryGroups.every((g: any) =>
      g.options.some((o: any) => o.id === g.selected_option_id),
    );
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
  const pendingLabel =
    (
      {
        "cart-add": "加购",
        "cart-update": "修改数量",
        "cart-remove": "移除商品",
        contact: "保存收货信息",
        delivery: "选择配送方式",
        quote: "获取报价",
        checkout: "准备结账",
        order: "提交订单",
        cancel: "取消订单",
      } as Record<string, string>
    )[data?.pendingAction] ?? "请求";
  const pendingError =
    error &&
    ![
      "ORIGINAL_RESULT_UNKNOWN",
      "RESOLVE_PENDING_OPERATION",
      "NETWORK_UNCERTAIN",
      "NETWORK_TIMEOUT",
      "NETWORK_FAILURE",
      "CONFIRMATION_RESULT_UNKNOWN",
    ].includes(errorCode ?? "")
      ? error
      : undefined;
  const selectedOrder = orderDetail ? data?.viewedOrder : data?.order;
  return (
    <section
      className="fv-storefront fv-stack"
      aria-label="店铺商城"
      aria-busy={busy}
    >
      {error && !data?.pending && (
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
          {data.pending && !data.cartCreationPending && (
            <Alert variant="warning">
              <AlertDescription>
                {busy
                  ? `正在处理${pendingLabel}…`
                  : pendingError ||
                    (data.canDiscardCartAddition
                      ? "正在更新购物车…"
                      : data.canRetryCart
                        ? `${pendingLabel}暂未完成，请重试。`
                        : "状态暂未更新，请稍后刷新。")}
              </AlertDescription>
              <Button
                disabled={busy}
                onClick={() =>
                  action(
                    data.canDiscardCartAddition
                      ? "discard-cart-add"
                      : data.canRetryCart
                        ? "retry-cart"
                        : "recover",
                  )
                }
              >
                {busy ? (
                  <Spinner />
                ) : data.canDiscardCartAddition ? (
                  "取消等待"
                ) : data.canRetryCart ? (
                  "重试"
                ) : (
                  "刷新状态"
                )}
              </Button>
            </Alert>
          )}
          {data.cartCreationPending && tab !== "cart" && (
            <div className="fv-row" role="status">
              <span className="fv-muted">购物车暂未加载。</span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => action("view")}
              >
                刷新购物车
              </Button>
            </div>
          )}
          {data.cartReady === false && (
            <Alert>
              <AlertDescription>
                当前商家仅开放商品浏览，购物车暂不可用。
              </AlertDescription>
            </Alert>
          )}
          {notice && !detail && tab === "products" && (
            <div role="status" className="fv-store-notice">
              <Check />
              {notice}
              <Button variant="ghost" size="sm" onClick={() => setTab("cart")}>
                查看购物车
              </Button>
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              if (value === "products" && !data.products) void browse();
              if (value === "orders") {
                setOrderDetail(false);
                setShowOrderDetails(false);
              }
            }}
          >
            {tab !== "checkout" && (
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
            )}
            <TabsContent value="products">
              <div className="fv-stack">
                {detail ? (
                  <>
                    <Button
                      variant="ghost"
                      className="fv-back-link"
                      onClick={() => browse()}
                      disabled={busy}
                    >
                      <ArrowLeft data-icon="inline-start" />
                      返回商品列表
                    </Button>
                    <div className="fv-product-detail">
                      <ProductGallery product={product} />
                      <div className="fv-stack fv-product-info">
                        <h3>{product?.title ?? "选择商品规格"}</h3>
                        {product?.description?.trim() && (
                          <p className="fv-product-description">
                            {product.description}
                          </p>
                        )}
                        <Separator />
                        <h4>规格与库存</h4>
                        {items(data.variants).length ? (
                          items(data.variants).map((v: any) => {
                            const unavailable =
                              ["out_of_stock", "unavailable"].includes(
                                v.availability?.status,
                              ) || v.availability?.quantity_available === 0;
                            const quantityText = quantities[v.id] ?? "1";
                            const quantity = Number(quantityText);
                            const stock = v.availability?.quantity_available;
                            const maximum =
                              typeof stock === "number" &&
                              Number.isFinite(stock)
                                ? Math.max(0, Math.min(100, Math.floor(stock)))
                                : 100;
                            const validQuantity =
                              quantityText.trim() !== "" &&
                              Number.isInteger(quantity) &&
                              quantity >= 1 &&
                              quantity <= maximum;
                            return (
                              <Card key={v.id} className="fv-variant-card">
                                <CardHeader>
                                  <CardTitle>
                                    {v.title === "Default"
                                      ? "默认规格"
                                      : v.title}
                                  </CardTitle>
                                  <CardDescription>
                                    {v.selected_options
                                      ?.filter(
                                        (o: any) =>
                                          !(
                                            o.name === "Default" &&
                                            o.value === "Default"
                                          ),
                                      )
                                      .map((o: any) => `${o.name}：${o.value}`)
                                      .join(" · ")}
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
                                <CardFooter className="fv-add-to-cart">
                                  <Field
                                    data-invalid={
                                      !validQuantity && !unavailable
                                    }
                                  >
                                    <FieldLabel>
                                      购买数量
                                      <Input
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={maximum}
                                        step={1}
                                        aria-label={`${v.title === "Default" ? "默认规格" : v.title}购买数量`}
                                        aria-invalid={
                                          !validQuantity && !unavailable
                                        }
                                        value={quantityText}
                                        disabled={blocked || unavailable}
                                        onChange={(e) => {
                                          setQuantities((previous) => ({
                                            ...previous,
                                            [v.id]: e.target.value,
                                          }));
                                          setNotice("");
                                        }}
                                      />
                                    </FieldLabel>
                                  </Field>
                                  <Button
                                    disabled={
                                      blocked ||
                                      unavailable ||
                                      !validQuantity ||
                                      !data.cartReady ||
                                      (locked
                                        ? !startShopping
                                        : !!data.checkout)
                                    }
                                    onClick={async () => {
                                      if (!validQuantity) return;
                                      setNotice("");
                                      if (
                                        await shop({
                                          action: "add",
                                          variantId: v.id,
                                          productName: product?.title ?? "商品",
                                          variantName: v.title ?? "默认规格",
                                          quantity,
                                        })
                                      ) {
                                        setAddedVariant(v.id);
                                        setNotice(`已加入 ${quantity} 件商品`);
                                      }
                                    }}
                                  >
                                    {startingCart ? (
                                      <Spinner />
                                    ) : (
                                      <ShoppingCart data-icon="inline-start" />
                                    )}
                                    {startingCart
                                      ? "正在加入购物车"
                                      : "加入购物车"}
                                  </Button>
                                </CardFooter>
                                {!validQuantity && !unavailable && (
                                  <p
                                    className="fv-field-error fv-add-error"
                                    role="status"
                                  >
                                    请输入 1–{maximum} 之间的整数
                                  </p>
                                )}
                                {notice && addedVariant === v.id && (
                                  <div
                                    role="status"
                                    className="fv-store-notice"
                                  >
                                    <Check />
                                    <span>{notice}</span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setTab("cart")}
                                    >
                                      查看购物车
                                    </Button>
                                  </div>
                                )}
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
                        {!locked && data.checkout && (
                          <p className="fv-muted">
                            已准备结账，如需加购请先返回购物车修改。
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
                  <div className="fv-row">
                    <h3>购物车</h3>
                    {notice && (
                      <span role="status" className="fv-cart-notice">
                        <Check aria-hidden />
                        {notice}
                      </span>
                    )}
                  </div>
                  <Badge>{count} 件商品</Badge>
                </div>
                {cartLines.length ? (
                  <div className="fv-checkout-layout fv-cart-layout">
                    <Card className="fv-cart-panel">
                      <CardContent className="fv-cart-lines">
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
                              <p className="fv-muted">
                                {line.variant_title === "Default"
                                  ? "默认规格"
                                  : line.variant_title}
                              </p>
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
                                <span aria-label="商品数量">
                                  {line.quantity}
                                </span>
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
                      </CardContent>
                      <CardFooter>
                        <Button
                          variant="ghost"
                          className="fv-back-link"
                          onClick={() => setTab("products")}
                        >
                          <ArrowLeft data-icon="inline-start" />
                          继续选购
                        </Button>
                      </CardFooter>
                    </Card>
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
                                // New checkout always starts with reviewing the
                                // address, even if the merchant prefilled it.
                                setStep(
                                  data.quote || data.checkout ? undefined : 0,
                                );
                              }}
                            >
                              {data.quote || data.checkout
                                ? "继续结账"
                                : "去结账"}
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
                      {data.cartCreationPending
                        ? "购物车暂未加载"
                        : locked
                          ? "购物车已清空"
                          : "购物车还是空的"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {data.cartCreationPending
                        ? "请稍后刷新。"
                        : locked
                          ? "已提交的商品保留在订单中，不再占用购物车。"
                          : "去逛逛，选一件喜欢的商品。"}
                    </EmptyDescription>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        data.cartCreationPending
                          ? action("view")
                          : setTab("products")
                      }
                    >
                      {data.cartCreationPending ? "刷新购物车" : "浏览商品"}
                    </Button>
                    {locked && (
                      <Button variant="ghost" onClick={() => setTab("orders")}>
                        查看订单
                      </Button>
                    )}
                  </Empty>
                )}
              </div>
            </TabsContent>
            {tab === "checkout" && (
              <section aria-label="结账流程" className="fv-checkout-process">
                <div className="fv-stack">
                  <div className="fv-section-heading">
                    <div>
                      <h3>结账</h3>
                      <p className="fv-description">
                        核对本次购物信息，完成下单与支付。
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setTab(locked ? "orders" : "cart");
                        if (locked) {
                          setOrderDetail(false);
                          setShowOrderDetails(true);
                        }
                      }}
                    >
                      <ArrowLeft data-icon="inline-start" />
                      {locked ? "返回订单" : "返回购物车"}
                    </Button>
                  </div>
                  <ol className="fv-checkout-steps" aria-label="结账进度">
                    {steps.map((label, index) => (
                      <li
                        key={label}
                        aria-current={
                          checkoutStep === index ? "step" : undefined
                        }
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
                            form={
                              addressDraft &&
                              addressDraft.cartId === data.cart.id
                                ? addressDraft.values
                                : {
                                    ...data.cart.shipping_address,
                                    email: data.cart.email ?? "",
                                  }
                            }
                            setForm={(values) =>
                              setAddressDraft({ cartId: data.cart.id, values })
                            }
                            busy={blocked}
                            action={action}
                            next={async () => {
                              setAddressDraft(undefined);
                              setStep(1);
                            }}
                          />
                        )}
                        {checkoutStep === 1 && (
                          <>
                            {preparingDelivery ? (
                              <p className="fv-muted" role="status">
                                <Spinner /> 正在获取配送方式…
                              </p>
                            ) : (
                              <div className="fv-section-heading">
                                <p className="fv-muted">
                                  {deliveryReady
                                    ? "已选好配送方式，可按需更换。"
                                    : deliveryGroups.some(
                                          (g: any) => g.options.length,
                                        )
                                      ? "请选择配送方式。"
                                      : "暂无可用配送方式，请检查收货地址或重试。"}
                                </p>
                                <Button
                                  variant="ghost"
                                  disabled={blocked}
                                  onClick={prepareDelivery}
                                >
                                  <RefreshCw data-icon="inline-start" />
                                  {deliveryReady ? "刷新" : "重试"}
                                </Button>
                              </div>
                            )}
                            {deliveryGroups.map((group: any) => (
                              <Card key={group.id}>
                                <CardHeader>
                                  <CardTitle>
                                    {group.label ?? "配送选项"}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="fv-stack">
                                    {!group.options.length && (
                                      <p className="fv-muted">
                                        此组商品暂无配送方式，请修改收货地址。
                                      </p>
                                    )}
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
                                          disabled={
                                            blocked ||
                                            preparingDelivery ||
                                            group.selected_option_id ===
                                              option.id
                                          }
                                          aria-pressed={
                                            group.selected_option_id ===
                                            option.id
                                          }
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
                            ))}
                            <p className="fv-muted">
                              下一步核对商品、收货地址与最终费用。
                            </p>
                            <Button
                              disabled={
                                blocked || preparingDelivery || !deliveryReady
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
                                  确认订单后选择支付方式。
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
                                setShowOrderDetails(true);
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
              </section>
            )}
            <TabsContent value="orders">
              <div className="fv-stack">
                <div className="fv-section-heading">
                  <div>
                    <h3>{showOrderDetails ? "订单详情" : "我的订单"}</h3>
                    <p className="fv-description">
                      {showOrderDetails
                        ? "查看这笔订单的商品、支付与配送信息。"
                        : "选择一笔订单，查看商品、支付结果和配送进度。"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (showOrderDetails) void action("view");
                      else {
                        ordersRequested.current = true;
                        void shop({ action: "orders" }).then((ok) => {
                          if (ok) setOrdersAfterFirstPage(false);
                        });
                      }
                    }}
                  >
                    {busy ? (
                      <Spinner />
                    ) : (
                      <RefreshCw data-icon="inline-start" />
                    )}
                    {showOrderDetails ? "刷新详情" : "刷新订单"}
                  </Button>
                </div>
                {showOrderDetails ? (
                  <>
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setShowOrderDetails(false);
                          setOrderDetail(false);
                        }}
                      >
                        <ArrowLeft data-icon="inline-start" />
                        返回订单列表
                      </Button>
                    </div>
                    {selectedOrder && (
                      <div className="fv-order-detail-layout">
                        <Card>
                          <CardHeader>
                            <CardTitle>商品与金额</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <Order order={selectedOrder} />
                          </CardContent>
                        </Card>
                        <div className="fv-stack">
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
                          {selectedOrder.status !== "canceled" && (
                            <Logistics order={selectedOrder} />
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : storefrontOrders(data).length ? (
                  <>
                    <OrderList
                      data={data}
                      busy={busy}
                      open={async (orderId) => {
                        if (orderId === data.order?.id) {
                          setOrderDetail(false);
                          setShowOrderDetails(true);
                        } else if (
                          await shop({ action: "order-detail", orderId })
                        ) {
                          setOrderDetail(true);
                          setShowOrderDetails(true);
                        }
                      }}
                    />
                    <div className="fv-order-list-footer">
                      <p className="fv-muted">
                        本页显示 {storefrontOrders(data).length} 笔订单
                      </p>
                      <div className="fv-row">
                        {ordersAfterFirstPage && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={async () => {
                              if (await shop({ action: "orders" }))
                                setOrdersAfterFirstPage(false);
                            }}
                          >
                            返回首页
                          </Button>
                        )}
                        {data.orders?.page?.has_more &&
                          data.orders.page.next_cursor && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await shop({
                                    action: "orders",
                                    cursor: data.orders.page.next_cursor,
                                  })
                                )
                                  setOrdersAfterFirstPage(true);
                              }}
                            >
                              下一页
                              <ArrowRight data-icon="inline-end" />
                            </Button>
                          )}
                      </div>
                    </div>
                  </>
                ) : busy ? (
                  <div role="status">
                    <Skeleton className="fv-skeleton-block" />
                    <p>正在读取订单…</p>
                  </div>
                ) : (
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
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
}
