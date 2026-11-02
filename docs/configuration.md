# 配置说明

先准备已登记的 PAP HTTPS 客户端：公开 CIMD、与私钥匹配的 ES256 JWKS、预登记回调地址，以及 Frontvia 管理侧单独批准的主体购买策略/确认密钥。插件不会启动公开注册服务或按邮箱绑定现有买方。

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
  "targets": [{"origin":"https://shop.example.test","address":"127.0.0.1","port":443}],
  "sites": [{
    "id":"test-shop", "label":"Test Shop", "domain":"shop.example.test",
    "issuer":"https://shop.example.test/companies/a",
    "resource":"https://shop.example.test/companies/a/commerce/v1/stores/store-a/rpc"
  }]
}
```

`targets.origin` 必须采用 URL 的规范 origin（HTTPS 默认 443 时写 `https://shop.example.test`，不要保留 `:443`）。`address` 必须是明确批准的 IPv4/IPv6 地址；`port` 匹配 URL 端口；测试隧道可单独配置 `connectPort`。不跟随重定向，启用 TLS 证书检查、响应大小及超时上限。生产 CA 可省略 `caFile`，但本轮没有生产验证。

Customer 配置（0600）：

```json
{
  "dataDir":"/private/profile-frontvia/customer",
  "storageKeyRef":"DSH_CUSTOMER_STORAGE_KEY",
  "sites":[{
    "siteId":"test-shop", "storeId":"store-a",
    "confirmationKeyRef":"DSH_CUSTOMER_CONFIRM_KEY", "confirmationKid":"approved-test-key"
  }]
}
```

`signingKeyRef` 对应 ES256 PKCS8 PEM；两个 `storageKeyRef` 和 `confirmationKeyRef` 对应独立的 32 字节 base64url 密钥。确认密钥须与批准客户端策略一致。首次导入通过宿主凭据服务或受保护启动环境完成，插件将解析后的密钥保存到 DSH 凭据存储。不要把密钥放到命令行、聊天或 Git。

Profile patch 使用 rc.3 的按 ID 配置语法：

```yaml
- id: dsh-pap
  config:
    configFile: /private/profile-frontvia/pap.json
- id: dsh-frontvia-customer
  config:
    configFile: /private/profile-frontvia/customer.json
```

两个 bundle 必须已经安装并启用；patch 不能替代安装。用 `scripts/run-configured.mjs` 生成的验收 Profile 只提供五组购物工具，关闭通用 shell、文件、委派和插件管理工具，避免模型读取本机密钥文件。宿主、其他本地插件和当前 OS 用户属于受信任边界。

`ctx.pap` API v1：`sites()`、`discover(siteId)`、`connect(siteId)`、`status(connectionRef?)`、`authorize(connectionRef, scopes)`、`callback(connectionRef, url)`、`disconnect(connectionRef)`、`request(connectionRef, method, params, signal?)`。`identity` 为宿主消费方进行确认绑定使用，不得转发到模型。连接引用不含秘密。

账号授权页可创建 PKCE 链接，再粘贴预登记地址上的回调 URL；回调的 issuer、state、origin、path、有效期和一次性消费均校验。当前没有自动浏览器回调监听器；首版主体购物无需账号授权。
