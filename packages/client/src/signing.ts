import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
} from "node:crypto";
export function jwt(key: string, header: any, claims: any) {
  const data = [header, claims]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return `${data}.${sign("sha256", Buffer.from(data), { key: createPrivateKey(key), dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
export function dpopProof(key: string, url: string, token?: string) {
  return jwt(
    key,
    {
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: createPublicKey(key).export({ format: "jwk" }),
    },
    {
      htm: "POST",
      htu: url,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(32).toString("base64url"),
      ...(token
        ? { ath: createHash("sha256").update(token).digest("base64url") }
        : {}),
    },
  );
}
