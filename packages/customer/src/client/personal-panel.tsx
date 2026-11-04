import React, { useEffect, useId, useRef, useState } from "react";
import { Button, Card, Field, FieldLabel, Input, Spinner } from "./ui.js";
import { useAccountRevision } from "./account.js";

export type PersonalStatus = {
  configured: boolean;
  signedIn: boolean;
  phone?: string;
  expiresAt?: number;
  logoutPending?: boolean;
  challenge?: { phone: string; expiresAt: number; resendAt: number };
};
const errors: Record<string, string> = {
  INVALID_UI_REQUEST: "请检查手机号或 6 位验证码格式后重试。",
  INVALID_PHONE: "请填写带国家代码的手机号，例如 +8613800000000。",
  INVALID_OTP: "请输入 6 位验证码。",
  HTTP_401: "验证码无效或已过期，请重新获取。",
  HTTP_429: "请求较多，请稍后再试。",
  OTP_RESEND_WAIT: "请等待倒计时结束后再获取验证码。",
  OTP_EXPIRED: "验证码已过期，请重新获取。",
  PERSONAL_LOGOUT_PENDING: "本机连接已停用，服务端退出尚未确认，请重试退出。",
  PERSONAL_LOGOUT_REQUIRED: "请先退出当前账号后再登录。",
  PERSONAL_ACCOUNT_CHANGED: "登录状态已变化，请重试。",
};
export function FrontviaAccountPanel({
  call,
}: {
  call: (op: string, payload?: any) => Promise<any>;
}) {
  const revision = useAccountRevision();
  const [status, setStatus] = useState<PersonalStatus>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const refresh = async () => {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const value = await call("personal-status");
      if (current === request.current) setStatus(value);
    } catch {
      if (current === request.current) {
        setStatus(undefined);
        setError("无法读取个人账号状态，请重试。");
      }
    } finally {
      if (current === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    setStatus(
      (previous) =>
        previous && {
          configured: previous.configured,
          signedIn: false,
        },
    );
    void refresh();
    return () => {
      request.current++;
    };
  }, [revision]);
  if (status)
    return (
      <PersonalPanel
        status={status}
        call={call}
        onChanged={refresh}
        disabled={loading}
      />
    );
  return (
    <Card className="fv-personal" aria-label="个人账号" aria-busy={loading}>
      <h3>个人账号</h3>
      {loading ? (
        <p role="status">
          <Spinner /> 正在读取账号状态…
        </p>
      ) : (
        <>
          <p role="alert">{error}</p>
          <div>
            <Button variant="outline" onClick={() => void refresh()}>
              重试
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
export function PersonalPanel({
  status,
  call,
  onChanged,
  disabled,
}: {
  status: PersonalStatus;
  call: (op: string, payload?: any) => Promise<any>;
  onChanged: () => Promise<void>;
  disabled: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const id = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!status.configured)
    return (
      <Card className="fv-personal">
        <h3>个人账号</h3>
        <p className="fv-description">
          尚未配置个人账号服务。配置 Frontvia 身份服务后，即可使用手机号登录。
        </p>
      </Card>
    );
  const challenge =
    status.challenge && status.challenge.expiresAt * 1000 > now
      ? status.challenge
      : undefined;
  const wait = Math.max(
    0,
    Math.ceil(((challenge?.resendAt ?? 0) * 1000 - now) / 1000),
  );
  const run = async (op: string, payload?: any) => {
    if (busy || disabled) return;
    setBusy(op);
    setError("");
    if (op === "personal-logout")
      window.dispatchEvent(new Event("frontvia-personal-change"));
    try {
      await call(op, payload);
      setCode("");
      if (op !== "personal-code") setPhone("");
    } catch (e: any) {
      setError(errors[e.code ?? e.message] ?? "账号服务暂不可用，请稍后重试。");
    } finally {
      if (op !== "personal-code")
        window.dispatchEvent(new Event("frontvia-personal-change"));
      setBusy("");
      await onChanged();
    }
  };
  return (
    <Card className="fv-personal" aria-label="个人账号">
      <div>
        <h3>个人账号</h3>
        <p className="fv-description">
          使用手机号登录或注册 Frontvia 个人账号，再到 PAP 连接中连接商家
          Agent。换号后请新建聊天。
        </p>
      </div>
      {status.signedIn ? (
        <div className="fv-personal-actions">
          <p role="status">已登录 · {status.phone}</p>
          <Button
            variant="outline"
            disabled={!!busy || disabled}
            onClick={() => void run("personal-logout")}
          >
            退出登录
          </Button>
        </div>
      ) : status.logoutPending ? (
        <div className="fv-personal-actions">
          <p>本机已退出，服务端退出待确认。</p>
          <Button
            disabled={!!busy || disabled}
            onClick={() => void run("personal-logout")}
          >
            重试退出
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              challenge ? "personal-verify" : "personal-code",
              challenge ? { code } : { phone: phone.trim() },
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-phone`}>
              手机号（含国家代码）
            </FieldLabel>
            <Input
              id={`${id}-phone`}
              type="tel"
              autoComplete="tel"
              placeholder="+86"
              value={phone}
              disabled={!!busy || disabled}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          {challenge && (
            <Field>
              <FieldLabel htmlFor={`${id}-code`}>
                发送至 {challenge.phone} 的验证码
              </FieldLabel>
              <Input
                id={`${id}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                disabled={!!busy || disabled}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          )}
          <div className="fv-personal-actions">
            <Button
              type="submit"
              disabled={
                !!busy ||
                disabled ||
                (challenge
                  ? !/^\d{6}$/.test(code)
                  : !/^\+[1-9][0-9]{7,14}$/.test(phone.trim()))
              }
            >
              {busy ? <Spinner /> : null}
              {challenge ? "登录 / 注册" : "获取验证码"}
            </Button>
            {challenge && (
              <Button
                variant="ghost"
                disabled={!!busy || disabled || wait > 0 || !phone.trim()}
                onClick={() =>
                  void run("personal-code", { phone: phone.trim() })
                }
              >
                {wait ? `${wait} 秒后可重发` : "重新获取验证码"}
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="fv-field-error">
          {error}
        </p>
      )}
    </Card>
  );
}
