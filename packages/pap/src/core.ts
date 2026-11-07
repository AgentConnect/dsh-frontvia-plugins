import { dpopProof, jwt } from "./signing.js";
export { jwt } from "./signing.js";
import {
  AccountClient,
  GRANT,
  PROFILE,
  type ClientIdentity,
  type DeviceIdentity,
} from "dsh-identity-client/core";
import type { PersonalConfig } from "dsh-identity-client/core";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Vault, Serial, fail, canonical } from "./storage.js";
import {
  httpsTransport,
  frontviaAccountOrigin,
  PinnedAgents,
  publicTransport,
  type Transport,
  type Target,
} from "./network.js";
import {
  inspectImport,
  parseServiceLink,
  importSchema,
  type ImportedSite,
  type ResourceDescription,
} from "./discovery.js";
export type { ImportedSite, ResourceDescription } from "./discovery.js";
export { Vault, Serial, PapError, fail, canonical } from "./storage.js";
export {
  readProfileConfig,
  profileStorage,
  openProfileVault,
} from "./profile.js";
export type { Transport, Target } from "./network.js";
export type Secrets = {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
};
export type Site = {
  id: string;
  label: string;
  domain: string;
  issuer: string;
  resource: string;
  imported?: boolean;
  description?: ResourceDescription;
  service?: ImportedSite["service"];
  allowedClientIds?: string[];
  discoveryUrl?: string;
};
export type PapConfig = {
  clientId: string;
  callback: string;
  signingKeyRef: string;
  keyId: string;
  sites: Site[];
  targets: Target[];
  caFile?: string;
  dataDir: string;
  personal?: PersonalConfig;
};
export type AccountOnlyConfig = Omit<PapConfig, keyof ClientIdentity> & {
  clientId?: undefined;
  deviceSigningKeyRef?: string;
};
type Connection = {
  id: string;
  siteId: string;
  user: string;
  personalIdentity?: string;
  personalGeneration?: string;
  proofKey: string;
  metadata: any;
  binding?: {
    clientId: string;
    callback: string;
    domain: string;
    issuer: string;
    resource: string;
  };
  sessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  signedIn?: boolean;
  disconnected?: boolean;
  pending?: { state: string; verifier: string; created: number };
};
const now = () => Math.floor(Date.now() / 1000);
const random = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
export class PapService {
  readonly apiVersion = 1;
  private serial = new Serial();
  readonly personal: AccountClient;
  private readonly device?: DeviceIdentity;
  private wire: Transport;
  private agents = new PinnedAgents();
  private inspectionWire?: Transport;
  private previews = new Map<
    string,
    { expires: number; sites: ImportedSite[] }
  >();
  constructor(
    readonly config: PapConfig | AccountOnlyConfig,
    private secrets: Secrets,
    private vault: Vault,
    transport?: Transport,
    account?: AccountClient,
  ) {
    if (
      (config.clientId === undefined
        ? !config.personal ||
          "callback" in config ||
          "keyId" in config ||
          "signingKeyRef" in config
        : new URL(config.clientId).protocol !== "https:" ||
          new URL(config.callback).origin !==
            new URL(config.clientId).origin) ||
      !config.sites.every(
        (s) =>
          new URL(s.issuer).protocol === "https:" &&
          new URL(s.resource).protocol === "https:",
      )
    )
      fail("INVALID_CLIENT_CONFIGURATION");
    this.inspectionWire = transport;
    const agents = this.agents;
    const fixed = httpsTransport(config.targets, config.caFile, agents);
    this.wire =
      transport ??
      (async (request) => {
        if (
          config.targets.some((t) => t.origin === new URL(request.url).origin)
        )
          return fixed(request);
        const origins = this.allSites()
          .filter((s) => s.imported)
          .flatMap((s) => [
            new URL(`https://${s.domain}`).origin,
            new URL(s.issuer).origin,
            new URL(s.resource).origin,
          ]);
        return publicTransport(origins, undefined, agents)(request);
      });
    if (config.personal && !account) fail("IDENTITY_PROVIDER_REQUIRED");
    this.personal =
      account ??
      ({
        config: undefined,
        status: () => ({ configured: false, signedIn: false }),
        refresh: async () => ({ configured: false, signedIn: false }),
      } as unknown as AccountClient);
    if (config.personal) this.device = account?.device;
  }
  private client(): ClientIdentity {
    if (!this.config.personal && this.config.clientId !== undefined)
      return this.config;
    return this.device?.current() ?? fail("PAP_CLIENT_IDENTITY_REQUIRED");
  }
  close() {
    this.agents.close();
  }
  private configuredSites(): Site[] {
    return [
      ...this.config.sites,
      ...(this.vault.get<ImportedSite[]>("imported-sites") ?? []),
    ];
  }
  private allSites(): Site[] {
    const removed = this.vault.get<string[]>("removed-sites") ?? [];
    return this.configuredSites().filter((s) => !removed.includes(s.id));
  }
  private siteRevision(site: Site) {
    return hash(
      canonical(site) +
        "\0" +
        (this.vault.get<string>(`site-generation:${site.id}`) ?? "initial"),
    );
  }
  private site(id: string) {
    return (
      this.allSites().find((x) => x.id === id) ?? fail("SITE_NOT_APPROVED")
    );
  }
  private stored(ref: string) {
    return (
      this.vault.get<Connection>(`connection:${ref}`) ??
      fail("CONNECTION_REQUIRED")
    );
  }
  private binding(siteId: string) {
    const { domain, issuer, resource } = this.site(siteId);
    return {
      clientId: this.client().clientId,
      callback: this.client().callback,
      domain,
      issuer,
      resource,
    };
  }
  private bindingError(c: Connection) {
    if (c.personalIdentity || this.config.personal) {
      try {
        if (c.personalIdentity !== this.personal.identity())
          return "PERSONAL_ACCOUNT_CHANGED";
      } catch {
        return "PERSONAL_LOGIN_REQUIRED";
      }
    }
    if (!this.allSites().some((s) => s.id === c.siteId))
      return "SITE_NOT_APPROVED";
    if (!c.binding) return "CONNECTION_BINDING_REQUIRED";
    if (this.config.clientId === undefined && !this.device?.current())
      return "PAP_CLIENT_IDENTITY_REQUIRED";
    const expected = this.binding(c.siteId);
    if (this.device && c.binding.clientId !== expected.clientId)
      return "DEVICE_IDENTITY_REPLACED";
    if (
      Object.entries(expected).some(
        ([key, value]) => c.binding![key as keyof typeof expected] !== value,
      )
    )
      return "CONNECTION_BINDING_CHANGED";
  }
  private load(ref: string) {
    const c = this.stored(ref),
      error = this.bindingError(c);
    if (error) fail(error);
    return c;
  }
  private save(c: Connection) {
    this.vault.set(`connection:${c.id}`, c);
  }
  private public(c: Connection) {
    const site = this.allSites().find((s) => s.id === c.siteId),
      bindingError = this.bindingError(c);
    return {
      connectionRef: c.id,
      siteId: c.siteId,
      label: site?.label ?? c.siteId,
      domain: c.binding?.domain ?? site?.domain,
      issuer: c.binding?.issuer ?? site?.issuer,
      resource: c.binding?.resource ?? site?.resource,
      ...(bindingError ? { bindingError } : {}),
      signedIn: !!c.signedIn,
      ...(c.personalIdentity ? { personalSignedIn: true } : {}),
      connected:
        !bindingError &&
        !c.disconnected &&
        (!c.personalIdentity ||
          c.personalGeneration === this.personal.current().generation) &&
        !!c.accessToken &&
        (c.expiresAt ?? 0) > now(),
      expiresAt: c.expiresAt,
    };
  }
  sites() {
    return this.allSites().map((s) => ({
      id: s.id,
      revision: this.siteRevision(s),
      label: s.label,
      domain: s.domain,
      issuer: s.issuer,
      resource: s.resource,
      description: s.description,
      service: s.service,
      clientAllowed: undefined,
    }));
  }
  removedSites() {
    const removed = this.vault.get<string[]>("removed-sites") ?? [];
    return this.configuredSites()
      .filter((s) => removed.includes(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        domain: s.domain,
        resource: s.resource,
        revision: this.siteRevision(s),
      }));
  }
  /** Owner UI only. Retain identity/history references; never cancel remote orders. */
  async removeSite(siteId: string, expectedRevision: string) {
    return this.serial.run("imports", () =>
      this.serial.run(`site:${siteId}`, async () => {
        const refs = this.vault
          .keys("connection:")
          .filter((key) => this.vault.get<Connection>(key)!.siteId === siteId);
        const lockConnections = async (index: number): Promise<void> => {
          if (index < refs.length)
            return this.serial.run(
              refs[index].slice("connection:".length),
              () => lockConnections(index + 1),
            );
          const site = this.site(siteId);
          if (this.siteRevision(site) !== expectedRevision)
            fail("SITE_REVISION_CHANGED");
          this.vault.transaction(() => {
            for (const key of refs) {
              const connection = this.vault.get<Connection>(key)!;
              delete connection.accessToken;
              delete connection.refreshToken;
              delete connection.pending;
              connection.disconnected = true;
              this.save(connection);
            }
            this.vault.set("removed-sites", [
              ...new Set([
                ...(this.vault.get<string[]>("removed-sites") ?? []),
                siteId,
              ]),
            ]);
            this.vault.set(`site-generation:${siteId}`, randomUUID());
          });
          // A preview made before removal cannot silently re-enable the service.
          this.previews.clear();
        };
        await lockConnections(0);
        return { removed: true, siteId };
      }),
    );
  }
  async restoreSite(siteId: string, expectedRevision: string) {
    return this.serial.run("imports", () =>
      this.serial.run(`site:${siteId}`, async () => {
        const removed = this.vault.get<string[]>("removed-sites") ?? [];
        const site = this.configuredSites().find((s) => s.id === siteId);
        if (!site || !removed.includes(siteId)) fail("SITE_NOT_REMOVED");
        if (this.siteRevision(site) !== expectedRevision)
          fail("SITE_REVISION_CHANGED");
        this.vault.transaction(() => {
          this.vault.set(
            "removed-sites",
            removed.filter((id) => id !== siteId),
          );
          this.vault.set(`site-generation:${siteId}`, randomUUID());
        });
        return { restored: true, siteId };
      }),
    );
  }
  async clientStatus() {
    const client =
      this.config.clientId === undefined ? this.device?.current() : this.config;
    return {
      clientId: client?.clientId,
      callback: client?.callback,
      signingKeyConfigured: !!(
        client && (await this.secrets.get(client.signingKeyRef))
      ),
      automatic: !!this.device,
    };
  }
  /** Owner UI only. Discovery is not authentication or business authorization. */
  async inspect(input: unknown) {
    const link = typeof input === "string" ? parseServiceLink(input) : null;
    const config = link ? null : importSchema.parse(input),
      origins = link
        ? [new URL(link.discoveryUrl).origin, new URL(link.resource).origin]
        : [
            new URL(config!.discovery_url).origin,
            ...config!.sites.map((s) => new URL(s.issuer).origin),
            ...config!.sites.map((s) => new URL(s.resource).origin),
          ];
    const sites = await inspectImport(
      link ? input : config,
      this.inspectionWire ??
        ((request) =>
          this.config.targets.some(
            (t) => t.origin === new URL(request.url).origin,
          )
            ? httpsTransport(this.config.targets, this.config.caFile)(request)
            : publicTransport(origins)(request)),
    );
    // Importing a link for a previously configured binding must retain its
    // local ID, sessions and account association rather than create a duplicate.
    if (link)
      for (const site of sites) {
        const prior = this.configuredSites().find(
          (s) =>
            s.imported &&
            s.domain === site.domain &&
            s.issuer === site.issuer &&
            s.resource === site.resource,
        );
        if (prior) site.id = prior.id;
      }
    const previewId = randomUUID();
    for (const [key, p] of this.previews)
      if (p.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 10)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(previewId, { expires: Date.now() + 600000, sites });
    return {
      previewId,
      client: await this.clientStatus(),
      sites: sites.map((s) => ({
        ...s,
        clientAllowed: undefined,
      })),
      verification: "discovered",
    };
  }
  async importResources(previewId: string, resources: string[]) {
    return this.serial.run("imports", async () => {
      const preview = this.previews.get(previewId);
      if (!preview || preview.expires < Date.now())
        fail("IMPORT_PREVIEW_EXPIRED");
      if (
        !Array.isArray(resources) ||
        !resources.length ||
        resources.length > 20 ||
        new Set(resources).size !== resources.length
      )
        fail("INVALID_IMPORT_SELECTION");
      const requested = resources.map(
        (resource) =>
          preview.sites.find((s) => s.resource === resource) ??
          fail("INVALID_IMPORT_SELECTION"),
      );
      const prior = this.vault.get<ImportedSite[]>("imported-sites") ?? [];
      const configured = this.configuredSites();
      for (const site of requested) {
        const same = configured.find((s) => s.id === site.id);
        if (
          same &&
          (!same.imported ||
            same.issuer !== site.issuer ||
            same.resource !== site.resource ||
            same.domain !== site.domain)
        )
          fail("SITE_BINDING_CONFLICT");
      }
      // Resolve bindings inside the import lock, after validating requested IDs.
      // Previews may precede another import, and JSON/link IDs can differ.
      const selected = requested.map((site) => {
        const existing = prior.find(
          (s) =>
            s.domain === site.domain &&
            s.issuer === site.issuer &&
            s.resource === site.resource,
        );
        return {
          ...site,
          id: existing?.id ?? site.id,
          service: site.service ?? existing?.service,
        };
      });
      const next = [
        ...prior.filter((s) => !selected.some((n) => n.id === s.id)),
        ...selected,
      ];
      if (next.length > 100) fail("SITE_LIMIT");
      this.vault.transaction(() => {
        this.vault.set("imported-sites", next);
        this.vault.set(
          "removed-sites",
          (this.vault.get<string[]>("removed-sites") ?? []).filter(
            (id) => !selected.some((s) => s.id === id),
          ),
        );
        for (const site of selected)
          this.vault.set(`site-generation:${site.id}`, randomUUID());
      });
      this.previews.delete(previewId);
      return { sites: this.sites(), verification: "discovered" };
    });
  }
  status(ref?: string) {
    return ref
      ? (() => {
          const c = this.stored(ref);
          if (!this.visible(c)) fail("PERSONAL_ACCOUNT_CHANGED");
          return this.public(c);
        })()
      : this.vault
          .keys("connection:")
          .map((k) => this.vault.get<Connection>(k)!)
          .filter((c) => this.visible(c))
          .map((c) => this.public(c));
  }
  canAccess(ref: string) {
    return this.visible(this.stored(ref));
  }
  private visible(c: Connection) {
    if (!c.personalIdentity && !this.config.personal) return true;
    try {
      return c.personalIdentity === this.personal.identity();
    } catch {
      return false;
    }
  }
  /** Opaque host-only metadata generation; not a credential or authorization. */
  capabilityCacheKey(ref: string): string | undefined {
    const c = this.load(ref);
    if (!this.public(c).connected || (c.expiresAt ?? 0) <= now() + 10) return;
    return hash(
      canonical([
        c.id,
        c.user,
        c.personalGeneration,
        c.expiresAt,
        c.accessToken,
        c.signedIn,
        this.siteRevision(this.site(c.siteId)),
      ]),
    );
  }
  /** Host-only subject binding; never returned by Agent tools. */
  identity(ref: string) {
    const c = this.load(ref),
      s = this.site(c.siteId);
    return {
      clientId: this.client().clientId,
      userId: c.user,
      ...(c.personalIdentity ? { personalSignedIn: true } : {}),
      issuer: s.issuer,
      resource: s.resource,
      signedIn: !!c.signedIn,
    };
  }
  /** Host-only, resource-bound statement. No key material leaves the PAP owner. */
  signResourceStatement(
    ref: string,
    typ: string,
    claims: Record<string, unknown>,
  ) {
    const c = this.load(ref),
      site = this.site(c.siteId);
    if (!c.personalIdentity) fail("PERSONAL_LOGIN_REQUIRED");
    if (
      typ !== "frontvia-personal-purchase+jwt" ||
      claims.client_id !== this.client().clientId ||
      claims.issuer !== site.issuer ||
      claims.resource !== site.resource
    )
      fail("STATEMENT_BINDING_MISMATCH");
    return jwt(
      c.proofKey,
      {
        alg: "ES256",
        typ,
        jwk: createPublicKey(c.proofKey).export({ format: "jwk" }),
      },
      claims,
    );
  }
  async discover(siteId: string) {
    const s = this.site(siteId),
      origin = new URL(`https://${s.domain}`);
    const doc = await this.wire({
      url: `${origin.origin}/.well-known/poppy.json`,
      method: "GET",
    });
    if (
      doc.protocol_version !== "0.2" ||
      doc.auth?.issuer !== s.issuer ||
      !doc.apis?.some(
        (a: any) => a.type === "openapi" && a.resource === s.resource,
      )
    )
      fail("DISCOVERY_MISMATCH");
    const u = new URL(s.issuer);
    const metadata = await this.wire({
      url: `${u.origin}/.well-known/oauth-authorization-server${u.pathname === "/" ? "" : u.pathname}`,
      method: "GET",
    });
    if (
      metadata.issuer !== s.issuer ||
      !metadata.poppy_domains?.includes(origin.hostname)
    )
      fail("ISSUER_MISMATCH");
    for (const key of [
      "token_endpoint",
      "authorization_endpoint",
      "revocation_endpoint",
    ])
      if (
        typeof metadata[key] !== "string" ||
        new URL(metadata[key]).origin !== u.origin
      )
        fail("ENDPOINT_MISMATCH");
    return { site: s, metadata };
  }
  private async fields(c: Connection) {
    const client = this.client();
    const key =
      (await this.secrets.get(client.signingKeyRef)) ??
      fail("CLIENT_KEY_REQUIRED");
    const claims = (sub: string) => ({
      iss: client.clientId,
      sub,
      aud: this.site(c.siteId).issuer,
      iat: now(),
      exp: now() + 60,
      jti: random(),
    });
    const header = { alg: "ES256", typ: "JWT", kid: client.keyId };
    return {
      client_id: client.clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: jwt(key, header, claims(client.clientId)),
      assertion: jwt(key, header, claims(c.user)),
    };
  }
  private proof(c: Connection, url: string, token?: string) {
    return dpopProof(c.proofKey, url, token);
  }
  private async token(c: Connection, fields: Record<string, string>) {
    const generation = c.personalIdentity
      ? this.personal.current().generation
      : undefined;
    const auth = await this.fields(c);
    delete (auth as Partial<typeof auth>).assertion;
    const endpoint = c.metadata.token_endpoint;
    const value = await this.wire({
      url: endpoint,
      method: "POST",
      body: new URLSearchParams({ ...auth, ...fields }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: this.proof(c, endpoint),
      },
    });
    if (
      typeof value.access_token !== "string" ||
      value.token_type !== "DPoP" ||
      typeof value.session_id !== "string" ||
      typeof value.signed_in !== "boolean" ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      fail("INVALID_TOKEN_RESPONSE");
    if (generation) this.personal.assert(generation);
    if (!c.personalIdentity && c.sessionId && c.sessionId !== value.session_id)
      fail("SESSION_CHANGED");
    if (c.signedIn && !value.signed_in) fail("SESSION_DOWNGRADE");
    Object.assign(c, {
      accessToken: value.access_token,
      sessionId: value.session_id,
      signedIn: value.signed_in,
      expiresAt: now() + value.expires_in,
      disconnected: false,
      personalGeneration: generation,
    });
    if (value.refresh_token) c.refreshToken = value.refresh_token;
    this.save(c);
    return this.public(c);
  }
  async connect(siteId: string) {
    return this.serial.run(`site:${siteId}`, async () => {
      const personalIdentity = this.config.personal
        ? this.personal.identity()
        : undefined;
      const generation = this.config.personal
        ? this.personal.current().generation
        : undefined;
      const site = this.site(siteId);
      if (this.device) await this.device.ensure();
      if (generation) this.personal.assert(generation);
      const client = this.client();
      let c = this.vault
        .keys("connection:")
        .map((k) => this.vault.get<Connection>(k)!)
        .find(
          (c) =>
            c.siteId === siteId &&
            c.personalIdentity === personalIdentity &&
            (!this.device ||
              !c.binding ||
              c.binding.clientId === client.clientId),
        );
      if (c) {
        const ref = c.id;
        const reusable = await this.serial.run(ref, async () => {
          const current = this.load(ref);
          return this.public(current).connected &&
            (current.expiresAt ?? 0) > now() + 10
            ? this.public(current)
            : null;
        });
        if (reusable) return reusable;
      }
      const { metadata } = await this.discover(siteId);
      if (generation) this.personal.assert(generation);
      if (!c) {
        c = {
          id: randomUUID(),
          siteId,
          user: personalIdentity
            ? hash(personalIdentity + "\0" + site.issuer)
            : this.subject(site.issuer),
          personalIdentity,
          proofKey: generateKeyPairSync("ec", {
            namedCurve: "prime256v1",
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
          }).privateKey,
          metadata,
          binding: this.binding(siteId),
        };
        this.save(c);
      }
      const ref = c.id;
      return this.serial.run(ref, async () => {
        const current = this.load(ref);
        current.metadata = metadata;
        this.save(current);
        return this.renewConnection(current);
      });
    });
  }
  private subject(issuer: string) {
    const key = `subject:${hash(this.client().clientId + "\0" + issuer)}`;
    let user = this.vault.get<string>(key);
    if (!user) {
      user =
        this.vault
          .keys("connection:")
          .map((k) => this.vault.get<Connection>(k)!)
          .find(
            (c) =>
              c.binding?.clientId === this.client().clientId &&
              c.binding?.issuer === issuer,
          )?.user ?? random();
      this.vault.set(key, user);
    }
    return user;
  }
  async renew(ref: string) {
    return this.serial.run(ref, () => {
      const c = this.load(ref);
      if (c.disconnected) fail("CONNECTION_DISCONNECTED");
      return this.renewConnection(c);
    });
  }
  private async renewConnection(c: Connection) {
    if (c.personalIdentity) {
      this.load(c.id);
      if (
        !c.metadata.identity_assertion_profiles_supported?.includes(PROFILE) ||
        !c.metadata.grant_types_supported?.includes(GRANT)
      )
        fail("IDENTITY_PROFILE_UNSUPPORTED");
      return this.token(c, {
        grant_type: GRANT,
        identity_assertion: await this.personal.assertion(
          this.site(c.siteId).issuer,
          this.site(c.siteId).resource,
          c.proofKey,
        ),
        resource: this.site(c.siteId).resource,
      });
    }
    if (c.signedIn) {
      if (!c.refreshToken || c.disconnected)
        fail("ACCOUNT_REAUTHORIZATION_REQUIRED");
      return this.token(c, {
        grant_type: "refresh_token",
        refresh_token: c.refreshToken,
        session_id: c.sessionId!,
      });
    }
    return this.token(c, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: (await this.fields(c)).assertion,
      resource: this.site(c.siteId).resource,
      ...(c.sessionId ? { session_id: c.sessionId } : {}),
    });
  }
  async authorize(ref: string, scopes: string[]) {
    if (this.load(ref).personalIdentity)
      fail("PERSONAL_COMMERCE_AUTHORIZATION_UNAVAILABLE");
    return this.serial.run(ref, async () => {
      const c = this.load(ref);
      if (!c.sessionId) fail("SESSION_REQUIRED");
      if (scopes.some((s) => !/^[A-Za-z0-9:._-]{1,120}$/.test(s)))
        fail("INVALID_SCOPE");
      c.pending = { state: random(), verifier: random(), created: now() };
      this.save(c);
      const q = new URLSearchParams({
        response_type: "code",
        client_id: this.client().clientId,
        redirect_uri: this.client().callback,
        resource: this.site(c.siteId).resource,
        scope: scopes.join(" "),
        state: c.pending.state,
        code_challenge: hash(c.pending.verifier),
        code_challenge_method: "S256",
        session_id: c.sessionId,
      });
      return { url: `${c.metadata.authorization_endpoint}?${q}` };
    });
  }
  async callback(ref: string, raw: string) {
    return this.serial.run(ref, async () => {
      const u = new URL(raw),
        expected = new URL(this.client().callback),
        c = this.load(ref),
        q = u.searchParams,
        p = c.pending;
      if (
        u.origin !== expected.origin ||
        u.pathname !== expected.pathname ||
        u.hash ||
        !p ||
        now() - p.created > 600 ||
        q.get("state") !== p.state ||
        q.get("iss") !== this.site(c.siteId).issuer ||
        ["state", "iss", "code", "error"].some((k) => q.getAll(k).length > 1)
      )
        fail("CALLBACK_REJECTED");
      if (!q.get("code") && !q.has("error")) fail("CALLBACK_REJECTED");
      delete c.pending;
      this.save(c);
      if (q.has("error")) fail("AUTHORIZATION_DENIED");
      return this.token(c, {
        grant_type: "authorization_code",
        code: q.get("code")!,
        code_verifier: p.verifier,
        redirect_uri: this.client().callback,
        session_id: c.sessionId!,
      });
    });
  }
  async disconnect(ref: string) {
    return this.serial.run(ref, async () => {
      const c = this.load(ref);
      if (c.refreshToken) {
        const auth = await this.fields(c);
        delete (auth as Partial<typeof auth>).assertion;
        await this.wire({
          url: c.metadata.revocation_endpoint,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ...auth,
            token: c.refreshToken,
            token_type_hint: "refresh_token",
          }).toString(),
        });
      }
      delete c.accessToken;
      delete c.refreshToken;
      delete c.pending;
      c.disconnected = true;
      this.save(c);
      return this.public(c);
    });
  }
  /** Owner payment UI only: redeem the server-issued, single-order payer capability.
   * Never send PAP credentials to this endpoint or accept an arbitrary UI URL.
   */
  async hostedPayment(ref: string, link: string, checkoutId: string) {
    return this.serial.run(ref, async () => {
      const c = this.load(ref);
      if (c.disconnected) fail("CONNECTION_DISCONNECTED");
      const issuer = new URL(this.site(c.siteId).issuer);
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return fail("INVALID_PAYMENT_LINK");
      }
      const entries = [...url.searchParams.keys()];
      const expires = Number(url.searchParams.get("expires"));
      const access = url.searchParams.get("access") ?? "";
      if (
        url.protocol !== "https:" ||
        url.origin !== issuer.origin ||
        url.username ||
        url.password ||
        url.hash ||
        !/^[a-f0-9-]{36}$/i.test(checkoutId) ||
        !/^\/companies\/[^/]+$/.test(issuer.pathname) ||
        url.pathname !== `${issuer.pathname}/pay/${checkoutId}` ||
        entries.length !== 2 ||
        new Set(entries).size !== 2 ||
        !entries.includes("expires") ||
        !entries.includes("access") ||
        !Number.isSafeInteger(expires) ||
        expires <= now() ||
        !/^(?:[A-Za-z0-9_-]{43}|v2\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43})$/i.test(
          access,
        )
      )
        fail("INVALID_PAYMENT_LINK");
      const generation = c.personalIdentity
        ? this.personal.current().generation
        : undefined;
      const reply = await this.wire({
        url: `${issuer.origin}${issuer.pathname}/hosted-payer/rpc`,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: issuer.origin },
        body: JSON.stringify({
          method: "start",
          checkout_id: checkoutId,
          expires,
          access,
        }),
        timeoutMs: 45000,
        maxResponseBytes: 512 * 1024,
      });
      if (generation) this.personal.assert(generation);
      this.load(ref);
      return reply;
    });
  }
  async request(
    ref: string,
    method: string,
    params: unknown,
    signal?: AbortSignal,
    options?: { maxResponseBytes: number },
  ) {
    return this.serial.run(ref, async () => {
      signal?.throwIfAborted();
      let c = this.load(ref);
      const site = this.site(c.siteId);
      if (site.description && !site.description.methods.includes(method))
        fail("METHOD_NOT_ADVERTISED");
      if (c.disconnected) fail("CONNECTION_DISCONNECTED");
      if (
        c.personalIdentity &&
        c.personalGeneration !== this.personal.current().generation
      ) {
        delete c.accessToken;
        delete c.sessionId;
      }
      const generation = c.personalIdentity
        ? this.personal.current().generation
        : undefined;
      if (!c.accessToken || (c.expiresAt ?? 0) <= now() + 10) {
        await this.renewConnection(c);
        c = this.load(ref);
      }
      const url = this.site(c.siteId).resource,
        id = randomUUID();
      const reply = await this.wire({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `DPoP ${c.accessToken}`,
          DPoP: this.proof(c, url, c.accessToken),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal,
        timeoutMs: 45000,
        maxResponseBytes: options?.maxResponseBytes,
      });
      if (generation) this.personal.assert(generation);
      this.load(ref);
      if (
        reply?.jsonrpc !== "2.0" ||
        reply.id !== id ||
        Boolean("result" in reply) === Boolean("error" in reply)
      )
        fail("INVALID_RPC_RESPONSE");
      return reply;
    });
  }
}
