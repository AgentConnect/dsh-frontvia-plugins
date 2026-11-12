# 公共身份与 PAP 0.3 配置

当前构建只包含 `dsh-frontvia-customer`。身份创建/发布、默认身份选择及域名授权使用
公共 Identity，发现、Session 签名与最终请求批准使用公共 DSH PAP。无需独立
Frontvia 身份服务、`identity-config.json`、手工 CIMD/JWKS 或购买签名密钥。

## 依赖与 Host 配置

- DSH Host：`0.2.2-rc.1`（Host 版本，不是 PAP 协议版本）。
- 公共 Identity：`@agent-network-protocol/dsh-anp-identity@0.1.16`。
- 公共 PAP：相邻 `../dsh-pap` 的本地候选，基于正式 `@awiki/dsh-pap@0.1.4`；
  当前业务入口补丁尚未发布。未修改的 npm 0.1.4 不支持 Customer 当前入口。
- Customer：本仓库构建的 `dsh-frontvia-customer`。

公共 PAP 的 Host 配置需启用 `enabled`、`autoConnect`，并将实际安装包
`dsh-frontvia-customer` 加入 `businessConsumers`。安装器提供这项配置；用户 Profile
的显式覆盖仍优先。该列表只允许调用受控业务入口，不授予永久写入/付款权限，
也不绕过公共 Identity 的域名授权、拒绝及一次操作批准。

安装和本地打包命令见 [仓库 README](../README.md)。安装必须显式执行；开发、
构建和打包本身不会修改用户 Profile、发布公共包或部署服务。

## 零商家配置

完成公共身份准备后，在对话中提供店铺域名，例如“去 shop.example.com 看商品”。
公共 `pap_connect({domain})` 或 Customer 连接工具复用同一 PAP 域名发现。
不填写 Agent URL、购物 PAP 链接、issuer、resource 或协议凭据。

商品、购物车、订单和咨询通过已发现的操作调用。没有已发布咨询助手时仍能购物。
更换身份/店铺后，旧引用不能读取新范围，迟到响应不能恢复旧卡片。

Customer 默认在当前 Profile 的 `plugin-data/frontvia/customer` 保存加密业务状态，
沿用原凭据引用，不复制公共 PAP 的数据库、Token 或私钥。通常无需手写配置。
确需隔离验收时，`configFile` 可指向当前用户持有、权限 0600、非符号链接的 JSON，
包含 `dataDir`、`storageKeyRef` 和空的 `sites: []`。存储密钥由 Host 凭据服务管理，
配置文件不包含密钥值。

## 购买与恢复

Customer 展示完整报价，用户从卡片发起购买；公共 PAP 批准并执行这笔实际请求。
`frontvia.pap03_purchase.v1` 是包含报价、金额、期限和幂等标识的业务帧，不是第二份
身份/购买签名。未批准不下单，结果未知继续核对原 operation，不换键重购。

CNY 内嵌支付调用发现的 `commerce.payments.hosted.start`，仅使用原订单付款能力；
跨商家付款链接拒绝。真实渠道仍要求用户完成渠道自身的付款确认。

## 咨询和有界响应

求助原因最多 300 个 UTF-16 单元；新请求在持久化前校验。明确的参数拒绝结束本地
等待，网络未知继续使用原命令和幂等键核对。

知识原件沿用服务端大小、Base64 与 SHA256 校验，只有明确可用的来源显示下载按钮。
公共 PAP 业务 JSON 读取上限为 8 MiB，模型通用工具投影仍为 64 KiB；卡片数据超限
应明确失败，不静默截断，也不另开协议通道。

历史 0.2 配置及手机号私有身份验收记录不适用于当前候选。当前候选已通过真实核心
串联验收；本说明不代表已安装到用户 Profile 或部署。

美国店铺的人工交付订单仍需要联系邮箱，卡片提供独立邮箱表单，不要求收货地址；中国大陆人工交付沿用现有联系要求。邮箱经 Owner UI 保存，不交给模型填写。

身份测试默认 `https://awiki.me`，通过 `python3 tests/support/read-awiki-me-auth.py` 只读当前部署的测试手机号/OTP 配置。值仅保存在被 Git 忽略的受保护文件，真实身份注册、公钥发布及回读使用线上服务；专用身份的本地密钥与必要注册恢复材料保留以便复用，不修改线上服务配置。
