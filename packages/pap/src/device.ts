import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import type { Secrets } from "./core.js";
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
const path = "/v1/personal/pap/devices";

export class DeviceIdentity {
  private serial = new Serial();
  constructor(
    private ref: string,
    private account: PersonalAccount,
    private vault: Vault,
    private secrets: Secrets,
    private wire: Transport,
  ) {}

  current(): ClientIdentity | undefined {
    const saved = this.vault.get<ClientIdentity>("pap-device");
    if (
      saved?.signingKeyRef === this.ref &&
      new URL(saved.clientId).origin === this.account.config?.origin
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
      const legacy = previous?.clientId.split("/").at(-2)?.includes(".");
      if (previous && (!legacy || previous.registryVersion === 2))
        return previous;
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
          body: JSON.stringify({ jwk, previous_client_id: previous?.clientId }),
        });
      } catch (e) {
        // The original endpoint rejects the new hint. Keep its existing URL
        // during a mixed-version rollout and retry migration on a later connect.
        if (previous && e instanceof PapError && e.code === "HTTP_400")
          return previous;
        if (e instanceof PapError && ["HTTP_404", "HTTP_405"].includes(e.code))
          fail("PAP_DEVICE_ENROLLMENT_UNAVAILABLE");
        throw e;
      }
      this.account.assert(login.generation);
      if (
        record?.kid !== kid ||
        typeof record.client_id !== "string" ||
        !record.client_id.startsWith(url + "/")
      )
        fail("INVALID_DEVICE_IDENTITY");
      const suffix = record.client_id.slice(url.length + 1);
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
        ...(record.registry_version === 2 ? { registryVersion: 2 } : {}),
      };
      this.vault.set("pap-device", identity);
      return identity;
    });
  }
}
