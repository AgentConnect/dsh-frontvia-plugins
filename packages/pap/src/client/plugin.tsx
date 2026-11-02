import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Unplug,
  UserRound,
} from "lucide-react";
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
  Skeleton,
  Spinner,
} from "./ui.js";
import styles from "./styles.css";

export const inject = ["slots", "connection"];
type Site = { id: string; label: string; domain: string };
type Connection = {
  connectionRef: string;
  siteId: string;
  label: string;
  domain: string;
  issuer: string;
  resource: string;
  signedIn: boolean;
  connected: boolean;
  expiresAt?: number;
};
type Status = { configured: boolean; sites: Site[]; connections: Connection[] };
type Operation = "connect" | "disconnect" | "authorize" | "callback";
type Run = (
  operation: Operation,
  payload: Record<string, unknown>,
) => Promise<any>;
const messages: Record<string, string> = {
  PAP_CONFIGURATION_REQUIRED: "请先配置 PAP 客户端，再连接商家。",
  CLIENT_KEY_REQUIRED: "客户端签名密钥未就绪，请检查此 Profile 的凭据配置。",
  SITE_NOT_APPROVED: "此商家尚未登记，请检查连接配置。",
  DISCOVERY_MISMATCH: "商家的发现信息与已登记配置不一致，连接未建立。",
  ISSUER_MISMATCH: "商家的身份服务与已登记配置不一致，连接未建立。",
  ENDPOINT_MISMATCH: "商家的授权地址与已登记配置不一致，连接未建立。",
  ACCOUNT_REAUTHORIZATION_REQUIRED: "此账户需要重新授权，请展开下方账户授权。",
  SESSION_REQUIRED: "请先连接商家，建立 PAP 会话。",
  CONNECTION_REQUIRED: "连接已不可用，请刷新状态后重新连接。",
  INVALID_SCOPE: "授权范围格式不正确，请使用商家提供的范围，并以空格分隔。",
  CALLBACK_REJECTED:
    "回调地址未通过校验。请检查是否属于当前商家和本次授权；过期时请重新创建授权链接。",
  AUTHORIZATION_DENIED: "商家未批准此次授权。你可以重新创建授权链接后再试。",
  INVALID_AUTHORIZATION_URL: "商家返回的授权链接无效，请检查连接配置。",
};
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return messages[code] ?? "操作未完成，请检查商家服务是否可用后重试。";
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
  function Merchant({
    site,
    connection,
    busy,
    run,
    now,
  }: {
    site: Site;
    connection?: Connection;
    busy: string;
    run: Run;
    now: number;
  }) {
    const id = useId();
    const [scopes, setScopes] = useState("");
    const [callback, setCallback] = useState("");
    const [authorization, setAuthorization] = useState("");
    const [open, setOpen] = useState(false);
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
        } else setNotice("商家连接已建立。");
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    const pending = (operation: Operation) =>
      busy === `${operation}:${site.id}`;
    return (
      <article aria-label={`${site.label} 连接`}>
        <Card>
          <CardHeader>
            <div className="pap-store-icon">
              <Store aria-hidden />
            </div>
            <div className="pap-heading">
              <CardTitle>{site.label}</CardTitle>
              <CardDescription>{site.domain}</CardDescription>
            </div>
            <Badge variant={connected ? "success" : "secondary"}>
              {connected ? <Check aria-hidden /> : <Unplug aria-hidden />}
              {connected ? "已连接" : "未连接"}
            </Badge>
          </CardHeader>
          <CardContent>
            <dl className="pap-facts">
              <div>
                <dt>
                  <UserRound aria-hidden />
                  当前身份
                </dt>
                <dd>{connection?.signedIn ? "商家账户" : "独立 PAP 身份"}</dd>
              </div>
              <div>
                <dt>
                  <KeyRound aria-hidden />
                  {connected ? "会话有效至" : "连接状态"}
                </dt>
                <dd>
                  {connected
                    ? sessionExpiry(connection)
                    : connection
                      ? "等待重新连接"
                      : "尚未建立连接"}
                </dd>
              </div>
            </dl>
            <div className="pap-connect-row">
              <p className="pap-muted">
                {connected
                  ? "连接已就绪，可在聊天中使用商家服务。"
                  : connection?.signedIn
                    ? "重新授权商家账户，即可恢复连接。"
                    : "连接后，以独立身份使用商家服务。"}
              </p>
              {connected ? (
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    void runAction("disconnect", { connectionRef: ref })
                  }
                >
                  {pending("disconnect") ? (
                    <Spinner />
                  ) : (
                    <Unplug data-icon="inline-start" aria-hidden />
                  )}
                  {pending("disconnect") ? "正在断开…" : "断开连接"}
                </Button>
              ) : connection?.signedIn ? (
                <Button disabled={!!busy} onClick={() => setOpen(true)}>
                  重新授权账户
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Button>
              ) : (
                <Button
                  disabled={!!busy}
                  onClick={() => void runAction("connect", { siteId: site.id })}
                >
                  {pending("connect") ? (
                    <Spinner />
                  ) : (
                    <Link2 data-icon="inline-start" aria-hidden />
                  )}
                  {pending("connect")
                    ? "正在连接…"
                    : connection
                      ? "重新连接"
                      : "连接商家"}
                </Button>
              )}
            </div>
            {error && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {notice && (
              <p className="pap-notice" role="status">
                <Check aria-hidden />
                {notice}
              </p>
            )}
            {ref && (
              <details
                className="pap-auth"
                open={open}
                onToggle={(e) => setOpen(e.currentTarget.open)}
              >
                <summary>
                  <KeyRound aria-hidden />
                  <span>
                    账户授权
                    <span className="pap-summary-hint">按需连接商家账户</span>
                  </span>
                  <Badge>可选</Badge>
                  <ChevronDown className="pap-chevron" aria-hidden />
                </summary>
                <div className="pap-auth-content">
                  <p className="pap-muted">
                    独立 PAP
                    身份可直接使用商家开放的服务。仅在需要访问账户专属资源时，才需要额外授权。
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
                        <FieldLabel htmlFor={`${id}-scopes`}>
                          授权范围
                        </FieldLabel>
                        <Input
                          id={`${id}-scopes`}
                          value={scopes}
                          onChange={(e) => setScopes(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="填写商家提供的授权范围"
                          disabled={!!busy}
                          aria-describedby={`${id}-scopes-help`}
                        />
                        <p id={`${id}-scopes-help`} className="pap-field-help">
                          多个范围用空格分隔，具体权限由商家确认。
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
                          前往商家授权
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
                        <p
                          id={`${id}-callback-help`}
                          className="pap-field-help"
                        >
                          此地址仅用于当前商家的授权校验，不会发送给聊天模型。
                        </p>
                        {invalid && (
                          <FieldError>请输入完整的 HTTPS 回调地址。</FieldError>
                        )}
                      </Field>
                    </FieldGroup>
                    <div className="pap-form-actions">
                      <Button
                        type="submit"
                        disabled={!!busy || !callback.trim()}
                      >
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
          </CardContent>
          <CardFooter>
            <LockKeyhole aria-hidden />
            <span>凭据由宿主管理 · 各商家连接独立隔离</span>
          </CardFooter>
        </Card>
      </article>
    );
  }
  function Panel() {
    const [data, setData] = useState<Status>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const [now, setNow] = useState(Date.now());
    const lock = useRef(false);
    const refresh = async () => {
      if (lock.current) return;
      lock.current = true;
      setBusy("status");
      setError("");
      try {
        setData(await call("status"));
        setNow(Date.now());
      } catch {
        setError("暂时无法读取连接状态，请重试。");
      } finally {
        lock.current = false;
        setBusy("");
      }
    };
    useEffect(() => {
      void refresh();
      const timer = setInterval(() => setNow(Date.now()), 15000);
      return () => clearInterval(timer);
    }, []);
    const run: Run = async (operation, payload) => {
      if (lock.current) throw new Error("OPERATION_IN_PROGRESS");
      lock.current = true;
      const siteId =
        payload.siteId ??
        data?.connections.find((c) => c.connectionRef === payload.connectionRef)
          ?.siteId;
      setBusy(`${operation}:${siteId}`);
      setError("");
      try {
        const result = await call(operation, payload);
        if (operation !== "authorize") {
          try {
            setData(await call("status"));
            setNow(Date.now());
          } catch {
            setError("操作已提交，但最新状态暂不可用。请刷新状态确认结果。");
          }
        }
        return result;
      } finally {
        lock.current = false;
        setBusy("");
      }
    };
    const connected =
      data?.connections.filter(
        (c) =>
          c.connected &&
          (c.expiresAt === undefined || c.expiresAt * 1000 > now),
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
            <div className="pap-title-row">
              <div className="pap-brand">
                <Link2 aria-hidden />
              </div>
              <div>
                <h2>PAP 连接</h2>
                <p className="pap-muted">连接商家，让 Agent 为你使用服务。</p>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void refresh()}
              aria-label="刷新连接状态"
            >
              {busy === "status" ? (
                <Spinner />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden />
              )}
              刷新状态
            </Button>
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
                  当前 Profile 尚未配置客户端身份。导入客户端配置并重启 Profile
                  后，即可在这里连接商家。
                </EmptyDescription>
                <p className="pap-field-help">
                  配置步骤请参阅 PAP 插件 README。
                </p>
              </Empty>
            </Card>
          ) : (
            <div className="pap-layout">
              <div className="pap-section-heading">
                <div>
                  <h3>已登记的商家</h3>
                  <p className="pap-muted">管理连接与账户授权</p>
                </div>
                <Badge>
                  {connected} / {data.sites.length} 已连接
                </Badge>
              </div>
              <main className="pap-main">
                {data.sites.length ? (
                  data.sites.map((site) => (
                    <Merchant
                      key={site.id}
                      site={site}
                      connection={data.connections.find(
                        (c) => c.siteId === site.id,
                      )}
                      busy={busy}
                      run={run}
                      now={now}
                    />
                  ))
                ) : (
                  <Card>
                    <Empty>
                      <div className="pap-empty-icon">
                        <Store aria-hidden />
                      </div>
                      <EmptyTitle>还没有登记商家</EmptyTitle>
                      <EmptyDescription>
                        在 PAP 客户端配置中添加商家后，刷新此页面即可查看。
                      </EmptyDescription>
                    </Empty>
                  </Card>
                )}
              </main>
              <aside className="pap-aside" aria-label="连接说明">
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>从连接到使用</CardTitle>
                      <CardDescription>
                        建立一次连接，后续在聊天中继续。
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ol className="pap-guide">
                      <li>
                        <span className="pap-guide-icon">
                          <Link2 aria-hidden />
                        </span>
                        <div>
                          <h4>连接已登记的商家</h4>
                          <p>使用独立身份建立连接。</p>
                        </div>
                      </li>
                      <li>
                        <span className="pap-guide-icon">
                          <Search aria-hidden />
                        </span>
                        <div>
                          <h4>告诉 Agent 你的需求</h4>
                          <p>由已启用的业务插件调用服务。</p>
                        </div>
                      </li>
                      <li>
                        <span className="pap-guide-icon">
                          <ShieldCheck aria-hidden />
                        </span>
                        <div>
                          <h4>在需要时亲自确认</h4>
                          <p>账户授权与业务确认各自独立。</p>
                        </div>
                      </li>
                    </ol>
                  </CardContent>
                </Card>
                <div className="pap-privacy">
                  <LockKeyhole aria-hidden />
                  <div>
                    <h4>连接属于你</h4>
                    <p>
                      签名密钥与令牌由宿主凭据存储和加密存储保护，不会展示给聊天模型。
                    </p>
                  </div>
                </div>
              </aside>
            </div>
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
