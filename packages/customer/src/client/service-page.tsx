import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  Clock3,
  Link2,
  MessageCircle,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { useAccountRevision } from "./account.js";
import { AccountSummary, type AccountStatus } from "./account-summary.js";
import { shoppingReference } from "./history.js";
import {
  serviceMerchants,
  resolveServiceSelection,
  readServiceSelection,
  saveServiceSelection,
  flowKind as kindOf,
  type ServiceFlow as Flow,
  type ServiceSite as Site,
  type ServiceSelection,
} from "./service-merchants.js";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Separator,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./ui.js";

type Reference = ReturnType<typeof shoppingReference>;
type Props = {
  call: (op: string, payload?: any) => Promise<any>;
  openConnections: () => void;
  openAccount: () => void;
  renderFlow: (reference: Reference) => React.ReactNode;
};
const kinds = [
  { value: "all", label: "全部记录" },
  { value: "shopping", label: "购物" },
  { value: "consultation", label: "咨询与知识" },
] as const;
function updatedTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date)
    : "更新时间未知";
}

export function ServicePage(props: Props) {
  const revision = useAccountRevision();
  return <AccountServicePage key={revision} revision={revision} {...props} />;
}
function AccountServicePage({
  call,
  openConnections,
  openAccount,
  renderFlow,
  revision,
}: Props & { revision: number }) {
  const [snapshot, setData] = useState<{
    flows: Flow[];
    sites: Site[];
    revision: number;
  }>();
  // Hide previous-account records in the same render that observes the change.
  const data = snapshot?.revision === revision ? snapshot : undefined;
  const [selection, setSelection] = useState<ServiceSelection>(() => {
    try {
      return revision ? {} : readServiceSelection(window.sessionStorage);
    } catch {
      return {};
    }
  });
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [account, setAccount] = useState<{
    revision: number;
    status?: AccountStatus;
    error: boolean;
  }>();
  useEffect(() => {
    let live = true;
    setAccount(undefined);
    call("personal-status")
      .then((status: AccountStatus) => {
        if (
          typeof status?.signedIn !== "boolean" ||
          typeof status.configured !== "boolean"
        )
          throw new Error("Invalid account status");
        if (live) setAccount({ revision, status, error: false });
      })
      .catch(() => {
        if (live) setAccount({ revision, error: true });
      });
    return () => {
      live = false;
    };
  }, [call, revision, refresh]);
  const detail = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (revision) {
      try {
        saveServiceSelection(window.sessionStorage);
      } catch {}
    }
  }, [revision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    call("list")
      .then((value) => {
        if (!Array.isArray(value.flows))
          throw new Error("Invalid service list");
        if (live) {
          setData({ flows: value.flows, sites: value.sites ?? [], revision });
        }
      })
      .catch(() => {
        if (live) setError("暂时无法读取服务记录，请重试。已有记录不会丢失。");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [call, refresh, revision]);
  const merchants = serviceMerchants(data?.sites ?? [], data?.flows ?? []);
  const { merchant, flow: selected } = resolveServiceSelection(
    merchants,
    selection,
  );
  const rows = merchant?.flows ?? [];
  const pending = rows.filter((flow) => flow.pending).length;
  const visible = rows.filter(
    (flow) => filter === "all" || kindOf(flow) === filter,
  );
  const focusDetail = useRef(false);
  useEffect(() => {
    if (merchant) {
      // Pin the resolved default too, so refreshed timestamps cannot switch shops.
      setSelection({ merchantKey: merchant.key, flowId: selected?.flowId });
      try {
        saveServiceSelection(window.sessionStorage, {
          merchantKey: merchant.key,
          flowId: selected?.flowId,
        });
      } catch {}
    }
    if (focusDetail.current) {
      detail.current?.scrollIntoView({ block: "start", behavior: "instant" });
      detail.current?.focus({ preventScroll: true });
      focusDetail.current = false;
    }
  }, [merchant?.key, selected?.flowId]);
  return (
    <div
      className="fv-viewport"
      role="region"
      aria-label="Frontvia 服务页面"
      tabIndex={0}
    >
      <div className="fv fv-home">
        <header className="fv-page-header">
          <div>
            <p className="fv-eyebrow">你的商家服务</p>
            <h2>Frontvia 服务</h2>
            <p className="fv-page-description">
              选择商家，直接继续选购或查看咨询答复。
            </p>
          </div>
          <div className="fv-page-actions">
            <Button
              variant="ghost"
              size="icon"
              disabled={loading}
              onClick={() => setRefresh((n) => n + 1)}
              aria-label="刷新服务记录"
              title="刷新服务记录"
            >
              {loading ? <Spinner /> : <RefreshCw aria-hidden />}
            </Button>
            <Button variant="outline" onClick={openConnections}>
              <Link2 data-icon="inline-start" />
              管理商家连接
            </Button>
          </div>
        </header>

        <AccountSummary
          status={account?.revision === revision ? account.status : undefined}
          error={account?.revision === revision && account.error}
          openAccount={openAccount}
        />

        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{error}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => setRefresh((n) => n + 1)}
            >
              重试
            </Button>
          </Alert>
        )}
        <section className="fv-merchants" aria-label="商家选择">
          <div className="fv-section-heading">
            <div>
              <h3>我的商家</h3>
              <p className="fv-description">
                切换商家，购物进度与历史记录一起切换。
              </p>
            </div>
            {data && <Badge>{merchants.length} 家商家</Badge>}
          </div>
          {!data && loading ? (
            <div
              className="fv-history-loading"
              role="status"
              aria-label="正在读取商家"
            >
              <Skeleton />
              <span className="fv-sr-only">正在读取商家…</span>
            </div>
          ) : merchants.length ? (
            <div
              className="fv-merchant-list"
              role="group"
              aria-label="选择商家"
            >
              {merchants.map((item) => (
                <button
                  type="button"
                  className="fv-merchant"
                  key={item.key}
                  aria-pressed={merchant?.key === item.key}
                  aria-controls={`${id}-detail`}
                  onClick={() => {
                    setSelection({ merchantKey: item.key });
                    setFilter("all");
                  }}
                >
                  <Store aria-hidden />
                  <span className="fv-record-copy">
                    <span className="fv-record-title">{item.title}</span>
                    <span className="fv-record-description">
                      {item.domain ?? "已配置商家服务"}
                      {item.storeId &&
                      merchants.some(
                        (other) =>
                          other.key !== item.key &&
                          other.domain === item.domain,
                      )
                        ? ` · 店铺 ${item.storeId}${merchants.some((other) => other.key !== item.key && other.domain === item.domain && other.storeId === item.storeId) ? ` · ${item.sites[0]?.issuer ?? item.sites[0]?.id}` : ""}`
                        : ""}
                    </span>
                    <span className="fv-record-time">
                      {item.flows.length} 条记录
                    </span>
                  </span>
                  <span className="fv-merchant-state">
                    {merchant?.key === item.key ? "当前商家" : "选择商家"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            !error && (
              <Empty>
                <Store aria-hidden />
                <EmptyTitle>还没有商家</EmptyTitle>
                <EmptyDescription>
                  在 PAP 中添加商家服务后，商家会显示在这里。
                </EmptyDescription>
                <Button variant="outline" onClick={openConnections}>
                  管理商家连接
                </Button>
              </Empty>
            )
          )}
        </section>

        {merchant && (
          <section
            className="fv-selected-flow"
            ref={detail}
            id={`${id}-detail`}
            tabIndex={-1}
            aria-label="商家操作面板"
          >
            <div className="fv-section-heading">
              <div>
                <h3>{merchant.title}</h3>
                <p className="fv-description">
                  {selected
                    ? `${kindOf(selected) === "shopping" ? "购物进度" : "咨询答复"} · ${updatedTime(selected.updatedAt)}更新`
                    : "商家已显示在这里，服务记录会保留在下方。"}
                </p>
              </div>
              <Badge>
                {selected
                  ? kindOf(selected) === "shopping"
                    ? "手动购物"
                    : "咨询与知识"
                  : "暂无服务记录"}
              </Badge>
            </div>
            {selected ? (
              renderFlow(shoppingReference(selected))
            ) : (
              <Empty>
                <ShoppingBag aria-hidden />
                <EmptyTitle>还没有这家商家的服务记录</EmptyTitle>
                <EmptyDescription>
                  先在聊天中连接这家商家并开始购物或咨询，之后即可在这里继续操作。
                </EmptyDescription>
                <Button variant="outline" onClick={openConnections}>
                  查看商家连接
                </Button>
              </Empty>
            )}
          </section>
        )}

        {merchant && (
          <section className="fv-history-section" aria-label="当前商家历史记录">
            <div className="fv-section-heading">
              <div>
                <h3>这家商家的历史记录</h3>
                <p className="fv-description">
                  选择历史记录，在上方查看对应的购物进度或咨询答复。
                </p>
              </div>
              {data && <Badge>{rows.length} 条记录</Badge>}
            </div>
            <Tabs
              value={filter}
              onValueChange={setFilter}
              className="fv-history-tabs"
            >
              <TabsList aria-label="服务记录分类">
                {kinds.map((kind) => (
                  <TabsTrigger key={kind.value} value={kind.value}>
                    {kind.label}
                    <span className="fv-tab-count">
                      {data
                        ? rows.filter(
                            (flow) =>
                              kind.value === "all" ||
                              kindOf(flow) === kind.value,
                          ).length
                        : "—"}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {kinds.map((kind) => (
                <TabsContent key={kind.value} value={kind.value}>
                  {loading ? (
                    <div
                      className="fv-history-loading"
                      role="status"
                      aria-label="正在读取服务记录"
                    >
                      <Skeleton />
                      <Skeleton />
                      <span className="fv-sr-only">正在读取服务记录…</span>
                    </div>
                  ) : visible.length ? (
                    <div className="fv-record-list">
                      {visible.map((flow) => {
                        const consultation = kindOf(flow) === "consultation";
                        const Icon = consultation ? MessageCircle : ShoppingBag;
                        return (
                          <button
                            type="button"
                            key={flow.flowId}
                            className="fv-record"
                            aria-expanded={selected?.flowId === flow.flowId}
                            aria-controls={
                              selected?.flowId === flow.flowId
                                ? `${id}-detail`
                                : undefined
                            }
                            onClick={() => {
                              focusDetail.current = true;
                              setSelection({
                                merchantKey: merchant.key,
                                flowId: flow.flowId,
                              });
                              if (selected?.flowId === flow.flowId) {
                                detail.current?.scrollIntoView({
                                  block: "start",
                                  behavior: "instant",
                                });
                                detail.current?.focus({ preventScroll: true });
                                focusDetail.current = false;
                              }
                            }}
                          >
                            <span className="fv-service-icon">
                              <Icon aria-hidden />
                            </span>
                            <span className="fv-record-copy">
                              <span className="fv-record-title">
                                {consultation ? "咨询与知识" : "购物记录"}
                              </span>
                              <span className="fv-record-description">
                                {merchant.title}
                              </span>
                              <span className="fv-record-time">
                                <Clock3 aria-hidden />
                                <time
                                  dateTime={
                                    Number.isFinite(Date.parse(flow.updatedAt))
                                      ? flow.updatedAt
                                      : undefined
                                  }
                                >
                                  {updatedTime(flow.updatedAt)}
                                </time>
                                更新
                              </span>
                            </span>
                            <span className="fv-record-meta">
                              <Badge
                                variant={flow.pending ? "warning" : "secondary"}
                              >
                                {flow.pending
                                  ? "待核对结果"
                                  : consultation
                                    ? "咨询与知识"
                                    : "购物记录"}
                              </Badge>
                              <span className="fv-record-action">
                                {flow.pending
                                  ? "查看并恢复"
                                  : consultation
                                    ? "查看答复"
                                    : "继续购物"}
                                <ArrowRight aria-hidden />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    !error && (
                      <Empty>
                        <Store aria-hidden />
                        <EmptyTitle>
                          {rows.length
                            ? `暂无${kind.label}记录`
                            : "暂无服务记录"}
                        </EmptyTitle>
                        <EmptyDescription>
                          {rows.length
                            ? "在聊天中使用这类商家服务后，记录会出现在这里。"
                            : "在聊天中连接这家商家并开始购物或咨询后，记录会出现在这里。"}
                        </EmptyDescription>
                        {rows.length ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFilter("all")}
                          >
                            查看全部记录
                          </Button>
                        ) : (
                          <Button variant="outline" onClick={openConnections}>
                            <Link2 data-icon="inline-start" />
                            前往 PAP 连接
                          </Button>
                        )}
                      </Empty>
                    )
                  )}
                </TabsContent>
              ))}
            </Tabs>
            {data && !loading && rows.length > 0 && (
              <p className="fv-history-caption">
                按最近更新排序 · 同一商家的不同聊天分别保留
                {pending > 0 ? ` · ${pending} 条待核对结果` : ""}
              </p>
            )}
          </section>
        )}

        <aside className="fv-start-guide" aria-label="使用指南">
          <Separator />
          <div className="fv-guide-heading">
            <h3>在这里，你可以</h3>
            <span>咨询在聊天中进行，购物也可在这里操作</span>
          </div>
          <div className="fv-guide-grid">
            {[
              {
                Icon: Link2,
                title: "连接商家",
                text: "在 PAP 中添加商家服务，管理连接与身份。",
              },
              {
                Icon: BookOpen,
                title: "咨询与查资料",
                text: "在聊天中提问，查看商家答复和知识来源。",
              },
              {
                Icon: ShoppingBag,
                title: "选购与下单",
                text: "选择商家后直接查看购物面板，购买前由你确认。",
              },
            ].map(({ Icon, title, text }) => (
              <Card key={title} className="fv-guide-card">
                <CardHeader>
                  <Icon aria-hidden />
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{text}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
