import { groupServices } from "./services.js";
import React, { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Info,
  KeyRound,
  Link2,
  RefreshCw,
  Plus,
  Ellipsis,
  Unplug,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Skeleton,
  Spinner,
} from "./ui.js";
import styles from "./styles.css";
import { ImportPanel } from "./import-panel.js";

export const inject = ["slots", "connection", "layout"];
type Site = {
  id: string;
  revision: string;
  label: string;
  domain: string;
  resource?: string;
  issuer?: string;
  clientAllowed?: boolean;
  description?: { methods: string[]; profile?: string };
};
type Connection = {
  connectionRef: string;
  siteId: string;
  label: string;
  domain: string;
  issuer: string;
  resource: string;
  signedIn: boolean;
  personalSignedIn?: boolean;
  connected: boolean;
  expiresAt?: number;
  bindingError?: string;
};
type Status = {
  configured: boolean;
  sites: Site[];
  connections: Connection[];
  removedSites?: Site[];
  client?: {
    clientId?: string;
    automatic?: boolean;
    signingKeyConfigured: boolean;
  };
};
type Operation =
  | "connect"
  | "disconnect"
  | "authorize"
  | "callback"
  | "remove"
  | "restore";
type Run = (
  operation: Operation,
  payload: Record<string, unknown>,
) => Promise<any>;
const messages: Record<string, string> = {
  IDENTITY_PROVIDER_REQUIRED: "此连接需要对应的身份插件，请启用后重试。",
  INVALID_DEVICE_IDENTITY: "账号服务返回的设备身份未通过验证。",
  PAP_CLIENT_IDENTITY_REQUIRED: "请配置有效的 PAP 客户端身份后再连接。",
  PAP_CONFIGURATION_REQUIRED: "请先配置 PAP 客户端，再连接服务方。",
  CLIENT_KEY_REQUIRED: "客户端签名密钥未就绪，请检查此 Profile 的凭据配置。",
  SITE_NOT_APPROVED: "此服务方尚未登记，请检查连接配置。",
  DISCOVERY_MISMATCH: "服务方的发现信息与已登记配置不一致，连接未建立。",
  ISSUER_MISMATCH: "服务方的身份服务与已登记配置不一致，连接未建立。",
  ENDPOINT_MISMATCH: "服务方的授权地址与已登记配置不一致，连接未建立。",
  ACCOUNT_REAUTHORIZATION_REQUIRED: "此账户需要重新授权，请展开下方账户授权。",
  SESSION_REQUIRED: "请先连接服务方，建立 PAP 会话。",
  CONNECTION_REQUIRED: "连接已不可用，请刷新状态后重新连接。",
  CONNECTION_BINDING_CHANGED:
    "连接配置已变化，旧凭据已停用。请恢复原配置；使用新服务方时请创建独立连接配置。",
  CONNECTION_BINDING_REQUIRED:
    "旧连接缺少身份绑定信息，暂时无法安全续接。原数据已保留，请在独立 Profile 中配置新连接。",
  PERSONAL_LOGIN_REQUIRED: "此连接需要登录，请在对应的身份插件完成登录后重试。",
  PERSONAL_ACCOUNT_CHANGED: "账号已变化，请重新连接服务方。",
  PERSONAL_TOKEN_ORIGIN_UNTRUSTED:
    "此服务方身份服务尚未配置为可信地址，个人凭据未发送。",
  PROVIDER_AUTHORIZATION_REQUIRED: "请通过此连接对应的身份插件完成授权。",
  CLIENT_NOT_ALLOWED:
    "此旧配置限制了客户端，请重新导入服务方最新的免审批连接配置。",
  HTTP_401: "客户端身份尚未通过服务方验证，请核对客户端登记与签名凭据。",
  HTTP_403: "服务拒绝了此请求，请检查服务是否已发布或账号是否有效。",
  INVALID_SCOPE: "授权范围格式不正确，请使用服务方提供的范围，并以空格分隔。",
  CALLBACK_REJECTED:
    "回调地址未通过校验。请检查是否属于当前服务方和本次授权；过期时请重新创建授权链接。",
  AUTHORIZATION_DENIED: "服务方未批准此次授权。你可以重新创建授权链接后再试。",
  SITE_REVISION_CHANGED: "配置已变化，请刷新状态后重新确认。",
  SITE_NOT_REMOVED: "配置已恢复或发生变化，请刷新状态。",
  INVALID_AUTHORIZATION_URL: "服务方返回的授权链接无效，请检查连接配置。",
};
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return messages[code] ?? "操作未完成，请检查服务列表是否可用后重试。";
}
function validUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
function sessionExpiry(connection?: Connection) {
  if (!connection?.expiresAt) return "建立连接后显示";
  const date = new Date(connection.expiresAt * 1000);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "暂不可用";
}

export function apply(ctx: any) {
  const call = async (op: string, payload: unknown = {}) => {
    const result = await ctx.connection.rpc.call("/api", `pap/${op}`, payload);
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  function ServiceConnection({
    site,
    connection,
    retiredDevice,
    busy,
    run,
    now,
  }: {
    site: Site;
    connection?: Connection;
    retiredDevice: boolean;
    busy: string;
    run: Run;
    now: number;
  }) {
    const id = useId();
    const [scopes, setScopes] = useState("");
    const [callback, setCallback] = useState("");
    const [authorization, setAuthorization] = useState("");
    const [open, setOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [deleteRevision, setDeleteRevision] = useState<string>();
    const deleteButton = useRef<HTMLButtonElement>(null);
    const cancelDelete = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      if (deleteRevision) cancelDelete.current?.focus();
    }, [deleteRevision]);
    const dismissDelete = () => {
      setDeleteRevision(undefined);
      deleteButton.current?.focus();
    };
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [invalid, setInvalid] = useState(false);
    const callbackInput = useRef<HTMLInputElement>(null);
    const connected =
      !!connection?.connected &&
      (connection.expiresAt === undefined || connection.expiresAt * 1000 > now);
    const ref = connection?.connectionRef;
    const runAction = async (
      operation: Operation,
      payload: Record<string, unknown>,
    ) => {
      setError("");
      setNotice("");
      try {
        const result = await run(operation, payload);
        if (operation === "authorize") {
          setAuthorization("");
          if (!validUrl(result.url))
            throw new Error("INVALID_AUTHORIZATION_URL");
          setAuthorization(result.url);
          setCallback("");
          setInvalid(false);
        } else if (operation === "callback") {
          setCallback("");
          setAuthorization("");
          setInvalid(false);
          setNotice("账户授权已完成。");
        } else if (operation === "disconnect") {
          setCallback("");
          setAuthorization("");
          setOpen(false);
          setNotice("连接已断开。");
        } else if (operation !== "remove") setNotice("服务方连接已建立。");
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    const pending = (operation: Operation) =>
      busy === `${operation}:${site.id}`;
    const title = site.label;
    const Icon = Link2;
    const needsReview = !!connection?.bindingError;
    const needsApproval = site.clientAllowed === false;
    const status = needsReview
      ? "需核对"
      : needsApproval
        ? "待批准"
        : connected
          ? "已连接"
          : "未连接";
    return (
      <article
        className="pap-service"
        aria-label={`${site.label} 连接`}
        data-expanded={detailsOpen}
      >
        <div className="pap-service-row">
          <button
            className="pap-service-toggle"
            type="button"
            aria-label={`查看${title}详情`}
            aria-expanded={detailsOpen}
            aria-controls={`${id}-details`}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <span className="pap-service-icon">
              <Icon aria-hidden />
            </span>
            <span className="pap-service-name">
              <span className="pap-service-title">{title}</span>
              {(needsReview || needsApproval) && (
                <span className="pap-service-caption">
                  {needsReview ? "连接信息需更新" : "需要服务方批准"}
                </span>
              )}
            </span>
            <ChevronDown className="pap-detail-chevron" aria-hidden />
          </button>
          <span
            className="pap-status"
            data-tone={
              needsReview || needsApproval
                ? "warning"
                : connected
                  ? "success"
                  : "neutral"
            }
          >
            <span className="pap-status-dot" aria-hidden />
            {status}
          </span>
          <div className="pap-service-actions">
            {needsReview || needsApproval ? (
              <Button
                variant="outline"
                size="sm"
                aria-expanded={detailsOpen}
                aria-controls={`${id}-details`}
                onClick={() => setDetailsOpen((v) => !v)}
              >
                {detailsOpen ? "收起详情" : "查看原因"}
              </Button>
            ) : connected ? null : connection?.signedIn ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  setDetailsOpen(true);
                  setOpen(true);
                }}
              >
                重新授权
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void runAction("connect", { siteId: site.id })}
              >
                {pending("connect") ? <Spinner /> : <Link2 aria-hidden />}
                {pending("connect")
                  ? "正在连接"
                  : connection
                    ? "重新连接"
                    : "连接"}
              </Button>
            )}
            <Button
              ref={deleteButton}
              variant="ghost"
              size="icon"
              disabled={!!busy}
              aria-label={`${site.label}更多操作`}
              aria-expanded={moreOpen}
              aria-controls={`${id}-more`}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Ellipsis aria-hidden />
            </Button>
          </div>
        </div>
        {moreOpen && (
          <div
            className="pap-more-actions"
            id={`${id}-more`}
            role="group"
            aria-label={`${site.label}更多操作`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setMoreOpen(false);
                deleteButton.current?.focus();
              }
            }}
          >
            {connected && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void runAction("disconnect", { connectionRef: ref })
                }
              >
                {pending("disconnect") ? <Spinner /> : <Unplug aria-hidden />}
                {pending("disconnect") ? "正在断开" : "断开连接"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy}
              className="pap-remove-action"
              onClick={() => {
                setError("");
                setMoreOpen(false);
                setDeleteRevision(site.revision);
              }}
            >
              <Trash2 aria-hidden />
              移除服务
            </Button>
          </div>
        )}
        {retiredDevice && (
          <p className="pap-field-help" role="status">
            设备身份已更换。新连接使用当前密钥；旧连接仍绑定原设备身份。
          </p>
        )}
        {deleteRevision && (
          <section
            className="pap-delete-confirm"
            id={`${id}-delete`}
            aria-label={`确认移除${title}`}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.stopPropagation();
                dismissDelete();
              }
            }}
          >
            <div>
              <h4>移除「{title}」？</h4>
              <p>
                该服务将从列表移除，并停止使用本机连接。已有记录保留。之后可在“已移除服务”中恢复，恢复后需重新连接。
              </p>
            </div>
            <div className="pap-delete-actions">
              <Button
                ref={cancelDelete}
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={dismissDelete}
              >
                取消
              </Button>
              <Button
                className="pap-delete-confirm-button"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void runAction("remove", {
                    siteId: site.id,
                    revision: deleteRevision,
                  })
                }
              >
                {pending("remove") ? <Spinner /> : <Trash2 aria-hidden />}
                {pending("remove") ? "正在移除" : "确认移除"}
              </Button>
            </div>
          </section>
        )}
        {error && (
          <div className="pap-row-feedback">
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
        {notice && (
          <p className="pap-row-notice" role="status">
            <Check aria-hidden />
            {notice}
          </p>
        )}
        <div
          className="pap-service-detail"
          id={`${id}-details`}
          hidden={!detailsOpen}
        >
          {(needsReview || needsApproval) && (
            <Alert variant="warning">
              <Info aria-hidden />
              <AlertDescription>
                {needsReview
                  ? errorMessage(new Error(connection!.bindingError))
                  : messages.CLIENT_NOT_ALLOWED}
              </AlertDescription>
            </Alert>
          )}
          <dl className="pap-detail-facts">
            <div>
              <dt>服务名称</dt>
              <dd>{site.label}</dd>
            </div>
            <div>
              <dt>连接身份</dt>
              <dd>
                {connection?.personalSignedIn
                  ? "身份服务授权"
                  : connection?.signedIn
                    ? "服务方账户"
                    : "独立 PAP 身份"}
              </dd>
            </div>
            <div>
              <dt>会话有效期</dt>
              <dd>
                {connected ? sessionExpiry(connection) : "尚未建立有效会话"}
              </dd>
            </div>
            {site.description && (
              <div>
                <dt>接口契约</dt>
                <dd>
                  {site.description.methods.length}{" "}
                  项已发布接口，使用权限由服务方核验
                </dd>
              </div>
            )}
            {site.resource && (
              <div className="pap-detail-address">
                <dt>资源地址</dt>
                <dd>{site.resource}</dd>
              </div>
            )}
          </dl>
          {ref && !connection?.bindingError && (
            <details
              className="pap-auth"
              open={open}
              onToggle={(e) => setOpen(e.currentTarget.open)}
            >
              <summary>
                <KeyRound aria-hidden />
                <span>
                  账户授权
                  <span className="pap-summary-hint">按需连接服务方账户</span>
                </span>
                <Badge>可选</Badge>
                <ChevronDown className="pap-chevron" aria-hidden />
              </summary>
              <div className="pap-auth-content">
                <p className="pap-muted">
                  独立 PAP
                  身份可直接使用服务方开放的服务。仅在需要访问账户专属资源时，才需要额外授权。
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setAuthorization("");
                    void runAction("authorize", {
                      connectionRef: ref,
                      scopes: scopes.split(/\s+/).filter(Boolean),
                    });
                  }}
                >
                  <div className="pap-step-title">
                    <span>1</span>创建授权链接
                  </div>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`${id}-scopes`}>授权范围</FieldLabel>
                      <Input
                        id={`${id}-scopes`}
                        value={scopes}
                        onChange={(e) => setScopes(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="填写服务方提供的授权范围"
                        disabled={!!busy}
                        aria-describedby={`${id}-scopes-help`}
                      />
                      <p id={`${id}-scopes-help`} className="pap-field-help">
                        多个范围用空格分隔，具体权限由服务方确认。
                      </p>
                    </Field>
                  </FieldGroup>
                  <div className="pap-form-actions">
                    <Button type="submit" variant="outline" disabled={!!busy}>
                      {pending("authorize") ? (
                        <Spinner />
                      ) : (
                        <KeyRound data-icon="inline-start" aria-hidden />
                      )}
                      {pending("authorize") ? "正在创建…" : "创建授权链接"}
                    </Button>
                    {authorization && (
                      <a
                        className="pap-button"
                        href={authorization}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        前往服务方授权
                        <ExternalLink data-icon="inline-end" aria-hidden />
                      </a>
                    )}
                  </div>
                  {authorization && (
                    <p className="pap-field-help" role="status">
                      链接已创建。在新窗口完成授权后，将回调地址粘贴到下方。
                    </p>
                  )}
                </form>
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!validUrl(callback.trim())) {
                      setInvalid(true);
                      callbackInput.current?.focus();
                      return;
                    }
                    void runAction("callback", {
                      connectionRef: ref,
                      url: callback.trim(),
                    });
                  }}
                >
                  <div className="pap-step-title">
                    <span>2</span>完成账户授权
                  </div>
                  <FieldGroup>
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={`${id}-callback`}>
                        授权回调地址
                      </FieldLabel>
                      <Input
                        ref={callbackInput}
                        id={`${id}-callback`}
                        type="url"
                        value={callback}
                        onChange={(e) => {
                          setCallback(e.target.value);
                          setInvalid(false);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="粘贴授权完成后的 HTTPS 地址"
                        disabled={!!busy}
                        aria-invalid={invalid || undefined}
                        aria-describedby={`${id}-callback-help`}
                      />
                      <p id={`${id}-callback-help`} className="pap-field-help">
                        此地址仅用于当前服务方的授权校验，不会发送给聊天模型。
                      </p>
                      {invalid && (
                        <FieldError>请输入完整的 HTTPS 回调地址。</FieldError>
                      )}
                    </Field>
                  </FieldGroup>
                  <div className="pap-form-actions">
                    <Button type="submit" disabled={!!busy || !callback.trim()}>
                      {pending("callback") ? (
                        <Spinner />
                      ) : (
                        <Check data-icon="inline-start" aria-hidden />
                      )}
                      {pending("callback") ? "正在验证…" : "完成授权"}
                    </Button>
                  </div>
                </form>
              </div>
            </details>
          )}
        </div>
      </article>
    );
  }

  function Panel() {
    const [data, setData] = useState<Status>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const [now, setNow] = useState(Date.now());
    const lock = useRef(false);
    const identityRevision = useRef(0);
    const refreshPending = useRef(false);
    const [importOpen, setImportOpen] = useState(false);
    const [notice, setNotice] = useState("");
    const addButton = useRef<HTMLButtonElement>(null);
    const refreshButton = useRef<HTMLButtonElement>(null);
    const focusAfterMutation = useRef(false);
    useEffect(() => {
      if (!busy && focusAfterMutation.current) {
        focusAfterMutation.current = false;
        refreshButton.current?.focus();
      }
    }, [busy]);
    const closeImport = () => {
      setImportOpen(false);
      addButton.current?.focus();
    };
    const refresh = async () => {
      if (lock.current) {
        refreshPending.current = true;
        return;
      }
      refreshPending.current = false;
      const revision = identityRevision.current;
      lock.current = true;
      setBusy("status");
      setError("");
      try {
        const next = await call("status");
        if (revision !== identityRevision.current) return;
        setData(next);
        setNow(Date.now());
      } catch {
        if (revision === identityRevision.current)
          setError("暂时无法读取连接状态，请重试。");
      } finally {
        lock.current = false;
        setBusy("");
        if (refreshPending.current) void refresh();
      }
    };
    useEffect(() => {
      const changed = () => {
        identityRevision.current++;
        setData(undefined);
        setError("");
        void refresh();
      };
      window.addEventListener("pap-connections-change", changed);
      void refresh();
      const timer = setInterval(() => setNow(Date.now()), 15000);
      return () => {
        clearInterval(timer);
        window.removeEventListener("pap-connections-change", changed);
      };
    }, []);
    const run: Run = async (operation, payload) => {
      if (lock.current) throw new Error("OPERATION_IN_PROGRESS");
      lock.current = true;
      const revision = identityRevision.current;
      const siteId =
        payload.siteId ??
        data?.connections.find((c) => c.connectionRef === payload.connectionRef)
          ?.siteId;
      setBusy(`${operation}:${siteId}`);
      setError("");
      try {
        const result = await call(operation, payload);
        if (revision !== identityRevision.current)
          throw new Error("PERSONAL_ACCOUNT_CHANGED");
        if (operation === "remove" || operation === "restore") {
          setNotice(
            operation === "remove"
              ? "配置已删除，已有记录已保留。可在页面下方恢复配置。"
              : "配置已恢复，请重新连接服务。",
          );
          focusAfterMutation.current = true;
        }
        if (operation !== "authorize") {
          try {
            const next = await call("status");
            if (revision !== identityRevision.current)
              throw new Error("PERSONAL_ACCOUNT_CHANGED");
            setData(next);
            setNow(Date.now());
          } catch {
            if (revision === identityRevision.current)
              setError("操作已提交，但最新状态暂不可用。请刷新状态确认结果。");
          }
        }
        return result;
      } finally {
        lock.current = false;
        setBusy("");
        if (refreshPending.current) void refresh();
      }
    };
    const connected =
      data?.connections.filter(
        (c) =>
          c.connected &&
          (c.expiresAt === undefined || c.expiresAt * 1000 > now),
      ).length ?? 0;
    const groups = groupServices(data?.sites ?? []);
    const attention =
      data?.sites.filter(
        (s) =>
          s.clientAllowed === false ||
          data.connections.some(
            (c) =>
              c.siteId === s.id &&
              c.bindingError &&
              c.bindingError !== "DEVICE_IDENTITY_REPLACED",
          ),
      ).length ?? 0;
    return (
      <div
        className="pap-viewport"
        role="region"
        aria-label="PAP 页面滚动区域"
        tabIndex={0}
      >
        <section className="pap" aria-label="PAP 连接管理">
          <style>{styles}</style>
          <header className="pap-page-header">
            <div>
              <h2>PAP 连接</h2>
            </div>
            <div className="pap-page-actions">
              <Button
                ref={refreshButton}
                variant="ghost"
                size="icon"
                disabled={!!busy}
                onClick={() => void refresh()}
                aria-label="刷新连接状态"
                title="刷新连接状态"
              >
                {busy === "status" ? <Spinner /> : <RefreshCw aria-hidden />}
              </Button>
              {data?.configured && (
                <Button
                  ref={addButton}
                  onClick={() => {
                    setImportOpen(true);
                    setNotice("");
                  }}
                  aria-expanded={importOpen}
                  aria-controls="pap-import-form"
                >
                  <Plus aria-hidden />
                  添加服务
                </Button>
              )}
            </div>
          </header>
          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void refresh()}
              >
                重试
              </Button>
            </Alert>
          )}
          {notice && (
            <p className="pap-notice" role="status">
              <Check aria-hidden />
              {notice}
            </p>
          )}
          {data?.configured && (
            <ImportPanel
              open={importOpen}
              onClose={closeImport}
              call={call}
              onImported={async () => {
                await refresh();
                setNotice("服务列表已添加。选择服务即可查看连接与授权状态。");
              }}
            />
          )}
          {!data ? (
            !error && (
              <div
                className="pap-loading"
                role="status"
                aria-label="正在读取连接"
              >
                <Skeleton className="pap-loading-heading" />
                <Skeleton className="pap-loading-card" />
                <span className="pap-muted">正在读取连接…</span>
              </div>
            )
          ) : !data.configured ? (
            <Card>
              <Empty>
                <div className="pap-empty-icon">
                  <KeyRound aria-hidden />
                </div>
                <EmptyTitle>先配置你的 PAP 客户端</EmptyTitle>
                <EmptyDescription>
                  当前 Profile
                  尚未配置客户端身份。完成配置并重启后，即可在这里添加和连接服务方。
                </EmptyDescription>
                <p className="pap-field-help">
                  配置步骤请参阅 PAP 插件 README。
                </p>
              </Empty>
            </Card>
          ) : (
            <>
              <div className="pap-overview" aria-label="连接概览">
                <span>{data.sites.length} 项服务</span>
                <span>
                  <i
                    className="pap-status-dot"
                    data-tone="success"
                    aria-hidden
                  />
                  {connected} 项已连接
                </span>
                {attention > 0 && (
                  <span>
                    <i
                      className="pap-status-dot"
                      data-tone="warning"
                      aria-hidden
                    />
                    {attention} 待处理
                  </span>
                )}
              </div>
              <main className="pap-service-groups" aria-label="服务列表">
                {groups.length ? (
                  groups.map(({ key, title, domain, sites }) => (
                    <section
                      className="pap-merchant-group"
                      key={key}
                      aria-label={`${title} 服务列表`}
                    >
                      <header className="pap-group-header">
                        <Link2 aria-hidden />
                        <div className="pap-merchant-name">
                          <h3>{title}</h3>
                          <p>
                            {domain}
                            {groups.some(
                              (g) =>
                                g.key !== key &&
                                g.title === title &&
                                g.domain === domain,
                            )
                              ? ` · ${sites[0].issuer ?? sites[0].id}`
                              : ""}
                          </p>
                        </div>
                        <span>{sites.length} 项服务</span>
                      </header>
                      <div className="pap-service-list">
                        {sites.map((site) => (
                          <ServiceConnection
                            key={site.id}
                            site={site}
                            connection={data.connections.find(
                              (c) =>
                                c.siteId === site.id &&
                                c.bindingError !== "DEVICE_IDENTITY_REPLACED",
                            )}
                            retiredDevice={data.connections.some(
                              (c) =>
                                c.siteId === site.id &&
                                c.bindingError === "DEVICE_IDENTITY_REPLACED",
                            )}
                            busy={busy}
                            run={run}
                            now={now}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <Card>
                    <Empty>
                      <div className="pap-empty-icon">
                        <Link2 aria-hidden />
                      </div>
                      <EmptyTitle>
                        {data.removedSites?.length
                          ? "暂无可用配置"
                          : "添加第一个服务"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {data.removedSites?.length
                          ? "添加新服务方，或从下方恢复已删除的配置。"
                          : "粘贴服务方提供的连接配置，查看可使用的服务。"}
                      </EmptyDescription>
                      <Button onClick={() => setImportOpen(true)}>
                        <Plus aria-hidden />
                        添加服务
                      </Button>
                    </Empty>
                  </Card>
                )}
              </main>
              <footer className="pap-page-footer">
                {!!data.removedSites?.length && (
                  <details className="pap-removed-configs">
                    <summary>
                      <Trash2 aria-hidden />
                      已移除服务（{data.removedSites.length}）
                      <ChevronDown aria-hidden />
                    </summary>
                    <p className="pap-field-help">
                      恢复只重新显示配置，不会自动连接。
                    </p>
                    <div className="pap-removed-list">
                      {data.removedSites.map((site) => (
                        <div className="pap-removed-row" key={site.id}>
                          <div>
                            <p>{site.label}</p>
                            <span>{site.domain}</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!busy}
                            aria-label={`恢复${site.label}配置`}
                            onClick={() =>
                              void run("restore", {
                                siteId: site.id,
                                revision: site.revision,
                              }).catch((e) => setError(errorMessage(e)))
                            }
                          >
                            {busy === `restore:${site.id}` ? (
                              <Spinner />
                            ) : (
                              <Undo2 aria-hidden />
                            )}
                            恢复
                          </Button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {data.client && (
                  <details className="pap-client-details">
                    <summary>
                      技术信息
                      <ChevronDown aria-hidden />
                    </summary>
                    <dl className="pap-detail-facts">
                      <div className="pap-detail-address">
                        <dt>客户端标识</dt>
                        <dd>
                          {data.client.clientId ??
                            (data.client.automatic
                              ? "首次连接服务方时自动建立"
                              : "待配置服务方连接身份")}
                        </dd>
                      </div>
                      <div>
                        <dt>签名凭据</dt>
                        <dd>
                          {data.client.signingKeyConfigured
                            ? "已配置"
                            : data.client.automatic
                              ? "首次连接时生成"
                              : "待配置"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                )}
              </footer>
            </>
          )}
        </section>
      </div>
    );
  }

  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "pap-connections" }, Panel),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "pap-connections",
        order: 30,
        label: () => "PAP 连接",
      },
      () => <Link2 size={18} strokeWidth={1.7} aria-hidden />,
    ),
  );
}
