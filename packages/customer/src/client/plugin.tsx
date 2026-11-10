import type { StartShopping } from "./storefront-cart.js";
import type { ViewScope } from "../view-scope.js";
import { Storefront } from "./storefront.js";
import {
  items,
  money,
  Lines,
  Address,
  Totals,
  Order,
} from "./commerce-display.js";
import { useAccountRevision } from "./account.js";
import { accountRequest } from "./account-request.js";
import { ServicePage } from "./service-page.js";
import { ProductSelection } from "./product-selection.js";
import { productImage as image } from "./product-image.js";
import {
  withHistoricalCatalog,
  type CatalogSnapshot,
} from "./catalog-history.js";
import {
  cardMessage,
  cardMessageRule,
  type CardIntent,
} from "./card-message.js";
import { FlowViews } from "./flow-views.js";
import { PaymentCard } from "./payment-card.js";
import { shoppingStep } from "./shopping-progress.js";
import {
  cartContactReady,
  manualCart,
  isRequiredContact as contactFieldRequired,
} from "../contact-fields.js";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Clock3,
  CreditCard,
  Info,
  LockKeyhole,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { historyDefinition } from "./history.js";
import { ToolFeedback } from "./tool-feedback.js";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Separator,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./ui.js";
// @ts-ignore esbuild loads CSS as text.
import styles from "./styles.css";
import { ConsultationCard } from "./consultation.js";
export const inject = [
  "slots",
  "layout",
  "connection",
  "uiConversation",
  "sessions",
  "conversation",
];
type UI = { flowId: string; sessionId: string; card: string };
const errorText: Record<string, string> = {
  CART_ALREADY_SUBMITTED:
    "商品已生成订单，请到“我的订单”查看。继续加购会使用新的购物车。",
  OPERATION_DISCARDED: "这次加购已结束，请重新选择商品。",
  CART_DISCARD_UNAVAILABLE: "当前操作无法取消，请查看订单状态。",
  ADD_NOT_COMPLETED: "未能加入商品，请重试。",
  CART_RETRY_FAILED: "这次购物车修改未成功，请检查商品数量后重试。",
  CART_RETRY_UNAVAILABLE: "当前购物车无法重试，请刷新查看最新状态。",
  OPERATION_NOT_COMPLETED: "操作未完成，请刷新核对当前进度后再试。",
  CHECKOUT_IN_PROGRESS: "当前已准备结算，请先核对报价；需要修改时请重新报价。",
  ORDER_CANCEL_UNAVAILABLE:
    "当前订单不能直接取消，请刷新核对；已付款订单需联系商家退款。",
  ORDER_CANCEL_FAILED: "取消未完成，订单仍保留。请核对原订单结果后再试。",
  PAYMENT_CLOSURE_UNCONFIRMED:
    "尚未确认支付渠道关闭，请查询原订单结果，不要重复操作。",
  PAID_ORDER_REQUIRES_MERCHANT_REFUND: "订单已有付款，请联系商家退款。",
  INLINE_PAYMENT_UNAVAILABLE: "当前商家暂未提供卡片扫码支付。",
  PAYMENT_RESULT_UNKNOWN: "暂未确认原订单支付结果，请刷新核对。",
  PAYMENT_LINK_UNAVAILABLE: "原订单付款入口已过期或暂不可用，请刷新核对。",
  INVALID_PAYMENT_LINK: "付款入口暂不可用，请刷新原订单。",
  INVALID_PAYMENT_QR: "二维码未通过核对，请刷新原订单后重试。",
  PERSONAL_ACCOUNT_CHANGED: "请登录原个人账号后查看此记录。",
  PERSONAL_LOGIN_REQUIRED: "请先到 Frontvia 服务登录个人账号。",
  PERSONAL_CHAT_ACCOUNT_CHANGED: "此聊天已用于另一账号，请新建聊天后连接商家。",
  FLOW_NOT_OWNED: "这份购物进度不属于当前会话，请回到原聊天查看。",
  NETWORK_FAILURE: "暂时无法连接商店，请稍后刷新。",
  NETWORK_TIMEOUT: "商店响应超时，请稍后刷新。",
  NETWORK_UNCERTAIN: "暂未收到商店回复，请先核对原操作结果。",
  QUOTE_CHANGED: "报价或购物车已变化，请重新报价并核对。",
  CONFIRMATION_EXPIRED: "确认已过期，请重新核对当前报价。",
  CONTACT_NOT_SAVED: "收货信息未保存，请重试。",
  CONTACT_REQUIRED: "请先填写并保存完整的收货信息。",
  CART_VERSION_CHANGED: "购物车已更新，请刷新后重试。",
  RESOLVE_PENDING_OPERATION: "上次操作结果尚未明确，请先核对原结果。",
  ORIGINAL_RESULT_UNKNOWN:
    "暂未查到原操作记录，请稍后再次核对。当前不会重复提交该操作。",
  CONNECTION_DISCONNECTED: "连接已断开，请在 PAP 连接页重新连接。",
  CONNECTION_BINDING_CHANGED:
    "PAP 连接配置已变化，请先在连接页核对原配置。购物记录已保留。",
  CONNECTION_BINDING_REQUIRED:
    "旧 PAP 连接缺少身份绑定信息，请在连接页查看处理说明。购物记录已保留。",
  CONFIRMATION_NOT_COMPLETED: "确认结果尚未明确，请核对原操作。",
  CONFIRMATION_RESULT_UNKNOWN: "确认回执未收到，请先核对原结果，不要重新购买。",
  CONFIRMATION_FAILED_NO_EFFECTS:
    "此次确认失败且未产生交易，请重新核对报价后再决定是否购买。",
  METHOD_UNAVAILABLE: "商家当前未开放这项操作，可以继续使用已开放的服务。",
  METHOD_NOT_ADVERTISED: "商家未发布这项接口，请刷新服务配置。",
  PURCHASE_PROFILE_UNAVAILABLE:
    "商家尚未为当前客户端开通购买能力，可先浏览商品。",
  PURCHASE_CONFIRMATION_UNAVAILABLE:
    "购买确认通道尚未就绪，请核对商家授权和本机确认凭据。",
};
const baseContactFields = [
  {
    key: "recipient",
    label: "收货人",
    placeholder: "填写收货人姓名",
    autoComplete: "shipping name",
    max: 200,
  },
  {
    key: "phone",
    label: "联系电话",
    placeholder: "收货联系电话",
    autoComplete: "shipping tel",
    max: 40,
  },
  {
    key: "line1",
    label: "街道地址",
    placeholder: "门牌号、街道及公寓号",
    autoComplete: "shipping address-line1",
    max: 300,
    wide: true,
  },
  {
    key: "city",
    label: "城市",
    placeholder: "例如 San Francisco",
    autoComplete: "shipping address-level2",
    max: 100,
  },
  {
    key: "region",
    label: "州 / 地区",
    placeholder: "例如 CA",
    autoComplete: "shipping address-level1",
    max: 100,
  },
  {
    key: "postal_code",
    label: "邮编",
    placeholder: "例如 94105",
    autoComplete: "shipping postal-code",
    max: 40,
  },
  {
    key: "email",
    label: "联系邮箱",
    placeholder: "name@example.com",
    autoComplete: "email",
    max: 254,
  },
] as const;
type Contact = Record<(typeof baseContactFields)[number]["key"], string>;
const blankContact: Contact = {
  phone: "",
  recipient: "",
  email: "",
  line1: "",
  city: "",
  region: "",
  postal_code: "",
};
const contactFrom = (v: any): Contact => {
  const a = v?.cart?.shipping_address;
  return {
    phone: a?.phone ?? "",
    email: v?.cart?.email ?? "",
    recipient: a?.recipient ?? "",
    line1: a?.line1 ?? "",
    city: a?.city ?? "",
    region: a?.region ?? "",
    postal_code: a?.postal_code ?? "",
  };
};
export function apply(ctx: any) {
  const call = (op: string, payload: any = {}) =>
    accountRequest(async () => {
      const r = await ctx.connection.rpc.call(
        "/api",
        `frontvia-customer/${op}`,
        payload,
      );
      if (!r.ok) throw new Error(r.error.code);
      return r.value;
    });
  const views = new FlowViews(
    (ref) => call("view", ref),
    15000,
    () => document.visibilityState !== "hidden",
  );
  ctx.effect(() => {
    const reset = () => views.clear();
    const refresh = () => {
      if (document.visibilityState !== "hidden") views.refreshAll();
    };
    const notifyPap = () =>
      window.dispatchEvent(new Event("pap-connections-change"));
    window.addEventListener("dsh-identity-change", notifyPap);
    window.addEventListener("dsh-identity-change", reset);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("dsh-identity-change", reset);
      window.removeEventListener("dsh-identity-change", notifyPap);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      views.clear();
    };
  });
  function Shopping({
    ui,
    sendToAgent,
    resume = false,
    startShopping,
    addedQuantity,
    initialError,
    catalog,
  }: {
    ui: UI;
    sendToAgent?: (s: string) => Promise<unknown>;
    resume?: boolean;
    startShopping?: StartShopping;
    addedQuantity?: number;
    initialError?: string;
    catalog?: CatalogSnapshot;
  }) {
    const accountRevision = useAccountRevision();
    const [liveRevision, setLiveRevision] = useState(accountRevision);
    const container = useRef<HTMLElement | null>(null);
    // The selected service panel must load once even if a background WebView
    // delays its first intersection event. Historical chat cards can defer.
    const visible = useRef(
      resume || typeof IntersectionObserver === "undefined",
    );
    const scope = useRef<ViewScope>(
      resume || ["products", "connection"].includes(ui.card)
        ? "catalog"
        : ui.card === "order"
          ? "order"
          : "checkout",
    );
    const onViewChange = useCallback(
      (next: ViewScope, refresh = true) => {
        if (scope.current === next) return;
        scope.current = next;
        if (visible.current && refresh) views.invalidate(ui);
      },
      [ui.flowId, ui.sessionId],
    );
    const dirtyForm = useRef(false);
    const acting = useRef(false);
    const canShop = resume || !!sendToAgent;
    const [liveData, setData] = useState<any>(),
      [busy, setBusy] = useState(""),
      [actionError, setError] = useState(initialError ?? ""),
      [viewError, setViewError] = useState(""),
      [tab, setTab] = useState<string | undefined>(
        resume ? undefined : ui.card === "connection" ? "products" : ui.card,
      ),
      [tick, setTick] = useState(Date.now());
    useEffect(() => {
      if (resume) return;
      const selected = tab ?? (liveData ? shoppingStep(liveData) : ui.card);
      onViewChange(
        selected === "products" || selected === "connection"
          ? "catalog"
          : selected === "order"
            ? "order"
            : selected === "cart"
              ? "cart"
              : "checkout",
      );
    }, [tab, liveData, resume, onViewChange]);
    const error = actionError || viewError;
    const data = withHistoricalCatalog(
      liveRevision === accountRevision ? liveData : undefined,
      catalog,
    );
    const [form, setForm] = useState<Contact>(blankContact),
      [fieldErrors, setFieldErrors] = useState<Partial<Contact>>({});
    const formId = useId();
    const isRequiredContact = (key: keyof Contact) =>
      contactFieldRequired(data?.pricing?.country, key);
    const contactFields = baseContactFields.map((field) => {
      const local =
        data?.pricing?.country === "CN"
          ? field.key === "line1"
            ? {
                label: "完整收货地址",
                placeholder: "填写省、市、区及街道门牌号",
              }
            : field.key === "region"
              ? { label: "省份 / 地区", placeholder: "例如 浙江省" }
              : field.key === "city"
                ? { placeholder: "例如 杭州市" }
                : field.key === "postal_code"
                  ? { placeholder: "例如 310000" }
                  : {}
          : {};
      return {
        ...field,
        ...local,
        label: `${"label" in local ? local.label : field.label}${isRequiredContact(field.key) ? "" : "（选填）"}`,
      };
    });
    useEffect(() => {
      dirtyForm.current = false;
      setData(undefined);
      setForm(blankContact);
      setError(initialError ?? "");
      setViewError("");
      setTab(
        resume ? undefined : ui.card === "connection" ? "products" : ui.card,
      );
      return views.subscribe(
        ui,
        (state) => {
          setLiveRevision(accountRevision);
          setData(state.value);
          setViewError(state.error?.message ?? "");
          if (state.value && !dirtyForm.current) {
            setForm(contactFrom(state.value));
          }
        },
        { scope: () => scope.current, visible: () => visible.current },
      );
    }, [ui.flowId, ui.sessionId, accountRevision]);
    useEffect(() => {
      if (typeof IntersectionObserver === "undefined" || !container.current)
        return;
      const observer = new IntersectionObserver(([entry]) => {
        const entered = entry.isIntersecting && !visible.current;
        visible.current = entry.isIntersecting;
        if (entered) views.invalidate(ui);
      });
      observer.observe(container.current);
      return () => observer.disconnect();
    }, [ui.flowId, ui.sessionId, accountRevision]);
    useEffect(() => {
      const t = setInterval(() => setTick(Date.now()), 1000);
      return () => clearInterval(t);
    }, []);
    const action = async (op: string, payload: any = {}) => {
      if (acting.current) return false;
      acting.current = true;
      const release = views.hold(ui);
      setBusy(op);
      setError("");
      if (op === "payment-start" || op === "order-cancel")
        views.publish(ui, {
          ...liveData,
          paymentQr: undefined,
          ...(op === "order-cancel"
            ? {
                pending: true,
                cancelPending: true,
                canCancelOrder: false,
                inlinePayment: false,
              }
            : {}),
        });
      try {
        const value =
          op === "view"
            ? await views.refresh(ui)
            : await call(op, { ...ui, ...payload });
        if (op !== "view") views.publish(ui, value);
        if (op === "contact") {
          if (value.pending || value.operation?.status !== "succeeded") {
            setError("CONTACT_NOT_SAVED");
            return false;
          }
          dirtyForm.current = false;
        }
        if (
          op === "retry-cart" &&
          !value.pending &&
          value.operation?.status === "failed"
        ) {
          setError("CART_RETRY_FAILED");
          return false;
        }
        if (
          op === "order-cancel" &&
          !value.pending &&
          value.operation?.status === "failed"
        ) {
          setError("ORDER_CANCEL_FAILED");
          return false;
        }
        if (
          op === "confirm" &&
          !value.pending &&
          value.operation?.status === "failed" &&
          value.operation.effects === "none"
        ) {
          setError("CONFIRMATION_FAILED_NO_EFFECTS");
          return false;
        }
      } catch (e: any) {
        if (op === "discard-cart-add") views.invalidate(ui, ["cart"]);
        if (
          op === "contact" ||
          op === "order-cancel" ||
          op === "shopping" ||
          op === "retry-cart"
        )
          views.invalidate(ui, ["checkout"]);
        setError(op === "confirm" ? "CONFIRMATION_RESULT_UNKNOWN" : e.message);
        if (op === "confirm" && e.message !== "PERSONAL_ACCOUNT_CHANGED")
          views.publish(ui, { ...liveData, pending: true });
        return false;
      } finally {
        acting.current = false;
        release();
        setBusy("");
      }
      return true;
    };
    const ask = async (intent: CardIntent) => {
      if (resume) {
        const ok = await action("shopping", {
          intent,
          expected_version: data?.cart?.version,
          actionId: crypto.randomUUID(),
        });
        if (ok)
          setTab(
            intent.action === "variants"
              ? "products"
              : ["add", "delivery-options"].includes(intent.action)
                ? "cart"
                : "quote",
          );
        return;
      }
      if (!sendToAgent) {
        setError("请回到所属聊天，让 Agent 继续购物。");
        return;
      }
      setBusy("agent");
      setError("");
      try {
        await sendToAgent(cardMessage(ui.flowId, intent));
        views.invalidate(ui);
      } catch {
        setError("消息未发送，请在原聊天重试。");
      } finally {
        setBusy("");
      }
    };
    const expired = !!data?.intent && data.intent.expiresAt <= tick;
    const quoteExpired =
      !!data?.quote && Date.parse(data.quote.expires_at) <= tick;
    const dirty = contactFields.some(
      ({ key }) => form[key] !== contactFrom(data)[key],
    );
    const contactReady = cartContactReady(data?.cart, data?.pricing?.country);
    const locked = !!data?.intent?.submitted || !!data?.order;
    const saveContact = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const element = e.currentTarget;
      const errors: Partial<Contact> = {};
      for (const { key, label } of contactFields) {
        const input = element.elements.namedItem(key) as HTMLInputElement;
        if (!isRequiredContact(key)) continue;
        if (!form[key].trim()) errors[key] = `请填写${label}`;
        else if (!input.validity.valid)
          errors[key] =
            key === "email" ? "请输入有效的邮箱地址" : `请检查${label}`;
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length) {
        (
          element.elements.namedItem(Object.keys(errors)[0]) as HTMLInputElement
        ).focus();
        return;
      }
      const { email, ...address } = form;
      await action("contact", {
        expected_version: data.cart.version,
        patch: {
          ...(email.trim() ? { email } : {}),
          shipping_address: { country: data.pricing?.country, ...address },
        },
        actionId: crypto.randomUUID(),
      });
    };
    if (resume)
      return (
        <div
          ref={(node) => {
            container.current = node;
          }}
        >
          <Storefront
            draftScope={JSON.stringify([
              accountRevision,
              ui.sessionId,
              ui.flowId,
            ])}
            data={data}
            busy={!!busy}
            error={
              error ? (errorText[error] ?? "暂时无法完成，请稍后重试。") : ""
            }
            errorCode={error}
            action={action}
            now={tick}
            startShopping={startShopping}
            addedQuantity={addedQuantity}
            onViewChange={onViewChange}
          />
        </div>
      );
    return (
      <section
        ref={(node) => {
          container.current = node;
        }}
        className={`fv${resume ? "" : " fv-inline"}`}
        aria-label="Frontvia 购物卡片"
        aria-busy={!!busy}
      >
        <style>{styles}</style>
        <Card>
          <CardHeader>
            <div className="fv-brand">
              <ShoppingBag aria-hidden />
            </div>
            <div className="fv-header-text">
              <CardTitle>商家购物</CardTitle>
            </div>
            <div className="fv-header-actions">
              {data?.mockPayment && <Badge>测试商店 · Mock</Badge>}
              <Button
                variant="ghost"
                size="icon"
                disabled={!!busy}
                onClick={() => action("view")}
                aria-label="刷新购物进度"
                title="刷新购物进度"
              >
                {busy === "view" ? <Spinner /> : <RefreshCw aria-hidden />}
              </Button>
            </div>
          </CardHeader>
          <Tabs
            value={tab ?? (data ? shoppingStep(data) : "")}
            onValueChange={setTab}
          >
            <TabsList aria-label="购物步骤">
              {[
                { value: "products", label: "选购商品", Icon: ShoppingBag },
                { value: "cart", label: "收货配送", Icon: MapPin },
                { value: "quote", label: "核对订单", Icon: CreditCard },
                { value: "order", label: "订单结果", Icon: CheckCheck },
              ].map(({ value, label, Icon }) => (
                <TabsTrigger value={value} key={value}>
                  <Icon aria-hidden />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <CardContent>
              {(data?.cartReady === false || data?.purchaseReady === false) && (
                <Alert>
                  <Info aria-hidden />
                  <AlertDescription>
                    {data?.cartReady === false
                      ? "当前店铺仅支持浏览，暂不可加购或结账。"
                      : "可以加购，暂不可结账。"}
                  </AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <Info aria-hidden />
                  <AlertDescription>
                    {errorText[error] ?? error}
                    {!data && (
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => action("view")}
                        >
                          重新加载
                        </Button>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {!data ? (
                error ? null : (
                  <div
                    className="fv-stack"
                    role="status"
                    aria-label="读取购物进度"
                  >
                    <Skeleton className="fv-skeleton-title" />
                    <Skeleton className="fv-skeleton-block" />
                    <FieldGroup>
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                    </FieldGroup>
                    <span className="fv-sr-only">正在读取购物进度</span>
                  </div>
                )
              ) : (
                <>
                  {data.pending && (
                    <Alert variant="warning">
                      <Clock3 aria-hidden />
                      <AlertDescription>
                        上次操作正在核对，请勿重复下单。
                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!busy}
                            onClick={() => action("recover")}
                          >
                            核对原结果
                            <ArrowRight data-icon="inline-end" />
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  <TabsContent value="products">
                    {resume && (
                      <div className="fv-between">
                        <p className="fv-muted">
                          直接选择商品和配送，购买前由你确认。
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || data.pending}
                          onClick={() =>
                            action("shopping", {
                              intent: { action: "browse" },
                              actionId: crypto.randomUUID(),
                            })
                          }
                        >
                          浏览商品
                        </Button>
                      </div>
                    )}
                    <ProductSelection
                      data={data}
                      busy={!!busy}
                      canAsk={canShop && !data.pending && !locked}
                      ask={ask}
                      formatPrice={money}
                      onCart={() => setTab("cart")}
                    >
                      {items(data.products).length ? (
                        <div className="fv-product-grid">
                          {items(data.products).map((p: any) => (
                            <Card className="fv-product" key={p.id}>
                              <div className="fv-product-media">
                                {image(p) ? (
                                  <img
                                    src={image(p)}
                                    alt={p.title}
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <ShoppingBag aria-hidden />
                                )}
                              </div>
                              <CardHeader>
                                <CardTitle>{p.title}</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="fv-price">
                                  {money(
                                    p.price_range?.min ??
                                      p.price_range?.minimum,
                                  )}
                                  {data.historicalCatalog && (
                                    <span className="fv-reference-price">
                                      参考价
                                    </span>
                                  )}
                                </p>
                              </CardContent>
                              <CardFooter>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!!busy || !canShop}
                                  onClick={() =>
                                    ask({
                                      action: "variants",
                                      productId: p.id,
                                      productName: p.title ?? "所选商品",
                                    })
                                  }
                                >
                                  选择规格
                                  <ArrowRight data-icon="inline-end" />
                                </Button>
                              </CardFooter>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <Empty>
                          <Search aria-hidden />
                          <EmptyTitle>暂无商品</EmptyTitle>
                          <EmptyDescription>
                            {resume
                              ? "点击浏览商品，查看商家当前商品。"
                              : "告诉智能体你想找的商品。"}
                          </EmptyDescription>
                        </Empty>
                      )}
                    </ProductSelection>
                    {resume &&
                      data.products?.page?.has_more &&
                      data.products.page.next_cursor && (
                        <Button
                          variant="outline"
                          disabled={!!busy || data.pending}
                          onClick={() =>
                            action("shopping", {
                              intent: {
                                action: "browse",
                                cursor: data.products.page.next_cursor,
                              },
                              actionId: crypto.randomUUID(),
                            })
                          }
                        >
                          下一页商品
                        </Button>
                      )}
                  </TabsContent>
                  <TabsContent value="cart">
                    {data.cart ? (
                      <>
                        <div className="fv-section-heading">
                          <div>
                            <h4>{locked ? "本次收货信息" : "收货与配送"}</h4>
                            <p className="fv-description">
                              {locked
                                ? "订单已提交，可在订单结果中查看最新状态。"
                                : "填写收货信息，运费将在选择配送后计算。"}
                            </p>
                          </div>
                          <Badge>
                            {data.pricing?.country === "CN"
                              ? "中国大陆 · CNY"
                              : "美国 · USD"}
                          </Badge>
                        </div>
                        <div className="fv-form-layout fv-chat-shipping">
                          <div className="fv-stack">
                            {manualCart(data.cart) ? (
                              <p className="fv-muted">
                                由商家交付，无需填写收货地址。
                              </p>
                            ) : locked ? (
                              <Address cart={data.cart} />
                            ) : (
                              <Card className="fv-contact-panel">
                                <CardHeader>
                                  <CardTitle>收货信息</CardTitle>
                                </CardHeader>
                                <form
                                  noValidate
                                  onSubmit={saveContact}
                                  aria-label="收货资料"
                                >
                                  <CardContent>
                                    <FieldGroup>
                                      {contactFields.map((f) => (
                                        <Field
                                          key={f.key}
                                          className={
                                            "wide" in f ? "fv-wide" : undefined
                                          }
                                          data-invalid={!!fieldErrors[f.key]}
                                          data-disabled={!!busy || data.pending}
                                        >
                                          <FieldLabel
                                            htmlFor={`${formId}-${f.key}`}
                                          >
                                            {f.label}
                                          </FieldLabel>
                                          <Input
                                            id={`${formId}-${f.key}`}
                                            name={f.key}
                                            required={isRequiredContact(f.key)}
                                            maxLength={f.max}
                                            type={
                                              f.key === "email"
                                                ? "email"
                                                : "text"
                                            }
                                            autoComplete={f.autoComplete}
                                            placeholder={f.placeholder}
                                            value={form[f.key]}
                                            aria-invalid={!!fieldErrors[f.key]}
                                            aria-describedby={
                                              fieldErrors[f.key]
                                                ? `${formId}-${f.key}-error`
                                                : undefined
                                            }
                                            disabled={!!busy || data.pending}
                                            onChange={(e) => {
                                              dirtyForm.current = true;
                                              setForm({
                                                ...form,
                                                [f.key]: e.target.value,
                                              });
                                              setFieldErrors({
                                                ...fieldErrors,
                                                [f.key]: undefined,
                                              });
                                            }}
                                          />
                                          {fieldErrors[f.key] && (
                                            <FieldError
                                              id={`${formId}-${f.key}-error`}
                                            >
                                              {fieldErrors[f.key]}
                                            </FieldError>
                                          )}
                                        </Field>
                                      ))}
                                    </FieldGroup>
                                  </CardContent>
                                  <CardFooter className="fv-contact-actions">
                                    <div className="fv-privacy">
                                      <LockKeyhole aria-hidden />
                                      <span>
                                        收货资料仅用于配送，不会发送给 AI 模型。
                                      </span>
                                    </div>
                                    <Button
                                      type="submit"
                                      disabled={
                                        !!busy ||
                                        data.pending ||
                                        (!dirty && contactReady)
                                      }
                                    >
                                      {busy === "contact" ? (
                                        <Spinner />
                                      ) : contactReady && !dirty ? (
                                        <Check data-icon="inline-start" />
                                      ) : null}
                                      {busy === "contact"
                                        ? "正在保存…"
                                        : contactReady && !dirty
                                          ? "收货资料已保存"
                                          : "保存收货资料"}
                                    </Button>
                                  </CardFooter>
                                </form>
                              </Card>
                            )}
                            {contactReady && !dirty && !locked && (
                              <>
                                <Separator />
                                <div className="fv-between">
                                  <div className="fv-section-icon">
                                    <Truck aria-hidden />
                                    <h4>配送方式</h4>
                                  </div>
                                  <Badge variant="success">
                                    <Check aria-hidden />
                                    资料已保存
                                  </Badge>
                                </div>
                                {(data.delivery?.delivery_groups ?? [])
                                  .length ? (
                                  data.delivery.delivery_groups.map(
                                    (g: any) => (
                                      <div className="fv-stack" key={g.id}>
                                        {g.options.map((o: any) => (
                                          <div
                                            className="fv-delivery"
                                            key={o.id}
                                          >
                                            <Truck aria-hidden />
                                            <div className="fv-delivery-copy">
                                              <p>{o.label}</p>
                                              <span>{money(o.amount)}</span>
                                            </div>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              disabled={
                                                !!busy ||
                                                !canShop ||
                                                data.pending
                                              }
                                              onClick={() =>
                                                ask({
                                                  action: "delivery",
                                                  groupId: g.id,
                                                  optionId: o.id,
                                                  optionName:
                                                    o.label ?? "所选配送方式",
                                                })
                                              }
                                            >
                                              选择并报价
                                              <ArrowRight data-icon="inline-end" />
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    ),
                                  )
                                ) : (
                                  <Button
                                    variant="outline"
                                    disabled={
                                      !!busy || !canShop || data.pending
                                    }
                                    onClick={() =>
                                      ask({ action: "delivery-options" })
                                    }
                                  >
                                    {busy === "agent" ? (
                                      <Spinner />
                                    ) : (
                                      <Truck data-icon="inline-start" />
                                    )}
                                    查询可用配送
                                    <ArrowRight data-icon="inline-end" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                          <aside className="fv-summary" aria-label="购物车摘要">
                            <h4>本次选购</h4>
                            <Lines lines={data.cart.lines} />
                            <Separator />
                            <div className="fv-total">
                              <span>当前金额</span>
                              <span>
                                {money(data.cart.totals?.grand_total)}
                              </span>
                            </div>
                            <p className="fv-muted">
                              最终金额以配送后的完整报价为准。
                            </p>
                            {data.quote && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setTab("quote")}
                              >
                                查看报价
                                <ArrowRight data-icon="inline-end" />
                              </Button>
                            )}
                          </aside>
                        </div>
                      </>
                    ) : (
                      <Empty>
                        <ShoppingCart aria-hidden />
                        <EmptyTitle>购物车为空</EmptyTitle>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTab("products")}
                        >
                          去选购
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      </Empty>
                    )}
                  </TabsContent>
                  <TabsContent value="quote">
                    {data.quote ? (
                      <div className="fv-stack">
                        <div className="fv-section-heading">
                          <div>
                            <h4>确认订单</h4>
                          </div>
                          <Badge
                            variant={quoteExpired ? "warning" : "secondary"}
                          >
                            <Clock3 aria-hidden />
                            {quoteExpired ? "报价已过期" : "报价有时效"}
                          </Badge>
                        </div>
                        {quoteExpired && (
                          <Alert variant="warning">
                            <Clock3 aria-hidden />
                            <AlertDescription>
                              这份报价已过期，请重新获取价格和配送费用。
                              <div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={
                                    !!busy ||
                                    !canShop ||
                                    data.intent?.submitted ||
                                    data.pending
                                  }
                                  onClick={() => ask({ action: "requote" })}
                                >
                                  重新报价
                                  <RefreshCw data-icon="inline-end" />
                                </Button>
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}
                        <div className="fv-form-layout">
                          <div className="fv-stack">
                            <Lines lines={data.quote.lines} />
                            <Address cart={data.cart} />
                            <div className="fv-privacy">
                              <ShieldCheck aria-hidden />
                              <span>
                                只有你点击确认购买，才会提交这笔订单。
                                <br />
                                报价或购物车变化后，需要重新核对。
                              </span>
                            </div>
                          </div>
                          <aside className="fv-summary" aria-label="费用明细">
                            <h4>费用明细</h4>
                            <Totals totals={data.quote.totals} />
                            <p className="fv-muted">
                              {data.quote.totals?.complete
                                ? "费用已完整"
                                : "费用尚未完整"}{" "}
                              ·{" "}
                              {data.quote.totals?.tax_inclusion === "inclusive"
                                ? "价格含税"
                                : "税费单独列示"}
                            </p>
                          </aside>
                        </div>
                        {data.checkout ? (
                          data.intent?.submitted ? (
                            <Alert>
                              <Check aria-hidden />
                              <AlertDescription>
                                已提交原确认，可查询订单的最新结果。
                                <div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setTab("order")}
                                  >
                                    查看订单
                                    <ArrowRight data-icon="inline-end" />
                                  </Button>
                                </div>
                              </AlertDescription>
                            </Alert>
                          ) : data.intent && !expired && !quoteExpired ? (
                            <div className="fv-confirm-box">
                              <div className="fv-between">
                                <span className="fv-section-icon">
                                  <ShieldCheck aria-hidden />
                                  费用已重新核对
                                </span>
                                <Badge>等待你确认</Badge>
                              </div>
                              <p className="fv-muted">
                                请确认以上商品、数量、收货资料和合计金额。
                              </p>
                              <Button
                                disabled={
                                  !!busy ||
                                  data.pending ||
                                  quoteExpired ||
                                  !data.purchaseReady
                                }
                                onClick={() =>
                                  action("confirm", {
                                    intentId: data.intent.id,
                                  }).then((ok) => {
                                    if (ok) setTab("order");
                                  })
                                }
                              >
                                {busy === "confirm" ? (
                                  <Spinner />
                                ) : (
                                  <LockKeyhole data-icon="inline-start" />
                                )}
                                确认购买 ·{" "}
                                {money(data.quote.totals.grand_total)}
                              </Button>
                            </div>
                          ) : (
                            <div className="fv-between">
                              <p className="fv-muted">
                                {expired
                                  ? "确认已过期，请重新核对。"
                                  : "下一步会重新核对完整报价。"}
                              </p>
                              <Button
                                disabled={
                                  !!busy ||
                                  data.pending ||
                                  quoteExpired ||
                                  !data.purchaseReady
                                }
                                onClick={() => action("review")}
                              >
                                {busy === "review" ? (
                                  <Spinner />
                                ) : (
                                  <ShieldCheck data-icon="inline-start" />
                                )}
                                核对完整报价
                                <ArrowRight data-icon="inline-end" />
                              </Button>
                            </div>
                          )
                        ) : (
                          <Button
                            disabled={
                              !!busy || !canShop || quoteExpired || data.pending
                            }
                            onClick={() => ask({ action: "prepare" })}
                          >
                            准备确认
                            <ArrowRight data-icon="inline-end" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Empty>
                        <CreditCard aria-hidden />
                        <EmptyTitle>还没有订单报价</EmptyTitle>
                        <EmptyDescription>
                          {resume
                            ? "保存收货资料并选择配送后，即可核对完整报价。"
                            : "保存收货资料并选择配送后，Agent 会为你生成完整报价。"}
                        </EmptyDescription>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTab("cart")}
                        >
                          填写收货资料
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      </Empty>
                    )}
                  </TabsContent>
                  <TabsContent value="order">
                    <div className="fv-stack">
                      <PaymentCard
                        data={data}
                        now={tick}
                        busy={!!busy}
                        refresh={() => {
                          void action("view");
                        }}
                        formatPrice={money}
                        cancel={() => action("order-cancel")}
                        start={() => {
                          void action("payment-start");
                        }}
                      />
                      {data.order && <Order order={data.order} />}{" "}
                      {items(data.orders)
                        .filter(
                          (o: any) => !data.order || o.id !== data.order.id,
                        )
                        .map((o: any) => (
                          <Order order={o} key={o.id} />
                        ))}
                      {!data.order && !items(data.orders).length && (
                        <Empty>
                          {data.pending ? (
                            <Clock3 aria-hidden />
                          ) : (
                            <Package aria-hidden />
                          )}
                          <EmptyTitle>
                            {data.pending
                              ? "正在核对订单"
                              : "还没有已提交的订单"}
                          </EmptyTitle>
                          <EmptyDescription>
                            {data.pending
                              ? "请查询原结果，避免重复购买。"
                              : "完成费用核对并确认购买后，订单会显示在这里。"}
                          </EmptyDescription>
                        </Empty>
                      )}
                      <div className="fv-between">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => action("recover")}
                        >
                          {busy === "recover" ? (
                            <Spinner />
                          ) : (
                            <RefreshCw data-icon="inline-start" />
                          )}
                          查询原订单结果
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </>
              )}
            </CardContent>
          </Tabs>
          {busy && (
            <CardFooter>
              <span className="fv-row" role="status" aria-live="polite">
                <Spinner />
                正在处理…
              </span>
            </CardFooter>
          )}
        </Card>
      </section>
    );
  }
  function Panel() {
    return (
      <>
        <style>{styles}</style>
        <ServicePage
          openAccount={() => ctx.layout.selectPanel("dsh-identity")}
          call={call}
          openConnections={() => ctx.layout.selectPanel("pap-connections")}
          renderFlow={(ui, startShopping, addedQuantity, initialError) => (
            <FlowCard
              key={ui.flowId}
              ui={ui}
              resume
              startShopping={startShopping}
              addedQuantity={addedQuantity}
              initialError={initialError}
            />
          )}
        />
      </>
    );
  }
  function Tail({ turn, sendToAgent }: any) {
    const cards = turn.data.get("frontvia-customer-cards")?.cards ?? [];
    const c = cards.at(-1);
    useEffect(() => {
      if (c && c.ui.card !== "consultation") views.invalidate(c.ui);
    }, [c?.callId, c?.ui.flowId, c?.ui.sessionId]);
    return c ? (
      <FlowCard
        key={`${c.ui.flowId}:${c.callId}`}
        ui={c.ui}
        catalog={c.catalog ?? {}}
        sendToAgent={sendToAgent}
      />
    ) : null;
  }
  function FlowCard({
    ui,
    sendToAgent,
    resume = false,
    startShopping,
    addedQuantity,
    initialError,
    catalog,
  }: {
    ui: UI;
    sendToAgent?: (s: string) => Promise<unknown>;
    resume?: boolean;
    startShopping?: StartShopping;
    addedQuantity?: number;
    initialError?: string;
    catalog?: CatalogSnapshot;
  }) {
    return ui.card === "consultation" ? (
      <section
        className={`fv${resume ? "" : " fv-inline"}`}
        aria-label="Frontvia 商家咨询"
      >
        <style>{styles}</style>
        <ConsultationCard ui={ui} call={call} sendToAgent={sendToAgent} />
      </section>
    ) : (
      <Shopping
        ui={ui}
        catalog={catalog}
        sendToAgent={sendToAgent}
        resume={resume}
        startShopping={startShopping}
        addedQuantity={addedQuantity}
        initialError={initialError}
      />
    );
  }
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "frontvia-customer" }, Panel),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "frontvia-customer",
        order: 31,
        label: () => "Frontvia 服务",
      },
      () => <span aria-hidden>◇</span>,
    ),
  );
  ctx.uiConversation.events.register(historyDefinition);
  ctx.uiConversation.userText.register(cardMessageRule);
  ctx.slots.inject("conversation.chat.turnTail", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.turnTail",
        id: "frontvia-customer-cards",
        inject: (sessionId: string) => ({
          sendToAgent: (text: string) => {
            const c = ctx.sessions.scope(sessionId)?.get("conversation");
            if (!c) throw new Error("会话已关闭");
            return c.send(text);
          },
        }),
      },
      Tail,
    ),
  );
  ctx.slots.inject("tool.call.toolview", () => {
    for (const key of [
      "frontvia_connection",
      "frontvia_products",
      "frontvia_cart",
      "frontvia_checkout",
      "frontvia_orders",
      "frontvia_consultation",
      "frontvia_knowledge",
    ])
      ctx.slots.register(
        { name: "tool.call.toolview", key },
        ({ phase, block }: any) => (
          <ToolFeedback name={key} phase={phase} block={block} />
        ),
      );
  });
}
