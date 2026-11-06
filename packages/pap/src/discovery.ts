import { createHash } from "node:crypto";
import { z } from "zod";
import { fail } from "./storage.js";
import type { Transport } from "./network.js";

const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (!u.port || u.port === "443")
    );
  });
const siteSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    domain: z.string().max(253),
    issuer: httpsUrl,
    resource: httpsUrl,
  })
  .strict();
export const importSchema = z
  .object({
    format: z.string().max(128).optional(),
    discovery_url: httpsUrl,
    openapi_url: httpsUrl.optional(),
    profile: z.string().max(128).optional(),
    sites: z.array(siteSchema).min(1).max(20),
    authorization: z
      .object({
        admission: z.literal("automatic").optional(),
        allowed_client_ids: z.array(httpsUrl).max(100).optional(),
        resource: httpsUrl.optional(),
        token_type: z.literal("DPoP").optional(),
        client_identity: z.string().max(50).optional(),
      })
      .strict()
      .optional(),
    service: z
      .object({
        store_id: z.string().max(128).optional(),
        tenant_id: z.string().max(128).optional(),
        company_id: z.string().max(128).optional(),
        agent_id: z.string().max(128).optional(),
        environment: z.enum(["test", "live"]).optional(),
        configuration_revision: z.number().int().optional(),
        publication_revision: z.number().int().optional(),
      })
      .strict()
      .optional(),
    verification: z
      .object({
        client_connection: z.string().max(100).optional(),
        service: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ResourceDescription = {
  openapiUrl: string;
  openrpcUrl?: string;
  title: string;
  profile?: string;
  methods: string[];
};
export type ImportedSite = z.infer<typeof siteSchema> & {
  imported: true;
  discoveryUrl: string;
  description: ResourceDescription;
  allowedClientIds?: string[];
  service?: z.infer<typeof importSchema>["service"];
};
const methods = (values: unknown[]) =>
  [
    ...new Set(
      values.filter(
        (v): v is string =>
          typeof v === "string" && /^[a-z][a-z0-9_.]{1,127}$/.test(v),
      ),
    ),
  ].slice(0, 150);
export async function inspectImport(input: unknown, wire: Transport) {
  const config = importSchema.parse(input),
    source = new URL(config.discovery_url),
    first = config.sites[0];
  if (
    new Set(config.sites.map((s) => s.id)).size !== config.sites.length ||
    new Set(config.sites.map((s) => s.resource)).size !== config.sites.length ||
    source.pathname !== "/.well-known/poppy.json" ||
    source.search ||
    first.domain !== source.host ||
    config.sites.some(
      (s) => s.domain !== first.domain || s.issuer !== first.issuer,
    ) ||
    (config.authorization?.resource &&
      !config.sites.some((s) => s.resource === config.authorization!.resource))
  )
    fail("IMPORT_BINDING_MISMATCH");
  const doc = await wire({ url: config.discovery_url, method: "GET" });
  if (
    doc.protocol_version !== "0.2" ||
    doc.auth?.issuer !== first.issuer ||
    !Array.isArray(doc.apis)
  )
    fail("DISCOVERY_MISMATCH");
  for (const site of config.sites)
    if (
      !doc.apis.some(
        (a: any) => a.type === "openapi" && a.resource === site.resource,
      )
    )
      fail("DISCOVERY_MISMATCH");
  const result: ImportedSite[] = [];
  // Shared discovery may publish many shops. Inspect only exported resource
  // origins, including their sibling services; contracts stay on that origin.
  const resourceOrigins = new Set(
    config.sites.map((s) => new URL(s.resource).origin),
  );
  const apis = doc.apis.filter(
    (api: any) =>
      api?.type === "openapi" &&
      httpsUrl.safeParse(api.resource).success &&
      httpsUrl.safeParse(api.url).success &&
      resourceOrigins.has(new URL(api.resource).origin) &&
      new URL(api.url).origin === new URL(api.resource).origin,
  );
  for (const api of apis.slice(0, 20)) {
    if (result.some((s) => s.resource === api.resource))
      fail("INVALID_SERVICE_CONTRACT");
    const declared = config.sites.find((s) => s.resource === api.resource);
    if (
      declared &&
      config.openapi_url &&
      api.resource === (config.authorization?.resource ?? first.resource) &&
      config.openapi_url !== api.url
    )
      fail("IMPORT_BINDING_MISMATCH");
    const openapi = await wire({ url: api.url, method: "GET" });
    if (
      !/^3\./.test(openapi.openapi) ||
      !openapi.paths?.[new URL(api.resource).pathname]?.post
    )
      fail("INVALID_SERVICE_CONTRACT");
    let names = methods(
        Array.isArray(openapi["x-methods"]) ? openapi["x-methods"] : [],
      ),
      openrpcUrl: string | undefined;
    if (openapi.externalDocs?.url) {
      const u = httpsUrl.parse(openapi.externalDocs.url);
      if (new URL(u).origin !== new URL(api.resource).origin)
        fail("CONTRACT_ORIGIN_MISMATCH");
      const rpc = await wire({ url: u, method: "GET" });
      if (!rpc.openrpc || !Array.isArray(rpc.methods))
        fail("INVALID_SERVICE_CONTRACT");
      names = methods(rpc.methods.map((m: any) => m.name));
      openrpcUrl = u;
    }
    if (!names.length) continue;
    const profile =
      typeof openapi["x-profile"] === "string"
        ? openapi["x-profile"]
        : undefined;
    if (
      declared &&
      config.profile &&
      api.resource === first.resource &&
      profile &&
      config.profile !== profile
    )
      fail("IMPORT_BINDING_MISMATCH");
    result.push({
      id:
        declared?.id ??
        `resource-${createHash("sha256")
          .update(first.issuer + "\0" + api.resource)
          .digest("hex")
          .slice(0, 20)}`,
      label:
        declared?.label ??
        String(openapi.info?.title ?? "商家服务").slice(0, 200),
      domain: first.domain,
      issuer: first.issuer,
      resource: api.resource,
      imported: true,
      discoveryUrl: config.discovery_url,
      description: {
        openapiUrl: api.url,
        openrpcUrl,
        title: String(openapi.info?.title ?? "商家服务").slice(0, 200),
        profile,
        methods: names,
      },
      ...(declared
        ? {
            allowedClientIds:
              config.authorization?.admission === "automatic"
                ? undefined
                : config.authorization?.allowed_client_ids,
          }
        : {}),
      service: config.service,
    });
  }
  if (
    config.sites.some(
      (site) => !result.some((s) => s.resource === site.resource),
    )
  )
    fail("INVALID_SERVICE_CONTRACT");
  return result;
}
