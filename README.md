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

在本机克隆仓库，进入仓库根目录。需要 Node **>=24.9.0**、pnpm **10.28.2** 和已启动过一次的 DSH Desktop **0.2.2-rc.1**。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm install:desktop
```

安装命令先校验两个包，再通过桌面 CLI 一次更新当前 `desktop` Profile。安装或校验失败时恢复原清单、锁文件与插件。Windows 上使用 DSH Desktop 安装的 `dsh.cmd`；自定义安装路径可通过 `DSH_DESKTOP_CLI` 指定。重新打开 DSH，进入 **DSH 账号**，通过已配置的独立身份服务完成手机号验证码登录。身份服务地址由受保护的 Profile 配置固定；商家链接不能替换该地址。随后在 PAP 连接中添加商家服务并授权，客户端为各资源管理自己的连接与证明密钥。详见 [配置说明](docs/configuration.md)。

开发验收可使用独立测试 Profile：

```sh
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

当前仅接受 0.2.2-rc.1，不申请或设置宿主版本豁免。包使用宿主 React，未打入第二套 React。

## 配置和身份

完整示例见 [配置说明](docs/configuration.md)。如需覆盖默认值，两个宿主插件分别接收 `{ configFile: '/absolute/path.json' }`。配置文件必须属于当前用户、权限为 0600，不能是符号链接。配置只放 DSH 凭据引用；私钥、存储密钥、确认密钥不放在配置或工具参数中。

每个独立 Profile/本机用户使用独立 DSH_HOME、凭据引用和数据目录。连接绑定 site、issuer 和 resource；稳定随机 PAP 主体在该目录内保存。不要把已有身份目录当作新用户模板复制。新主体不按邮箱认领 Buyer Web 用户或旧订单。

PAP 会话、DPoP 私钥、Token、购物进度和原请求以 AES-256-GCM 保存到独立 SQLite；主密钥及客户端/确认签名密钥通过 DSH 凭据服务管理。SQLite 独占租约防止两个宿主进程同时写同一状态目录，进程退出或崩溃后由操作系统释放锁。

## 使用

“Frontvia 服务”的商品详情使用紧凑主图，与商品标题顶部对齐。商家提供多张图片时，可点击下方缩略图切换；仅一张图片时隐藏切换栏。图片保留原比例，加载失败显示占位，其他图片仍可查看。

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

### 人民币对话购物

当商家咨询 capabilities 明确返回 `frontvia.conversation_purchase.v1`、CN/CNY、
`owner_message` 和 `hosted_alipay` 时，插件使用当前咨询连接备单；无需添加另一套登录或客户端审批。
旧 USD/US Commerce 购物流程保持原契约，不能仅修改币种后复用其确认凭证。

1. 在对话中说明商品、数量和中国大陆收货信息，由商家 Agent 返回真实报价。
2. 购物卡片展示完整商品/规格、地址、配送和费用，勾选核对后点击“确认购买”。
3. 插件重新核对服务端摘要与会话版本，只通过 owner 界面发送原确认消息；模型无法代确认。
4. 点击“去支付宝付款”在独立浏览器核对收款方并完成支付。返回时只读查询原结算单；打开付款页不代表成功。
5. 网络结果未知时先“核对原请求”；重启、重复点击、刷新和返回付款页均不产生新购买。

该能力需要配套 Frontvia 服务端的结构化 shopping 响应及已配置的 CN/CNY 支付环境。
确认码、付款访问链接和完整结构化收货摘要不进入模型工具结果。完整界面数据仍存于现有加密状态库。
验证范围与复现见 [CNY 接入验收](docs/cny-integration.md)。

- 模型可用 `frontvia_connection`、`frontvia_products`、`frontvia_cart`、`frontvia_checkout`、`frontvia_orders`、`frontvia_consultation` 和 `frontvia_knowledge`，没有确认购买或付款工具。咨询的 `answer_accept` 只是领取商家准备好的答复，不是购买授权。
- 旧 USD 流程中，“确认”文本不产生授权；只有认证 owner 界面接口可签发短效购买凭证。接口拒绝客户端传入金额、身份、Token、确认签名或幂等键。
- 点击时再次读取 Cart、Quote、Checkout，核对买方、商家、原报价摘要、版本与完整金额，绑定原幂等键和 nonce。个人账号使用 `frontvia.personal_purchase.v1`，由当前 PAP 连接的 DPoP 密钥签署 ES256 凭证；旧主体购买保留 `frontvia.pap_subject_purchase.v1` 和独立 HMAC 策略。这两者均为 Frontvia 业务扩展。
- 已有购物车写入及报价要求显式 `expected_version`。缺失/过期时返回错误并要求重新读取，插件不补版本自动重试。
- 写请求在发出前持久化。结果未知时保留原键，后续操作受阻，先 `orders recover` 查询原 Operation；不换键重新购买。
- `checkout revise` 仅用于用户修改方案或报价失效：撤销**未确认、零授权/零扣款**的草稿结算，保留购物车和收货输入，清除旧报价及旧确认。已提交确认、已付订单、结果未知均不能走此路径。这不是取消订单或退款功能。
- DSH 重启不会自动确认、重放购买或创建订单。历史卡片重新打开时查询服务器当前结果。
- 个人账号购买要求服务端 Schema52 及对应 capabilities，不需要商家逐客户端审批或本机 HMAC 确认密钥。游客不能继承此购买能力；旧 signed-out 主体购买仍要求原有批准策略。

商家咨询使用独立流程，支持提问、按版本续问、读取会话、请求人工协助和领取答复；知识工具支持检索、读取来源和核验访问状态。原文件仅通过用户卡片下载，模型不会收到文件 base64。咨询与 Commerce 同 issuer 下复用稳定买方主体，分别持有资源令牌和 DPoP 密钥，不能混用流程。咨询回执丢失后显式恢复原请求及原幂等键；重启不自动发送问题或购买。

购物能力展示元数据最多缓存 120 秒（咨询仍为 30 秒），按当前账号、商家资源与连接版本隔离；写入、恢复和购买确认强制重新读取，实际业务与知识访问仍由服务端即时校验。未开放/未核验的方法拒绝执行；没有购买能力时仍允许商家开放的商品只读接口。导入公开配置不会生成客户端私钥或自动登录个人账号。公开接入仍校验 CIMD/JWKS、匹配签名、回调和服务状态。配置中的 `service: ready` 不表示当前 DSH 客户端已验证。具体接入条件见配置说明，连接复用、缓存边界和本轮验证见 [性能优化](docs/performance.md)。

## 验收与本机复现

见 [分项验收报告](docs/acceptance.md) 和 [测试栈操作](docs/native-acceptance.md)。验收区分受控协议测试、真实 Frontvia 服务、受控模型、真实付费模型和宿主 UI。真实模型购物对话最多五轮；重新运行不会自动启用付费模型。

此前界面验收使用官方 DSH 0.2.1-rc.3 宿主 Web UI 和真实 Chrome。没有把 Electron 应用窗口、公开分发、生产服务或真实支付列为已验证。

个人账号购物的当前验收及截图：[docs/personal-commerce-acceptance.md](docs/personal-commerce-acceptance.md)。

PAP 连接页更新与验收：[docs/pap-ui-refresh.md](docs/pap-ui-refresh.md)。

代码审查修复、旧连接升级限制与本轮验证：[docs/review-fixes.md](docs/review-fixes.md)。

### 手机号登录与公开 Agent

默认启用 DSH 独立个人账号登录，账号环境由独立账号插件配置；PAP 的单独使用见 [PAP README](packages/pap/README.md)。
流程为在「DSH 账号」中手机号验证码注册/登录 → 在 PAP 连接中添加商家的购物或公开咨询配置 → 连接 → 使用 Customer
咨询工具；旧 USD 购物另添加 Commerce 资源；声明支持的 CNY 购物直接使用咨询连接。无需商家审批客户端；公钥、签名、回调、DPoP、服务发布状态仍由
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
