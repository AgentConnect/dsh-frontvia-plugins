# PAP 连接页更新（2026-11-02）

状态：本地实现与 UI 验证 PASS。使用官方 DSH 0.2.1-rc.3 Web host；未公开发布或推送；本地提交以 Git 历史为准。

## 页面变化

- 延续购物卡片的 shadcn/ui 风格，使用宿主语义颜色、规则字重、商家卡片、状态徽标及图标；独立 PAP 包不依赖 Customer 包。
- 每个商家的连接、身份和会话状态在同一张卡片内；账户授权按需展开，分为创建链接和完成回调两步。
- 每张卡片独立持有输入及授权链接，失败保留回调输入，成功后清除；请求期间禁止重复提交。
- 已断开的商家账户显示重新授权入口，不尝试用另一身份替换；HTTPS 回调校验与服务端原有 PKCE/issuer/state 校验共同生效。
- 提供初始加载、未配置、无商家、错误与重试状态，随宿主切换深浅色，并支持窄屏和减少动态效果。

## 验证

- `pnpm check`：类型检查、构建及 23 项现有产品行为测试通过。
- 真实 Chrome / DSH 宿主内 18 项交互检查通过：双商家输入隔离、错误回调保留、HTTPS 链接校验、重复提交、授权后状态刷新、断开与重新授权、正确商家重新连接、过期状态、配置为空及失败重试。
- 9 项外观与状态检查通过：规则字重、状态徽标对比度 7.24:1、宿主深色、390px 无横向溢出、移动表单、减少动态效果、加载骨架屏和首屏失败恢复。
- 交互检查使用浏览器范围内的合成 PAP 响应，不代表本轮重做了真实 PAP 握手或商家授权。未调用付费模型或产生订单。
- 已移除 PAP 响应拦截，最终页面读取当前 Profile 的真实连接状态；本地 DSH 实例按用户要求保持运行，地址为 http://127.0.0.1:4347/ 。

复现脚本：`scripts/pap-ui-fixture.playwright.cjs` → `scripts/pap-ui-check.playwright.cjs`；重新装载 fixture 后运行 `scripts/pap-ui-appearance.playwright.cjs`。通过 playwright-cli 的 `run-code --filename` 在独立测试 Profile 执行。

证据：`.local/pap-ui-check.log`、`.local/pap-ui-browser.json`、`.local/pap-ui-appearance.json`、`.local/pap-ui-live.json`。

## 本地安装包

- 路径：`/Users/howard/workspace/dsh-frontvia-plugins/.local/packages/dsh-pap-0.1.0-6ebcd80b22bc.tgz`
- SHA-256：`6ebcd80b22bcf908b8b6d77456805cbe9179ce28de02fa0e0e4f80d82dd31185`

安装程序已核对宿主安装的 index/core/client 与构建产物逐字节相同。Customer 安装包未改动。开发起始时仓库无初始提交；当前仍无远程，上游对齐为 UNVERIFIED；保留所有既有文件，PAP 修改前快照为 `.local/pap-ui-before-20261102.tar.gz`。

## 截图

当前 Profile 实际页面：

![PAP 连接](../output/playwright/pap-actual-light.png)

受控数据下的账户授权与深色适配：

![账户授权](../output/playwright/pap-auth-light.png)
![深色账户授权](../output/playwright/pap-auth-dark.png)
![窄屏](../output/playwright/pap-mobile-light.png)

### 宽度调整
按用户反馈将桌面左侧商家区从 696px 收窄为 540px，页面最大宽度 900px，右侧说明区 280px。已重新构建并安装，浏览器实测 390px 窄屏仍为单列、无横向溢出；当前实例保留运行。

### 整体视觉对齐
再次按用户反馈将页面最大宽度调为 800px、左侧商家区 448px。页头、商家分区标题共享内容边线；左右卡片使用同一网格行，移除侧栏固定 65px 顶部补偿；卡片内边距统一为 20px。浏览器实测左右卡片顶部及两侧边缘偏差均为 0px，展开授权后与 390px 窄屏均无横向溢出。类型检查、构建及本地包安装核对通过；证据为 `.local/pap-ui-alignment.json`。

### 内置浏览器滚动修复
用户反馈页面显示不全后，在 Codex 内置浏览器复现了真实问题：DSH 主内容容器为 overflow:hidden，插件正文没有自己的滚动容器；展开授权后高度 1259px 超过 853px 视窗，滚轮无法到达底部。此前整块元素截图和横向溢出检查未覆盖此宿主纵向裁切。

修复为插件专属 `.pap-viewport`：占满宿主可用高度、min-height:0、overflow:auto，并支持键盘聚焦。未修改宿主样式或 PAP 协议行为。类型检查与构建通过，本地安装包已做逐字节核对。在内置浏览器真实展开并滚动验证，滚动区高度 853px、内容高度 1030px、可滚到末尾；完成授权按钮在视窗内，横向无溢出。证据 `.local/pap-iab-scroll.json` 及 `output/playwright/pap-iab-scroll-bottom.png`。内置浏览器标签已作为交付保留，本地实例继续运行。
