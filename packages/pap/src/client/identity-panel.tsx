import React from "react";
import { Button, Card } from "./ui.js";

export type PersonalIdentity = {
  configured: boolean;
  signedIn: boolean;
  phone?: string;
  expiresAt?: number;
  logoutPending?: boolean;
};

/** PAP displays the shared identity; Frontvia owns the login entry. */
export function IdentityPanel({
  identity,
  openAccount,
}: {
  identity: PersonalIdentity;
  openAccount: () => void;
}) {
  return (
    <Card className="pap-identity" aria-label="当前身份">
      <h3>当前身份</h3>
      <p role="status">
        {identity.signedIn
          ? `Frontvia 个人账号 · ${identity.phone}`
          : identity.logoutPending
            ? "本机已退出，服务端退出待确认"
            : "未登录 Frontvia 个人账号"}
      </p>
      <p className="pap-description">
        {identity.logoutPending
          ? "请到 Frontvia 服务重试退出。"
          : identity.signedIn
            ? "账号管理和退出登录请前往 Frontvia 服务。"
            : identity.configured
              ? "请到 Frontvia 服务使用手机号登录或注册，再连接商家。"
              : "在 Frontvia 服务配置个人账号后，即可使用手机号登录。"}
      </p>
      {identity.configured && !identity.signedIn && (
        <Button variant="outline" onClick={openAccount}>
          打开 Frontvia 服务
        </Button>
      )}
    </Card>
  );
}
