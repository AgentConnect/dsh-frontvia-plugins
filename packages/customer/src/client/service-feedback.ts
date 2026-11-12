/** Safe UI guidance: raw transport messages and credentials never reach the card. */
export function serviceFeedback(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const transportStatus =
    /transport failure for \/api\/frontvia-customer\/[a-z-]+: HTTP (\d{3})$/.exec(
      message,
    )?.[1];
  if (transportStatus)
    return {
      code: `CLIENT_HTTP_${transportStatus}`,
      text: "Frontvia 插件尚未就绪。请完全退出并重新打开 DSH；如果仍未恢复，请在“插件”中查看 Frontvia 的异常原因。",
      action: "plugins",
      label: "查看插件状态",
      retry: true,
    };
  const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(message)
    ? message
    : "SERVICE_READ_FAILED";
  if (
    [
      "PERSONAL_ACCOUNT_CHANGED",
      "IDENTITY_CHANGED",
      "PERSONAL_LOGIN_REQUIRED",
      "PUBLIC_IDENTITY_REQUIRED",
      "PAP_IDENTITY_REQUIRED",
      "PAP_PERMISSION_DENIED",
    ].includes(code)
  )
    return {
      code,
      text: "当前身份无法访问这条咨询。请先核对默认公共身份和 PAP 授权；旧手机号连接的记录不能直接用新身份恢复。",
      action: "settings",
      label: "查看设置步骤",
      retry: true,
    };
  if (["FLOW_NOT_OWNED", "CONNECTION_BINDING_REQUIRED"].includes(code))
    return {
      code,
      text: "这张历史卡片暂时无法恢复。请从 Frontvia 服务重新打开商家；已有聊天内容仍可查看，请勿重复下单或付款。",
      action: "services",
      label: "打开 Frontvia 服务",
      retry: false,
    };
  if (
    [
      "CONSULTATION_UNAVAILABLE",
      "CLIENT_NOT_ALLOWED",
      "PAP_DISCONNECTED",
      "METHOD_NOT_ADVERTISED",
      "PAP_OPERATION_NOT_FOUND",
    ].includes(code)
  )
    return {
      code,
      text: "当前咨询连接不可用。请在设置中检查商家是否已连接、咨询服务是否已授权，再回来重试。",
      action: "settings",
      label: "查看设置步骤",
      retry: true,
    };
  return {
    code,
    text: "暂未获取到商家的最新回复。请点击“重试”；如果仍无法读取，可检查商家连接。不要重复提交原来的购买或付款。",
    action: "settings",
    label: "查看设置步骤",
    retry: true,
  };
}
