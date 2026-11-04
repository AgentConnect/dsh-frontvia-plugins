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

## 2026-11-04 新加坡部署与客户端更新

用户授权改部署后，服务端使用 `ssh sgt-via-ali` 的现有 `frontvia-dev` 实例及其受保护通企付配置。
商户号、App ID 和签名密钥仅在服务器内与原配置比对，未下载、打印或提交；未更改渠道配置。

- 服务端实际运行提交：`37fc7446891e5b795bbefbc48602bbfec865dcd0`，保留部署分支历史并包含最新 main。
- 插件功能提交：`4d43fef`；两个仓库的 `codex/cny-dsh-integration` 已推送，服务端部署分支也已更新。
- 当前实例已是 Platform 0053 / Agent 027；候选全部迁移及 Medusa lockfile 与原制品一致，本次未执行数据库迁移。
- 停写备份：服务器 `backups/data-1793790834`，三个数据库分别归档、摘要和 pg_restore 目录校验通过，另备份受保护输入配置。
- 实际运行二进制 SHA256：`17d54547e64e77bdab9773e7575e2c0152d4d2ec632eac06e060de8ab3c10839`；与构建回执及运行进程路径一致。
- 主服务、Knowledge HTTP 和 Worker 均 active；商家 `/`、买方 `/`、Admin `/app`、店铺 `/health/ready` 与发现文档均 HTTP 200。

初次部署遇到 GitHub SSH 公钥认证间歇失败，旧应用已恢复。最终使用同一密钥经
[GitHub 官方 443 端口](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port)
建立并复用本次操作专属连接，仍严格校验 smartGrey 身份、已推送分支和完整提交。
未修改全局 SSH 配置或跳过部署门禁；结束后已关闭该连接，失败记录与备份保留。

本机原 4349 DSH 已更新 Customer bundle，账号、配置和密钥未更改。九份原会话完整保留；
宿主重启后有两份会话追加记录，原文件字节前缀全部保留，未覆盖历史。
因原个人登录属于 ali，新增隔离的 `frontvia-cny` Profile（4350）连接新加坡，使用独立加密存储，
复用原已公开的客户端签名身份，不向新加坡转发 ali 个人令牌。已通过正式发现和导入加入咨询资源，
CNY 购物沿此咨询资源进行。该入口需独立登录 Frontvia，模型账号也需在该隔离宿主中配置。

上线后以仓库声明的保留测试身份通过真实 OTP API、PAP/DPoP 连接和能力读取，结果为：
`frontvia.conversation_purchase.v1`、`supported`、`CN/CNY`、`owner_message`、`hosted_alipay`。
实际 DSH 浏览器完成登录、连接、退出、刷新；1440×1000 桌面和 390×844 深色手机视口无横向溢出，
无 pageerror。验收后测试账号已退出。Browser 插件未提供，使用已有 Playwright 运行时；
截图和临时脚本仅在本机 `/tmp/frontvia-cny-evidence`，不提交用户运行数据。

这是部署、身份、能力和页面验收。未在新实例创建购买、发起真实支付宝交易、扣款或退款，
也未调用真实模型；完整下单到付款的真渠道验收仍需由用户确认订单并本人付款。
保留测试验证码不证明真实短信投递。原本地三场景支付集成使用模拟渠道，其边界不变。
