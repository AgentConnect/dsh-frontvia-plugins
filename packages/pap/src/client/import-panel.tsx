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
  Input,
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
    input = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLTextAreaElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    previewHeading = useRef<HTMLHeadingElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const [text, setText] = useState(""),
    [preview, setPreview] = useState<any>();
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (preview) previewHeading.current?.focus();
    else (advanced ? jsonInput : input).current?.focus();
  }, [open, !!preview, advanced]);
  async function inspect(e: React.FormEvent) {
    e.preventDefault();
    setBusy("inspect");
    setError("");
    setPreview(undefined);
    try {
      const configuration = advanced ? json : text;
      if (configuration.length > 64000)
        throw new Error("INVALID_CONNECTION_CONFIG");
      const result = await call("inspect", {
        configuration: advanced
          ? JSON.parse(configuration)
          : configuration.trim(),
      });
      setPreview(result);
      setSelected(result.sites.map((s: any) => s.resource));
    } catch (e: any) {
      const messages: Record<string, string> = {
        INVALID_SERVICE_LINK:
          "链接不完整，请复制服务方提供的完整 PAP 服务链接。",
        IMPORT_BINDING_MISMATCH:
          "配置与服务方发布的地址不一致，请重新导出连接配置。",
        DISCOVERY_MISMATCH: "服务方发现信息与配置不一致。",
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
      setJson("");
      setAdvanced(false);
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
    <dialog
      ref={dialog}
      className="pap-import-panel"
      id="pap-import-form"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="pap-import-header">
        <div>
          <h3 id={`${id}-title`}>添加服务</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={!!busy}
          aria-label="关闭添加服务"
        >
          <X aria-hidden />
        </Button>
      </header>
      <ol className="pap-import-steps" aria-label="添加步骤">
        <li data-active={!preview} aria-current={!preview ? "step" : undefined}>
          <span>{preview ? <Check aria-hidden /> : "1"}</span>粘贴链接
        </li>
        <li className="pap-step-line" aria-hidden />
        <li data-active={!!preview} aria-current={preview ? "step" : undefined}>
          <span>2</span>选择服务
        </li>
      </ol>
      {!preview ? (
        <form onSubmit={inspect}>
          <Field>
            <FieldLabel htmlFor={id}>
              {advanced ? "JSON 配置" : "服务链接"}
            </FieldLabel>
            {advanced ? (
              <textarea
                ref={jsonInput}
                id={id}
                className="pap-input pap-json"
                value={json}
                onChange={(e) => {
                  setJson(e.target.value);
                  setError("");
                }}
                placeholder="粘贴服务方提供的完整 JSON 配置"
                spellCheck={false}
                autoComplete="off"
                disabled={!!busy}
                maxLength={64000}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            ) : (
              <Input
                ref={input}
                id={id}
                type="url"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError("");
                }}
                placeholder="https://…"
                spellCheck={false}
                autoComplete="off"
                disabled={!!busy}
                maxLength={2048}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="pap-import-mode"
              disabled={!!busy}
              onClick={() => {
                setAdvanced((v) => !v);
                setError("");
              }}
            >
              {advanced ? "使用服务链接" : "使用 JSON 配置"}
            </Button>
          </Field>
          {error && (
            <Alert variant="destructive">
              <Info aria-hidden />
              <AlertDescription id={`${id}-error`}>{error}</AlertDescription>
            </Alert>
          )}
          <div className="pap-import-actions">
            <Button
              type="submit"
              disabled={!!busy || !(advanced ? json : text).trim()}
            >
              {busy === "inspect" ? <Spinner /> : <ArrowRight aria-hidden />}
              {busy === "inspect" ? "正在检查" : "检查服务"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="pap-discovered">
          <div className="pap-discovered-heading">
            <h4 ref={previewHeading} tabIndex={-1}>
              选择要添加的服务
            </h4>
            <span>
              已选择 {selected.length} / {preview.sites.length}
            </span>
          </div>
          <div className="pap-resource-list">
            {preview.sites.map((site: any) => {
              const title = site.label;
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
                    {site.clientAllowed === false && (
                      <span className="pap-resource-meta">需要服务方批准</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
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
    </dialog>
  );
}
