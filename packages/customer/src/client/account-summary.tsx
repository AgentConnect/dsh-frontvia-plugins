import React from "react";
import { Button } from "./ui.js";

export type AccountStatus = {
  configured: boolean;
  signedIn: boolean;
  phone?: string;
  logoutPending?: boolean;
};

export function AccountSummary({
  status,
  error,
  openAccount,
}: {
  status?: AccountStatus;
  error: boolean;
  openAccount: () => void;
}) {
  const label = error
    ? "暂时无法确认账号状态"
    : !status
      ? "正在读取账号状态…"
      : status.logoutPending
        ? "本机已退出，服务端退出待确认"
        : status.signedIn
          ? `已登录 DSH 账号${status.phone ? ` · ${status.phone}` : ""}`
          : status.configured
            ? "未登录 DSH 账号"
            : "DSH 账号尚未配置";
  return (
    <div className="fv-account-summary" aria-label="DSH 账号状态">
      <p role="status">{label}</p>
      <Button variant="ghost" size="sm" onClick={openAccount}>
        {!error &&
        status?.configured &&
        !status.signedIn &&
        !status.logoutPending
          ? "登录 DSH 账号"
          : "管理 DSH 账号"}
      </Button>
    </div>
  );
}
