import { useAccountRevision } from "./account.js";
import React, { useEffect, useState } from "react";
import {
  BookOpen,
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
  CardFooter,
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
}: {
  ui: { flowId: string; sessionId: string; card: string };
  call: (op: string, payload: any) => Promise<any>;
  sendToAgent?: (text: string) => Promise<unknown>;
}) {
  const accountRevision = useAccountRevision();
  const [data, setData] = useState<any>(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const errors: Record<string, string> = {
    PERSONAL_ACCOUNT_CHANGED: "请登录原个人账号后查看此咨询。",
    PERSONAL_LOGIN_REQUIRED: "请先到 Frontvia 服务登录个人账号。",
    CLIENT_NOT_ALLOWED: "客户端接入校验未通过，请在 PAP 连接中核对配置。",
    CONNECTION_BINDING_REQUIRED:
      "旧连接缺少绑定信息，请在 PAP 连接中查看处理说明。",
    CONSULTATION_UNAVAILABLE: "咨询服务暂不可用或未获授权，请刷新连接后重试。",
    KNOWLEDGE_SOURCE_EXPIRED: "原知识来源已失效，请重新检索。",
    KNOWLEDGE_UNAVAILABLE: "商家暂未开放这项知识服务。",
    RESOLVE_PENDING_OPERATION: "上次请求结果未知，请先核对原请求。",
  };
  async function refresh(op = "view") {
    setBusy(op);
    setError("");
    try {
      setData(await call(op, ui));
    } catch (e: any) {
      setData(undefined);
      setError(errors[e.message] ?? "服务暂不可用，请检查连接或稍后重试。");
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    let live = true;
    setData(undefined);
    call("view", ui)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(errors[e.message] ?? "暂时无法读取商家服务。");
      });
    return () => {
      live = false;
    };
  }, [ui.flowId, ui.sessionId, accountRevision]);
  async function download(sourceRef: string) {
    setBusy("original");
    setError("");
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
          <CardTitle>商家咨询与知识</CardTitle>
          <CardDescription>
            {data?.capabilities?.agent?.name ?? "读取商家提供的答复与公开资料"}
          </CardDescription>
        </div>
        <Badge>咨询服务</Badge>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <Info aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!data && !error && (
          <p role="status">
            <Spinner />
            正在读取商家服务…
          </p>
        )}
        {data && (
          <div className="fv-stack">
            <div className="fv-between">
              <span className="fv-muted">
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
            </div>
            {data.conversation?.status === "failed" && (
              <Alert variant="destructive">
                <Info aria-hidden />
                <AlertDescription>
                  商家未能完成本次答复，问题和已有记录已保留。你可以在聊天中重新提问。
                </AlertDescription>
              </Alert>
            )}
            {(data.conversation?.messages ?? []).length ? (
              data.conversation.messages.map((m: any) => (
                <article className="fv-consult-message" key={m.id}>
                  <p className="fv-muted">
                    {m.actor === "agent" || m.actor === "merchant"
                      ? "商家回复"
                      : "你的问题"}
                  </p>
                  <p>{m.text}</p>
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
        <div className="fv-consult-actions">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            {busy === "view" ? <Spinner /> : <RefreshCw aria-hidden />}刷新答复
          </Button>
          {data?.pending && (
            <Button disabled={!!busy} onClick={() => void refresh("recover")}>
              {busy === "recover" ? <Spinner /> : null}核对原请求
            </Button>
          )}
        </div>
      </CardContent>
      <CardFooter>咨询答复不会下单或付款，购买仍需单独核对并确认。</CardFooter>
    </Card>
  );
}
