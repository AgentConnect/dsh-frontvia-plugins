import React from "react";
import { Button, Card } from "./ui.js";

export type PersonalIdentity = {
  configured: boolean;
  signedIn: boolean;
  phone?: string;
  expiresAt?: number;
  logoutPending?: boolean;
};

/** PAP displays the shared identity; the independent identity plugin owns the login entry. */
export function IdentityPanel({
  identity,
  openAccount,
}: {
  identity: PersonalIdentity;
  openAccount?: () => void;
}) {
  return (
    <Card className="pap-identity" aria-label="当前身份">
      <h3>当前身份</h3>
      <p role="status">
        {identity.signedIn
          ? `DSH 个人账号 · ${identity.phone}`
          : identity.logoutPending
            ? "本机已退出，服务端退出待确认"
            : "未登录 DSH 个人账号"}
      </p>
      <p className="pap-description">
        {!openAccount
          ? "请安装或启用 DSH 账号插件，以登录或管理个人账号。"
          : identity.logoutPending
            ? "请到 DSH 账号重试退出。"
            : identity.signedIn
              ? "账号管理和退出登录请前往 DSH 账号。"
              : identity.configured
                ? "请到 DSH 账号使用手机号登录或注册，再连接商家。"
                : "在 DSH 账号配置个人账号后，即可使用手机号登录。"}
      </p>
      {openAccount && identity.configured && !identity.signedIn && (
        <Button variant="outline" onClick={openAccount}>
          打开 DSH 账号
        </Button>
      )}
    </Card>
  );
}
