import { serviceFeedback } from "./service-feedback.js";
import { useAccountRevision } from "./account.js";
import { ConversationShopping } from "./conversation-shopping.js";
import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Download,
  Info,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
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
  Spinner,
} from "./ui.js";
export function ConsultationCard({
  ui,
  call,
  sendToAgent,
  openSettings,
  openServices,
  openPlugins,
}: {
  ui: { flowId: string; sessionId: string; card: string };
  call: (op: string, payload: any) => Promise<any>;
  sendToAgent?: (text: string) => Promise<unknown>;
  openSettings?: () => void;
  openServices?: () => void;
  openPlugins?: () => void;
}) {
  const accountRevision = useAccountRevision();
  const scope = `${ui.flowId}:${ui.sessionId}:${accountRevision}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pollUntil = useRef(Date.now() + 300000);
  const [data, setData] = useState<any>(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [failure, setFailure] = useState<ReturnType<typeof serviceFeedback>>();
  async function refresh(op = "view", automatic = false) {
    if (!automatic) pollUntil.current = Date.now() + 300000;
    setBusy(op);
    setError("");
    setFailure(undefined);
    try {
      const value = await call(op, ui);
      if (currentScope.current !== scope) return;
      setData(value);
    } catch (e: any) {
      if (currentScope.current !== scope) return;
      setData(undefined);
      setFailure(serviceFeedback(e));
    } finally {
      if (currentScope.current === scope) setBusy("");
    }
  }
  useEffect(() => {
    let live = true;
    pollUntil.current = Date.now() + 300000;
    setData(undefined);
    setError("");
    setFailure(undefined);
    setBusy("");
    call("view", ui)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setFailure(serviceFeedback(e));
      });
    return () => {
      live = false;
    };
  }, [ui.flowId, ui.sessionId, accountRevision]);
  // Read-only refresh: never replay consent or start a payment on mount/focus.
  useEffect(() => {
    if (!data?.shopping || busy) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    const timer =
      Date.now() < pollUntil.current &&
      ["processing", "payment_pending"].includes(data.shopping.state)
        ? setTimeout(() => {
            if (document.visibilityState === "visible")
              void refresh("view", true);
          }, 5000)
        : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      clearTimeout(timer);
    };
  }, [data, busy, ui.flowId, ui.sessionId, accountRevision]);
  async function download(sourceRef: string) {
    setBusy("original");
    setError("");
    setFailure(undefined);
    try {
      const value = await call("original", { ...ui, sourceRef });
      const bytes = Uint8Array.from(atob(value.bytes_base64), (c) =>
        c.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = value.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("当前原文件不可用，请重新读取来源后再下载。");
    } finally {
      setBusy("");
    }
  }
  const knowledge = data?.knowledge,
    sources =
      knowledge?.sources ??
      knowledge?.data?.sources ??
      knowledge?.data?.hits ??
      knowledge?.hits ??
      (knowledge?.data?.source ? [knowledge.data.source] : []);
  return (
    <Card>
      <CardHeader>
        <div className="fv-brand">
          <MessageCircle aria-hidden />
        </div>
        <div>
          <CardTitle>
            {data?.capabilities?.shopping?.availability === "supported"
              ? "商家购物与咨询"
              : "商家咨询与知识"}
          </CardTitle>
          {data?.capabilities?.agent?.name && (
            <CardDescription>{data.capabilities.agent.name}</CardDescription>
          )}
        </div>
        <Badge>
          {data?.capabilities?.shopping?.availability === "supported"
            ? "人民币购物"
            : "咨询服务"}
        </Badge>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <Info aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {failure && (
          <Alert>
            <Info aria-hidden />
            <AlertDescription className="fv-service-feedback">
              <p>{failure.text}</p>
              <div className="fv-consult-actions">
                {failure.retry && (
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void refresh()}
                  >
                    {busy ? <Spinner /> : <RefreshCw aria-hidden />}重试
                  </Button>
                )}
                {(failure.action === "services"
                  ? openServices
                  : openSettings) && (
                  <Button
                    variant="outline"
                    onClick={
                      failure.action === "services"
                        ? openServices
                        : openSettings
                    }
                  >
                    {failure.label}
                  </Button>
                )}
              </div>
              <details>
                <summary>技术信息</summary>
                <code>{failure.code}</code>
              </details>
            </AlertDescription>
          </Alert>
        )}
        {!data && !error && !failure && (
          <p role="status">
            <Spinner />
            正在读取商家服务…
          </p>
        )}
        {data && (
          <div className="fv-stack">
            <ConversationShopping shopping={data.shopping} busy={!!busy} />
            {data.conversation?.status === "failed" && (
              <Alert variant="destructive">
                <Info aria-hidden />
                <AlertDescription>
                  商家未能完成本次答复，问题和已有记录已保留。你可以在聊天中重新提问。
                </AlertDescription>
              </Alert>
            )}
            <details className="fv-consult-conversation" key={scope}>
              <summary>
                <span className="fv-consult-heading fv-muted">
                  <ChevronRight aria-hidden />
                  {data.pending
                    ? "原请求结果待核对"
                    : data.conversation?.status === "pending"
                      ? "商家正在处理"
                      : data.conversation?.status === "failed"
                        ? "本次答复未完成"
                        : data.conversation?.status === "needs_human"
                          ? "等待人工回复"
                          : "当前会话"}
                </span>
                <Badge>
                  {data.capabilities?.knowledge === "supported"
                    ? "公开知识已开放"
                    : "暂未开放知识"}
                </Badge>
              </summary>
              <div className="fv-stack">
                {(data.conversation?.messages ?? []).length ? (
                  data.conversation.messages.map((m: any) => (
                    <article className="fv-consult-message" key={m.id}>
                      <p className="fv-muted">
                        {m.actor === "agent" || m.actor === "merchant"
                          ? "商家回复"
                          : "你的问题"}
                      </p>
                      <p>
                        {m.text
                          .replace(
                            /https:\/\/[^\s<>"']+\/pay\/[^\s<>"']+/gu,
                            "请在上方购物卡片打开付款页",
                          )
                          .replace(
                            /确认购买\s+[A-Za-z0-9_-]{4,80}/gu,
                            "请在购物卡片核对后点击确认购买",
                          )}
                      </p>
                      {m.knowledge_status && m.knowledge_status !== "none" && (
                        <span className="fv-muted">
                          {m.knowledge_status === "current"
                            ? "引用已核对"
                            : "引用状态已变化，请重新查询"}
                        </span>
                      )}
                    </article>
                  ))
                ) : (
                  <Empty>
                    <MessageCircle aria-hidden />
                    <EmptyTitle>在聊天中向商家提问</EmptyTitle>
                    <EmptyDescription>
                      只会发送本次问题及你选择的商品，不会转发整段私人聊天。
                    </EmptyDescription>
                  </Empty>
                )}
              </div>
            </details>
            {!!sources.length && (
              <div className="fv-stack">
                <h4>
                  <BookOpen aria-hidden />
                  公开知识来源
                </h4>
                {sources.map((s: any, i: number) => (
                  <article
                    className="fv-consult-message"
                    key={s.sourceRef ?? i}
                  >
                    <p>{s.title ?? s.document_title ?? "知识来源"}</p>
                    <p>{s.text ?? s.content ?? s.excerpt}</p>
                    {s.sourceRef && (
                      <div className="fv-between">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || !sendToAgent}
                          onClick={() =>
                            void sendToAgent?.(
                              `使用当前咨询 flowId=${ui.flowId}，读取知识 sourceRef=${s.sourceRef} 的精确来源。`,
                            )
                          }
                        >
                          读取来源
                        </Button>
                        {s.original?.available === true && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!busy}
                            onClick={() => void download(s.sourceRef)}
                          >
                            <Download aria-hidden />
                            下载原文件
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {knowledge?.downloadSourceRef && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void download(knowledge.downloadSourceRef)}
              >
                <Download aria-hidden />
                下载 {knowledge.filename ?? "原文件"}
              </Button>
            )}
          </div>
        )}
        {!failure && (
          <div className="fv-consult-actions">
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void refresh()}
            >
              {busy === "view" ? <Spinner /> : <RefreshCw aria-hidden />}
              {data?.shopping ? "刷新订单与答复" : "刷新答复"}
            </Button>
            {data?.pending && (
              <Button disabled={!!busy} onClick={() => void refresh("recover")}>
                {busy === "recover" ? <Spinner /> : null}核对原请求
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
