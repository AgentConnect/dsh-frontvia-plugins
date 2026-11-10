# DSH PAP + Frontvia Customer

两个独立的本地插件，让官方 **DeepSeek Harness 0.2.2-rc.1** 的 Agent 使用商家发布的 PAP 服务。支持手机号个人账号、导入商家连接 JSON、发现咨询与购物资源、咨询会话与公开知识检索，以及商品、购物车和人工确认购买。购物表单按服务端能力支持 US/USD 与 CN/CNY；人工交付和零元订单沿用各自的服务端契约。此前个人账号免审批购物通过的是隔离 Mock 支付验收，不代表真实渠道验收。

源码未发布 npm 或 Release；不内置收款渠道，也不替服务端实现取消订单和退款；付款入口与结果由商家服务提供，真实渠道仍须单独验收。咨询答复、公开知识与人工求助均由商家服务提供，插件不另建客服系统。安装包仅供本机使用；本地提交不包含推送或发版。

购物卡片现已采用 shadcn/ui 组件结构和 Radix Tabs，适配 DSH 深浅主题、窄屏和表单状态。见 [界面预览、验证记录与最新安装包](docs/ui-refresh.md)。

## 结构与边界

```text
DSH Agent ── 七组 Frontvia 工具 ── CustomerService ── ctx.pap ── 商家咨询 / Commerce
DSH 用户卡片 ── owner 用户操作接口 ───────┘                 └─ PAP/DPoP
                                └─ 本地确认签名 → checkouts.confirm
```

| 包                      | 负责                                                                                                                                        | 不负责                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `dsh-pap`               | 配置检查与导入、PAP 0.2 发现、ES256 Client/Session Assertion、DPoP、稳定主体、续接、PKCE/Direct Sign-In、撤销、按资源和已发布契约约束的请求 | 商品、购物车、付款授权                                  |
| `dsh-frontvia-customer` | 五组购物工具、咨询与知识两组工具、服务卡片、购物进度、原请求核对、人类购买确认                                                              | 直接访问 Medusa、调用远端 Buyer Agent、模型代为确认购买 |

`PAP` 可单独启用，不依赖账号或商城。`Customer` 声明 PAP 与账号插件的 peer 依赖和 Cordis `inject: ['pap', 'identity', ...]`。安装包存在不等于 PAP 服务启用。PAP 停用时，Cordis 自动撤销 Customer 的可执行工具和接口；界面显示依赖未就绪。协议服务 API 版本不兼容时不注册购物工具。

源代码在 `packages/pap/src` 和 `packages/customer/src`；测试栈脚本位于 `scripts`，这些验收脚本不会被打进插件包。运行时只使用商家公开的 Consultation / Commerce JSON-RPC 契约。

协议与业务拆分、兼容和验证范围见 [PAP 独立连接管理](docs/pap-independence.md)。

## 构建与安装

需要 Node **>=24.9.0**、pnpm **10.28.2**、官方 DSH Desktop **0.2.2-rc.1**。三个仓库的本轮交接分支均为 `codex/full-environment-readiness`：Core 在 `AgentConnect/frontvia-core`，本仓库为 `AgentConnect/dsh-frontvia-plugins`，身份服务为 `AgentConnect/pap-server`。身份仓库克隆为同级的 `pap-server` 目录；账号插件的包名仍为 `dsh-identity-client`，它不是本地仓库目录名。

```sh
git clone --branch codex/full-environment-readiness https://github.com/AgentConnect/pap-server.git pap-server
git clone --branch codex/full-environment-readiness https://github.com/AgentConnect/dsh-frontvia-plugins.git dsh-frontvia-plugins
cd pap-server
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
cd ../dsh-frontvia-plugins
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm build
pnpm test
pnpm pack:local
```

先按 [配置说明](docs/configuration.md) 准备当前用户受保护的 `desktop/identity-config.json`，再执行 `node scripts/install-desktop.mjs`。安装会一次校验三个包，再更新 desktop Profile；失败恢复原清单、锁文件与插件。打包前拒绝缺失的构建产物。更新身份客户端源码后必须重新构建身份仓库再打包。

安装不生成身份信任配置。个人凭据只发往受保护配置固定的身份服务；商家链接不能替换它。退出重开 DSH，进入“DSH 账号”登录，然后在 PAP 连接中添加购物和咨询服务。不复制他人的 Profile 或凭据。

包摘要位于 `.local/packages/manifest.json`。隔离安装回归使用现有测试夹具，不修改真实用户 Profile。已通过的历史安装记录见相应验收文档，不能替代本次版本核对。

当前仅接受 0.2.2-rc.1，不申请或设置宿主版本豁免。包使用宿主 React，未打入第二套 React。

## 配置和身份

完整示例见 [配置说明](docs/configuration.md)。如需覆盖默认值，两个宿主插件分别接收 `{ configFile: '/absolute/path.json' }`。配置文件必须属于当前用户、权限为 0600，不能是符号链接。配置只放 DSH 凭据引用；私钥、存储密钥、确认密钥不放在配置或工具参数中。

每个独立 Profile/本机用户使用独立 DSH_HOME、凭据引用和数据目录。连接绑定 site、issuer 和 resource；稳定随机 PAP 主体在该目录内保存。不要把已有身份目录当作新用户模板复制。新主体不按邮箱认领 Buyer Web 用户或旧订单。

PAP 会话、DPoP 私钥、Token、购物进度和原请求以 AES-256-GCM 保存到独立 SQLite；主密钥及客户端/确认签名密钥通过 DSH 凭据服务管理。SQLite 独占租约防止两个宿主进程同时写同一状态目录，进程退出或崩溃后由操作系统释放锁。

## 使用

“Frontvia 服务”的商品详情使用紧凑主图，与商品标题顶部对齐。商家提供多张图片时，可点击下方缩略图切换；仅一张图片时隐藏切换栏。图片保留原比例，加载失败显示占位，其他图片仍可查看。

商品介绍按商家提供的轻量 Markdown 显示标题、列表和表格；HTML 保持为文本，不主动读取外链标题，正文图片仅使用公开图库中已有的 HTTPS 地址。人工交付结账跳过实物地址，核对商品交付约定；最终报价为零的订单仍须本人确认，但不要求选择支付方式，也不发起付款。

对话卡片的商品规格页复用同一图库，主图最大 240px；宽卡片左图右规格，窄卡片上下排列。切图和返回列表只改变展示，不发送智能体命令。历史对话展示当次结果保存的图片。

对话卡片可为每个规格填写加购数量，默认 1 件，上限为已知库存与 100 件中的较小值。点击加购后，可见对话文字和发送给智能体的请求使用同一数量；实际库存由商家在加购时核对。

1. 启动已配置的独立 Profile，打开宿主打印的本机认证地址。
2. 先在“DSH 账号”用手机号登录，再在“PAP 连接 → 添加服务”粘贴商家复制的 PAP 服务链接（也兼容 JSON），检查并选择资源。添加仅保存服务信息；连接成功、业务可用与购买授权分别核验。
3. 新建聊天：“搜索 Travel Mug，选一个可购买规格，加购一件。”
4. 在购物车卡片填写并保存收货资料。这些字段直接提交业务服务，不写入模型工具结果。
5. 对 Agent 说：“读取最新购物车，选最便宜配送，生成报价并准备结算，等我确认。”
6. 核对商品、数量、地址和全部费用，点击“核对完整报价”，再点击“确认购买”。
7. 在订单卡片或让 Agent 查询原操作，核对实际订单和支付状态。支付渠道由所连环境决定；仅在明确使用 Mock 的隔离环境中才是模拟支付。真实支付由用户在支付页面自行确认。

每个聊天、每个商家保留一个购物流程；新一次独立购买可新建聊天。不同聊天的购物车、报价和确认引用不能交叉使用。订单列表按当前 PAP 买方查询。

## 确认与恢复

### 当前购买与咨询

新购买统一使用 Commerce、完整报价展示和 owner 确认。独立 DSH 身份可以向商家助手普通提问、读取公开知识及按用户要求申请人工协助；咨询不产生新的购物授权。旧咨询交易仅保留历史读取与原请求恢复，不能按历史验收记录发起新的咨询购买。

## 验收与本机复现

见 [分项验收报告](docs/acceptance.md) 和 [测试栈操作](docs/native-acceptance.md)。验收区分受控协议测试、真实 Frontvia 服务、受控模型、真实付费模型和宿主 UI。真实模型购物对话最多五轮；重新运行不会自动启用付费模型。

此前界面验收使用官方 DSH 0.2.1-rc.3 宿主 Web UI 和真实 Chrome。没有把 Electron 应用窗口、公开分发、生产服务或真实支付列为已验证。

个人账号购物的当前验收及截图：[docs/personal-commerce-acceptance.md](docs/personal-commerce-acceptance.md)。

PAP 连接页更新与验收：[docs/pap-ui-refresh.md](docs/pap-ui-refresh.md)。

代码审查修复、旧连接升级限制与本轮验证：[docs/review-fixes.md](docs/review-fixes.md)。

### 手机号登录与公开 Agent

默认启用 DSH 独立个人账号登录，账号环境由独立账号插件配置；PAP 的单独使用见 [PAP README](packages/pap/README.md)。
流程为在「DSH 账号」中手机号验证码注册/登录 → 在 PAP 连接中添加商家的购物或公开咨询配置 → 连接 → 使用 Customer
咨询工具；旧 USD 购物另添加 Commerce 资源；CNY 新购买使用独立 Commerce 资源。无需商家审批客户端；公钥、签名、回调、DPoP、服务发布状态仍由
服务端校验。个人凭据只发给受保护配置中的可信服务，不随导入地址变化。

本地验证：`pnpm typecheck && pnpm build && pnpm test`。跨仓库集成使用
Frontvia 的 publication runner 和本仓库 `scripts/personal-live.ts`，先执行
本地 `pnpm pack:local`，再以
`DSH_FRONTVIA_HOME="$PWD/.local/personal-login-baseline/isolated-home" node scripts/harness.mjs --install --setup-only`
准备专用测试 profile。测试脚本会启动并停止这个隔离宿主，使用真实本地
HTTPS/Platform/Agent、预留号码验证码和受控模型；不修改用户默认安装、
不证明真实短信投递，也不发布或部署版本。

### 单条 PAP 服务链接

支持 `https://身份域名/.well-known/poppy.json#resource=编码后的咨询资源URL`。这是 Frontvia 链接导入约定；只添加发现文档中精确匹配且通过对应 OpenAPI 核验的一个服务（咨询或 Commerce），不附带导入其他服务或店铺。链接不含凭据，添加后仍用客户端自己的身份连接。已用 JSON 导入过同一绑定时保留其本地 ID 与身份。旧 JSON 导入流程不变。源码支持不代表本机已安装更新。

### DSH 0.2.2-rc.1

当前依赖、宿主版本声明和本地安装包已对齐 DSH 0.2.2-rc.1 / Cordis 4.1.0；旧宿主与其他未验版本仍由安装器拒绝。新版真实宿主 HTTP 验收、本机安装及界面验证边界见 [升级记录](docs/dsh-022-acceptance.md)。

### 当前商品契约适配

商品页展示参数、类目、品牌、型号、规格属性、交付方式和服务政策；购物车与订单使用保存时的商品快照。人工交付购物车不强制实物地址；零元订单的 `not_required` 显示为无需付款，不能冒充已付款。订单展示人工交付和物流结果。商品/购物车/报价/订单读取采用上限 8 MiB 的响应预算，其余请求保持原上限。

Commerce 单资源链接导入后，首次连接从经过 PAP 身份绑定的 `commerce.capabilities.get` 获取店铺 ID；完整 JSON 或本地配置已有 ID 时仍要求完全一致。持久化流程不随服务端店铺 ID 变化而重绑。操作与交易状态继续逐次读取、检查能力与版本。

服务目录按精确 issuer 与店铺绑定分组；绑定信息不足时保留独立服务入口，不按域名猜测合并。同一家店可以有购物和咨询入口，目录项数不是店铺数量。


独立 DSH 身份可以使用 `frontvia_consultation` 提问、续问、读取答复和按用户要求申请人工协助。Frontvia 对外部身份不签发 Agent 购物授权，插件也不展示新咨询购买能力；新购买只走 Commerce 与 owner 确认。旧身份的咨询创建仍拒绝，历史记录读取不变。咨询权限取自当前 PAP 连接的身份绑定，不接受模型指定身份或授权字段。
