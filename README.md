# DSH PAP + Frontvia Customer

两个独立的本地插件，让官方 **DeepSeek Harness 0.2.1-rc.3** 的 Agent 直接调用 Frontvia PAP Commerce API。用户在原生聊天卡片里填写收货资料、核对费用、点击确认购买。当前为独立登记客户端、US/USD、Mock 支付的本机验证版本。

源码未发布 npm 或 Release；不包含真实收款、生产部署、取消订单、退款、政策咨询或人工客服。安装包仅供本机使用；本地提交不包含推送或发版。

购物卡片现已采用 shadcn/ui 组件结构和 Radix Tabs，适配 DSH 深浅主题、窄屏和表单状态。见 [界面预览、验证记录与最新安装包](docs/ui-refresh.md)。

## 结构与边界

```text
DSH Agent ── 五组 Frontvia 工具 ── CustomerService ── ctx.pap ── Frontvia Commerce
DSH 用户卡片 ── owner 用户操作接口 ───────┘                 └─ PAP/DPoP
                                └─ 本地确认签名 → checkouts.confirm
```

| 包 | 负责 | 不负责 |
| --- | --- | --- |
| `dsh-pap` | PAP 0.2 发现、ES256 Client/Session Assertion、DPoP、稳定主体、续接、PKCE/Direct Sign-In、撤销、受配置资源约束的请求 | 商品、购物车、付款授权 |
| `dsh-frontvia-customer` | 五组购物工具、四类卡片、购物进度、原操作查询、人类确认 | 直接访问 Medusa、调用远端 Buyer Agent、模型代为确认 |

`Customer` 同时声明 npm peer 依赖和 Cordis `inject: ['pap', ...]`。安装包存在不等于 PAP 服务启用。PAP 停用时，Cordis 自动撤销 Customer 的可执行工具和接口；界面显示依赖未就绪。协议服务 API 版本不兼容时不注册购物工具。

源代码在 `packages/pap/src` 和 `packages/customer/src`；测试栈脚本位于 `scripts`，这些验收脚本不会被打进插件包。运行时只使用公开 Commerce JSON-RPC 契约。

## 构建与安装

需要 Node **>=24.9.0**、pnpm **10.28.2**。本机验收使用 Node 25.2.1；系统默认 Node 22 不符合宿主要求。

```sh
cd /Users/howard/workspace/dsh-frontvia-plugins
export PATH=/opt/homebrew/bin:$PATH
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm pack:local
node scripts/harness.mjs --install --setup-only
```

安装至独立 `.local/dsh-home`，Profile 为 `frontvia`，不修改现有 DSH 默认 Profile。脚本逐个安装两个 bundle，并比较安装后的 `index.js`、`core.js` 和 `client.js` 与构建产物。包文件名带 SHA-256 前缀，避免 pnpm 缓存旧的同版本 tarball。

安装包及完整 SHA-256 在 `.local/packages/manifest.json`。也可通过官方 CLI 分别安装：

```sh
# 在目标独立 DSH_HOME 下执行，文件名以 manifest.json 为准。
node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile frontvia add /absolute/path/dsh-pap-0.1.0-HASH.tgz
node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile frontvia add /absolute/path/dsh-frontvia-customer-0.1.0-HASH.tgz
```

仅接受 rc.3，不申请或设置宿主版本豁免。包使用宿主 React，未打入第二套 React。

## 配置和身份

完整示例见 [配置说明](docs/configuration.md)。两个宿主插件分别接收 `{ configFile: '/absolute/path.json' }`。配置文件必须属于当前用户、权限为 0600，不能是符号链接。配置只放 DSH 凭据引用；私钥、存储密钥、确认密钥不放在配置或工具参数中。

每个独立 Profile/本机用户使用独立 DSH_HOME、凭据引用和数据目录。连接绑定 site、issuer 和 resource；稳定随机 PAP 主体在该目录内保存。不要把已有身份目录当作新用户模板复制。新主体不按邮箱认领 Buyer Web 用户或旧订单。

PAP 会话、DPoP 私钥、Token、购物进度和原请求以 AES-256-GCM 保存到独立 SQLite；主密钥及客户端/确认签名密钥通过 DSH 凭据服务管理。SQLite 独占租约防止两个宿主进程同时写同一状态目录，进程退出或崩溃后由操作系统释放锁。

## 使用

1. 启动已配置的独立 Profile，打开宿主打印的本机认证地址。
2. 在“PAP 连接”确认测试商家已连接。
3. 新建聊天：“搜索 Travel Mug，选一个可购买规格，加购一件。”
4. 在购物车卡片填写并保存收货资料。这些字段直接提交业务服务，不写入模型工具结果。
5. 对 Agent 说：“读取最新购物车，选最便宜配送，生成报价并准备结算，等我确认。”
6. 核对商品、数量、地址和全部费用，点击“核对完整报价”，再点击“确认购买”。
7. 在订单卡片或让 Agent 查询原操作，核对实际订单和支付状态。此测试环境全部是 Mock 支付。

每个聊天、每个商家保留一个购物流程；新一次独立购买可新建聊天。不同聊天的购物车、报价和确认引用不能交叉使用。订单列表按当前 PAP 买方查询。

## 确认与恢复

- 模型仅有 `frontvia_connection`、`frontvia_products`、`frontvia_cart`、`frontvia_checkout`、`frontvia_orders`，没有确认或付款工具。
- “确认”文本不产生授权；只有认证 owner 界面接口可签发短效购买凭证。接口拒绝客户端传入金额、身份、Token、确认签名或幂等键。
- 点击时再次读取 Cart、Quote、Checkout，核对买方、商家、原报价摘要、版本与完整金额，绑定原幂等键和 nonce。此为 Frontvia `frontvia.pap_subject_purchase.v1` 扩展，不是 PAP 标准支付能力。
- 已有购物车写入及报价要求显式 `expected_version`。缺失/过期时返回错误并要求重新读取，插件不补版本自动重试。
- 写请求在发出前持久化。结果未知时保留原键，后续操作受阻，先 `orders recover` 查询原 Operation；不换键重新购买。
- `checkout revise` 仅用于用户修改方案或报价失效：撤销**未确认、零授权/零扣款**的草稿结算，保留购物车和收货输入，清除旧报价及旧确认。已提交确认、已付订单、结果未知均不能走此路径。这不是取消订单或退款功能。
- DSH 重启不会自动确认、重放购买或创建订单。历史卡片重新打开时查询服务器当前结果。
- PAP 的账号授权/PKCE 是独立通用能力；本版本 Frontvia 购买仅支持已批准的 signed-out PAP 主体。

## 验收与本机复现

见 [分项验收报告](docs/acceptance.md) 和 [测试栈操作](docs/native-acceptance.md)。验收区分受控协议测试、真实 Frontvia 服务、受控模型、真实付费模型和宿主 UI。真实模型购物对话最多五轮；重新运行不会自动启用付费模型。

运行环境使用官方 DSH rc.3 宿主 Web UI 和真实 Chrome。没有把 Electron 应用窗口、公开分发、生产服务或真实支付列为已验证。

PAP 连接页更新与验收：[docs/pap-ui-refresh.md](docs/pap-ui-refresh.md)。
