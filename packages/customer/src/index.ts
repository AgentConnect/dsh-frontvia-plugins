import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  clientRequestSchema,
  type ConnectionRpcResult,
} from "@deepseek-ai/dsh-client-connection";
import type {} from "dsh-pap";
import { Vault, PapError, fail, type Secrets } from "dsh-pap/core";
import { lstatSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CustomerService, type CustomerConfig } from "./core.js";
import { tools, guidance } from "./tools.js";
import { uiSchemas } from "./ui-contract.js";
export const name = "dsh-frontvia-customer";
export const inject = [
  "pap",
  "tools",
  "credentials",
  "connection",
  "systemPrompt",
];
export async function apply(
  ctx: Context,
  config: { configFile?: string } = {},
) {
  if (!config.configFile) return;
  const st = lstatSync(config.configFile);
  if (
    st.isSymbolicLink() ||
    !st.isFile() ||
    st.uid !== process.getuid?.() ||
    st.mode & 0o077
  )
    fail("PROTECTED_CONFIG_REQUIRED");
  const c = JSON.parse(
    readFileSync(config.configFile, "utf8"),
  ) as CustomerConfig & { storageKeyRef: string };
  const secrets: Secrets = {
    get: async (ref) =>
      (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    set: (ref, v) => ctx.credentials.set(credentialRef(ref), v),
  };
  let key = await secrets.get(c.storageKeyRef);
  if (!key) key = randomBytes(32).toString("base64url");
  await secrets.set(c.storageKeyRef, key);
  for (const site of c.sites) {
    const value = await secrets.get(site.confirmationKeyRef);
    if (value) await secrets.set(site.confirmationKeyRef, value);
  }
  const vault = new Vault(join(c.dataDir, "customer.sqlite"), key);
  ctx.effect(() => () => vault.close());
  const service = new CustomerService(c, ctx.pap, secrets, vault);
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
            if (operation === "list")
              value = { flows: service.list(), sites: ctx.pap.sites() };
            if (operation === "view")
              value = await service.view(a.sessionId, a.flowId);
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
            if (operation === "confirm")
              value = await service.confirm(a.sessionId, a.flowId, a.intentId);
            if (operation === "recover") {
              await service.tool(
                a.sessionId,
                "frontvia_orders",
                { flowId: a.flowId, action: "recover" },
                "ui-recovery",
                request.signal,
              );
              value = await service.view(a.sessionId, a.flowId);
            }
            result = { ok: true, value };
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
