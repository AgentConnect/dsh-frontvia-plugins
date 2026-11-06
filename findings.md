# Findings
- PAP external subjects must preserve legacy principal/client pairs explicitly, never by phone. Merchant account ownership remains unchanged.
- Direct CNY needed independent owner-confirmed operation/nonce predicates in hosted_payer; the original reserve/accepted-summary branch remains for old orders.
- Binding payer links only to the original login would prevent payment after re-login. v2 instead MAC-binds each returned link to its requesting PAP session while retaining the original durable purchase authority.
- Identity data/control head mismatch fails closed; account enabled/contact facts survive a data restore. Key fingerprints in both databases also fence stale key configurations after rotation.
- Removing the one-time legacy Vault migration config must preserve the old device keyRef, so a durable migration marker now owns that reference.
- Commerce export adds identity_profile to the strict import schema; authority still comes from verified metadata/protected identity config, not imported JSON.
- Existing workspace-wide integration suites need owned A2 environment configuration. Library checks and targeted disposable PG contracts are the relevant completed local evidence, not full E2E.

## 2026-11-06 联调结果

独立身份和原生 Commerce 的协议在真实 HTTP/TLS、隔离数据库和原生交易服务上互通，无商家 Agent 前置条件。付款页沿用保守 409 PAYMENT_RESULT_UNKNOWN 契约；身份服务不可用会关闭付款页能力，不能当作支付失败重建订单。同一账号/设备重新登录保留 merchant principal、原订单与已付金额；新链接绑定新 PAP session，旧链接不复活。测试证书必须是服务端用途，不能把 CA:TRUE 证书用作终端证书；未关闭证书校验。
