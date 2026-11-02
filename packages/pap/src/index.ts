import { Service, type Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  clientRequestSchema,
  type ConnectionRpcResult,
} from "@deepseek-ai/dsh-client-connection";
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PapService,
  Vault,
  fail,
  PapError,
  type PapConfig,
  type Secrets,
} from "./core.js";
export const name = "dsh-pap";
export const inject = ["credentials", "connection"];
export type Config = { configFile?: string };
export class PapProvider extends Service {
  readonly apiVersion = 1;
  constructor(
    ctx: Context,
    private core?: PapService,
  ) {
    super(ctx, "pap");
  }
  private ready() {
    return this.core ?? fail("PAP_CONFIGURATION_REQUIRED");
  }
  sites() {
    return this.core?.sites() ?? [];
  }
  status(ref?: string) {
    return this.core ? this.core.status(ref) : [];
  }
  identity(ref: string) {
    return this.ready().identity(ref);
  }
  discover(site: string) {
    return this.ready().discover(site);
  }
  connect(site: string) {
    return this.ready().connect(site);
  }
  authorize(ref: string, scopes: string[]) {
    return this.ready().authorize(ref, scopes);
  }
  callback(ref: string, url: string) {
    return this.ready().callback(ref, url);
  }
  disconnect(ref: string) {
    return this.ready().disconnect(ref);
  }
  request(ref: string, method: string, params: unknown, signal?: AbortSignal) {
    return this.ready().request(ref, method, params, signal);
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    pap: PapProvider;
  }
}
export async function apply(ctx: Context, config: Config = {}) {
  const secrets: Secrets = {
    get: async (ref) =>
      (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    set: (ref, value) => ctx.credentials.set(credentialRef(ref), value),
  };
  let core: PapService | undefined;
  if (config.configFile) {
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
    ) as PapConfig & { storageKeyRef: string };
    let key = await secrets.get(c.storageKeyRef);
    if (!key) key = randomBytes(32).toString("base64url");
    await secrets.set(c.storageKeyRef, key);
    const signing = await secrets.get(c.signingKeyRef);
    if (signing) await secrets.set(c.signingKeyRef, signing);
    const vault = new Vault(join(c.dataDir, "pap.sqlite"), key);
    core = new PapService(c, secrets, vault);
    ctx.effect(() => () => vault.close());
  }
  const service = new PapProvider(ctx, core);
  for (const operation of [
    "status",
    "connect",
    "disconnect",
    "authorize",
    "callback",
  ])
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `/api/pap/${operation}`,
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
          if (message.method !== `pap/${operation}`)
            return new Response(null, { status: 400 });
          let result: ConnectionRpcResult<unknown>;
          try {
            const a = message.payload as any;
            let value: any;
            if (operation === "status")
              value = {
                configured: !!core,
                sites: service.sites(),
                connections: service.status(),
              };
            else if (operation === "connect")
              value = await service.connect(String(a.siteId));
            else if (operation === "disconnect")
              value = await service.disconnect(String(a.connectionRef));
            else if (operation === "authorize")
              value = await service.authorize(
                String(a.connectionRef),
                a.scopes ?? [],
              );
            else
              value = await service.callback(
                String(a.connectionRef),
                String(a.url),
              );
            result = { ok: true, value };
          } catch (e) {
            result = {
              ok: false,
              error: {
                details: {},
                code: e instanceof PapError ? e.code : "PAP_REQUEST_FAILED",
                message: e instanceof PapError ? e.code : "连接操作未完成",
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
