import { createPublicKey } from "node:crypto";
import { PersonalAccount, type PersonalConfig } from "./personal.js";
import { DeviceIdentity } from "./device.js";
import { dpopProof } from "./signing.js";
import { fail, Vault } from "./storage.js";
import type { Secrets } from "./types.js";
import type { Transport } from "./network.js";
export { PersonalAccount } from "./personal.js";
export type { PersonalConfig } from "./personal.js";
export { DeviceIdentity } from "./device.js";
export type { ClientIdentity } from "./device.js";
export { Vault, PapError, fail } from "./storage.js";
export {
  openProfileVault,
  profileStorage,
  readProfileConfig,
} from "./profile.js";
export { PinnedAgents, httpsTransport, publicTransport } from "./network.js";
export type { Secrets } from "./types.js";
export type { Transport, Target } from "./network.js";
export const GRANT = "urn:dsh:params:oauth:grant-type:identity-assertion";
export const PROFILE = "dsh.identity_assertion.v1";

/** Host account port. Bearers stay within this package and its own transport. */
export class AccountClient {
  readonly apiVersion = 1;
  readonly device: DeviceIdentity;
  private account: PersonalAccount;
  constructor(
    readonly config: PersonalConfig,
    vault: Pick<Vault, "get" | "set">,
    private secrets: Secrets,
    private wire: Transport,
    deviceKeyRef: string,
  ) {
    this.account = new PersonalAccount(config, vault, wire);
    this.device = new DeviceIdentity(
      deviceKeyRef,
      this.account,
      vault,
      secrets,
      wire,
    );
  }
  current() {
    const { token: _, ...publicState } = this.account.current();
    return publicState;
  }
  identity() {
    return this.account.identity();
  }
  assert(generation: string) {
    this.account.assert(generation);
  }
  status() {
    return this.account.status();
  }
  refresh() {
    return this.account.refresh();
  }
  requestCode(phone: string) {
    return this.account.requestCode(phone);
  }
  verify(code: string) {
    return this.account.verify(code);
  }
  logout() {
    return this.account.logout();
  }
  async assertion(audience: string, resource: string, resourceKey: string) {
    if (!this.config.audiences.includes(audience))
      fail("IDENTITY_AUDIENCE_UNTRUSTED");
    const login = this.account.current(),
      device = await this.device.ensure();
    const key =
      (await this.secrets.get(device.signingKeyRef)) ??
      fail("SIGNING_KEY_REQUIRED");
    const url = this.config.origin + "/v1/federation/assertions";
    const r = await this.wire({
      url,
      method: "POST",
      headers: {
        Origin: this.config.requestOrigin,
        "Content-Type": "application/json",
        Authorization: "Bearer " + login.token,
        DPoP: dpopProof(key, url, login.token),
      },
      body: JSON.stringify({
        audience,
        resource,
        client_id: device.clientId,
        dpop_jwk: createPublicKey(resourceKey).export({ format: "jwk" }),
      }),
    });
    this.assert(login.generation);
    if (
      r.profile !== PROFILE ||
      typeof r.identity_assertion !== "string" ||
      r.identity_assertion.length > 16384 ||
      !(r.expires_in > 0 && r.expires_in <= 60)
    )
      fail("INVALID_IDENTITY_ASSERTION");
    return r.identity_assertion as string;
  }
}
