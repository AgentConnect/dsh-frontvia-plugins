import React from "react";
import { Button } from "./ui.js";

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
    <div className="pap-identity" aria-label="当前账号">
      <div>
        <p role="status">
          {identity.signedIn
            ? `已登录 DSH 账号${identity.phone ? ` · ${identity.phone}` : ""}`
            : identity.logoutPending
              ? "退出尚未完成"
              : "未登录 DSH 账号"}
        </p>
        {(!openAccount || identity.logoutPending) && (
          <p className="pap-description">
            {!openAccount
              ? "请安装或启用 DSH 账号插件。"
              : "请到账号页面重试退出。"}
          </p>
        )}
      </div>
      {openAccount && (
        <Button variant="ghost" size="sm" onClick={openAccount}>
          {identity.signedIn || identity.logoutPending
            ? "管理账号"
            : "打开 DSH 账号"}
        </Button>
      )}
    </div>
  );
}
