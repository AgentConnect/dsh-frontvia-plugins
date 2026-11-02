# Implementation findings

- Reference plugin: /Users/howard/Documents/ChatGPT/amazon-picker. Its native UI uses host React, connection owner routes, slots main/sidebar/tool.call.toolview/conversation.chat.turnTail. Output canonical JSON follows DSH tool schemas.
- Reference DSH source checkout has unrelated dirty work and is older than installed runtime; do not edit it. Installed official app is 0.2.1-rc.3; use matching packages and bundled CLI.
- Frontvia /Users/howard/workspace/frontvia-core is on current main 5e8cb68. Unrelated six UI/test files dirty at start; leave untouched.
- Frontvia public contract: docs/api/frontvia-commerce-v1.openrpc.json. PAP reference web/buyer-lab/protocol.ts. Confirmation reference web/buyer-lab/confirmation.ts and platform/crates/platform-server/src/buyer_subject.rs.
- First-version subject purchase does not require merchant password login; stable random client+issuer scoped user ID maps to native Customer. Contact email is never identity.
- Account Direct Sign-In/PKCE is generic PAP capability, separate from subject purchase checkout support.
- Host default Node 22.23.2 is too old for rc.3; /opt/homebrew/bin/node is 25.2.1. pnpm 10.28.2 available.

- Installed both local tarballs into isolated `.local/dsh-home` Profile `frontvia`; bundle list contains dsh-base, dsh-web-app, dsh-pap, dsh-frontvia-customer. Unconfigured real DSH host starts successfully on port 4347.
- Existing Frontvia PG cluster is stopped; first native startup failed at database connection before creating resources, cleanup PASS. Created a task-owned PG16 cluster on 21439 instead of starting or changing shared state.
- Native acceptance fixture generates its own C1 signing key/CIMD/JWKS and own short-lived confirmation key; no existing client identity is reused.

- Final installed rc.3 integration requires top-level object tool schemas and id/config patches. Content-addressed tarballs avoid same-version pnpm cache; installer compares installed bundle bytes.
- Actual Commerce orders.list returns references, despite the full-order page expectation; resolve through public orders.get and refresh on historical card open.
- Current checkout cancel accepts checkout_id/meta but rejects optional reason; use it only for unconfirmed zero-authorized/zero-captured draft revision, never order cancellation.
- Native result is one Mock order/capture (USD 17.34). Five real-model turns total include two preflight failures; final regression is controlled. Native Electron and real account OAuth browser flow remain UNVERIFIED; see FINAL report.
