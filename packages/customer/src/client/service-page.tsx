import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Link2, RefreshCw, Store } from "lucide-react";
import { useAccountRevision } from "./account.js";
import { AccountSummary, type AccountStatus } from "./account-summary.js";
import { shoppingReference } from "./history.js";
import {
  serviceMerchants,
  resolveServiceSelection,
  readServiceSelection,
  saveServiceSelection,
  flowKind,
  type ServiceFlow,
  type ServiceSite,
  type ServiceSelection,
} from "./service-merchants.js";
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
  Skeleton,
  Spinner,
  Separator,
} from "./ui.js";
type Props = {
  call: (op: string, payload?: any) => Promise<any>;
  openConnections: () => void;
  openAccount: () => void;
  renderFlow: (
    reference: ReturnType<typeof shoppingReference>,
    startShopping: () => void,
  ) => React.ReactNode;
};
export function ServicePage(props: Props) {
  const revision = useAccountRevision();
  return <AccountServicePage key={revision} {...props} revision={revision} />;
}
function AccountServicePage({
  call,
  openConnections,
  openAccount,
  renderFlow,
  revision,
}: Props & { revision: number }) {
  const [data, setData] = useState<{
    sites: ServiceSite[];
    flows: ServiceFlow[];
  }>();
  const [account, setAccount] = useState<AccountStatus>();
  const [accountError, setAccountError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [choosing, setChoosing] = useState(() => {
    try {
      return (
        revision > 0 || !readServiceSelection(window.sessionStorage).merchantKey
      );
    } catch {
      return true;
    }
  });
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const live = useRef(true);
  const entryId = useRef<string>();
  const [selection, setSelection] = useState<ServiceSelection>(() => {
    try {
      return revision ? {} : readServiceSelection(window.sessionStorage);
    } catch {
      return {};
    }
  });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    call("list")
      .then((value) => {
        if (!Array.isArray(value.flows) || !Array.isArray(value.sites))
          throw Error();
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError("暂时无法读取商家，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    call("personal-status")
      .then((value) => {
        if (active) {
          setAccount(value);
          setAccountError(false);
        }
      })
      .catch(() => {
        if (active) setAccountError(true);
      });
    return () => {
      active = false;
    };
  }, [call, refresh]);
  const merchants = serviceMerchants(data?.sites ?? [], data?.flows ?? []);
  const { merchant, flow } = resolveServiceSelection(merchants, selection);
  useEffect(() => {
    const resolved = merchant
      ? { merchantKey: merchant.key, flowId: flow?.flowId }
      : {};
    setSelection(resolved);
    try {
      saveServiceSelection(window.sessionStorage, resolved);
    } catch {}
  }, [merchant?.key, flow?.flowId]);
  const site =
    merchant?.sites.find((s) =>
      s.description?.methods?.includes("commerce.capabilities.get"),
    ) ??
    merchant?.sites.find((s) =>
      merchant.flows.some(
        (f) => f.siteId === s.id && flowKind(f) === "shopping",
      ),
    );
  const openStore = async () => {
    if (!merchant || !site || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError("");
    entryId.current ??= crypto.randomUUID();
    try {
      const ui = await call("open-store", {
        siteId: site.id,
        actionId: entryId.current,
      });
      if (!live.current) return;
      setData(
        (previous) =>
          previous && {
            ...previous,
            flows: [
              { ...ui, siteId: site.id, updatedAt: new Date().toISOString() },
              ...previous.flows.filter((f) => f.flowId !== ui.flowId),
            ],
          },
      );
      setSelection({ merchantKey: merchant.key, flowId: ui.flowId });
      entryId.current = undefined;
    } catch {
      if (live.current)
        setError("暂时无法开始购物，请核对商家连接与个人登录后重试。");
    } finally {
      openingRef.current = false;
      if (live.current) setOpening(false);
    }
  };
  return (
    <div
      className="fv-viewport"
      role="region"
      aria-label="Frontvia 服务页面"
      tabIndex={0}
    >
      <div className="fv fv-home fv-market">
        <header className="fv-page-header">
          <div>
            <p className="fv-eyebrow">你的商家服务</p>
            <h2>Frontvia 服务</h2>
            <p className="fv-page-description">从心仪好物，到安心收货。</p>
          </div>
          <div className="fv-page-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新商家"
              disabled={loading || opening}
              onClick={() => setRefresh((n) => n + 1)}
            >
              {loading ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" onClick={openConnections}>
              <Link2 data-icon="inline-start" />
              管理商家连接
            </Button>
          </div>
        </header>
        <AccountSummary
          status={account}
          error={accountError}
          openAccount={openAccount}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
              重试
            </Button>
          </Alert>
        )}
        {loading && !data ? (
          <Skeleton className="fv-skeleton-block" />
        ) : !merchants.length ? (
          <Empty>
            <Store />
            <EmptyTitle>连接你的第一家店铺</EmptyTitle>
            <EmptyDescription>
              添加商家服务后，即可浏览商品、下单和查看订单。
            </EmptyDescription>
            <Button onClick={openConnections}>连接商家</Button>
          </Empty>
        ) : (
          <>
            {choosing || !merchant ? (
              <section aria-label="选择店铺" className="fv-stack">
                <div className="fv-section-heading">
                  <h3>选择店铺</h3>
                  <Badge>{merchants.length} 家店铺</Badge>
                </div>
                <div className="fv-store-grid">
                  {merchants.map((m) => (
                    <Card key={m.key}>
                      <CardHeader>
                        <Store />
                        <CardTitle>{m.title}</CardTitle>
                        <CardDescription>{m.domain}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="fv-muted">
                          {m.storeId ? `店铺 ${m.storeId}` : "已连接的商家服务"}
                        </p>
                      </CardContent>
                      <CardFooter>
                        <Button
                          variant="outline"
                          disabled={opening}
                          onClick={() => {
                            setSelection({ merchantKey: m.key });
                            setChoosing(false);
                            entryId.current = undefined;
                          }}
                        >
                          进入店铺
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <div className="fv-shop-heading">
                  <div className="fv-row">
                    <Store />
                    <div>
                      <h3>{merchant.title}</h3>
                      <p className="fv-description">
                        {merchant.domain}
                        {merchants.some(
                          (m) =>
                            m.key !== merchant.key &&
                            m.domain === merchant.domain,
                        )
                          ? ` · ${merchant.storeId ?? ""}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="fv-row">
                    <Button
                      variant="ghost"
                      disabled={opening}
                      onClick={() => setChoosing(true)}
                    >
                      切换店铺
                    </Button>
                    {site && flow && (
                      <Button
                        variant="outline"
                        disabled={opening}
                        onClick={openStore}
                      >
                        {opening && <Spinner />}开始新的购物
                      </Button>
                    )}
                  </div>
                </div>
                {flow ? (
                  renderFlow(shoppingReference(flow), openStore)
                ) : (
                  <Empty>
                    <Store />
                    <EmptyTitle>欢迎光临</EmptyTitle>
                    <EmptyDescription>
                      {site
                        ? "浏览店内商品，挑选规格后加入购物车。"
                        : "这家商家提供咨询服务，可在聊天中发起咨询。"}
                    </EmptyDescription>
                    {site && (
                      <Button disabled={opening} onClick={openStore}>
                        {opening && <Spinner />}开始逛店
                      </Button>
                    )}
                  </Empty>
                )}
                {flow && flowKind(flow) === "consultation" && site && (
                  <Button disabled={opening} onClick={openStore}>
                    进入商品商城
                  </Button>
                )}
                {merchant.flows.length > 1 && (
                  <details className="fv-service-history">
                    <summary>
                      其他购物与咨询记录 · {merchant.flows.length}
                    </summary>
                    <div className="fv-record-list">
                      {merchant.flows.map((f) => (
                        <Button
                          variant="ghost"
                          key={f.flowId}
                          disabled={opening}
                          onClick={() =>
                            setSelection({
                              merchantKey: merchant.key,
                              flowId: f.flowId,
                            })
                          }
                        >
                          {flowKind(f) === "shopping" ? "购物记录" : "咨询答复"}{" "}
                          · {new Date(f.updatedAt).toLocaleString("zh-CN")}
                          {f.flowId === flow.flowId ? " · 当前" : ""}
                        </Button>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
        <Separator />
        <p className="fv-muted fv-market-footer">
          每家店铺的商品、购物车和订单独立管理。
        </p>
      </div>
    </div>
  );
}
