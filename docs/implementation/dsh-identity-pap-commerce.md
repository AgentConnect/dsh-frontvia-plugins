# 独立身份与 PAP 直接购买：本地实施记录

日期：2026-11-06。对应 SPEC v0.2。本记录区分代码实现、本地验证和上线验收；不代表生产已切换。

## 实现与代码位置

| 仓库 / 本地目录 | 交付 |
| --- | --- |
| `dsh-identity` / `/Users/howard/workspace/dsh-identity` | 独立 Rust 服务、数据与恢复控制双库、OTP/会话/设备、短期身份凭证和在线检查、独立宿主账号插件、加密迁移、维护密钥轮换、操作手册 |
| `frontvia-core` / `/Users/howard/workspace/frontvia-identity-pap` | Migration 0059、外部身份 PAP grant、资源与付款页撤销检查、旧主体显式映射、直接 CNY 付款链接、独立 Commerce 连接导出 |
| `dsh-frontvia-plugins` / 当前目录 | 依赖独立账号宿主、PAP 凭证交换、动态 CN/CNY 地址与报价、owner 确认、订单页付款入口、旧咨询订单读取/恢复、三个包的本地安装校验与回滚 |

修改前已 fetch 并核对插件基线 `036a5ed`、Frontvia 基线 `30917ea`。Frontvia 使用独立 worktree；原有未提交工作未改动。新身份仓库为本地 Git 仓库，无远程/upstream，远程对齐状态为 UNVERIFIED。用户随后授权本地提交；三个仓库均未推送。

## 冻结的本期接口

- 身份 profile：`dsh.identity_assertion.v1`；grant：`urn:dsh:params:oauth:grant-type:identity-assertion`；JWT typ：`dsh-identity-assertion+jwt`；ES256。属于项目版本化扩展，不声称是现有 PAP 标准。
- 个人 Bearer 只到独立身份域名。发给商家的凭证最长 60 秒，精确绑定 issuer/subject/audience/resource/client/DPoP/session/version/epoch，jti 只消费一次。
- 商家每次准入在线检查父会话；没有有效状态缓存。退出前已准入操作可按原键完成，退出后的新准入失败。网络故障不能降级游客或回退旧个人令牌。
- 商家 `GET /v1/merchant/commerce/connection-export` 使用原商家鉴权导出中立 `frontvia.connection.v1`，不依赖 Agent 发布；插件不调用该管理接口，只导入商家导出的内容并验证 PAP 发现。
- 新购买仅 Commerce。Agent 工具不注册新的咨询购买入口；旧卡片确认路由拒绝新购买。Frontvia 外部身份咨询请求不附带 Agent 购物授权。已有咨询交易可通过历史适配器读取和恢复。
- CNY 付款链接 `v2.<PAP-session>.<MAC>` 绑定原已确认操作、checkout、owner、报价/金额、连接代次和截止时间。签发与访问都要求 durable confirm + consumed nonce。旧 reserve + accepted summary 单独校验。退出使旧链接失效；重新登录后可查询原 checkout 取得新链接，不重做购买。

## 数据与迁移

身份联系人使用独立 HMAC 盲索引和 AES-GCM 密文；OTP、个人令牌仅存摘要。数据/控制 head 不符即关闭认证。普通启动不修复 head 或采用旧快照。恢复由维护流程对照独立账号事实，默认禁用无法匹配的用户，并使全部旧会话/OTP 失效。加密/摘要密钥轮换有暂存索引唯一性检查，并在两库固定当前密钥指纹，旧进程不能继续写入。

离线导出要求显式 subject UUID 范围，只迁移对应手机号用户和已登记设备。新库保留 UUID，Frontvia 显式映射保留原 principal/client/order owner；不按手机号自动合并。迁移不复制旧会话、OTP、企业权限或订单。

本地迁移只复制设备公开记录/私钥引用，保留旧 client_id；原 Vault 不删除。迁移标记保存原 keyRef，移除一次性 legacyVault 配置并重启后也不会换身份。旧域名仅兼容登记 origin+handle 的三个公开 GET，拒绝带 Authorization/Cookie 的请求和其他路径/方法。具体生产 edge 规则尚未安装。

## 已执行验证

- 独立身份 Rust：9 项隔离 PostgreSQL 集成检查通过，覆盖 OTP 并发/失败/过期、密文、主体/设备/资源绑定、退出与重放、旧备份/禁用状态、加密导入、两个旧 origin 同 handle，以及密钥轮换后身份保持与旧进程拒绝。
- 独立宿主：类型检查、构建、1 项 owner 路由/受限输入/旧设备迁移与重启检查通过。旧令牌不进入新 Vault。
- 插件：类型检查、构建、106 项检查通过，包括 CN/CNY owner 确认、无咨询购买、付款链接不进入模型/外部 URL 拒绝、中立 Commerce 导入、三个包安装失败回滚（隔离 Profile，未安装真实桌面）。
- Frontvia：workspace 编译通过；library 检查 86 项通过、14 项需专用环境而忽略。单独运行原账号数据库契约、外部身份 PAP 数据库契约、旧主体映射/直接付款 SQL 数据库契约均通过。
- Frontvia 的无参数 `cargo test --workspace` 到既有 `a2_store_guards` 时因缺少专用 `FRONTVIA_A2_TEST_CONFIG` 停止，不能记为全仓完整通过。相关新功能使用独立数据库 runner 验证。

复现入口：独立身份 `IDENTITY_TEST_ADMIN=... cargo test --workspace --locked`、`pnpm check`；插件 `pnpm check`；Frontvia platform 下 `cargo test --workspace --lib --locked`，`tests/accounts/run.py --federation`、`--direct-payer`，以及无该选项的原账号契约。数据库 runner 必须使用专用隔离 PostgreSQL；本次使用 loopback 17643，未连接生产数据库。原账号大型测试需要 `RUST_MIN_STACK=33554432`，默认测试线程栈不足不等于业务失败。

## 本轮继续：双服务 TLS 与原生交易联调

新增两个可复现入口：Frontvia `platform/tests/identity/tls.py` 和 `platform/tests/identity/commerce.py`，运行要求见同目录 `README.md`。独立身份提供仅测试构建可用的真实 HTTP listener；只替换验证码投递。Platform 的 dev-dependency 启用本地证书/地址映射入口，普通生产依赖不启用，未关闭 TLS 校验。

- **PASS：双服务真实 HTTPS/PG。** 实际 OTP 登录、设备登记、CIMD/JWKS 拉取、短期凭证换票、资源访问；未知证书、错资源、凭证/DPoP 重放、跨用户、退出后访问均拒绝。身份服务断开时资源访问返回临时不可用，恢复后继续原会话，不降级游客。
- **PASS：连接导出与协商。** 商家管理接口导出直接 Commerce 配置，无 Agent 发布依赖；实际 PAP 元数据声明独立身份 profile 和 grant，买家以它们换票。
- **PASS：完整 Platform → 原生 Medusa/PG/Redis → 签名本地支付网关。** 不创建 Agent schema、不发布商家 Agent、关闭咨询购买。通过 PAP 直接查询 CNY 商品、准备地址配送/报价/checkout；确认前无订单和支付，篡改金额的 ES256 确认拒绝，同键重复确认复用同一笔原生订单。付款页重复启动只产生一笔本地二维码交易。
- **PASS：回调与原订单恢复。** 非法支付签名拒绝，合法/重复回调仍只有原交易；PAP 查询返回权威已付金额。身份服务不可用或退出后旧付款页拒绝访问。遵守真实 60 秒验证码冷却后，同一账号/设备重新登录保留原订单，取得新会话绑定链接，旧链接继续失效。
- 付款页继续使用现有保守 `409 PAYMENT_RESULT_UNKNOWN` 错误契约；此响应不代表付款失败，也不会创建替代订单。
- 本轮只构建交易模块和 Rust 必要目标，未全量构建 Web/Agent、未安装桌面、未发布或部署。短信与支付网络是受控替身；上述结果不能表述为真实短信、真实支付宝或真实 DSH 用户验收。

## 验收矩阵与剩余门禁

| 范围 | 状态与原因 |
| --- | --- |
| 双服务真实 TLS 联调 | PASS；真实独立身份 HTTP/PG + PAP + 校验证书的 HTTPS，投递验证码使用受控替身 |
| 无商家 Agent 的原生交易/支付链路 | PASS（受控渠道）；完整 Platform/Medusa/PG/Redis 与签名本地支付网关，真实支付宝仍未验证 |
| 实际 DSH 桌面/窄屏/键盘验收 | UNVERIFIED；未安装当前包，未覆盖真实宿主 UI |
| 真实短信、真实支付宝 | UNVERIFIED；未调用真实渠道 |
| 生产数据库最小权限、独立备份故障域、边缘精确代理、容量 | UNVERIFIED；手册给出要求，本次只操作本地隔离环境 |
| 跨密钥版本旧备份的恢复 | 保持关闭认证，不会自动采用旧密钥；完整恢复演练仍待完成 |
| 生产迁移、回滚、旧订单全集核验 | 未执行；当前证据是受控样本，正式人口范围与生产域名仍待运营配置 |

因此这是本地核心实现交付，SPEC 全部上线验收尚未完成。下一验收工作是实际 DSH 宿主、生产边缘/最小权限及迁移演练；真实渠道另行验收。创建远程仓库、提交/PR、安装、部署、生产迁移和真实渠道使用分别需要后续明确授权；本次没有执行。

本轮证据（本地忽略目录，不进入发布包）：

- TLS：`/Users/howard/workspace/frontvia-identity-pap/platform/.local/identity_tls_4f55ae15268f/report.json`，PASS。
- 原生交易：`/Users/howard/workspace/frontvia-identity-pap/platform/.local/evidence/432c76f7c93e/direct-report.json`，PASS、cleanup=true。
- `cargo test --workspace --lib --locked`：86 passed、0 failed、14 ignored；专用 TLS/native runner 另行执行，不将 ignored 当作通过。
- 普通生产依赖树不启用 `test-fixtures`。最终两个场景的临时数据库已清理，原有本地 PostgreSQL 集群保留。

## 本地提交

2026-11-06 用户授权“提交”，本轮实现分别保存于三个任务分支：

| 仓库 | 分支 | 提交 |
| --- | --- | --- |
| dsh-identity | `codex/identity-pap` | `f1aa8cf` |
| frontvia-core | `codex/identity-pap-direct-commerce` | `aeaad0a` |
| dsh-frontvia-plugins | `codex/spec-identity-pap-commerce` | 包含本记录的 `feat(plugins): use independent identity and direct PAP commerce` 提交 |

提交前重新 fetch，两现有仓库基线仍与 origin/main 对齐。此次仅创建本地提交，未创建远程仓库、push、PR、合并、安装或部署。保留上述既有验证结果；提交阶段只更新状态记录，未改动业务代码。

## PR #10 审查修复

- 历史咨询订单投影不再以“允许新咨询购买”为前提。capability unavailable 时，已接受订单仍验证并展示原 checkout、付款状态与同源付款入口；未确认摘要不会生成新的确认入口。
- 接受服务端合法的 US/USD/zh-CN 上下文，保留 CN/CNY/zh-CN 和 US/USD/en-US；未知组合继续拒绝。
- 新增 owner view 回归覆盖能力关闭前后、待付款到已付、链接不进入模型、外站链接拒绝及无新增提交；英文/中文美元店铺均走浏览、购物车、报价、owner 确认、原订单读取。
- 同步 main 的 DSH 0.2.2-rc.1 兼容更新，保留 main 锁文件中的当前宿主依赖。
- 本地 `pnpm check`（类型检查、构建、122 项测试）通过。未执行真实桌面安装、部署或真实支付。

## 复审：CN 完整地址无需拆分省市

- CN 地址允许仅提供国家、收件人、有效电话和完整 line1；省、市、邮编可省略或留空。表单标注选填，并将 line1 标为“完整收货地址”。
- 表单与宿主共用国家必填规则。发送 Commerce 请求前移除空的可选地址字段，保留完整地址；US 城市、州、邮箱和邮编仍必填。
- 回归通过严格 UI 请求入口保存省市缺省/空白两种地址，再验证重启恢复、配送选择、报价、本人确认及原订单付款入口；US 缺省省市在任何写入前被拒绝。
- 本轮类型检查、构建及 125 项插件测试通过；未安装桌面包或部署。
