import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Link2, RefreshCw, Store } from "lucide-react";
import { useAccountRevision } from "./account.js";
import { AccountSummary, type AccountStatus } from "./account-summary.js";
import {
  openStorefrontCart,
  type AddToNewCart,
  type StartShopping,
} from "./storefront-cart.js";
import { MerchantPicker } from "./merchant-picker.js";
import { shoppingReference } from "./history.js";
import {
  serviceMerchants,
  merchantCommerceSite,
  type Merchant,
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
  Button,
  Empty,
  EmptyTitle,
  EmptyDescription,
  Skeleton,
  Spinner,
} from "./ui.js";
type Props = {
  call: (op: string, payload?: any) => Promise<any>;
  openConnections: () => void;
  openAccount: () => void;
  renderFlow: (
    reference: ReturnType<typeof shoppingReference>,
    startShopping: StartShopping,
    addedQuantity?: number,
    initialError?: string,
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
  const [addition, setAddition] = useState<{
    flowId: string;
    quantity: number;
    error?: string;
  }>();
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
        if (active) setError("暂时无法读取服务入口，请重试。");
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
    if (!data || choosing) return;
    const resolved = merchant
      ? { merchantKey: merchant.key, flowId: flow?.flowId }
      : {};
    setSelection(resolved);
    try {
      saveServiceSelection(window.sessionStorage, resolved);
    } catch {}
  }, [!!data, choosing, merchant?.key, flow?.flowId]);
  const site = merchant && merchantCommerceSite(merchant);
  const openMerchantStore = async (
    target: Merchant | undefined,
    intent?: AddToNewCart,
  ): Promise<boolean> => {
    const targetSite = target && merchantCommerceSite(target);
    if (!target || !targetSite || openingRef.current) return false;
    openingRef.current = true;
    setOpening(true);
    setError("");
    entryId.current ??= crypto.randomUUID();
    try {
      const result = await openStorefrontCart(
        call,
        targetSite.id,
        entryId.current,
        intent,
        () => live.current,
      );
      if (!live.current || !result) return false;
      const { ui } = result;
      setAddition({
        flowId: ui.flowId,
        quantity: result.added && intent ? intent.quantity : 0,
        error: result.error ? "ADD_NOT_COMPLETED" : undefined,
      });
      setData(
        (previous) =>
          previous && {
            ...previous,
            flows: [
              {
                ...ui,
                siteId: targetSite.id,
                updatedAt: new Date().toISOString(),
              },
              ...previous.flows.filter((f) => f.flowId !== ui.flowId),
            ],
          },
      );
      setSelection({ merchantKey: target.key, flowId: ui.flowId });
      entryId.current = undefined;
      // The selected cart owns its error and retry state; avoid a second page-level warning.
      return !result.error;
    } catch {
      if (live.current)
        setError("暂时无法准备购物车，请核对商家连接与个人登录后重试。");
      return false;
    } finally {
      openingRef.current = false;
      if (live.current) setOpening(false);
    }
  };
  const openStore: StartShopping = (intent) =>
    openMerchantStore(merchant, intent);
  const selectMerchant = (target: Merchant) => {
    if (openingRef.current) return;
    const next = resolveServiceSelection(merchants, {
      merchantKey: target.key,
      flowId:
        selection.merchantKey === target.key ? selection.flowId : undefined,
    });
    setSelection({ merchantKey: target.key, flowId: next.flow?.flowId });
    setChoosing(false);
    setError("");
    entryId.current = undefined;
    if (!next.flow && merchantCommerceSite(target))
      void openMerchantStore(target);
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
            <h2>Frontvia 服务</h2>
          </div>
          <div className="fv-page-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新服务"
              disabled={loading || opening}
              onClick={() => setRefresh((n) => n + 1)}
            >
              {loading ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" onClick={openConnections}>
              <Link2 data-icon="inline-start" />
              管理服务连接
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
            <EmptyTitle>添加第一个服务入口</EmptyTitle>
            <EmptyDescription>
              添加商家的购物或咨询服务后，即可使用对应能力。
            </EmptyDescription>
            <Button onClick={openConnections}>添加服务</Button>
          </Empty>
        ) : (
          <>
            {choosing || !merchant ? (
              <MerchantPicker
                merchants={merchants}
                selectedKey={selection.merchantKey}
                disabled={opening}
                onSelect={selectMerchant}
              />
            ) : (
              <>
                <nav aria-label="服务导航" className="fv-store-breadcrumb">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={opening}
                    onClick={() => setChoosing(true)}
                  >
                    <ArrowLeft data-icon="inline-start" />
                    全部服务（{merchants.length}）
                  </Button>
                  <span aria-current="page">{merchant.title}</span>
                </nav>
                <div className="fv-shop-heading">
                  <div className="fv-shop-identity">
                    <div className="fv-store-symbol" aria-hidden>
                      <Store />
                    </div>
                    <div>
                      <h3>{merchant.title}</h3>
                      <p className="fv-description">
                        {merchant.domain}
                        {merchants.some(
                          (m) =>
                            m.key !== merchant.key &&
                            m.domain === merchant.domain &&
                            m.title === merchant.title,
                        )
                          ? ` · ${merchant.storeId ?? ""}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
                {flow ? (
                  <div
                    key={`${merchant.key}:${flow.flowId}`}
                    className="fv-shop-content"
                  >
                    {renderFlow(
                      shoppingReference(flow),
                      openStore,
                      addition?.flowId === flow.flowId
                        ? addition.quantity
                        : undefined,
                      addition?.flowId === flow.flowId
                        ? addition.error
                        : undefined,
                    )}
                  </div>
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
                      <Button
                        disabled={opening}
                        onClick={() => void openStore()}
                      >
                        {opening && <Spinner />}开始逛店
                      </Button>
                    )}
                  </Empty>
                )}
                {flow && flowKind(flow) === "consultation" && site && (
                  <Button disabled={opening} onClick={() => void openStore()}>
                    进入商品商城
                  </Button>
                )}
                {merchant.flows.length > 1 && (
                  <details className="fv-service-history">
                    <summary>
                      历史购物与咨询 · {merchant.flows.length - 1}
                    </summary>
                    <div className="fv-record-list">
                      {merchant.flows
                        .filter((f) => f.flowId !== flow?.flowId)
                        .map((f) => (
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
                            {flowKind(f) === "shopping"
                              ? "购物记录"
                              : "咨询答复"}{" "}
                            · {new Date(f.updatedAt).toLocaleString("zh-CN")}
                          </Button>
                        ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
