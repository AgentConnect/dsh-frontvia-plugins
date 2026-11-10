import { Service, type Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-app-boot";
import { join } from "node:path";
import {
  AccountClient,
  profileStorage,
  openProfileVault,
  readProfileConfig,
  PinnedAgents,
  publicTransport,
  httpsTransport,
  Vault,
  fail,
  type PersonalConfig,
  type Target,
  type Secrets,
} from "./core.js";
export const name = "dsh-frontvia-client";
export const inject = ["credentials", "connection", "profileContext"];
export class IdentityProvider extends Service {
  constructor(
    ctx: Context,
    readonly account: AccountClient,
  ) {
    super(ctx, "frontviaIdentity");
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    frontviaIdentity: IdentityProvider;
  }
}
export async function apply(
  ctx: Context,
  config: { configFile?: string } = {},
) {
  // No guessed public origin: operator-provided trust is required before rollout.
  const c = readProfileConfig<
    PersonalConfig & {
      targets?: Target[];
      caFile?: string;
      legacyVault?: { path: string; keyRef: string; deviceKeyRef: string };
    }
  >(config.configFile ?? join(ctx.profileContext.dir, "identity-config.json"));
  const paths = profileStorage(ctx.profileContext, "identity");
  const secrets: Secrets = {
    get: async (r) => (await ctx.credentials.resolve(credentialRef(r)))?.value,
    set: (r, v) => ctx.credentials.set(credentialRef(r), v),
  };
  const vault = await openProfileVault(
    join(paths.dataDir, "identity.sqlite"),
    paths.storageKeyRef,
    secrets,
  );
  ctx.effect(() => () => vault.close());
  let deviceKeyRef = paths.storageKeyRef + "_DEVICE";
  const migrated = vault.get<{ keyRef: string; clientId: string }>(
    "identity-device-migration",
  );
  if (migrated) {
    const saved = vault.get<import("./core.js").ClientIdentity>("pap-device");
    if (
      !saved ||
      saved.clientId !== migrated.clientId ||
      saved.signingKeyRef !== migrated.keyRef ||
      !c.legacy ||
      new URL(saved.clientId).origin !== c.legacy.origin
    )
      fail("MIGRATION_DEVICE_CONFLICT");
    deviceKeyRef = migrated.keyRef;
  }
  if (c.legacyVault) {
    if (!c.legacy) fail("MIGRATION_IDENTITY_BINDING_REQUIRED");
    const key =
      (await secrets.get(c.legacyVault.keyRef)) ?? fail("STORAGE_KEY_REQUIRED");
    const previous = new Vault(c.legacyVault.path, key);
    try {
      const device =
        previous.get<import("./core.js").ClientIdentity>("pap-device");
      if (
        !device ||
        device.signingKeyRef !== c.legacyVault.deviceKeyRef ||
        new URL(device.clientId).origin !== c.legacy.origin ||
        !(await secrets.get(device.signingKeyRef))
      )
        fail("MIGRATION_DEVICE_BINDING_REQUIRED");
      const saved = vault.get<import("./core.js").ClientIdentity>("pap-device");
      if (
        saved &&
        (saved.clientId !== device.clientId ||
          saved.signingKeyRef !== device.signingKeyRef)
      )
        fail("MIGRATION_DEVICE_CONFLICT");
      if (!saved) vault.set("pap-device", device);
      deviceKeyRef = device.signingKeyRef;
      vault.set("identity-device-migration", {
        keyRef: deviceKeyRef,
        clientId: device.clientId,
      });
      // Never copy a bearer, OTP, or pending login. The new service requires OTP.
    } finally {
      previous.close();
    }
  }
  const agents = new PinnedAgents();
  const transport = c.targets?.length
    ? httpsTransport(c.targets, c.caFile, agents)
    : publicTransport([c.origin], undefined, agents);
  // Even protected test targets cannot receive the personal bearer at another origin.
  const account = new AccountClient(
    c,
    vault,
    secrets,
    (r) => {
      if (new URL(r.url).origin !== c.origin)
        throw new Error("IDENTITY_ORIGIN_MISMATCH");
      return transport(r);
    },
    deviceKeyRef,
  );
  ctx.effect(() => () => agents.close());
  new IdentityProvider(ctx, account);
  for (const operation of ["status", "requestCode", "verify", "logout"])
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `/api/frontvia-identity/${operation}`,
        methods: ["POST"],
        requestBody: "buffered",
        async fetch(request) {
          if (ctx.connection.browserPeer.principal.kind !== "owner")
            return new Response(null, { status: 403 });
          let m;
          try {
            m = clientRequestSchema.parse(await request.json());
            if (m.method !== `frontvia-identity/${operation}`)
              return new Response(null, { status: 400 });
            const p = m.payload as any;
            const keys =
              operation === "requestCode"
                ? ["phone"]
                : operation === "verify"
                  ? ["code"]
                  : [];
            if (
              !p ||
              Array.isArray(p) ||
              typeof p !== "object" ||
              Object.keys(p).some((k) => !keys.includes(k)) ||
              keys.some((k) => typeof p[k] !== "string")
            )
              return Response.json(
                {
                  type: "server-response",
                  rpcId: m.rpcId,
                  result: {
                    ok: false,
                    error: {
                      code: "INVALID_UI_REQUEST",
                      message: "请检查输入",
                      details: {},
                    },
                  },
                },
                { headers: { "cache-control": "no-store" } },
              );
            const value =
              operation === "status"
                ? await account.refresh()
                : operation === "requestCode"
                  ? await account.requestCode(p?.phone)
                  : operation === "verify"
                    ? await account.verify(p?.code)
                    : await account.logout();
            return Response.json(
              {
                type: "server-response",
                rpcId: m.rpcId,
                result: { ok: true, value },
              },
              { headers: { "cache-control": "no-store" } },
            );
          } catch (e) {
            const code =
              e instanceof Error && "code" in e && typeof e.code === "string"
                ? e.code
                : "IDENTITY_REQUEST_FAILED";
            return Response.json(
              {
                type: "server-response",
                rpcId: m?.rpcId,
                result: {
                  ok: false,
                  error: {
                    code,
                    message: "账号操作未完成，请重试",
                    details: {},
                  },
                },
              },
              { headers: { "cache-control": "no-store" } },
            );
          }
        },
      }),
    );
}
