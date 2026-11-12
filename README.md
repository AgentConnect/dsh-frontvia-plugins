# DSH Frontvia Customer

Frontvia 业务插件：商品、购物车、地址、报价、订单和咨询卡片。PAP 只使用 0.3；身份和协议由公共基础插件负责。

| 组件 | 来源与职责 |
| --- | --- |
| 公共 Identity | `@agent-network-protocol/dsh-anp-identity@0.1.16`；身份创建/发布、私钥和授权 |
| 公共 PAP | `@awiki/dsh-pap`；发现、Session、请求签名和一次操作批准 |
| Customer | 本仓库 `packages/customer`；业务工具、卡片、报价核对及原 operation 恢复 |

原 Frontvia 专属 Client/PAP 已退出当前构建。本地公共 PAP 候选基于 `0.1.4` 增加受限业务入口，尚未发布，不能用未修改的 npm `0.1.4` 冒充本候选。

## 使用

1. 安装后先完成下方 Host 接入配置，再在 DSH「设置 → 身份管理」创建／发布公共身份并保存默认身份。
2. 在对话中说“去 `shop.example.com` 看一下商品”。不需要预配置商家、Agent URL 或 PAP 服务链接。
3. Customer 复用公共 PAP 发现的购物和咨询 API。无咨询助手时，购物能力仍可独立使用。
4. 卡片显示完整报价，购买按钮发起公共 PAP 的最终批准。未批准不下单，未知结果只核对原 operation，不重发购买。

购物、订单、付款状态以服务端事实为准；真实付款渠道仍需用户完成渠道要求的确认。

## 本地开发

使用独立工作目录。公共 PAP 本地候选位于相邻 `../dsh-pap`，不修改公共身份插件的实现。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm build
pnpm pack:local
```

`pack:local` 仅产生本机安装候选：Customer 与公共 PAP 的内容寻址包。Identity 使用锁定的正式版本。未执行安装或 npm 发布。

安装候选必须与 DSH `0.2.2-rc.1` 匹配。显式运行 `scripts/install-desktop.mjs` 才会更新 desktop Profile；旧 Frontvia 包的替换使用 `--replace-legacy-frontvia`，只处理安装器原先放入 `.local-packages/frontvia` 的旧包，不删除身份、凭据或业务状态。安装器会把公共 Identity/PAP 的 bundle 放在 Customer 之前，修复旧版升级时保留错误顺序造成的后台启动失败；其他插件的选择和相对顺序保持不变。用户 Profile 自己的覆盖配置保持优先；公共 PAP 的自定义配置需保留 `businessConsumers: ['dsh-frontvia-customer']`。

隔离 Host 可以通过原有 `scripts/harness.mjs` 加载候选；验收不得使用用户默认 Profile。普通验证不产生额外日志归档。

### 一次性 Host 接入配置

安装器不会代替所有者授予身份使用权限。所有者同意使用 PAP 后，在 desktop Profile 的 `cordis.patch.yml` 合并以下配置；已有消费者须保留。只增加实际安装的 PAP 适配器，不授予 Provider／私钥导出权限。

```yaml
- id: anp-identity
  name: '@agent-network-protocol/dsh-anp-identity'
  config:
    allowConsumers: ['@awiki/dsh-plugin', '@agent-network-protocol/dsh-anp-identity/protocol-bootstrap', '@awiki/dsh-pap/plugin']
    userConsumers: ['@agent-network-protocol/dsh-anp-identity/protocol-bootstrap', '@awiki/dsh-pap/plugin']
    domainAccess:
      enabled: true
      scopes: []
      secretStore: keyring
```

完整退出并重开 DSH 后，在「设置 → 协议管理」核对读取策略及“写入：每次确认”。首次提供店铺域名才建立具体连接；公开身份已发布不等于远端店铺已连接。设置中的 `Host 尚未开启全局域名接入` 说明缺少本段配置，反复创建身份不能解决。

## 迁移状态

公共身份、域名发现、Claude Code/DeepSeek 实际浏览、Core/Medusa 购物与公共一次批准、同域实际咨询的 focused 核心串联已通过。Customer 168 项与公共 PAP 147 项单测通过；这些结果不代表完整浏览器、真实支付渠道或跨平台验收。当前源码和候选配置的旧入口清理已完成；共享环境未切换，尚未部署或发布。当前进度见 Frontvia Core 的 `docs/plan/platform/pap03-shared-identity-domain-discovery-plan.md`。

`docs/` 中此前的 0.2、手机号私有身份、三插件安装及测试记录属于历史交付，不能作为当前候选的安装或验收说明。


核心串联由 Core 拥有：`python3 platform/tests/pap03/commerce.py`，需先准备当前 Native/Platform 构建，先执行 `python3 tests/support/read-awiki-me-auth.py` 配置受保护的线上测试预设，并在任务环境提供 `DEEPSEEK_API_KEY`。它使用已部署的 awiki.me User Service、正式 Identity 0.1.16/Native 0.2.6 和当前本地 PAP 候选；业务数据库、角色、TLS 和 Claude 状态独立，不操作用户默认 Profile。

MCP 测试投影仅描述工具的根对象参数；实际 Customer 仍执行完整 action 参数校验。模型只获得两个商家工具，购入批准由测试操作者走公共 PAP 的一次决定。身份通过 awiki.me 注册/发布并复用专用测试身份，Native 使用 Mock 支付；不将这些测试条件写成实际渠道或公共部署已通过。

## 分开的测试入口

- 协议和对外接口系统测试：Core `platform/tests/system/pap03/run.py`；说明见该目录 README。
- 实际 DSH Web / Chromium E2E：本仓库 `pnpm test:e2e:dsh`，说明见 [DSH E2E](tests/e2e/dsh/README.md)。覆盖域名浏览、卡片恢复、规格加购、邮箱、公共批准、原订单和实际咨询；工作台配置本轮不纳入。

两类测试使用隔离资源；公共 PAP 的组件检查与真实 HTTP 系统用例分开计数。测试使用正式公共 Identity、本地 PAP 候选和 Native Mock；身份统一连接既有 awiki.me User Service，没有新部署 User Service 或对外 DSH 站点。

咨询读取失败会区分本机插件未启动、身份／授权、历史卡片和商家读取失败，提供只读重试、插件页或设置步骤，并在折叠技术信息中保留安全错误码。不自动重发购买／付款，不自动将旧手机号记录绑定到新公共身份。
