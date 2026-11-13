# DSH Web 端到端测试

本目录只放 DSH 产品 E2E；PAP / Frontvia 系统测试在 `frontvia-core/platform/tests/system/pap03/`。未来工作台配置 E2E 使用独立子目录，本轮不加入。

```bash
python3 tests/support/read-awiki-me-auth.py  # 只读 awiki.me 测试预设，不打印值
# DEEPSEEK_API_KEY 从受保护环境继承。
python3 tests/e2e/dsh/run.py
```

需要 Node 24、当前 Customer 安装包、正式 PAP 0.1.6 / Identity 0.1.17、Core Web 的 Playwright/Chromium 及 Core 拥有的隔离服务前提。使用实际 `dsh --profile frontvia-e2e` Web 进程和浏览器，测试 profile、业务状态和会话隔离，不修改用户默认 DSH 配置。专用 awiki.me 测试身份的加密状态和必要注册恢复材料保留，以便跨轮复用。

测试专用网络插件只负责测试 HTTPS 域名映射和测试 CA，保留真实 PAP 传输及证书校验。Identity 使用正式实现，测试身份通过已部署的 `https://awiki.me` 注册/发布，CIMD/JWKS 从公网实际读取。预置身份是测试前置，不能声称 DSH 界面注册/邮件投递已验收。

用例从可见界面启动会话，使用实际 DSH Agent、DeepSeek、公共 PAP 和 Customer 查询商家并显示卡片；继续验证刷新、规格数量、加购、联系邮箱、报价、公共一次批准弹窗、原订单和同域咨询。禁止用直接调用 Customer 内存方法、伪造 owner 连接或 Claude/MCP 代替 DSH 产品用例。失败输出固定错误与必要诊断，临时进程和运行输入随拥有环境清理；专用身份及受保护的 OTP 输入按上述边界保留。当前为 Linux Chromium Web 验收，不代表 Electron/macOS/Windows 全平台通过。

浏览器依赖提前检查；需要补齐时，在 Core `web/` 使用 `PLAYWRIGHT_SKIP_BROWSER_GC=1 node node_modules/playwright-core/cli.js install chromium`，保留其他项目已有浏览器。入口会重建本地插件包和当前 Platform，不使用上轮旧制品。

测试预设配置方式及保留边界见 Core 系统测试目录 README；不再需要 `DSH_IDENTITY_USER_SERVICE_SOURCE` 或本地 User Service Python 路径。预设仅注册/Join/恢复可用，不用它模拟普通短信登录或注销。

公共包来源由 `tests/support/public-pap.mjs` 选择：默认正式 npm 包，显式本地联调使用 `FRONTVIA_PAP_TEST_PACKAGE_ROOT` 并先重打包。开始时输出实际 PAP 版本及来源；源码候选结果不代表 registry 包验收。

复用已发布测试身份时，DSH 本轮只复制 Host 的公开 catalog 与 manager-settings 到拥有的临时目录；原生 Provider 继续在原保护目录托管密钥。这样保留空商家测试前置，不删除历史连接、不复制私钥或凭据；DSH 退出后临时 Host 状态随拥有 runner 清理。首次启动的 Preview Notice 必须确认关闭后再操作商城。
