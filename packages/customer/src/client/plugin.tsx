import { useAccountRevision } from "./account.js";
import { accountRequest } from "./account-request.js";
import { FrontviaAccountPanel } from "./personal-panel.js";
import React, { useEffect, useId, useState } from "react";
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
import { historyDefinition, shoppingReference } from "./history.js";
import { ToolFeedback } from "./tool-feedback.js";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
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
  "connection",
  "uiConversation",
  "sessions",
  "conversation",
];
type UI = { flowId: string; sessionId: string; card: string };
const items = (v: any) =>
  Array.isArray(v)
    ? v
    : (v?.items ?? v?.products ?? v?.variants ?? v?.orders ?? []);
const money = (m: any) => {
  if (m?.amount_minor !== undefined && /^\d+$/.test(m.amount_minor)) {
    const n = BigInt(m.amount_minor);
    return `${m.currency} ${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
  }
  return m?.amount_decimal !== undefined
    ? `${m.currency} ${m.amount_decimal}`
    : "待核对";
};
const image = (p: any) => {
  const raw = p.images?.[0]?.url;
  try {
    return new URL(raw).protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
};
const errorText: Record<string, string> = {
  PERSONAL_ACCOUNT_CHANGED: "请登录原个人账号后查看此记录。",
  PERSONAL_LOGIN_REQUIRED: "请先到 Frontvia 服务登录个人账号。",
  PERSONAL_CHAT_ACCOUNT_CHANGED: "此聊天已用于另一账号，请新建聊天后连接商家。",
  FLOW_NOT_OWNED: "这份购物进度不属于当前会话，请回到原聊天查看。",
  NETWORK_FAILURE: "暂时无法连接商店，请稍后刷新。",
  NETWORK_TIMEOUT: "商店响应超时，请稍后刷新。",
  NETWORK_UNCERTAIN: "暂未收到商店回复，请先核对原操作结果。",
  QUOTE_CHANGED: "报价或购物车已变化，请重新报价并核对。",
  CONFIRMATION_EXPIRED: "确认已过期，请重新核对当前报价。",
  CART_VERSION_CHANGED: "购物车已更新，请刷新后重试。",
  RESOLVE_PENDING_OPERATION: "上次操作结果尚未明确，请先核对原结果。",
  ORIGINAL_RESULT_UNKNOWN: "暂未查到原操作结果，请稍后再次核对，不要重复购买。",
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
const contactFields = [
  {
    key: "recipient",
    label: "收货人",
    placeholder: "填写收货人姓名",
    autoComplete: "shipping name",
    max: 200,
  },
  {
    key: "email",
    label: "联系邮箱",
    placeholder: "name@example.com",
    autoComplete: "email",
    max: 254,
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
] as const;
type Contact = Record<(typeof contactFields)[number]["key"], string>;
const blankContact: Contact = {
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
    email: v?.cart?.email ?? "",
    recipient: a?.recipient ?? "",
    line1: a?.line1 ?? "",
    city: a?.city ?? "",
    region: a?.region ?? "",
    postal_code: a?.postal_code ?? "",
  };
};
function Lines({ lines = [] }: { lines?: any[] }) {
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
function Address({ cart }: { cart: any }) {
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
function Totals({ totals }: { totals: any }) {
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
function Order({ order }: { order: any }) {
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
          <h4>订单已创建</h4>
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
              {fulfillment[order.fulfillment_status] ??
                order.fulfillment_status ??
                "暂未查到"}
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
  function Shopping({
    ui,
    sendToAgent,
  }: {
    ui: UI;
    sendToAgent?: (s: string) => Promise<unknown>;
  }) {
    const [data, setData] = useState<any>(),
      [busy, setBusy] = useState(""),
      [error, setError] = useState(""),
      [tab, setTab] = useState(ui.card === "connection" ? "products" : ui.card),
      [tick, setTick] = useState(Date.now());
    const [form, setForm] = useState<Contact>(blankContact),
      [fieldErrors, setFieldErrors] = useState<Partial<Contact>>({});
    const formId = useId();
    const accountRevision = useAccountRevision();
    useEffect(() => {
      let live = true;
      setData(undefined);
      setForm(blankContact);
      call("view", ui)
        .then((v) => {
          if (live) {
            setData(v);
            setForm(contactFrom(v));
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
      return () => {
        live = false;
      };
    }, [ui.flowId, ui.sessionId, accountRevision]);
    useEffect(() => {
      const t = setInterval(() => setTick(Date.now()), 1000);
      return () => clearInterval(t);
    }, []);
    const action = async (op: string, payload: any = {}) => {
      setBusy(op);
      setError("");
      try {
        const value = await call(op, { ...ui, ...payload });
        setData(value);
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
        setError(op === "confirm" ? "CONFIRMATION_RESULT_UNKNOWN" : e.message);
        if (op === "confirm") setData((v: any) => ({ ...v, pending: true }));
        return false;
      } finally {
        setBusy("");
      }
      return true;
    };
    const ask = async (text: string) => {
      if (!sendToAgent) {
        setError("请回到所属聊天，让 Agent 继续购物。");
        return;
      }
      setBusy("agent");
      setError("");
      try {
        await sendToAgent(`当前购物 flowId=${ui.flowId}。${text}`);
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
    const contactReady = contactFields.every(
      ({ key }) => !!contactFrom(data)[key],
    );
    const locked = !!data?.intent?.submitted || !!data?.order;
    const saveContact = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const element = e.currentTarget;
      const errors: Partial<Contact> = {};
      for (const { key, label } of contactFields) {
        const input = element.elements.namedItem(key) as HTMLInputElement;
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
        patch: { email, shipping_address: { country: "US", ...address } },
        actionId: crypto.randomUUID(),
      });
    };
    return (
      <section className="fv" aria-label="Frontvia 购物卡片" aria-busy={!!busy}>
        <style>{styles}</style>
        <Card>
          <CardHeader>
            <div className="fv-brand">
              <ShoppingBag aria-hidden />
            </div>
            <div className="fv-header-text">
              <CardTitle>Frontvia</CardTitle>
              <CardDescription>挑选好物，安心下单</CardDescription>
            </div>
            <div className="fv-header-actions">
              <Badge>
                {data?.mockPayment ? "测试商店 · Mock" : "商家购物服务"}
              </Badge>
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
          <Tabs value={tab} onValueChange={setTab}>
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
                      ? "当前连接仅支持浏览商品，尚未开通购物车和结算。个人账号已登录不代表购物能力已开通。"
                      : "可以加入购物车。购买确认尚未就绪，请先完成购买服务配置。"}
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
                    <div className="fv-stack">
                      <div className="fv-section-heading">
                        <div>
                          <h4>发现心仪的商品</h4>
                          <p className="fv-description">
                            选择商品规格，加入本次购物车。
                          </p>
                        </div>
                        {data.cart && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTab("cart")}
                          >
                            <ShoppingCart data-icon="inline-start" />
                            购物车
                          </Button>
                        )}
                      </div>
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
                                </p>
                              </CardContent>
                              <CardFooter>
                                <span className="fv-muted">查看可选规格</span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!!busy || !sendToAgent}
                                  onClick={() =>
                                    ask(
                                      `查看商品 ${p.id} 的可购买规格，展示规格和真实价格。`,
                                    )
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
                          <EmptyTitle>想买点什么？</EmptyTitle>
                          <EmptyDescription>
                            告诉 Agent 你想找的商品，搜索结果会出现在这里。
                          </EmptyDescription>
                        </Empty>
                      )}
                      {items(data.variants).length > 0 && (
                        <div className="fv-stack">
                          <div className="fv-section-icon">
                            <Package aria-hidden />
                            <h4>可购买规格</h4>
                          </div>
                          {items(data.variants).map((v: any) => (
                            <div className="fv-delivery" key={v.id}>
                              <div className="fv-delivery-copy">
                                <p>{v.title}</p>
                                <span>{money(v.unit_price)}</span>
                              </div>
                              <Button
                                size="sm"
                                disabled={
                                  !!busy || !sendToAgent || !data.cartReady
                                }
                                onClick={() =>
                                  ask(
                                    `将规格 ${v.id} 加购 1 件。已有购物车请先读取最新版本。完成后展示购物车卡片。`,
                                  )
                                }
                              >
                                {data.cartReady ? "加购 1 件" : "暂不可加购"}
                                <ShoppingCart data-icon="inline-end" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
                          <Badge>美国 · USD</Badge>
                        </div>
                        <div className="fv-form-layout">
                          <div className="fv-stack">
                            {locked ? (
                              <Address cart={data.cart} />
                            ) : (
                              <form
                                noValidate
                                onSubmit={saveContact}
                                aria-label="收货资料"
                              >
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
                                        required
                                        maxLength={f.max}
                                        type={
                                          f.key === "email" ? "email" : "text"
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
                                <div className="fv-form-actions">
                                  <div className="fv-privacy">
                                    <LockKeyhole aria-hidden />
                                    <span>
                                      收货资料仅用于配送，
                                      <br />
                                      不会发送给 AI 模型。
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
                                </div>
                              </form>
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
                                                !sendToAgent ||
                                                data.pending
                                              }
                                              onClick={() =>
                                                ask(
                                                  `选择配送组 ${g.id} 的选项 ${o.id}。先读取最新购物车版本，再选择配送、按新版本生成报价并 prepare；停在待我确认的卡片。`,
                                                )
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
                                      !!busy || !sendToAgent || data.pending
                                    }
                                    onClick={() =>
                                      ask(
                                        "收货资料已填写。读取最新购物车并查询可用配送方式，说明运费供我选择。",
                                      )
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
                        <EmptyTitle>购物车还是空的</EmptyTitle>
                        <EmptyDescription>
                          先选一件心仪的商品，再填写收货资料。
                        </EmptyDescription>
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
                            <h4>确认你的订单</h4>
                            <p className="fv-description">
                              商品、收货信息和费用都在这里。
                            </p>
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
                                    !sendToAgent ||
                                    data.intent?.submitted ||
                                    data.pending
                                  }
                                  onClick={() =>
                                    ask(
                                      "报价已过期，请 revise 未确认的草稿结算，重新读取购物车版本、报价并 prepare，停在用户确认前。",
                                    )
                                  }
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
                              !!busy ||
                              !sendToAgent ||
                              quoteExpired ||
                              data.pending
                            }
                            onClick={() =>
                              ask(
                                "请准备当前有效报价的结算，展示待我确认的卡片，不要替我确认。",
                              )
                            }
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
                          保存收货资料并选择配送后，Agent 会为你生成完整报价。
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
                        <span className="fv-muted">以商店当前记录为准</span>
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
          <CardFooter>
            <span className="fv-row">
              <LockKeyhole aria-hidden />
              由你确认购买
            </span>
            <span role="status" aria-live="polite">
              {busy ? (
                <span className="fv-row">
                  <Spinner />
                  正在处理…
                </span>
              ) : data?.mockPayment ? (
                "测试环境 · Mock 支付"
              ) : (
                "支付方式和金额请以结算信息为准"
              )}
            </span>
          </CardFooter>
        </Card>
      </section>
    );
  }
  function Panel() {
    const accountRevision = useAccountRevision();
    const [rows, setRows] = useState<any[]>([]),
      [selected, setSelected] = useState<any>(),
      [error, setError] = useState(""),
      [loading, setLoading] = useState(true);
    useEffect(() => {
      let live = true;
      setRows([]);
      setSelected(undefined);
      setLoading(true);
      setError("");
      call("list")
        .then((v) => {
          if (live) setRows(v.flows);
        })
        .catch(() => {
          if (live) setError("Frontvia 服务未就绪，请检查插件及本机配置。");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
      return () => {
        live = false;
      };
    }, [accountRevision]);
    return (
      <div className="fv-viewport">
        <div className="fv">
          <style>{styles}</style>
          <FrontviaAccountPanel call={call} />
          <Card>
            <CardHeader>
              <div className="fv-brand">
                <ShoppingBag aria-hidden />
              </div>
              <div>
                <CardTitle>你的 Frontvia 服务</CardTitle>
                <CardDescription>
                  继续商家咨询、知识查询或购物；在 PAP 连接中添加商家服务。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert variant="destructive">
                  <Info aria-hidden />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {loading ? (
                <Skeleton className="fv-skeleton-block" />
              ) : rows.length ? (
                <div className="fv-progress-list">
                  {rows.map((f) => (
                    <Button
                      variant="outline"
                      key={f.flowId}
                      onClick={() => setSelected(shoppingReference(f))}
                    >
                      <span>
                        {f.siteId} · {new Date(f.updatedAt).toLocaleString()}
                      </span>
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  ))}
                </div>
              ) : (
                !error && (
                  <Empty>
                    <ShoppingBag aria-hidden />
                    <EmptyTitle>连接商家，开始咨询</EmptyTitle>
                    <EmptyDescription>
                      登录后，在 PAP
                      连接中添加并连接商家，再新建聊天开始咨询。服务记录会保留在这里。
                    </EmptyDescription>
                  </Empty>
                )
              )}
            </CardContent>
          </Card>
          {selected && <FlowCard key={selected.flowId} ui={selected} />}
        </div>
      </div>
    );
  }
  function Tail({ turn, sendToAgent }: any) {
    const cards = turn.data.get("frontvia-customer-cards")?.cards ?? [];
    const c = cards.at(-1);
    return c ? (
      <FlowCard
        key={`${c.ui.flowId}:${c.callId}`}
        ui={c.ui}
        sendToAgent={sendToAgent}
      />
    ) : null;
  }
  function FlowCard({
    ui,
    sendToAgent,
  }: {
    ui: UI;
    sendToAgent?: (s: string) => Promise<unknown>;
  }) {
    return ui.card === "consultation" ? (
      <section className="fv" aria-label="Frontvia 商家咨询">
        <style>{styles}</style>
        <ConsultationCard ui={ui} call={call} sendToAgent={sendToAgent} />
      </section>
    ) : (
      <Shopping ui={ui} sendToAgent={sendToAgent} />
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
