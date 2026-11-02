import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { Vault, Serial, fail } from "./storage.js";
import { httpsTransport, type Transport, type Target } from "./network.js";
export { Vault, Serial, PapError, fail, canonical } from "./storage.js";
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
};
type Connection = {
  id: string;
  siteId: string;
  user: string;
  proofKey: string;
  metadata: any;
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
export function jwt(key: string, header: any, claims: any) {
  const data = [header, claims]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return `${data}.${sign("sha256", Buffer.from(data), { key: createPrivateKey(key), dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
export class PapService {
  readonly apiVersion = 1;
  private serial = new Serial();
  private wire: Transport;
  constructor(
    readonly config: PapConfig,
    private secrets: Secrets,
    private vault: Vault,
    transport?: Transport,
  ) {
    if (
      new URL(config.clientId).protocol !== "https:" ||
      new URL(config.callback).origin !== new URL(config.clientId).origin ||
      !config.sites.every(
        (s) =>
          new URL(s.issuer).protocol === "https:" &&
          new URL(s.resource).protocol === "https:",
      )
    )
      fail("INVALID_CLIENT_CONFIGURATION");
    this.wire = transport ?? httpsTransport(config.targets, config.caFile);
  }
  private site(id: string) {
    return (
      this.config.sites.find((x) => x.id === id) ?? fail("SITE_NOT_APPROVED")
    );
  }
  private load(ref: string) {
    return (
      this.vault.get<Connection>(`connection:${ref}`) ??
      fail("CONNECTION_REQUIRED")
    );
  }
  private save(c: Connection) {
    this.vault.set(`connection:${c.id}`, c);
  }
  private public(c: Connection) {
    const site = this.site(c.siteId);
    return {
      connectionRef: c.id,
      siteId: site.id,
      label: site.label,
      domain: site.domain,
      issuer: site.issuer,
      resource: site.resource,
      signedIn: !!c.signedIn,
      connected:
        !c.disconnected && !!c.accessToken && (c.expiresAt ?? 0) > now(),
      expiresAt: c.expiresAt,
    };
  }
  sites() {
    return this.config.sites.map((s) => ({
      id: s.id,
      label: s.label,
      domain: s.domain,
    }));
  }
  status(ref?: string) {
    return ref
      ? this.public(this.load(ref))
      : this.vault
          .keys("connection:")
          .map((k) => this.public(this.vault.get<Connection>(k)!));
  }
  /** Host-only subject binding; never returned by Agent tools. */
  identity(ref: string) {
    const c = this.load(ref),
      s = this.site(c.siteId);
    return {
      clientId: this.config.clientId,
      userId: c.user,
      issuer: s.issuer,
      resource: s.resource,
      signedIn: !!c.signedIn,
    };
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
    const key =
      (await this.secrets.get(this.config.signingKeyRef)) ??
      fail("CLIENT_KEY_REQUIRED");
    const claims = (sub: string) => ({
      iss: this.config.clientId,
      sub,
      aud: this.site(c.siteId).issuer,
      iat: now(),
      exp: now() + 60,
      jti: random(),
    });
    const header = { alg: "ES256", typ: "JWT", kid: this.config.keyId };
    return {
      client_id: this.config.clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: jwt(key, header, claims(this.config.clientId)),
      assertion: jwt(key, header, claims(c.user)),
    };
  }
  private proof(c: Connection, url: string, token?: string) {
    return jwt(
      c.proofKey,
      {
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: createPublicKey(c.proofKey).export({ format: "jwk" }),
      },
      {
        htm: "POST",
        htu: url,
        iat: now(),
        jti: random(),
        ...(token ? { ath: hash(token) } : {}),
      },
    );
  }
  private async token(c: Connection, fields: Record<string, string>) {
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
    if (c.sessionId && c.sessionId !== value.session_id)
      fail("SESSION_CHANGED");
    if (c.signedIn && !value.signed_in) fail("SESSION_DOWNGRADE");
    Object.assign(c, {
      accessToken: value.access_token,
      sessionId: value.session_id,
      signedIn: value.signed_in,
      expiresAt: now() + value.expires_in,
      disconnected: false,
    });
    if (value.refresh_token) c.refreshToken = value.refresh_token;
    this.save(c);
    return this.public(c);
  }
  async connect(siteId: string) {
    return this.serial.run(`site:${siteId}`, async () => {
      const { metadata } = await this.discover(siteId);
      let c = this.vault
        .keys("connection:")
        .map((k) => this.vault.get<Connection>(k)!)
        .find((c) => c.siteId === siteId);
      if (!c) {
        c = {
          id: randomUUID(),
          siteId,
          user: random(),
          proofKey: generateKeyPairSync("ec", {
            namedCurve: "prime256v1",
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
          }).privateKey,
          metadata,
        };
        this.save(c);
      } else {
        c.metadata = metadata;
        this.save(c);
      }
      if (c.disconnected && c.signedIn)
        fail("ACCOUNT_REAUTHORIZATION_REQUIRED");
      return this.renew(c.id);
    });
  }
  async renew(ref: string) {
    return this.serial.run(ref, async () => {
      const c = this.load(ref);
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
    });
  }
  async authorize(ref: string, scopes: string[]) {
    return this.serial.run(ref, async () => {
      const c = this.load(ref);
      if (!c.sessionId) fail("SESSION_REQUIRED");
      if (scopes.some((s) => !/^[A-Za-z0-9:._-]{1,120}$/.test(s)))
        fail("INVALID_SCOPE");
      c.pending = { state: random(), verifier: random(), created: now() };
      this.save(c);
      const q = new URLSearchParams({
        response_type: "code",
        client_id: this.config.clientId,
        redirect_uri: this.config.callback,
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
        expected = new URL(this.config.callback),
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
        redirect_uri: this.config.callback,
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
  async request(
    ref: string,
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ) {
    let c = this.load(ref);
    if (c.disconnected) fail("CONNECTION_DISCONNECTED");
    if (!c.accessToken || (c.expiresAt ?? 0) <= now() + 10) {
      await this.renew(ref);
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
    });
    if (
      reply?.jsonrpc !== "2.0" ||
      reply.id !== id ||
      Boolean("result" in reply) === Boolean("error" in reply)
    )
      fail("INVALID_RPC_RESPONSE");
    return reply;
  }
}
