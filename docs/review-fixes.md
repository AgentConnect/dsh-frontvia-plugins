# 代码审查修复（2026-11-02）

基线：本地 `5d98ec2f238d59cbd535a33554fa4663a58bf272`，分支 `codex/pap-customer`。仓库没有配置远程，上游对齐为 UNVERIFIED。修复留在工作区，未提交、推送或发布。

## 修复内容

| 问题 | 修复与回归证据 |
| --- | --- |
| 同一 siteId 改换资源后复用旧凭据 | 连接固定客户端、回调、商家域名、issuer 和 resource；配置不匹配时在凭据使用和网络请求之前拒绝。测试逐项改动这五个字段、重启、恢复原配置，并检查零外发请求及原身份保留。 |
| 重连覆盖并发购物写入 | 现有流程的重连与购物、联系资料、确认操作共用 flowId 锁；首次建立流程另有 session/site 锁。测试阻塞重连后并发加购，以及未知结果与原请求键跨重连、重启保留。 |
| 侧栏选择进度被严格接口拒绝 | 只传 flowId、sessionId 和 card，不再把列表时间、店铺、pending 等元数据带进 UI 操作。测试用真实列表结果构造引用，通过严格 schema 读取所属流程并验证跨会话拒绝。 |
| 已取消的写入永久 pending | 在保存原操作记录之前检查取消信号；调用已交给 PAP 后仍按结果未知处理，保留原键并查询原操作，不自动重发。测试发送前取消、重启后显式重试，以及已有的发送后丢回执用例。 |
| 失败且无副作用的确认无法重新操作 | 只有权威 Operation 为 failed/none 时才清除旧确认意图，保留原命令和结果；后续必须重新核对、重新点击。覆盖直接回执、重启后查询、旧版本已完成记录、重新报价、旧卡片拒绝与重复点击；不明确的副作用继续阻止新交易。 |

宿主实测还发现 PAP 入口重复打包了 core，导致跨包的 PapError 无法识别，被误报为表单错误。构建现在让入口引用同一份 core；新增使用构建后的两个包验证工具与用户接口均保留准确错误码的测试。

## 验证边界

- PASS：`pnpm check`，类型检查、构建和 40 项测试；其中包含实际密码学签名/DPoP 校验、模拟 Commerce 故障与恢复，以及两个构建包的组合测试。
- PASS：两个内容寻址的本地安装包安装至既有 DSH 0.2.1-rc.3 Profile，安装脚本逐字节核对 index/core/client。
- PASS：宿主 HTTP 复验确认未认证请求被拒绝，侧栏引用通过严格参数校验，并准确返回旧连接的绑定限制。1 个连接与 3 份购物进度的引用摘要升级前后一致。证据：`.local/review-fix-host.json`；原始检查基线：`.local/review-fix-host-before.json`。
- UNVERIFIED：本轮内置浏览器控制连接不可用，未完成新版页面的浏览器交互复验。此前 UI 截图不作为本轮复验结果。
- 本轮无付费模型调用、真实支付或商家服务端全链路复验。Commerce 测试使用隔离模拟服务；原本机商家测试栈未启动。

现有预览连接缺少升级前的绑定字段，按安全规则显示 `CONNECTION_BINDING_REQUIRED`。保留原 1 个连接和 3 份购物进度，未改写为新身份。处理方式见 [配置说明](configuration.md)。本地 DSH 继续在 `http://127.0.0.1:4347/` 运行。

## 本地包

- PAP：`.local/packages/dsh-pap-0.1.0-0de6164e6a2c.tgz`，SHA-256 `0de6164e6a2c7eca3c71216bc578034032fe5699d1dfa87db2b7bda33f4b592e`。
- Customer：`.local/packages/dsh-frontvia-customer-0.1.0-3846e966c345.tgz`，SHA-256 `3846e966c345424cffcca3fd4e6c345363a2258487d8f3b5943490575c85bf55`。

完整日志：`.local/review-fix-check.log`、`.local/review-fix-pack.log`、`.local/review-fix-install.log`。运行时记录、凭据与本地包均不进入 Git。
