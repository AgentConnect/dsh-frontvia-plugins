# 配置说明

安装后直接进入「Frontvia 服务」使用手机号登录。默认使用公开的 Frontvia 个人账号服务，账号与服务记录分别存入当前 DSH Profile 的加密数据库。再次启动会向账号服务验证已保存的会话；过期或被撤销时可重新登录。临时网络故障保留会话，可重试。

默认模式在首次连接商家时由 DSH 为当前 Profile 生成 ES256 密钥，向账号服务的 `/v1/personal/pap/devices` 提交公钥和持有证明，并保存返回的 HTTPS 客户端标识。再次连接复用已登记的设备身份，服务端轮换摘要密钥后客户端标识仍有效。本机签名密钥遗失时，下次连接生成独立密钥及商家连接。旧记录保留原引用；继续使用新身份时应新开聊天。旧服务端缺少此接口时仍可登录；商家连接显示服务端需更新。

已有自管 PAP 身份的 Profile 可继续使用原配置：公开 CIMD、与私钥匹配的 ES256 JWKS 和声明的回调地址。支持公开接入的 Frontvia 服务自动校验客户端，无需商家逐客户端审批。账号配置由独立账号插件负责；登录入口在账号或 Frontvia 页面，PAP 页面只管理服务连接，不展示 DSH 账号状态。PAP 单独使用见 [PAP README](../packages/pap/README.md)。插件不会启动公开注册服务或按邮箱绑定现有买方。

个人购物要求 Frontvia Schema52 和 `frontvia.personal_purchase.v1`，使用资源连接的 ES256/DPoP 证明，无需独立 HMAC 确认密钥。旧 `frontvia.pap_subject_purchase.v1` 仍保留商家批准的主体购买策略和 HMAC 密钥。

示例中的域名、IP、路径、storeId、kid 均为占位符，必须替换为同一隔离环境的真实值。

PAP 配置（0600）：

```json
{
  "clientId": "https://client.example.test/agent.json",
  "callback": "https://client.example.test/callback",
  "signingKeyRef": "DSH_PAP_CLIENT_SIGNING",
  "keyId": "client-key-1",
  "storageKeyRef": "DSH_PAP_STORAGE_KEY",
  "dataDir": "/private/profile-frontvia/pap",
  "caFile": "/private/profile-frontvia/test-ca.pem",
  "targets": [
    {
      "origin": "https://shop.example.test",
      "address": "127.0.0.1",
      "port": 443
    }
  ],
  "sites": [
    {
      "id": "test-shop",
      "label": "Test Shop",
      "domain": "shop.example.test",
      "issuer": "https://shop.example.test/companies/a",
      "resource": "https://shop.example.test/companies/a/commerce/v1/stores/store-a/rpc"
    }
  ]
}
```

`targets.origin` 必须采用 URL 的规范 origin（HTTPS 默认 443 时写 `https://shop.example.test`，不要保留 `:443`）。`address` 必须是明确批准的 IPv4/IPv6 地址；`port` 匹配 URL 端口；测试隧道可单独配置 `connectPort`。不跟随重定向，启用 TLS 证书检查、响应大小及超时上限。已批准访问的账号或商家域名遇到全量 Fake-IP 响应时，会通过经过 TLS 校验的公共 DNS 查询原域名的 A 记录，仍只拨号公网 IP；具体条件见下方导入说明。生产 CA 可省略 `caFile`，本地隔离测试应保留专用 CA。

Customer 配置（0600）：

```json
{
  "dataDir": "/private/profile-frontvia/customer",
  "storageKeyRef": "DSH_CUSTOMER_STORAGE_KEY",
  "sites": [
    {
      "siteId": "test-shop",
      "storeId": "store-a"
    }
  ]
}
```

`signingKeyRef` 对应 ES256 PKCS8 PEM；两个 `storageKeyRef` 对应独立的 32 字节 base64url 密钥。仅旧主体购买需要在 site 中增加 `confirmationKeyRef` 和 `confirmationKid`，对应另一份独立的 32 字节密钥和服务端批准策略。首次导入通过宿主凭据服务或受保护启动环境完成，插件将解析后的密钥保存到 DSH 凭据存储。不要把密钥放到命令行、聊天或 Git。

Profile patch 使用 rc.3 的按 ID 配置语法：

```yaml
- id: dsh-pap
  config:
    configFile: /private/profile-frontvia/pap.json
- id: dsh-frontvia-customer
  config:
    configFile: /private/profile-frontvia/customer.json
```

两个 bundle 必须已经安装并启用；patch 不能替代安装。用 `scripts/run-configured.mjs` 生成的验收 Profile 提供五组购物工具和咨询、知识两组服务工具，关闭通用 shell、文件、委派和插件管理工具，避免模型读取本机密钥文件。宿主、其他本地插件和当前 OS 用户属于受信任边界。

`ctx.pap` API v1：`sites()`、`discover(siteId)`、`connect(siteId)`、`status(connectionRef?)`、`authorize(connectionRef, scopes)`、`callback(connectionRef, url)`、`disconnect(connectionRef)`、`request(connectionRef, method, params, signal?)`。`identity` 为宿主消费方进行确认绑定使用，不得转发到模型。连接引用不含秘密。

连接首次创建时会在加密存储中固定 `clientId`、`callback`、商家 `domain`、`issuer` 和 `resource`。同一 siteId 的任一绑定字段发生变化后，旧连接返回 `CONNECTION_BINDING_CHANGED`，不会发送旧 Token、签名断言或撤销请求；恢复原配置后可以继续使用原身份。仅修改展示名称不影响连接。要接入不同商家，应配置独立 siteId 和对应的 Customer 商家策略。

升级前没有保存这些字段的旧连接返回 `CONNECTION_BINDING_REQUIRED`。插件无法从当前配置证明旧凭据的原始归属，因此不会自动补写绑定或换身份；原加密凭据、购物进度和订单引用全部保留。继续本机测试时使用独立 Profile、新的 `dataDir` 与凭据引用建立新身份，不覆盖旧目录，也不要将旧购物车或订单关联到新连接。旧身份迁移需要先核实历史配置，本次未提供自动迁移。`status` 仍可读取此类连接，并返回 `connected:false` 和非秘密的 `bindingError` 供页面显示。

账号授权页可创建 PKCE 链接，再粘贴预登记地址上的回调 URL；回调的 issuer、state、origin、path、有效期和一次性消费均校验。当前没有自动浏览器回调监听器；首版主体购物无需账号授权。

## 导入商家发布的服务

PAP 页面接受商家导出的 `frontvia.consultation.connection.v1` JSON。点击“检查服务”时，插件公开读取发现文档及其 OpenAPI/OpenRPC，核对 issuer、resource、接口路径和方法；检查不会创建 PAP 会话或发出业务请求。选择资源后保存到当前 Profile 的加密存储，重启保留。预览有效十分钟，不能添加未检查的资源或覆盖已有连接的身份绑定。

导入仅支持公网 HTTPS 443。发现文档可位于公共商家域名，资源可位于配置明确声明的店铺域名；发现文档必须公布相同的 issuer 和完整 resource 地址，OpenAPI 地址须与导出配置一致，OpenAPI/OpenRPC 契约须与对应 resource 同源。只检查配置声明的资源域名及该域名下发布的其他服务，不扩展到发现文档中其他店铺的域名。DNS 解析拒绝内网/保留地址并在每次请求固定连接 IP，保留 TLS 证书校验，不跟随重定向。本地隔离测试继续通过显式 `targets` 配置。公开 JSON 不接受私钥/Token 字段。

如果已批准访问的域名被本机代理解析为全量 `198.18.0.0/15` Fake-IP，插件会通过 `https://dns.google/resolve` 回查该域名的 A 记录。回查受 HTTPS 证书、超时和响应大小限制；仅使用名称匹配的 IPv4 答案，结果仍须全部通过公网地址检查，随后固定连接 IP 并核验原商家域名证书。直接填写保留 IP、真实内网地址、空答案或混合地址不会触发回查；公共 DNS 失败或返回内网地址仍拒绝请求。此流程不修改系统代理或 DNS，也不扩展已批准访问的域名白名单。受保护配置中的显式 `targets` 仍优先；若为核实后的公网地址配置目标且同时保留隔离栈 `caFile`，需设 `systemCa: true` 使用系统公开 CA，并在 IP 变化后重新核实更新。

同一发现文档可以发布多个资源：咨询与 Commerce 分别添加，分别核验权限。配置的咨询 `allowed_client_ids` 只适用于该声明资源，不推导另一资源的授权。新资源在同 client/issuer 下使用同一稳定随机主体，但 Token、会话、DPoP 和业务流程按资源隔离。

Customer 从导入配置的 `service.store_id` 和 Commerce 实际 capabilities 核对店铺。个人账号使用服务端发布的 `frontvia.personal_purchase.v1`；仅旧主体购买需要配置 `confirmationKeyRef`、`confirmationKid` 并由商家批准 `frontvia.pap_subject_purchase.v1`。只读商品查询不要求购买策略。`mockPayment: true` 仅用于明确配置的 Mock 栈；不能从 `environment: test` 推断是否真实支付。

公开接入不再以旧导出配置中的咨询允许名单作为审批门槛，仍需独立可访问的 CIMD/JWKS、对应签名私钥和匹配回调。不能把 Buyer Lab 的 clientId 填进配置代替自己的签名身份。旧服务端未声明个人购买 profile 时，插件应显示购买未开通；更新客户端不能替代服务端升级。

PAP 增加宿主接口 `inspect(configuration)`、`importResources(previewId, resources)` 和 `clientStatus()`；前两者只通过认证 owner 页面开放，不注册给模型。导入后显示“已发现”，PAP 连接后才可检查业务 capabilities。过期/未授权/未开放的方法均不视为可执行。

每项服务右侧的删除按钮会先要求确认，再从可用列表移除该配置。删除会等待本机在途请求返回，清除该服务的本机会话令牌和未完成授权；不向商家撤销订单或远端授权。连接身份、购物进度、原请求键和订单引用仍保留。导入配置与文件预置配置都支持删除，文件原文不会被改写。页面底部“已移除服务”可在重启后恢复配置，恢复不会自动连接、续用旧令牌或重放购物操作。`removeSite(siteId, revision)` / `restoreSite(siteId, revision)` 只由认证 owner 页面调用，不注册为模型工具；配置已更新时必须刷新并重新确认。

## 准备独立公网客户端

在本机生成一套新的 ES256 客户端身份（工具同时生成仅供旧主体购买使用的独立确认密钥）：

```sh
node scripts/prepare-public-client.mjs .local/my-public-client https://buyer.example.com/dsh/agent.json
```

输出目录必须不存在；重复运行会拒绝覆盖已有密钥。`public/` 仅包含 CIMD、JWKS 和无脚本的授权回调页；`bootstrap-secrets.json` 是仅供宿主导入的私密材料，不能放进静态目录或提交到 Git。工具只生成文件，不发布身份、安装 Profile、登记商家权限或修改现有连接。

客户端签名私钥保留在本机。支持公开接入的商家读取并验证公开身份即可；只有旧主体购买需要额外登记确认密钥。首次启用时使用新的 Profile、数据目录和凭据引用，通过 DSH 凭据服务导入；不要改写已有连接的 clientId，也不要修改导出配置来伪造服务能力。

商家仍控制对外服务的启用、发布和暂停；个人账号接入不会自动发布 Agent。服务端升级和两插件更新需协调进行，协议连接、商品查询、人工确认和支付验收分别记录。完整购买验收使用隔离 Mock 栈；ali 与本地安装的图片/加购验收另见 [个人购物验收](personal-commerce-acceptance.md#ali-与本地安装补充2026-11-04-复核)，不代表真实付款已验证。

## 咨询求助与知识原件

求助原因最多 300 个 UTF-16 单元，与服务端 Support 契约一致。新请求在保存 pending 前
校验；旧请求恢复遇到服务端 `INVALID_PARAMS` 时保留原命令/幂等键回执并结束 pending，
允许用户修正后继续提问。网络结果未知继续沿用原键恢复。

知识原件保留服务端 1 MiB 字节上限；该读取单独设置 Base64 最大长度 1,398,104
加 16 KiB JSON 信封的 transport 预算。普通响应保持 1 MiB，PAP Host 自定义预算硬上限
为 2 MiB。下载仍校验声明大小、实际字节数、规范 Base64 和 SHA256；超限或撤回拒绝。
只有精确来源明确返回 `original.available === true` 才显示下载按钮；未知、非文件或超限
来源仍可阅读。更新时两插件需配套，才能传递此次 Host 内部响应预算。
