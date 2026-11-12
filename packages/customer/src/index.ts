import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  clientRequestSchema,
  type ConnectionRpcResult,
} from "@deepseek-ai/dsh-client-connection";
import type {} from "@awiki/dsh-pap/plugin";
import {Pap03Business} from "./pap03-business.js";
import {PapError,fail,type Secrets} from "./state.js";
import {openProfileVault,profileStorage,readProfileConfig} from "./profile.js";
import type {} from "@deepseek-ai/dsh-app-boot";
import { join } from "node:path";
import { CustomerService, type CustomerConfig } from "./core.js";
import { tools, guidance } from "./tools.js";
import { uiSchemas } from "./ui-contract.js";
export const name = "dsh-frontvia-customer";
export const inject = [
  "pap",
  "profileContext",
  "tools",
  "credentials",
  "connection",
  "systemPrompt",
];
export async function apply(
  ctx: Context,
  config: { configFile?: string } = {},
) {
  const c: CustomerConfig & { storageKeyRef: string } = config.configFile
    ? readProfileConfig(config.configFile)
    : profileStorage(ctx.profileContext, "customer");
  if(typeof ctx.pap.acquireBusiness!=="function")fail("PUBLIC_PAP_UPDATE_REQUIRED");
  const pap = new Pap03Business(ctx.pap.acquireBusiness(ctx));
  const secrets: Secrets = {
    get: async (ref) =>
      (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    set: (ref, v) => ctx.credentials.set(credentialRef(ref), v),
  };
  const vault = await openProfileVault(
    join(c.dataDir, "customer.sqlite"),
    c.storageKeyRef,
    secrets,
  );
  ctx.effect(() => () => vault.close());
  const service = new CustomerService(c, pap, vault);
  for (const tool of tools(service)) ctx.tools.register(tool as any);
  ctx.systemPrompt.section({
    name: "frontvia-customer:shopping",
    order: 3200,
    interpolate: false,
    text: ({ scope }) =>
      ctx.tools.get("frontvia_connection", scope) ? guidance : "",
  });
  for (const operation of Object.keys(uiSchemas) as (keyof typeof uiSchemas)[])
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `/api/frontvia-customer/${operation}`,
        methods: ["POST"],
        requestBody: "buffered",
        async fetch(request) {
          const peer = ctx.connection.browserPeer;
          if (peer.principal.kind !== "owner")
            return new Response(null, { status: 403 });
          let message;
          try {
            message = clientRequestSchema.parse(await request.json());
          } catch {
            return new Response(null, { status: 400 });
          }
          if (message.method !== `frontvia-customer/${operation}`)
            return new Response(null, { status: 400 });
          let result: ConnectionRpcResult<unknown>;
          try {
            const a = uiSchemas[operation].parse(message.payload) as any;
            let value: any;
            await pap.refresh();
            if (operation === "identity-status") value = pap.identityStatus();
            if (operation === "list") value = {flows:service.list(),sites:pap.sites()};
            if (operation === "open-store")
              value = await service.openStore(a.siteId, a.actionId);
            if (operation === "view")
              value = service.consultation.owns(a.flowId)
                ? await service.consultation.view(a.sessionId, a.flowId)
                : await service.view(a.sessionId, a.flowId, a.scopes);
            if (operation === "shopping")
              value = await service.shopping(
                a.sessionId,
                a.flowId,
                {
                  intent: a.intent,
                  expected_version: a.expected_version,
                  actionId: a.actionId,
                },
                request.signal,
              );
            if (operation === "original")
              value = await service.consultation.original(
                a.sessionId,
                a.flowId,
                a.sourceRef,
              );
            if (operation === "contact")
              value = await service.contact(
                a.sessionId,
                a.flowId,
                a.expected_version,
                a.patch,
                a.actionId,
              );
            if (operation === "review")
              value = await service.review(a.sessionId, a.flowId);
            if (operation === "order-cancel")
              value = await service.cancelOrder(a.sessionId, a.flowId);
            if (operation === "payment-start")
              value = await service.startPayment(a.sessionId, a.flowId);
            if (operation === "confirm")
              value = await service.confirm(a.sessionId, a.flowId, a.intentId);
            // Legacy accepted operations remain recoverable; never create a new
            // purchase by submitting a confirmation message to an Agent.
            if (operation === "shopping-confirm")
              fail("DIRECT_COMMERCE_REQUIRED");
            if (operation === "discard-cart-add")
              value = await service.discardCartAddition(a.sessionId, a.flowId);
            if (operation === "retry-cart")
              value = await service.retryCart(a.sessionId, a.flowId);
            if (operation === "recover") {
              await service.tool(
                a.sessionId,
                service.consultation.owns(a.flowId)
                  ? "frontvia_consultation"
                  : "frontvia_orders",
                { flowId: a.flowId, action: "recover" },
                "ui-recovery",
                request.signal,
              );
              value = service.consultation.owns(a.flowId)
                ? await service.consultation.view(a.sessionId, a.flowId)
                : await service.view(a.sessionId, a.flowId, a.scopes);
            }
            result = { ok: true, value: value&&typeof value==="object"&&!Array.isArray(value)?{...value,identityRevision:pap.revision()}:value };
          } catch (e) {
            result = {
              ok: false,
              error: {
                details: {},
                code: e instanceof PapError ? e.code : "INVALID_UI_REQUEST",
                message:
                  e instanceof PapError
                    ? e.code
                    : "请求未完成，请检查输入后重试",
              },
            };
          }
          return Response.json(
            { type: "server-response", rpcId: message.rpcId, result },
            { headers: { "cache-control": "no-store" } },
          );
        },
      }),
    );
}
