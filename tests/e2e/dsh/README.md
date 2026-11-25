# DSH Web 端到端测试

本目录只放 DSH 产品 E2E；PAP / Frontvia 系统测试在 `frontvia-core/platform/tests/system/pap03/`。未来工作台配置 E2E 使用独立子目录，本轮不加入。

```bash
python3 tests/support/read-awiki-me-auth.py  # 只读 awiki.me 测试预设，不打印值
# DEEPSEEK_API_KEY 从受保护环境继承。
python3 tests/e2e/dsh/run.py
```

需要 Node 24、当前 Customer 安装包、锁定的 PAP / Identity 包、Core Web 的 Playwright/Chromium 及专用店。涉及售后写入时，选用支持 Operations v3 的 PAP 候选。使用实际 `dsh --profile frontvia-e2e` Web 进程和浏览器，测试 profile、业务状态和会话与用户默认 DSH 配置隔离。专用 awiki.me 测试身份的加密状态和必要注册恢复材料保留，以便跨轮复用。

测试专用网络插件只负责测试 HTTPS 域名映射和测试 CA，保留真实 PAP 传输及证书校验。Identity 使用正式实现，测试身份通过已部署的 `https://awiki.me` 注册/发布，CIMD/JWKS 从公网实际读取。预置身份是测试前置，不能声称 DSH 界面注册/邮件投递已验收。

用例从可见界面启动会话，使用实际 DSH Agent、DeepSeek、公共 PAP 和 Customer 查询商家并显示卡片；继续验证刷新、规格数量、加购、联系邮箱、报价、公共一次批准弹窗、原订单和同域咨询。禁止用直接调用 Customer 内存方法、伪造 owner 连接或 Claude/MCP 代替 DSH 产品用例。失败输出固定错误与必要诊断，临时进程和运行输入随拥有环境清理；专用身份及受保护的 OTP 输入按上述边界保留。当前为 Linux Chromium Web 验收，不代表 Electron/macOS/Windows 全平台通过。

浏览器依赖提前检查；需要补齐时，在 Core `web/` 使用 `PLAYWRIGHT_SKIP_BROWSER_GC=1 node node_modules/playwright-core/cli.js install chromium`，保留其他项目已有浏览器。入口会重建本地插件包和当前 Platform，不使用上轮旧制品。

在运行前执行 `python3 tests/e2e/dsh/test_run.py` 和 `python3 tests/e2e/dsh/run.py --preflight-only`。DSH 使用从 PATH 解析的 Node.js，或 `FRONTVIA_DSH_TEST_NODE` 的指定可执行文件，版本至少为 24.9.0。Core 使用 mise 的 Node.js 22.23.1，或从 `FRONTVIA_CORE_TEST_NODE` 指定该版本的绝对路径。通过 `CHROMIUM_PATH` 可指定本机浏览器。runner 输出隔离进程的 Node.js、实际加载的 DSH 宿主和候选包版本。

`--preflight-only` 核对 DSH Node.js 和 Chromium。实际用例在构建前检查保护的 OTP 输入文件、已发布测试身份的 `enrollment.json`、`DEEPSEEK_API_KEY` 和 PATH 上的 `claude`。缺少输入时报告配置名，凭据值不进入日志。

测试预设配置方式及保留边界见 Core 系统测试目录 README；不再需要 `DSH_IDENTITY_USER_SERVICE_SOURCE` 或本地 User Service Python 路径。预设仅注册/Join/恢复可用，不用它模拟普通短信登录或注销。

公共包来源由 `tests/support/public-pap.mjs` 选择：默认正式 npm 包，显式本地联调使用 `FRONTVIA_PAP_TEST_PACKAGE_ROOT` 并先重打包。开始时输出实际 PAP 版本及来源；源码候选结果不代表 registry 包验收。

复用已发布测试身份时，DSH 本轮只复制 Host 的公开 catalog 与 manager-settings 到拥有的临时目录；原生 Provider 继续在原保护目录托管密钥。这样保留空商家测试前置，不删除历史连接、不复制私钥或凭据；DSH 退出后临时 Host 状态随拥有 runner 清理。首次启动的 Preview Notice 必须确认关闭后再操作商城。

## PAP 1.0 与 UCP 非支付结算

在已构建的候选上运行 `python3 tests/e2e/dsh/run.py --ucp`。设置
`FRONTVIA_CORE_ROOT` 为包含 `commerce.py --suite dsh-ucp` 的 Core，
设置 `FRONTVIA_PAP_TEST_PACKAGE_ROOT` 与
`FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT` 为已构建候选包的绝对路径。沿用上文
的浏览器、隔离 Native 构建及 PostgreSQL 前提。设置
`FRONTVIA_IDENTITY_TEST_AUTH_FILE` 和 `FRONTVIA_IDENTITY_TEST_STATE`
为受保护的测试输入与任务身份工作状态；后者承载活跃的本机签名状态，
供 Claude 连接店铺后在独立 DSH Web 进程恢复。PAP 1.0 验收从专用已发布
身份的工作副本加载原批准记录与本机密钥托管，再从 awiki.me 回读 CIMD/JWKS。
准备副本时保留 `enrollment.json`、本机身份仓和已发布目录，在副本内初始化
新的 `identity/domain-access/`。旧 PAP 连接密文的密钥按原绝对路径区分，
适用于原目录下的连接恢复。Agent 执行使用 Claude Code
与 DeepSeek `deepseek-flash[1m]`，从受保护环境继承 `DEEPSEEK_API_KEY`。

本用例先从实际域名发现和读取商品，再通过浏览器中的 Frontvia 服务页完成
商品详情、加购、改量、创建草稿及重新打开。通过 DSH 实际发出的 PAP 1.0 请求
确认选用了 UCP 目录、Cart 和 Checkout 路由。Core runner 核对一个真实 Cart、
一个 Checkout 草稿及 Native Checkout、额度、付款会话和订单零增长。
浏览器 suite 输出 3 条逐用例结果，Claude 浏览单独输出 1 条结果。

`python3 tests/e2e/dsh/run.py --ucp-full` 保留为旧 Core 夹具入口，依赖 `init-frontvia-service.js` 和 C0 Native 账本。运行当前 Native 时使用专用店的 `--site-config`，并在 Core 运行分进程的 `tests/install-postgres.py --e2e-signed <Platform target> --workbench`。

现场 Mock 店使用 `python3 tests/e2e/dsh/run.py --site-config <0600 配置文件>`。配置包含 `liveStore: true`、`suite: "dsh-ucp-full"`、完整 `origin`、`domain`、公开的客户端 `ucpPlatformProfileUrl`、测试商品标题 `productTitle`、报价返回的配送选项 `shippingLabel`、`testContact` 和本轮独立证据目录 `controlDir`。测试联系人只使用专用夹具值，模型输入经进程环境注入。真实 HTTPS 店铺和客户端资料使用系统信任。买家端在下单前核对店铺和专用客户端资料都公开声明 `com.frontvia.payment.durable_mock`。

Dodo Test Mode 独立协议验收使用 `node --import tsx scripts/pap10-core-check.mjs <0600 配置文件>`。配置使用 `suite: "ucp-reference"`、`paymentMode: "dodo_test"`、`liveStore: true` 和该店的 HTTPS `origin`、`domain`、`ucpPlatformProfileUrl`、`controlDir`。参考运行器从受保护证据目录交换签名请求和回执，并在结束后写入停止文件。先核对同一测试店的渠道、商品、PDF 与签名状态，再通过正式托管页和 Dodo 官方测试卡付款。渠道原付款、退款和原订单下载由参考运行器独立回查。

在该目录运行只读事实观察器，按原请求文件返回 Commerce 店铺范围的结算草稿和已授权交接记录、该店 Native 的购物车、付款会话、订单和 capture。售后阶段按原订单公开编号回查同一 Native 占用和原申请编号。观察器按 `ucp-full-flow.mjs` 中的阶段原子写入响应。每次运行使用新证据目录和专用商品。发生浏览器或运输失败时先核对已有购物车、付款与原申请，再决定沿原入口恢复。

现场 A 单使用 CNY 1.00 商品与 CNY 2.00 运费。需要同单商家签名回读时，在配置的 `merchantCancellation` 中写入 `currency: "CNY"`、`amountMinor: "300"` 和 `shippingMinor: "200"`。观察器等待 `ucp-after-merchant-refund.request`，随后由单独的工作台会话办理该原申请。观察器按原订单查证退款金额、原运费、整单取消、唯一原生退款与预留释放，再返回事实供 DSH 原卡刷新。买家用例只读商家处理结果。

读取已存在的验收订单时，在同一受保护配置中设置 `existingAftersales`，填写 `orderId`、`caseId` 和期望状态 `state`，支持 `pending_merchant`、`waiting_return`、`refunded`。该入口从真实 DSH 订单列表打开原单，核对签名协议回执的订单和申请标识，不提交购物车、订单或申请。仅当继续 A 单的商家环节时同时提供 `merchantCancellation`，并由观察器核对待审核事实和原退款。
付款后先核对浏览器永久链接可读、客服同源并携带订单号、咨询区没有提交申请表单。再用 390px 浏览器从 DSH 的原订单打开售后，核对 PAP 宿主显示的取消条款并由买家确认。Core 以永久链接中的公开订单编号关联已支付的订单、Commerce 公开回执和 Native 正在办理的申请。批准前没有申请，批准后只有一笔在办申请，资金效果仍为零。刷新后通过真实 PAP 响应核对同一笔申请。协议日志用订单编号和申请编号共同计算摘要。runner 退出时清理隔离库。端到端的店员和商家 Agent 交接使用持续运行的专用测试店，在同一申请上操作并由 DSH 回读。
