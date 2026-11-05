# dsh-pap

Generic PAP 0.2 client service for official DeepSeek Harness 0.2.1-rc.3. Exposes `ctx.pap` and a connection sidebar. No commerce or payment tools. Configure via a protected `configFile`; keys are DSH credential references, not package contents. See the repository README for local installation and validation boundaries.

## 手机号个人账号

默认安装会在当前 DSH Profile 中启用 Frontvia 个人登录。打开「Frontvia 服务」即可查看已登录账号或使用验证码登录。要指定其他账号环境，可在受保护的 `configFile` 中增加：

```json
{
  "personal": {
    "origin": "https://identity.example.com",
    "requestOrigin": "https://identity.example.com",
    "tokenOrigins": ["https://platform.example.com"]
  }
}
```

`origin` 是提供 `/v1/personal/*` 的可信 Frontvia 服务；`requestOrigin` 必须
是服务端已配置允许的 Origin。`tokenOrigins` 是可接收个人登录凭据的可信
Platform issuer origin，不能从导入的商家配置自动追加。使用系统证书的公网
HTTPS 可直接解析；本地测试使用现有 `targets` 和专用 CA，不关闭 TLS 校验。

PAP 连接页只提供 PAP 客户端连接管理和当前身份展示。手机号验证码登录、
注册和退出入口位于 **Frontvia 服务**。原有加密会话和凭据存储位置不变，
Frontvia 通过宿主服务操作同一个账号会话，PAP 使用其身份建立连接。
PAP 不注册 `pap/personal-*` 页面接口；`pap/status` 只返回脱敏身份状态，
不包含验证码挑战信息。个人令牌不交给浏览器或模型。
配置个人账号后，连接商家须先到 Frontvia 服务登录。

默认安装在首次连接商家时向 Frontvia 账号服务登记当前 Profile 的设备公钥，签名私钥由本机 DSH 保存。服务端需支持 `POST /v1/personal/pap/devices`。显式配置的客户端继续使用自己的 CIMD/JWKS、匹配签名密钥和 HTTPS 回调。公开 Frontvia
服务自动校验客户端，旧导出配置中的允许列表不再形成审批门槛；服务端仍能
拒绝已禁用客户端、错误签名或未发布服务。个人登录不授予商家管理权限；
个人购物由 Commerce capabilities 和 Customer 的 owner 确认入口控制，
PAP 只提供当前资源连接的绑定证明签名，不注册购买工具。

退出立即停用本机连接；若服务端退出结果未知，会保留加密的待退出凭据并明确
提示重试，重启也不会悄悄恢复。换号后仅显示该账号连接，同账号重登复用原
连接引用和咨询身份。旧聊天仍是 DSH 的历史，换号后应新建聊天；Customer 会
阻止把另一账号接入已有账号记录的聊天。
