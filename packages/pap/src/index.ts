import type {} from "dsh-identity-client";
import { Service, type Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  clientRequestSchema,
  type ConnectionRpcResult,
} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-app-boot";
import { join } from "node:path";
import {
  PapService,
  profileStorage,
  readProfileConfig,
  openProfileVault,
  fail,
  PapError,
  type PapConfig,
  type AccountOnlyConfig,
  type Secrets,
} from "./core.js";
export const name = "dsh-pap";
export const inject = [
  "credentials",
  "connection",
  "profileContext",
  "identity",
];
export type Config = { configFile?: string };
export class PapProvider extends Service {
  readonly apiVersion = 1;
  constructor(
    ctx: Context,
    private core: PapService,
  ) {
    super(ctx, "pap");
  }
  sites() {
    return this.core.sites();
  }
  removedSites() {
    return this.core.removedSites();
  }
  removeSite(siteId: string, revision: string) {
    return this.core.removeSite(siteId, revision);
  }
  restoreSite(siteId: string, revision: string) {
    return this.core.restoreSite(siteId, revision);
  }
  status(ref?: string) {
    return this.core.status(ref);
  }
  canAccess(ref: string) {
    return this.core.canAccess(ref);
  }
  capabilityCacheKey(ref: string) {
    return this.core.capabilityCacheKey(ref);
  }
  identity(ref: string) {
    return this.core.identity(ref);
  }
  hostedPayment(ref: string, link: string, checkoutId: string) {
    return this.core.hostedPayment(ref, link, checkoutId);
  }
  signResourceStatement(
    ref: string,
    typ: string,
    claims: Record<string, unknown>,
  ) {
    return this.core.signResourceStatement(ref, typ, claims);
  }
  discover(site: string) {
    return this.core.discover(site);
  }
  connect(site: string) {
    return this.core.connect(site);
  }
  clientStatus() {
    return this.core.clientStatus();
  }
  // Host-only account operations for the Frontvia owner UI. Keep the existing
  // encrypted session owner so PAP grants and account switching share one fence.
  personalStatus() {
    return this.core.personal.refresh();
  }
  requestPersonalCode(phone: string) {
    return this.core.personal.requestCode(phone);
  }
  verifyPersonalCode(code: string) {
    return this.core.personal.verify(code);
  }
  logoutPersonal() {
    return this.core.personal.logout();
  }
  inspect(input: unknown) {
    return this.core.inspect(input);
  }
  importResources(previewId: string, resources: string[]) {
    return this.core.importResources(previewId, resources);
  }
  authorize(ref: string, scopes: string[]) {
    return this.core.authorize(ref, scopes);
  }
  callback(ref: string, url: string) {
    return this.core.callback(ref, url);
  }
  disconnect(ref: string) {
    return this.core.disconnect(ref);
  }
  request(
    ref: string,
    method: string,
    params: unknown,
    signal?: AbortSignal,
    options?: { maxResponseBytes: number },
  ) {
    return this.core.request(ref, method, params, signal, options);
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
  const c: (PapConfig | AccountOnlyConfig) & { storageKeyRef: string } =
    config.configFile
      ? readProfileConfig<
          (PapConfig | AccountOnlyConfig) & { storageKeyRef: string }
        >(config.configFile)
      : {
          ...profileStorage(ctx.profileContext, "pap"),
          targets: [],
          personal: ctx.identity.account.config,
        };
  if ("signingKeyRef" in c) {
    const key = await secrets.get(c.signingKeyRef);
    if (key) await secrets.set(c.signingKeyRef, key);
  }
  const vault = await openProfileVault(
    join(c.dataDir, "pap.sqlite"),
    c.storageKeyRef,
    secrets,
  );
  ctx.effect(() => () => vault.close());
  const policy =
    c.clientId === undefined
      ? { ...c, deviceSigningKeyRef: c.storageKeyRef + "_DEVICE" }
      : c;
  const core = new PapService(
    policy,
    secrets,
    vault,
    undefined,
    ctx.identity?.account,
  );
  ctx.effect(() => () => core.close());
  const service = new PapProvider(ctx, core);
  for (const operation of [
    "status",
    "connect",
    "disconnect",
    "authorize",
    "callback",
    "inspect",
    "import",
    "remove",
    "restore",
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
            if (operation === "status") {
              const personal = await core.personal.refresh();
              value = {
                configured: true,
                sites: service.sites(),
                removedSites: service.removedSites(),
                connections: service.status(),
                personal: {
                  configured: personal.configured,
                  signedIn: personal.signedIn,
                  phone: personal.phone,
                  expiresAt: personal.expiresAt,
                  logoutPending: personal.logoutPending,
                },
                client: await service.clientStatus(),
              };
            } else if (operation === "inspect")
              value = await service.inspect(a.configuration);
            else if (operation === "import")
              value = await service.importResources(a.previewId, a.resources);
            else if (operation === "remove" || operation === "restore") {
              if (
                !a ||
                Object.keys(a).sort().join(",") !== "revision,siteId" ||
                typeof a.siteId !== "string" ||
                !a.siteId ||
                a.siteId.length > 128 ||
                typeof a.revision !== "string" ||
                !/^[A-Za-z0-9_-]{43}$/.test(a.revision)
              )
                fail("INVALID_CONFIGURATION_ACTION");
              value =
                operation === "remove"
                  ? await service.removeSite(a.siteId, a.revision)
                  : await service.restoreSite(a.siteId, a.revision);
            } else if (operation === "connect")
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
