import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileJson,
  Info,
  X,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Spinner,
} from "./ui.js";

export function ImportPanel({
  call,
  onImported,
  open,
  onClose,
}: {
  call: (operation: string, payload?: unknown) => Promise<any>;
  onImported: () => Promise<void>;
  open: boolean;
  onClose: () => void;
}) {
  const id = useId(),
    input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(""),
    [preview, setPreview] = useState<any>();
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open && !preview) input.current?.focus();
  }, [open, !!preview]);
  async function inspect(e: React.FormEvent) {
    e.preventDefault();
    setBusy("inspect");
    setError("");
    setPreview(undefined);
    try {
      if (text.length > 64000) throw new Error("INVALID_CONNECTION_CONFIG");
      const result = await call("inspect", { configuration: JSON.parse(text) });
      setPreview(result);
      setSelected(result.sites.map((s: any) => s.resource));
    } catch (e: any) {
      const messages: Record<string, string> = {
        IMPORT_BINDING_MISMATCH:
          "配置与商家发布的地址不一致，请重新导出连接配置。",
        DISCOVERY_MISMATCH: "商家发现信息与配置不一致。",
        PUBLIC_HTTPS_REQUIRED: "只能导入可验证的公网 HTTPS 服务。",
        INVALID_SERVICE_CONTRACT: "该服务尚未提供可识别的接口契约。",
        IMPORT_PREVIEW_EXPIRED: "检查结果已过期，请重新检查。",
      };
      setError(
        e instanceof SyntaxError
          ? "这段 JSON 不完整或格式有误，请检查后重试。"
          : (messages[e.message] ??
              "未能检查配置，请确认配置内容和服务网络后重试。"),
      );
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("import");
    setError("");
    try {
      await call("import", {
        previewId: preview.previewId,
        resources: selected,
      });
      await onImported();
      setPreview(undefined);
      setText("");
      onClose();
    } catch (e: any) {
      setError(
        e.message === "SITE_BINDING_CONFLICT"
          ? "该连接名称已绑定其他资源，请保留原连接并使用新的名称。"
          : "添加未完成，请返回并重新检查配置后再试。",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      className="pap-import-panel"
      id="pap-import-form"
      hidden={!open}
      aria-label="添加商家配置"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="pap-import-header">
        <div>
          <h3>添加商家</h3>
          <p>粘贴商家提供的配置，连接你需要的服务。</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={!!busy}
          aria-label="关闭添加商家"
        >
          <X aria-hidden />
        </Button>
      </header>
      <ol className="pap-import-steps" aria-label="添加步骤">
        <li data-active={!preview} aria-current={!preview ? "step" : undefined}>
          <span>{preview ? <Check aria-hidden /> : "1"}</span>粘贴配置
        </li>
        <li className="pap-step-line" aria-hidden />
        <li data-active={!!preview} aria-current={preview ? "step" : undefined}>
          <span>2</span>选择服务
        </li>
      </ol>
      {!preview ? (
        <form onSubmit={inspect}>
          <Field>
            <FieldLabel htmlFor={id}>商家连接 JSON</FieldLabel>
            <textarea
              ref={input}
              id={id}
              className="pap-input pap-json"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError("");
              }}
              placeholder={
                '{\n  "discovery_url": "https://…",\n  "sites": […]\n}'
              }
              spellCheck={false}
              autoComplete="off"
              disabled={!!busy}
              maxLength={64000}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
            />
            <p id={`${id}-hint`} className="pap-field-help">
              粘贴商家导出的完整配置，不需要填写密钥或令牌。
            </p>
          </Field>
          {error && (
            <Alert variant="destructive">
              <Info aria-hidden />
              <AlertDescription id={`${id}-error`}>{error}</AlertDescription>
            </Alert>
          )}
          <div className="pap-import-actions">
            <span className="pap-field-help">先检查服务，再确认添加。</span>
            <Button type="submit" disabled={!!busy || !text.trim()}>
              {busy === "inspect" ? <Spinner /> : <ArrowRight aria-hidden />}
              {busy === "inspect" ? "正在检查" : "检查服务"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="pap-discovered">
          <div className="pap-discovered-heading">
            <h4>选择要添加的服务</h4>
            <span>
              已选择 {selected.length} / {preview.sites.length}
            </span>
          </div>
          <div className="pap-resource-list">
            {preview.sites.map((site: any) => {
              const title = site.description.methods.some((m: string) =>
                m.startsWith("commerce."),
              )
                ? "购物服务"
                : site.description.profile ===
                    "frontvia.merchant_consultation.v1"
                  ? "咨询与知识"
                  : site.label;
              return (
                <label
                  className="pap-resource-option"
                  key={site.resource}
                  data-selected={selected.includes(site.resource)}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(site.resource)}
                    disabled={!!busy}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, site.resource]
                          : selected.filter((r) => r !== site.resource),
                      )
                    }
                  />
                  <span>
                    <span className="pap-resource-title">{title}</span>
                    <span className="pap-resource-domain">{site.domain}</span>
                    <span className="pap-resource-meta">
                      {site.description.methods.length} 项已发布接口
                      {site.clientAllowed === false
                        ? " · 当前客户端待批准"
                        : " · 连接时核验权限"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="pap-field-help">
            发现成功代表服务已发布，访问和购买权限仍由商家核验。
          </p>
          <details className="pap-import-identity">
            <summary>
              <FileJson aria-hidden />
              客户端与连接地址
              <ChevronDown aria-hidden />
            </summary>
            {preview.client.clientId && (
              <p className="pap-resource-url">{preview.client.clientId}</p>
            )}
            {!preview.client.signingKeyConfigured && (
              <p className="pap-field-help">
                {preview.client.automatic
                  ? "首次连接时将自动验证本机设备身份。"
                  : "客户端签名凭据尚未配置。"}
              </p>
            )}
            {preview.sites.map((site: any) => (
              <p className="pap-resource-url" key={site.resource}>
                {site.resource}
              </p>
            ))}
          </details>
          {error && (
            <Alert variant="destructive">
              <Info aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="pap-import-actions">
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setPreview(undefined);
                setError("");
              }}
            >
              <ArrowLeft aria-hidden />
              返回编辑
            </Button>
            <Button
              disabled={!!busy || !selected.length}
              onClick={() => void save()}
            >
              {busy === "import" ? <Spinner /> : <Check aria-hidden />}
              {busy === "import"
                ? "正在添加"
                : `添加 ${selected.length} 项服务`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
