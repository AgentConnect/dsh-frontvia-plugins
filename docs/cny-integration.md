# CNY 对话购物接入与本地验收

日期：2026-11-04。开发基线：插件 main `97b00b2`，服务端 main `b097aa7`。
两仓库使用 `codex/cny-dsh-integration` 开发分支。以下为部署前本地验收记录；真实环境交付状态以文末部署记录为准。

## 实现

- Frontvia 保留个人账号登录入口，PAP 保留身份和认证传输职责。
- 仅根据服务端明确的 `frontvia.conversation_purchase.v1` 能力启用人民币购物；旧 US/USD 流程不变。
- 商家 Agent 备单，服务端返回当前完整摘要。卡片展示商品/规格/数量、收货信息、配送和全部费用。
- owner 用户勾选核对后确认。插件重新读取摘要、会话版本与有效期，并使用持久原幂等键提交原确认消息。
- 模型工具不能发送购买确认，模型结果移除确认码和付款访问链接；用户界面单独取得完整信息。
- 付款 URL 校验已验证商家 issuer 的 origin、结算路径和访问参数，在独立浏览器打开。
- 读取原结算单刷新资金事实；已付款/退款/关闭状态不提供新的付款入口。页面返回不产生付款成功推断。
- 可见页面每 5 秒只读查询待处理订单，最多持续 5 分钟；用户主动刷新或返回页面可重新查询。后台页面暂停轮询。
- 原确认结果未知时必须恢复原请求；商家端仍有待恢复操作时不重新提供确认按钮，应在对话中要求商家核对原操作；重启、重复点击、换账号、改金额、改版本或报价过期均有对应保护。

## 验证结果

| 层级 | 结果与边界 |
| --- | --- |
| 插件类型、构建、全部测试 | PASS，83 项；包含 CNY owner 确认、改价/过期/版本/能力撤回、双击、丢失响应、重启、跨会话/账号、链接隔离及旧购物/咨询回归 |
| Agent 单元测试 | PASS，21 项购物及咨询预算测试；摘要持久化与严格参数形状、恢复原写入和付款链接保护 |
| Agent PostgreSQL | PASS，购物 5 项、咨询预算 9 项；实际队列、持久操作、RLS 与历史读取；配置与模型受控 |
| Platform 单元测试 | PASS，3 项；精确原始确认、购物车/摘要版本与期限、付款事实优先及未知状态禁止重新付款 |
| Platform / Medusa 集成 | PASS，3 个场景：PAP 购买与付款、取消后迟到收款、两次分退款后取消；实际本地 TLS/PAP/PG/Medusa，渠道是本地验签网关夹具 |
| 实际 React 组件浏览器 | PASS，桌面深浅色、390px 手机无横向溢出；核对勾选、一次确认、独立付款入口、付款后刷新、刷新不重提。商家回复与付款状态为合成夹具 |
| 当前安装的 DSH / ali / 真实支付宝 | UNVERIFIED；未安装或部署本次改动，未发生真实扣款 |

服务端集成证据保存在服务端工作树
`platform/.local/evidence/5fd2ee19635c/conversation-result.json`；
Agent 最终购物证据为 `agent/runtime/.local/evidence/postgres-b74563de3b1d`，
预算证据为 `agent/runtime/.local/evidence/postgres-d8da4bcd84a8`。
浏览器截图位于本仓库 `.local/cny-ui/`，仅含合成信息。

## 本地复现

```sh
pnpm check
node scripts/cny-ui-fixture.mjs
```

第二条命令打印隔离页面地址。可用 Playwright CLI 打开后执行 `run-code --filename scripts/cny-ui-check.playwright.cjs` 复现交互检查。核对勾选前按钮不可点击；确认一次后展示合成付款入口。
页面的 `/__fixture/paid` 仅用于将合成状态设为已付款，绝不连接真实支付服务。
不要将这个夹具作为支付 API 或生产安装入口。

服务端使用原有 `platform/tests/commerce/conversation_payments.py`、
`agent/runtime/scripts/test-postgres.py --suite conversation-commerce` 和
`--suite public-consultation-budget`。必须使用任务专用测试数据库及当前源码构建；
需要独立 Medusa 测试构建、PAP TLS 夹具、Rust test listener。真实付款验收需另行授权。

本次增量不新增数据库迁移；服务端需要 main 已有的 Platform 0053 和 Agent 027 迁移。
上线需配套更新两端，且目标店铺明确配置 CN/CNY、对话购物、真实 Provider、收款方及回调。
旧服务端没有结构化购物能力时，插件保留咨询行为，不猜测是否支持购买。
