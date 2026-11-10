# DSHFrontviaPAP (`dsh-frontvia-pap`)

**Frontvia 专用的 PAP 连接插件，不是通用 PAP 插件**。面向 Frontvia 服务发现、授权与连接场景，底层采用 PAP 0.2；不承诺其他产品扩展的通用兼容性。适用于 DeepSeek Harness 0.2.2-rc.1。提供 `ctx.frontviaPap` 和「Frontvia PAP 连接」页面，仅依赖宿主的 Profile、凭据、连接和界面服务；不依赖 DSH 账号或 Frontvia Customer 插件。

## 连接页面

管理服务发现、连接、授权、断开、移除和恢复。列表按发现域名与 issuer 分组，各资源保留独立连接；不按商家、店铺或业务类型推断身份。资源地址、会话有效期和客户端信息收在详情中。

添加服务支持 HTTPS 资源链接和 JSON 配置。检查只生成预览，选择资源并确认后才导入，不自动连接或授权。页面不显示账号登录、手机号、商城入口或业务操作。

## 单独使用

无配置时也可启动、检查和保存服务信息。建立连接前，需要有效的客户端身份：已发布的 HTTPS 客户端元数据、匹配的签名密钥及回调。插件不会假定任意服务接受临时生成的本地身份。

通过插件的 `configFile` 指向仅当前用户可读的 JSON 文件（0600）：

```json
{
  "clientId": "https://client.example.com/client.json",
  "callback": "https://client.example.com/callback",
  "signingKeyRef": "MY_PAP_SIGNING_KEY",
  "keyId": "key-1",
  "storageKeyRef": "MY_PAP_STORAGE_KEY",
  "dataDir": "/absolute/path/to/pap-data",
  "sites": [],
  "targets": []
}
```

密钥引用由宿主凭据服务解析，不能把私钥写进导入配置或包中。公开服务使用 HTTPS、目标地址校验和 DNS 防护；本地隔离测试才使用显式 `targets` 和专用 CA。服务方仍决定是否接受客户端及授权方式。

PAP 可以单独安装其本地构建包；仓库的 `install:desktop` 是包含账号和商城的组合安装，不是单独安装命令，也不是版本发布。

## 可选身份适配

宿主插件可通过 `registerAuthentication` 提供特定授权方式。适配器根据已核验的授权服务器元数据匹配，提供不含令牌的主体/会话代次及授权字段；PAP 仅传递资源公钥。账号登录和设备登记由适配器自己的账号服务负责。

显式客户端在服务支持标准 JWT bearer 路径时继续使用原配置。需要扩展授权却未安装对应适配器时，连接明确失败，不降级为匿名身份。每条连接记录适配器归属，并在异步调用后重新检查登录代次、适配器实例及连接绑定。适配器卸载不删除连接，已在途请求不能返回旧账号数据。

`registerStatement` 仅供可信宿主扩展注册明确的证明策略。未注册的类型、跨客户端/issuer/resource 的声明均拒绝；私钥始终由 PAP 保存。`requestBound` 是无 PAP 凭据、同 issuer origin 的宿主辅助请求，不暴露为页面 RPC 或模型工具。

Frontvia 的身份匹配、购买证明策略和支付链接规则在 Customer 的适配层中，PAP 不导入这些实现。`frontvia-pap/status` 不读取或刷新账号，不返回账号信息。

## 已有数据与回退

不迁移或删除数据库。保留原 Profile 中的 `plugin-data/frontvia/pap` 路径、加密密钥引用、连接 ID、主体和 DPoP 密钥，路径名称仅用于兼容旧安装。已有 `personalIdentity` 记录由明确声明兼容能力的适配器读取；适配器缺失、账号退出或换号时拒绝访问。

旧 `personal` 配置只作为兼容标记，不再配置账号服务；账号环境由独立账号插件管理。回退前停止宿主并恢复整套匹配的旧插件构建，保留凭据和数据；不要删除数据库或复制另一账号的 Profile。

## 与通用 PAP 共存

已对照 [AgentConnect/dsh-pap](https://github.com/AgentConnect/dsh-pap) 的 `777a8214`：通用包为 `@awiki/dsh-pap`，使用 `pap` / `papHost` / `papManager` 服务、`papManager` 管理接口和 `pap_*` 工具。本插件不依赖该包，使用 `frontviaPap`、`/api/frontvia-pap/*`（RPC 方法 `frontvia-pap/*`）、`frontvia-pap-connections` 页面及 `frontvia-pap-connections-change` 事件；业务工具保持 `frontvia_*`。

Frontvia 账号客户端同时使用 `frontviaIdentity`、`/api/frontvia-identity/*` 和 `frontvia-identity-change`。两套插件的本地服务和接口名称分开；远端 PAP 协议、资源 URL 与签名字段不随本地包名修改。默认存储与密钥引用保留，升级不会新建空身份或清空连接。
