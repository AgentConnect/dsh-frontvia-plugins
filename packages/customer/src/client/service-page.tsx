import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronUp,
  CircleAlert,
  Clock3,
  Link2,
  MessageCircle,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { useAccountRevision } from "./account.js";
import { shoppingReference } from "./history.js";
import { FrontviaAccountPanel } from "./personal-panel.js";
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

type Flow = {
  flowId: string;
  sessionId: string;
  siteId: string;
  kind?: string;
  updatedAt: string;
  pending?: boolean;
};
type Site = {
  id: string;
  label?: string;
  domain?: string;
  service?: { store_id?: string };
};
type Reference = ReturnType<typeof shoppingReference>;
type Props = {
  call: (op: string, payload?: any) => Promise<any>;
  openConnections: () => void;
  renderFlow: (reference: Reference) => React.ReactNode;
};
const kindOf = (flow: Flow) =>
  flow.kind === "consultation" ? "consultation" : "shopping";
const kinds = [
  { value: "all", label: "全部记录" },
  { value: "shopping", label: "购物" },
  { value: "consultation", label: "咨询与知识" },
] as const;
function serviceName(site: Site | undefined, flow: Flow) {
  // Discovery titles can be protocol descriptions rather than merchant names.
  const label = site?.label?.trim();
  return label &&
    !/JSON-RPC|transport|Frontvia merchant consultation/i.test(label) &&
    label !== site?.id
    ? label
    : kindOf(flow) === "shopping"
      ? "商家购物服务"
      : "商家咨询服务";
}
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
  return <AccountServicePage revision={revision} {...props} />;
}
function AccountServicePage({
  call,
  openConnections,
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
  const [selection, setSelected] = useState<Flow>();
  const selected = data ? selection : undefined;
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const detail = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    setSelected(undefined);
    setFilter("all");
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
          setSelected((previous) =>
            value.flows.find((flow: Flow) => flow.flowId === previous?.flowId),
          );
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
  }, [refresh, revision]);
  useEffect(() => {
    if (selected) {
      detail.current?.scrollIntoView({ block: "start", behavior: "instant" });
      detail.current?.focus({ preventScroll: true });
    }
  }, [selected?.flowId]);
  const rows = [...(data?.flows ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const pending = rows.filter((flow) => flow.pending).length;
  const visible = rows.filter(
    (flow) => filter === "all" || kindOf(flow) === filter,
  );
  const siteFor = (flow: Flow) =>
    data?.sites.find((site) => site.id === flow.siteId);
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
              管理个人账号，接着上次的咨询与购物。
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

        <FrontviaAccountPanel call={call} />

        <section className="fv-history-section" aria-label="最近服务记录">
          <div className="fv-section-heading">
            <div>
              <h3>最近服务记录</h3>
              <p className="fv-description">
                选择一条记录，查看购物进度或咨询答复。
              </p>
            </div>
            {data && <Badge>{rows.length} 条记录</Badge>}
          </div>
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(value);
              setSelected(undefined);
            }}
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
                            kind.value === "all" || kindOf(flow) === kind.value,
                        ).length
                      : "—"}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
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
                      const site = siteFor(flow),
                        consultation = kindOf(flow) === "consultation";
                      const Icon = consultation ? MessageCircle : ShoppingBag;
                      return (
                        <button
                          type="button"
                          key={flow.flowId}
                          className="fv-record"
                          ref={
                            selected?.flowId === flow.flowId
                              ? selectedButton
                              : undefined
                          }
                          aria-expanded={selected?.flowId === flow.flowId}
                          aria-controls={
                            selected?.flowId === flow.flowId
                              ? `${id}-detail`
                              : undefined
                          }
                          onClick={() => setSelected(flow)}
                        >
                          <span className="fv-service-icon">
                            <Icon aria-hidden />
                          </span>
                          <span className="fv-record-copy">
                            <span className="fv-record-title">
                              {serviceName(site, flow)}
                            </span>
                            <span className="fv-record-description">
                              {site?.domain ?? "商家配置已移除"}
                              {site?.service?.store_id
                                ? ` · 店铺 ${site.service.store_id}`
                                : ""}
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
                              {flow.pending ? "查看并恢复" : "查看进度"}
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
                          : "从连接一家商店开始"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {rows.length
                          ? "在聊天中使用这类商家服务后，记录会出现在这里。"
                          : "在 PAP 中添加并连接商家，然后新建聊天。咨询答复与购物进度会保留在这里。"}
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

        {selected && (
          <div
            className="fv-selected-flow"
            ref={detail}
            id={`${id}-detail`}
            tabIndex={-1}
            aria-label="已选服务记录"
          >
            <div className="fv-section-heading">
              <div>
                <h3>{serviceName(siteFor(selected), selected)}</h3>
                <p className="fv-description">
                  {updatedTime(selected.updatedAt)}的记录
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  selectedButton.current?.focus();
                  setSelected(undefined);
                }}
              >
                <ChevronUp data-icon="inline-start" />
                收起详情
              </Button>
            </div>
            {renderFlow(shoppingReference(selected))}
          </div>
        )}

        <aside className="fv-start-guide" aria-label="使用指南">
          <Separator />
          <div className="fv-guide-heading">
            <h3>在这里，你可以</h3>
            <span>从连接到服务，接着聊就好</span>
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
                text: "挑选商品、查看购物进度，购买前由你确认。",
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
