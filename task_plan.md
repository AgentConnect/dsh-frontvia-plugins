# DSH PAP + Frontvia Customer implementation

## Objective and authority
Implement the approved dual-plugin plan in this new local repository. Official DSH 0.2.1-rc.3, TypeScript/pnpm, human click confirmation in chat, isolated identity and Mock payments. No publishing, deployment, commit or push. Do not modify unrelated Frontvia work.

## Phases
- [complete] 1. Baseline, runtime contracts and workspace scaffolding.
- [complete] 2. Generic PAP service, durable encrypted state and protocol tests.
- [complete] 3. Customer commerce tools, confirmation and recovery tests.
- [complete] 4. Native DSH cards, dependency lifecycle and packages.
- [complete] 5. Isolated actual Frontvia/DSH acceptance, bounded real model (five turns total), documentation and cleanup evidence. FINAL report: docs/acceptance.md.
- [complete] Follow-up: shadcn-based interactive form/card refinement, scoped theme styles, RPC error compatibility, 23 behavior tests and 25 controlled UI checks. Report: docs/ui-refresh.md.

## Fixed decisions
- Packages: dsh-pap and dsh-frontvia-customer. Customer requires PAP via peer dependency and Cordis injection; installer activates both bundles.
- PAP is protocol-only. Customer owns business references, schemas, progress and confirmation. No generic network/model confirmation tool.
- Client identity signing key, DPoP key, encryption key and confirmation key stay outside model/browser payloads.
- Write request and original key persisted before network. Unknown results block replacement writes; query original operation.
- Frontvia pap_subject_purchase.v1 is approved-client business extension, not PAP standard payment.
- New repository has no remote/commits: upstream alignment UNVERIFIED by definition. Frontvia fetched origin/main 5e8cb68b44aa630de2cc634d9b75d2da8c7033f7 before work.

## Errors and corrections
- Scaffolding git init initially targeted parent workspace; verified it was newly-created, unborn and had no remotes, then moved that exact .git into the new repository. No pre-existing repository was changed.
