# Identity service and PAP direct Commerce implementation

Authorized: local implementation of SPEC v0.2. Local commits additionally authorized by the user on 2026-11-06. No push/PR, remote repository creation, real installation/deployment, production migration or live SMS/payment performed.

## Workspaces and baseline
- Plugin: `/Users/howard/workspace/dsh-frontvia-cny-address`, `codex/spec-identity-pap-commerce`, fetched baseline `036a5ed`.
- Frontvia: `/Users/howard/workspace/frontvia-identity-pap`, `codex/identity-pap-direct-commerce`, fetched baseline `30917ea`.
- Independent identity: `/Users/howard/workspace/dsh-identity`, `codex/identity-pap`, initial local commit f1aa8cf; no remote; upstream UNVERIFIED.

## State
1. P0: implemented versioned extension, config and recovery contracts.
2. P1: implemented independent service/client, protected DB control, migration and key rotation; local PG/host checks pass.
3. P2: implemented external identity PAP exchange, resource and payer revalidation; local PG protocol contract passes. Actual double-service verified TLS/HTTP/PG contract now passes.
4. P3: implemented direct CN/CNY API/card/payer path; local plugin and server predicates pass. Full Platform/native Medusa/PG/Redis/signed local gateway contract now passes without any merchant Agent. Real Alipay and installed DSH remain unverified.
5. P4: controlled migration/restore/profile checks pass; real population migration, edge and cross-key backup recovery remain unverified.
6. P5: not executed; actual installation/cutover require separate authorization.

Detailed evidence and acceptance limits: `docs/implementation/dsh-identity-pap-commerce.md`. No local validation is labeled production or installed acceptance.
