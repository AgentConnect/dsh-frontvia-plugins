import React, { useEffect, useRef } from "react";
import { Button } from "./ui.js";

/** DSH settings are a modal, not a layout panel. Use explicit host navigation instructions. */
export function ConnectionHelp({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="fv fv-connection-help"
      aria-label="连接设置步骤"
      onClose={close}
    >
      <h3>连接设置步骤</h3>
      <ol>
        <li>点击 DSH 左下角的账号菜单（或“更多”），打开“设置”。</li>
        <li>
          在“身份管理”选择已发布的默认公共身份；没有可用身份时，先按页面引导创建并发布。
        </li>
        <li>在“协议管理”检查 PAP 接入授权；已断开的商家须在“PAP 连接”中点“重新连接”。</li>
        <li>首次接入时，在会话中提供店铺域名；已连接的商家可从 Frontvia 服务打开。</li>
      </ol>
      <p>旧手机号连接的记录不会自动转给新公共身份，原聊天内容仍会保留。</p>
      <Button variant="outline" onClick={() => dialog.current?.close()}>
        知道了
      </Button>
    </dialog>
  );
}
