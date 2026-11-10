import { randomUUID, createHash } from "node:crypto";
import { Vault, Serial, fail, PapError } from "./storage.js";
import type { Transport } from "./network.js";

export type PersonalConfig = {
  origin: string;
  requestOrigin: string;
  /** Explicit merchant issuers allowed to receive short-lived assertions. */
  audiences: string[];
  legacy?: { origin: string; subjects: string[] };
};
type Login = {
  userId: string;
  token: string;
  expiresAt: number;
  phone: string;
  generation: string;
  origin: string;
};
type State = {
  login?: Login;
  pendingLogout?: Login;
  challenge?: {
    id: string;
    phone: string;
    expiresAt: number;
    resendAt: number;
  };
  generation: string;
};
const tick = () => Math.floor(Date.now() / 1000);
const origin = (value: string) => {
  const u = new URL(value);
  return u.protocol === "https:" && u.origin === value;
};

/** Host-only credentials. No bearer, challenge identifier, or OTP enters tools. */
export class PersonalAccount {
  private serial = new Serial();
  constructor(
    readonly config: PersonalConfig | undefined,
    private vault: Pick<Vault, "get" | "set">,
    private wire: Transport,
  ) {
    if (
      config &&
      (!origin(config.origin) ||
        (config.legacy &&
          (!origin(config.legacy.origin) ||
            !config.legacy.subjects.every((s) => /^[0-9a-f-]{36}$/.test(s)))) ||
        !origin(config.requestOrigin) ||
        !config.audiences.length ||
        !config.audiences.every((s) => {
          const u = new URL(s);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            !u.hash &&
            !u.search
          );
        }))
    )
      fail("INVALID_PERSONAL_CONFIGURATION");
  }
  private state(): State {
    return (
      this.vault.get<State>("personal-account") ?? { generation: "initial" }
    );
  }
  private save(s: State) {
    this.vault.set("personal-account", s);
  }
  private configured() {
    return this.config ?? fail("PERSONAL_CONFIGURATION_REQUIRED");
  }
  current() {
    const c = this.configured(),
      s = this.state();
    if (
      s.pendingLogout ||
      !s.login ||
      s.login.expiresAt <= tick() ||
      s.login.origin !== c.origin
    )
      fail("PERSONAL_LOGIN_REQUIRED");
    return s.login;
  }
  identity() {
    const p = this.current();
    return createHash("sha256")
      .update(
        (this.config?.legacy?.subjects.includes(p.userId)
          ? this.config.legacy.origin
          : p.origin) +
          "\0" +
          p.userId,
      )
      .digest("base64url");
  }
  assert(generation: string) {
    if (this.current().generation !== generation)
      fail("PERSONAL_ACCOUNT_CHANGED");
  }
  status() {
    const s = this.state();
    let p: Login | undefined;
    try {
      p = this.current();
    } catch {}
    return {
      configured: !!this.config,
      signedIn: !!p,
      phone: p?.phone,
      expiresAt: p?.expiresAt,
      logoutPending: !!s.pendingLogout,
      challenge:
        s.challenge && s.challenge.expiresAt > tick()
          ? {
              phone: s.challenge.phone,
              expiresAt: s.challenge.expiresAt,
              resendAt: s.challenge.resendAt,
            }
          : undefined,
    };
  }
  private call(path: string, body: unknown, token?: string) {
    const c = this.configured();
    return this.wire({
      url: c.origin + "/v1/auth/" + path,
      method: path === "me" ? "GET" : "POST",
      headers: {
        Origin: c.requestOrigin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async refresh() {
    let p: Login;
    try {
      p = this.current();
    } catch {
      return this.status();
    }
    try {
      const me = await this.call("me", undefined, p.token);
      this.assert(p.generation);
      if (typeof me?.user_id !== "string") fail("INVALID_RESPONSE");
      if (me.user_id !== p.userId) fail("PERSONAL_ACCOUNT_CHANGED");
    } catch (e) {
      if (
        e instanceof Error &&
        "code" in e &&
        (e.code === "HTTP_401" || e.code === "PERSONAL_ACCOUNT_CHANGED")
      ) {
        const s = this.state();
        if (s.login?.generation === p.generation) {
          delete s.login;
          s.generation = randomUUID();
          this.save(s);
        }
      } else throw e;
    }
    return this.status();
  }
  async requestCode(phone: string) {
    return this.serial.run("account", async () => {
      const s = this.state();
      if (s.pendingLogout) fail("PERSONAL_LOGOUT_PENDING");
      if (
        s.login?.origin === this.configured().origin &&
        s.login.expiresAt > tick()
      )
        fail("PERSONAL_LOGOUT_REQUIRED");
      if (typeof phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(phone))
        fail("INVALID_PHONE");
      if (s.challenge && s.challenge.resendAt > tick()) fail("OTP_RESEND_WAIT");
      const r = await this.call("otp/request", {
        phone,
      });
      if (
        typeof r.challenge_id !== "string" ||
        !Number.isFinite(r.expires_in) ||
        r.expires_in <= 0 ||
        r.expires_in > 300 ||
        !Number.isFinite(r.resend_after)
      )
        fail("INVALID_RESPONSE");
      if (this.state().generation !== s.generation)
        fail("PERSONAL_ACCOUNT_CHANGED");
      s.challenge = {
        id: r.challenge_id,
        phone: phone.slice(0, 3) + " •••• " + phone.slice(-4),
        expiresAt: tick() + r.expires_in,
        resendAt: tick() + r.resend_after,
      };
      this.save(s);
      return this.status();
    });
  }
  async verify(code: string) {
    return this.serial.run("account", async () => {
      const s = this.state(),
        c = s.challenge;
      if (s.pendingLogout) fail("PERSONAL_LOGOUT_PENDING");
      if (!c || c.expiresAt <= tick()) fail("OTP_EXPIRED");
      if (typeof code !== "string" || !/^\d{6}$/.test(code))
        fail("INVALID_OTP");
      const r = await this.call("otp/verify", { challenge_id: c.id, code });
      if (
        typeof r.user_id !== "string" ||
        typeof r.access_token !== "string" ||
        !r.access_token.startsWith("dsh.personal.") ||
        !Number.isFinite(r.expires_in) ||
        r.expires_in <= 0 ||
        r.expires_in > 86400
      )
        fail("INVALID_RESPONSE");
      const generation = randomUUID();
      const login = {
        userId: r.user_id,
        token: r.access_token,
        expiresAt: tick() + r.expires_in,
        phone: c.phone,
        generation,
        origin: this.configured().origin,
      };
      if (this.state().generation !== s.generation) {
        this.save({ generation, pendingLogout: login });
        fail("PERSONAL_ACCOUNT_CHANGED");
      }
      this.save({ generation, login });
      return this.status();
    });
  }
  async logout() {
    // Disable local use synchronously, including requests already in flight.
    const s = this.state();
    if (s.login) s.pendingLogout = s.login;
    delete s.login;
    delete s.challenge;
    s.generation = randomUUID();
    this.save(s);
    return this.serial.run("account", async () => {
      const current = this.state(),
        p = current.pendingLogout;
      if (p && p.expiresAt > tick()) {
        if (p.origin !== this.configured().origin)
          fail("PERSONAL_LOGOUT_PENDING");
        try {
          await this.call("logout", {}, p.token);
        } catch (e) {
          if (!(e instanceof Error && "code" in e && e.code === "HTTP_401"))
            fail("PERSONAL_LOGOUT_PENDING");
        }
      }
      this.save({ generation: randomUUID() });
      return this.status();
    });
  }
  /** Internal only: personal bearer can only be sent to this identity service. */
  token(endpoint: string) {
    if (new URL(endpoint).origin !== this.configured().origin)
      fail("PERSONAL_TOKEN_ORIGIN_UNTRUSTED");
    return this.current().token;
  }
}
