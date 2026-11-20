# DSH Frontvia Customer

Frontvia 业务插件支持商品、购物车、地址、报价、订单和咨询卡片。身份和协议由公共基础插件负责，UCP 购物通过 PAP 1.0 发现和调用。

| 组件 | 来源与职责 |
| --- | --- |
| 公共 Identity | `@agent-network-protocol/dsh-anp-identity@0.1.18`；身份创建/发布、私钥和授权 |
| 公共 PAP | `@awiki/dsh-pap`；发现、Session、请求签名和一次操作批准 |
| Customer | 本仓库 `packages/customer`；业务工具、卡片、报价核对及原 operation 恢复 |

本分支要求 PAP 0.2.2 的订单 PDF 下载和 Fulfillment 父能力协商。锁文件暂时使用 PAP #5 的固定 Git 提交，并从 npm 安装 Identity 0.1.18。提交和 PR 记录在 `dependencies.source.json`。

## 安装与更新

在独立工作目录检出本分支，使用 Node.js 24.9 或更高版本和 pnpm 10.28.2。按下方本地开发步骤打包。隔离验收使用测试 Host；如需更新本机 desktop Profile，完全退出桌面版后运行 `pnpm install:desktop`。

已有 Profile 须按 Identity、PAP、Customer 顺序加载；启用 PAP 的 `enabled`、`autoConnect`，保留 `businessConsumers: ['dsh-frontvia-customer']`。Mac 上在 Identity 的 `domainAccess` 中显式设置 `secretStore: local-file`；PAP 默认 Secret Service 后端仅支持 Linux，不自动降级。Identity 自身的密钥后端无需修改。用户 Host 覆盖配置仍优先。

## 使用

1. 安装后先完成下方 Host 接入配置，再在 DSH「设置 → 身份管理」创建／发布公共身份并保存默认身份。
2. 在对话中说“去 `shop.example.com` 看一下商品”。不需要预配置商家、Agent URL 或 PAP 服务链接。
3. Customer 复用公共 PAP 发现的购物和咨询 API。无咨询助手时，购物能力仍可独立使用。
4. 卡片显示完整报价，购买按钮发起公共 PAP 的最终批准。未批准不下单，未知结果只核对原 operation，不重发购买。

购物、订单、付款状态以服务端事实为准。UCP 订单只从 Frontvia 的明确付款状态消息读取状态，不把结算完成或缺失状态视为已付款。真实付款渠道仍需用户完成渠道要求的确认。

## 本地开发

锁文件可以在独立检出中安装两个依赖。

```sh
unset FRONTVIA_PAP_TEST_PACKAGE_ROOT FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

`pack:local` 生成本机安装候选，并记录所选 PAP 版本和包的 SHA-256。打包与桌面安装器均核对 PAP 版本、Store Context、Order History 和订单 PDF 能力。

源码候选支持 DSH `0.2.2-rc.1` 和 `0.2.2-rc.3`。打包默认针对 `rc.1`。为 `rc.3` 打包时，设置 `FRONTVIA_DSH_RUNTIME=0.2.2-rc.3`，并通过 `FRONTVIA_PAP_TEST_PACKAGE_ROOT` 和 `FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT` 选用已构建且声明兼容 `rc.3` 的公共插件候选。打包会检查三个包的目标版本，安装器会核对候选清单与桌面 CLI 版本。

显式运行 `scripts/install-desktop.mjs` 才会更新 desktop Profile；旧 Frontvia 包的替换使用 `--replace-legacy-frontvia`，只处理安装器原先放入 `.local-packages/frontvia` 的旧包。安装器会把公共 Identity/PAP 的 bundle 放在 Customer 之前，修复旧版升级时保留错误顺序造成的后台启动失败；其他插件的选择和相对顺序保持不变。用户 Profile 自己的覆盖配置保持优先；公共 PAP 的自定义配置需保留 `businessConsumers: ['dsh-frontvia-customer']`。

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
      secretStore: local-file
```

公共 PAP 的 `keyring` 后端只支持 Linux Secret Service。Mac 显式选择上面的 `local-file`，使用与状态目录分离、仅当前用户可读的受保护目录保存 PAP 状态加密密钥；公共身份私钥仍由 Identity Provider 保管。Linux 已配置 Secret Service 时可显式改为 `keyring`。不做静默存储降级；`PAP_CREDENTIAL_UNAVAILABLE` 也可能来自不支持的存储后端，不代表需要重新注册身份。

完整退出并重开 DSH 后，在「设置 → 协议管理」核对读取策略及“写入：每次确认”。首次提供店铺域名才建立具体连接；完整重启后可在原对话再次连接同一域名，公共 PAP 会先恢复本地状态，Customer 再核对聊天所属身份。同一身份保留原流程；更换身份须新建聊天。主动断开的连接须由用户在「设置 → PAP 连接」重新连接。设置中的 `Host 尚未开启全局域名接入` 说明缺少本段配置。

## 迁移状态

公共身份、域名发现、Claude Code/DeepSeek 实际浏览、Core/Medusa 购物与公共一次批准、同域实际咨询的 focused 核心串联已通过。Customer 168 项与公共 PAP 147 项单测通过；这些结果不代表完整浏览器、真实支付渠道或跨平台验收。当前源码和候选配置的旧入口清理已完成；npm 版本为 Customer 0.2.0，发布验证使用公共 PAP 0.2.0 与 Identity 0.1.18，发布不自动切换共享环境或部署服务。当前进度见 Frontvia Core 的 `docs/plan/platform/pap03-shared-identity-domain-discovery-plan.md`。

`docs/` 中此前的 0.2、手机号私有身份、三插件安装及测试记录属于历史交付，不能作为当前候选的安装或验收说明。


核心串联由 Core 拥有：`python3 platform/tests/pap03/commerce.py`，需先准备当前 Native/Platform 构建，先执行 `python3 tests/support/read-awiki-me-auth.py` 配置受保护的线上测试预设，并在任务环境提供 `DEEPSEEK_API_KEY`。它使用已部署的 awiki.me User Service、正式 Identity 0.1.18/Native 0.2.6 和当前正式 PAP 包；业务数据库、角色、TLS 和 Claude 状态独立，不操作用户默认 Profile。

MCP 测试投影仅描述工具的根对象参数；实际 Customer 仍执行完整 action 参数校验。模型只获得两个商家工具，购入批准由测试操作者走公共 PAP 的一次决定。身份通过 awiki.me 注册/发布并复用专用测试身份，Native 使用 Mock 支付；不将这些测试条件写成实际渠道或公共部署已通过。

## 分开的测试入口

- 协议和对外接口系统测试：Core `platform/tests/system/pap03/run.py`；说明见该目录 README。
- 实际 DSH Web / Chromium E2E：本仓库 `pnpm test:e2e:dsh`，说明见 [DSH E2E](tests/e2e/dsh/README.md)。覆盖域名浏览、卡片恢复、规格加购、邮箱、公共批准、原订单和实际咨询；工作台配置本轮不纳入。

两类测试使用隔离资源。公共 PAP 的组件检查与真实 HTTP 系统用例分开计数。测试使用 Native Mock 和现有 awiki.me User Service。

## 系统测试的公共包来源

在独立检出中核对实际加载的依赖来源和打包清单：

```sh
unset FRONTVIA_PAP_TEST_PACKAGE_ROOT FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT
pnpm install --frozen-lockfile
node tests/support/public-pap.mjs
pnpm check
pnpm pack:local
node --import tsx scripts/pap10-core-check.mjs --preflight
```

PAP 0.2.2 上架 npm 后，从此分支运行以下命令，把两个开发依赖切回公开包并生成 registry 锁文件。删除临时的 `dependencies.source.json` 与 `pnpm-workspace.yaml` 中仅供 PAP Git 构建使用的 `onlyBuiltDependencies` 项。在新的检出中重复上方命令，确认 PAP 的 `source` 为 `registry`，再验收已购 PDF 摘要、全额退款撤权及 Fulfillment 协商。

```sh
npm pkg set 'devDependencies.@awiki/dsh-pap=0.2.2'
(cd packages/customer && npm pkg set 'devDependencies.@awiki/dsh-pap=0.2.2')
pnpm install --lockfile-only
```

设置 `FRONTVIA_IDENTITY_TEST_AUTH_FILE` 指向已有的 0600 awiki.me 测试输入，将 `FRONTVIA_IDENTITY_TEST_STATE` 指向任务专用受保护工作状态。Core 的 `platform/tests/pap03/commerce.py --suite pap10` 和 `--suite ucp` 复用这两个候选包。产品用例使用 `python3 tests/e2e/dsh/run.py --ucp`，需继承 `DEEPSEEK_API_KEY`。构建和临时 profile 都在候选或测试工作目录内。

旧 `docs/specs/`、`docs/implementation/`、`task_plan.md` 和 `progress.md` 的专用身份／PAP 0.2 内容只供历史追溯，不是当前安装或执行入口。现有身份、密钥、购物记录与结果未知交易不随源码清理删除。

咨询读取失败会区分本机插件未启动、身份／授权、历史卡片和商家读取失败，提供只读重试、插件页或设置步骤，并在折叠技术信息中保留安全错误码。不自动重发购买／付款，不自动将旧手机号记录绑定到新公共身份。
