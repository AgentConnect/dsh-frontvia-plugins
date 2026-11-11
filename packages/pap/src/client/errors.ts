export const messages: Record<string, string> = {
  IDENTITY_AUDIENCE_UNTRUSTED:
    "身份服务尚未信任此服务方，请联系管理员核对目标 issuer；个人凭据未发送。",
  PAP_DEVICE_ENROLLMENT_UNAVAILABLE:
    "设备身份登记暂不可用，请检查身份服务连接后重试。",
  PERSONAL_CONFIGURATION_REQUIRED: "身份服务尚未配置，请先完成账号插件配置。",
  INVALID_PERSONAL_CONFIGURATION: "身份服务配置无效，请联系管理员核对。",
  SIGNING_KEY_REQUIRED:
    "身份插件的设备签名凭据未就绪，请在账号页面核对设备状态。",
  PERSONAL_LOGOUT_PENDING: "账号正在退出，请等待完成后重新登录。",
  PERSONAL_LOGOUT_REQUIRED: "当前设备身份需要重新登录，请先在账号页面退出。",
  NETWORK_FAILURE: "网络连接未完成，请检查网络后重试。",
  IDENTITY_PROVIDER_REQUIRED: "此连接需要对应的身份插件，请启用后重试。",
  INVALID_DEVICE_IDENTITY: "账号服务返回的设备身份未通过验证。",
  PAP_CLIENT_IDENTITY_REQUIRED: "请配置有效的 PAP 客户端身份后再连接。",
  PAP_CONFIGURATION_REQUIRED: "请先配置 PAP 客户端，再连接服务方。",
  CLIENT_KEY_REQUIRED: "客户端签名密钥未就绪，请检查此 Profile 的凭据配置。",
  SITE_NOT_APPROVED: "此服务方尚未登记，请检查连接配置。",
  DISCOVERY_MISMATCH: "服务方的发现信息与已登记配置不一致，连接未建立。",
  ISSUER_MISMATCH: "服务方的身份服务与已登记配置不一致，连接未建立。",
  ENDPOINT_MISMATCH: "服务方的授权地址与已登记配置不一致，连接未建立。",
  ACCOUNT_REAUTHORIZATION_REQUIRED: "此账户需要重新授权，请展开下方账户授权。",
  SESSION_REQUIRED: "请先连接服务方，建立 PAP 会话。",
  CONNECTION_REQUIRED: "连接已不可用，请刷新状态后重新连接。",
  CONNECTION_BINDING_CHANGED:
    "连接配置已变化，旧凭据已停用。请恢复原配置；使用新服务方时请创建独立连接配置。",
  CONNECTION_BINDING_REQUIRED:
    "旧连接缺少身份绑定信息，暂时无法安全续接。原数据已保留，请在独立 Profile 中配置新连接。",
  PERSONAL_LOGIN_REQUIRED: "此连接需要登录，请在对应的身份插件完成登录后重试。",
  PERSONAL_ACCOUNT_CHANGED: "账号已变化，请重新连接服务方。",
  PERSONAL_TOKEN_ORIGIN_UNTRUSTED:
    "此服务方身份服务尚未配置为可信地址，个人凭据未发送。",
  PROVIDER_AUTHORIZATION_REQUIRED: "请通过此连接对应的身份插件完成授权。",
  CLIENT_NOT_ALLOWED:
    "此旧配置限制了客户端，请重新导入服务方最新的免审批连接配置。",
  OAUTH_INVALID_REQUEST:
    "服务方拒绝了连接请求格式（invalid_request），请联系服务管理员核对。",
  OAUTH_INVALID_CLIENT: "服务方未通过客户端认证（invalid_client）。",
  OAUTH_INVALID_GRANT: "服务方未接受本次授权凭据（invalid_grant）。",
  OAUTH_INVALID_TARGET: "服务方未接受本次资源地址（invalid_target）。",
  OAUTH_INVALID_DPOP_PROOF: "服务方未接受本次请求证明（invalid_dpop_proof）。",
  OAUTH_UNAUTHORIZED_CLIENT:
    "服务方未允许此客户端的授权方式（unauthorized_client）。",
  HTTP_401: "客户端身份尚未通过服务方验证，请核对客户端登记与签名凭据。",
  HTTP_403: "服务拒绝了此请求，请检查服务是否已发布或账号是否有效。",
  INVALID_SCOPE: "授权范围格式不正确，请使用服务方提供的范围，并以空格分隔。",
  CALLBACK_REJECTED:
    "回调地址未通过校验。请检查是否属于当前服务方和本次授权；过期时请重新创建授权链接。",
  AUTHORIZATION_DENIED: "服务方未批准此次授权。你可以重新创建授权链接后再试。",
  SITE_REVISION_CHANGED: "配置已变化，请刷新状态后重新确认。",
  SITE_NOT_REMOVED: "配置已恢复或发生变化，请刷新状态。",
  INVALID_AUTHORIZATION_URL: "服务方返回的授权链接无效，请检查连接配置。",
};
export function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return messages[code]
    ? `${messages[code]}（${code}）`
    : "连接操作未完成，请联系管理员核对。（PAP_REQUEST_FAILED）";
}
