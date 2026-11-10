import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import type { Secrets } from "./types.js";
import type { Transport } from "./network.js";
import type { PersonalAccount } from "./personal.js";
import { dpopProof } from "./signing.js";
import { fail, PapError, Serial, Vault } from "./storage.js";

export type ClientIdentity = {
  clientId: string;
  callback: string;
  keyId: string;
  signingKeyRef: string;
  registryVersion?: number;
};
const path = "/v1/devices";

export class DeviceIdentity {
  private serial = new Serial();
  constructor(
    private ref: string,
    private account: PersonalAccount,
    private vault: Pick<Vault, "get" | "set">,
    private secrets: Secrets,
    private wire: Transport,
  ) {}

  current(): ClientIdentity | undefined {
    const saved = this.vault.get<ClientIdentity>("pap-device");
    if (
      saved?.signingKeyRef === this.ref &&
      [
        this.account.config?.origin,
        this.account.config?.legacy?.origin,
      ].includes(new URL(saved.clientId).origin)
    )
      return saved;
  }

  async ensure() {
    return this.serial.run("device", async () => {
      const login = this.account.current();
      const origin = this.account.config!.origin;
      const url = origin + path;
      // Only the configured account origin may receive the personal bearer.
      const token = login.token;
      let key = await this.secrets.get(this.ref);
      if (!key) {
        key = generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
          publicKeyEncoding: { type: "spki", format: "pem" },
        }).privateKey;
        await this.secrets.set(this.ref, key);
      }
      const jwk = createPublicKey(key).export({ format: "jwk" });
      const kid = createHash("sha256")
        .update(
          JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
        )
        .digest("base64url");
      const saved = this.current();
      const previous = saved?.keyId === kid ? saved : undefined;
      if (previous?.registryVersion === 3) return previous;
      this.account.assert(login.generation);
      let record;
      try {
        record = await this.wire({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: this.account.config!.requestOrigin,
            Authorization: "Bearer " + token,
            DPoP: dpopProof(key, url, token),
          },
          body: JSON.stringify({
            jwk,
            ...(previous ? { previous_client_id: previous.clientId } : {}),
          }),
        });
      } catch (e) {
        if (
          e instanceof Error &&
          "code" in e &&
          ["HTTP_404", "HTTP_405"].includes(String(e.code))
        )
          fail("PAP_DEVICE_ENROLLMENT_UNAVAILABLE");
        throw e;
      }
      this.account.assert(login.generation);
      if (
        record?.kid !== kid ||
        typeof record.client_id !== "string" ||
        !(
          record.client_id.startsWith(url + "/") ||
          (previous && record.client_id === previous.clientId)
        )
      )
        fail("INVALID_DEVICE_IDENTITY");
      const base = record.client_id.startsWith(url + "/")
        ? url
        : this.account.config!.legacy!.origin + "/v1/personal/pap/devices";
      const suffix = record.client_id.slice(base.length + 1);
      if (
        !/^[A-Za-z0-9._-]{1,220}\/agent\.json$/.test(suffix) ||
        record.callback !==
          record.client_id.replace(/agent\.json$/, "callback") ||
        new URL(record.client_id).href !== record.client_id
      )
        fail("INVALID_DEVICE_IDENTITY");
      const identity = {
        clientId: record.client_id,
        callback: record.callback,
        keyId: kid,
        signingKeyRef: this.ref,
        ...(record.registry_version === 3 ? { registryVersion: 3 } : {}),
      };
      this.vault.set("pap-device", identity);
      return identity;
    });
  }
}
