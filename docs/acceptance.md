# 本机验收报告 — FINAL

日期：2026-11-02。结论：首版本地双插件已实现并完成官方 DSH **0.2.1-rc.3 Web UI + 真实 Chrome + 隔离 Frontvia 服务 + Mock 支付**购物验收。以下记录明确区分实际服务、受控测试和未验证项目。

## 交付与基线

- 源码：`/Users/howard/workspace/dsh-frontvia-plugins`，分支 `codex/pap-customer`，按用户要求建立本地初始提交；未推送或设置远程。新仓库无远程基线，对齐状态为 **UNVERIFIED**，不虚构 upstream。
- 参考 Frontvia：开始开发前 fetch 后 HEAD 与 origin/main 均为 `5e8cb68b44aa630de2cc634d9b75d2da8c7033f7`。已有未提交工作保留；插件运行时不导入其内部源码，测试脚本复用该基线的隔离服务测试工具。
- Node 25.2.1、pnpm 10.28.2、宿主包精确锁定 0.2.1-rc.3，使用宿主 React。测试 Profile 为 `.local/dsh-home` / `frontvia`。
- 两个包均为 `private: true` 的本地 tarball；没有 npm 发布、Release、标签或部署。

| 安装包 | SHA-256 |
| --- | --- |
| [dsh-pap-0.1.0-6ce23870351b.tgz](../.local/packages/dsh-pap-0.1.0-6ce23870351b.tgz) | `6ce23870351bc63080e91b428f4228f3d92063858391a70252f13b7866ccea2b` |
| [dsh-frontvia-customer-0.1.0-17f565fd26eb.tgz](../.local/packages/dsh-frontvia-customer-0.1.0-17f565fd26eb.tgz) | `17f565fd26eb48aa82dcab826cb52223e0c7900a7319f7ec7799943724caf428` |

安装脚本已验证两个包安装后的服务、核心和客户端 bundle 与本次构建逐字节一致。tarball 内容不包含测试数据、凭据或运行时数据库。[包审计](../.local/native/package-audit.json)、[安装日志](../.local/final-install.log)。

## 分项结果

| 项目 | 结果与边界 | 证据 |
| --- | --- | --- |
| 类型、构建和行为测试 | **PASS：22/22**。覆盖完整购物、缺失/过期版本、跨会话、金额/确认过期、幂等冲突、并发确认、回执丢失与重启、草稿重新报价、订单引用补全/历史刷新、协议和宿主兼容 | [最终检查](../.local/final-check.log) |
| 实际 PAP/Commerce | **PASS**：HTTPS 发现、登记客户端、真实 ES256 Assertion/DPoP、稳定主体、商品/购物车/地址/配送/报价/草稿结算 | [PAP 请求](../.local/native/wire-results.json)、[购物适配器](../.local/native/adapter-result.json) |
| 实际协议与隔离 | **PASS：10 项**。错误 resource、过期/重放 DPoP、跨店 endpoint、配置 issuer/resource 不匹配、续期主体/会话稳定、错误商家配置、独立买方读取订单被拒、未登记客户端被拒 | [隔离结果](../.local/native/isolation-result.json) |
| Direct Sign-In、PKCE、刷新与撤销 | **PASS（受控协议）**：校验 issuer/state/callback/PKCE、一次性回调、账号 Token 刷新及撤销。真实账号登录浏览器链路 **UNVERIFIED**；本次采用独立 signed-out PAP 主体购买 | `packages/pap/test/protocol.test.ts` |
| 服务依赖与生命周期 | **PASS（实际 DSH）**：PAP 停用时 Customer 无购物工具、显示依赖状态；停用状态跨重启保持；重新启用恰好恢复五组工具；停用 Customer 后 PAP 界面独立可用。版本不兼容拒绝注册为受控测试 | [生命周期](../.local/native/lifecycle.json)、`packages/customer/test/lifecycle.test.ts` |
| 受控模型异常路径 | **PASS**：实际 DSH → 实际 Frontvia；缺版本重新加购、模型尝试 confirm 均被拒，购物车数量仍为一。提供且仅提供五组购物工具，无个人资料泄漏 | [受控拒绝](../.local/native/controlled-model-denials-and-lifecycle.json) |
| 真实模型完整购物 | **PASS（共五轮额度已用完，细节见下）**：自然语言搜索、规格、加购、配送、报价、准备结算、查询原结果；人工 UI 填写资料/确认 | [真实聊天](../output/playwright/final-chat.png)、[确认前](../output/playwright/real-confirm-before.png)、[订单](../output/playwright/final-order.png) |
| 人工确认保护 | **PASS**：确认前订单/扣款均为零；跨会话、伪造 intent 和客户端改金额被拒；浏览器丢回执、重复原确认仍仅一笔交易。金额变化及旧 intent 另有行为测试 | [确认前](../.local/native/before-confirm.json)、[确认检查](../.local/native/browser-confirm.json) |
| 真实商家订单核对 | **PASS**：管理 API 可见同一显示订单 #1，Travel Mug × 1，商品 12.34 + 配送 5.00 = **USD 17.34**，Mock captured 17.34，待履约 | [确认后](../.local/native/after-confirm.json)、[最终商家事实](../.local/native/facts.json) |
| 恢复与重新报价 | **PASS**：丢失回执核对原 Operation；DSH 从凭据存储重启后恢复连接、卡片和原订单，不自动购买；释放未确认零扣款草稿、保留输入、旧确认失效、新建报价/草稿 | [确认检查](../.local/native/browser-confirm.json)、[重新报价](../.local/native/requote-result.json) |
| 历史订单列表 | **PASS**：实际订单引用经公开 orders.get 补全；重载和刷新显示 #1、已付款、USD 17.34，无本次刷新 pageerror | [最终列表](../output/playwright/final-orders-list.png) |
| 模型数据脱敏 | **PASS（测试标记检查）**：解压全部三份聊天的所有 zstd frames，268 条记录中未发现测试收货人、邮箱、地址三个标记。并有递归敏感字段过滤测试；不把标记扫描声称为形式化保密证明 | [脱敏检查](../.local/native/model-redaction.json) |
| 清理 | **PASS**：本任务 DSH、受控模型、Frontvia 平台/客户端 fixture、Medusa/Redis 等子进程已关闭，独立 PG 21439 已停止；七个已记录端口均无监听 | [资源清理](../.local/native/cleanup.json)、[进程和端口复核](../.local/native/cleanup-verification.json) |

## 真实模型轮次与交易事实

真实模型使用本机既有授权 DeepSeek 配置，凭据只在启动内存中读取。五轮计数包含失败轮次，没有为补测增加费用对话：

1. 首轮被供应商拒绝：工具 JSON Schema 顶层缺少 object 类型，未执行购物工具。
2. 修正后第二轮仍加载旧包，定位为同版本 tarball 安装缓存，仍未执行购物工具。
3. 加入内容哈希文件名并核对实际安装 bundle 后，搜索 Travel Mug、读取规格、加购一件成功。
4. 用户卡片保存测试收货资料后，模型读取最新购物车、选择最低配送、报价并准备结算，等待人工确认。
5. 人工确认及故意丢失浏览器回执后，模型查询原 Operation 和原订单，返回已付款、待履约。

最终 UI 再用受控模型及只读刷新回归，没有继续请求付费模型。测试购买确认由浏览器自动化点击模拟用户操作；不是模型工具自行授权，也不是外部真实买家验收。

PAP 订单 ID：`e88f37d2-8957-4452-bb02-d85a75f8f554`。商家原生订单 ID：`order_01M6DCZNFYYHZ6Z28XSMVAGPAP`。显示订单号均为 **1**。最终数据库计数为 **1 个订单、1 次 Mock capture**，重复点击未新增效果。

## 已修正的集成差异

- DSH rc.3 的插件 patch 按 ID/config 配置，工具 schema 顶层必须兼容供应商 object 要求；本地安装后校验实际 bundle，避免缓存旧版本。
- 当前 Commerce 订单列表实际返回引用，按页最多十笔经公开 orders.get 读取详情；重开历史卡片重新读取服务器状态。
- 草稿 checkout 会阻止重新报价，提供受约束的 revise 动作，仅取消未确认、零授权/零扣款草稿。当前服务不接受可选 cancel reason，因此不发送该字段。
- 卡片对齐原生 `display_number`、`payment.status`、`totals.grand_total`，金额使用整数最小单位；不把原生付款状态猜成成功。

## 限制与保留项

- 本次验证的是官方同版本 **CLI 宿主 Web UI + Chrome**；原生 Electron 窗口内安装/交互未执行。真实账号 Direct Sign-In 浏览器联调、生产域名/生产数据、真实收款、公开分发与部署均 **UNVERIFIED / 不在本轮范围**。
- 账号授权当前采用创建 PKCE 链接后粘贴预登记回调 URL，没有自动回调监听器。首版主体购物不依赖账号登录。
- 仅配置 US/USD 与预登记测试商家。无多用户自注册、现有 Buyer Web 账号认领、订单取消或退款申请。
- 测试 Profile 关闭模型的通用 shell、文件和插件管理工具，购物工具不能读取密钥或确认。宿主、其他插件和当前 OS 用户属于可信边界；不声称抵抗已获得本机任意代码执行权的主体。
- 故意断网、服务停用和重启期间存在预期网络错误。真实模型的美元 Markdown 产生过宿主 KaTeX 警告；订单卡片金额不受影响。上游 OpenTelemetry peer 范围警告仍存在，测试禁用 telemetry，未发现本轮运行问题。
- 测试数据库已清理，截图中的订单是历史验收证据，不能继续视作在线订单。保留源码、包、加密 Profile/聊天及 `.local` 证据；后者含本机测试凭据，不应复制到公开仓库。

安装/使用见 [README](../README.md)，配置见 [configuration.md](configuration.md)，重新建立隔离服务见 [native-acceptance.md](native-acceptance.md)。
