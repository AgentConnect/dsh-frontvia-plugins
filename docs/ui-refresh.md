# 购物卡片与收货表单优化

2026-11-02，状态：完成。本次采用 **shadcn/ui 组件结构 + Radix Tabs + DSH 主题变量**，直接优化既有购物流程。

## 界面变化

- 收货表单按联系人、地址分组，提供占位提示、浏览器自动填充、字段内错误、首个错误字段聚焦、保存中及已保存状态。
- 宽卡片采用表单与购物摘要两栏；窄卡片自动改单栏，输入字号提升到 16px，避免移动设备输入时自动放大。
- 商品、收货配送、报价、订单使用带键盘导航的 Tabs；按钮、输入框、Badge、Alert、Skeleton 和空状态统一样式。
- 报价单分别展示商品、收货资料和全部费用；合计与购买确认清晰突出。报价过期时禁用确认，提供重新报价入口。
- 保存失败保留输入；只有已保存的资料才显示配送操作。修改资料后暂时收起配送操作。
- 订单结果展示订单号、付款与履约状态、商品和金额。确认回执丢失时保留查询原操作入口。
- 跟随 DSH 深浅主题，所有样式限定在 `.fv` 下；使用宿主 React/React DOM，没有添加全局 CSS reset 或第二套 React。

源码组件由 [shadcn/ui 官方组件](https://ui.shadcn.com/docs/components/field)适配，保留 [MIT 许可说明](../packages/customer/THIRD_PARTY_NOTICES.md)。插件不依赖 Tailwind 运行环境，组件的语义样式映射到 DSH CSS 变量。json-render 面向模型生成动态 UI；当前固定购物流程采用直接组件组合。

## 预览

以下均为真实 DSH 0.2.1-rc.3 Web 宿主中的组件，内容使用受控测试数据。

![收货表单](../output/playwright/ui-cart-light.png)

- [深色表单](../output/playwright/ui-cart-dark.png)
- [窄屏表单](../output/playwright/ui-cart-mobile-light.png)
- [完整报价与确认](../output/playwright/ui-quote-light.png)
- [订单结果](../output/playwright/ui-order-light.png)

## 验证与额外修复

| 检查 | 结果 |
| --- | --- |
| TypeScript、构建和既有业务保护测试 | **PASS，23/23** |
| 实际 DSH + Chrome 的表单、Tabs、报价、确认与恢复交互 | **PASS，17 项** |
| 深浅主题、窄屏、对比度、减少动画、加载和空状态 | **PASS，8 项** |
| 390px 视口 | 单列表单、卡片无横向溢出；卡片宽度由宿主聊天栏决定 |
| 成功提示文字对比度 | **7.24:1**（浅色主题） |
| 安装后文件 | 两个包的服务、核心及客户端 bundle 与构建逐字节一致 |

联调发现现有 PAP/Customer 失败响应缺少 DSH rc.3 要求的 `error.details`，会使正常业务错误变成 `invalid server-response failure`。两个插件均已补齐，并使用宿主 `ConnectionRpcResult` 类型约束。新增测试从实际注册的用户接口触发业务错误，再用宿主 `serverResponseSchema` 校验。最终已在实际 DSH 页面验证错误提示可见，错误后 Skeleton 不再持续显示。

本轮 Commerce UI 响应在浏览器测试边界受控模拟；实际宿主、插件包、React 组件和错误接口均有运行验证。**没有增加真实模型调用、真实 Commerce 交易或支付效果**。此前完整 Mock 购物验收见 [原验收报告](acceptance.md)，不能将本轮 UI fixture 的结果当成新的业务 E2E。

证据：[23 项测试](../.local/ui-check.log)、[17 项交互](../.local/ui-browser-result.json)、[8 项外观与响应式](../.local/ui-appearance.json)、[实际错误接口](../.local/ui-actual-route.json)、[安装包核对](../.local/ui-artifacts.json)。

本轮验证结束后已关闭测试浏览器和本任务 DSH 服务，4347 端口无监听；没有启动 Commerce 栈。源码、安装包、截图和原测试 Profile 保留。[清理记录](../.local/ui-cleanup.json)。

浏览器检查脚本为 `scripts/ui-fixture.playwright.cjs`、`scripts/ui-check.playwright.cjs`、`scripts/ui-appearance.playwright.cjs`，使用 Playwright CLI 的 `run-code --filename` 按此顺序运行。它们针对保留的本机 DSH 测试聊天，不会自动创建付费模型对话。必须使用隔离 Profile，并先启动 `node scripts/run-configured.mjs --controlled-model --stored-credentials`。fixture 仅在该浏览器会话中拦截购物 UI 路由。

## 更新的本地安装包

- [PAP 0.1.0](../.local/packages/dsh-pap-0.1.0-20898448731a.tgz)：`20898448731ae21fd0b7c5d4bae772ef4784776983c57610abce3aaec725c4f0`
- [Customer 0.1.0](../.local/packages/dsh-frontvia-customer-0.1.0-dcf1c7176998.tgz)：`dcf1c7176998b1aeecc0bbbcae347d5228675c43735bb7ceeb6335ee837685e9`

安装步骤见 [README](../README.md)，当前文件清单以 `.local/packages/manifest.json` 为准。两个包仍为本地测试产物，没有提交、推送或发布。原始源码在改动前保存于 `.local/ui-before-20261102.tar.gz`；新仓库仍无远程，upstream 对齐状态为 UNVERIFIED。
