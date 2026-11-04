import { generateKeyPairSync, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Prepare an independent identity. This never publishes, installs, or changes a profile. */
export async function preparePublicClient(directory, clientId) {
  const url = new URL(clientId);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !url.pathname.endsWith("/agent.json") ||
    !url.hostname.includes(".") ||
    /\.(test|local|localhost)$/.test(url.hostname) ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":")
  )
    throw new Error("PUBLIC_CLIENT_URL_REQUIRED");
  const root = resolve(directory),
    publicDirectory = root + "/public";
  // Refuse to replace an existing key or state directory, even on a second run.
  await mkdir(root, { mode: 0o700 });
  await mkdir(publicDirectory, { mode: 0o700 });
  const suffix = createHash("sha256")
    .update(clientId)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  const refs = {
    signing: `DSH_PUBLIC_SIGNING_${suffix}`,
    confirmation: `DSH_PUBLIC_CONFIRM_${suffix}`,
  };
  const keyId = "dsh-" + randomBytes(8).toString("hex");
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwksUrl = new URL("jwks.json", url).href,
    callback = new URL("callback", url).href;
  const metadata = {
    client_id: clientId,
    client_name: "DSH Frontvia Customer",
    redirect_uris: [callback],
    token_endpoint_auth_method: "private_key_jwt",
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
      "urn:frontvia:params:oauth:grant-type:personal",
    ],
    response_types: ["code"],
    jwks_uri: jwksUrl,
  };
  const jwks = {
    keys: [
      {
        ...pair.publicKey.export({ format: "jwk" }),
        kid: keyId,
        use: "sig",
        alg: "ES256",
      },
    ],
  };
  const write = (path, value) =>
    writeFile(path, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  await write(root + "/bootstrap-secrets.json", {
    [refs.signing]: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    [refs.confirmation]: randomBytes(32).toString("base64url"),
  });
  await write(publicDirectory + "/agent.json", metadata);
  await write(publicDirectory + "/jwks.json", jwks);
  await writeFile(
    publicDirectory + "/callback.html",
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>返回 DSH 完成授权</title><body><main><h1>返回 DSH 完成授权</h1><p>复制浏览器地址栏中的完整地址，粘贴到 DSH 的“授权回调地址”，再点击“完成授权”。</p><p>请勿把地址发送给聊天模型或其他人。本页不保存授权内容。</p></main></body></html>\n',
    { mode: 0o600, flag: "wx" },
  );
  const manifest = {
    clientId,
    jwksUrl,
    callback,
    keyId,
    confirmationKid: keyId + "-purchase",
    refs,
    publicFiles: ["agent.json", "jwks.json", "callback.html"],
  };
  await write(root + "/identity.json", manifest);
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw new Error(
      "Use: node scripts/prepare-public-client.mjs OUTPUT_DIRECTORY HTTPS_CLIENT_ID",
    );
  const identity = await preparePublicClient(process.argv[2], process.argv[3]);
  console.log(
    JSON.stringify({
      status: "PREPARED_NOT_PUBLISHED",
      clientId: identity.clientId,
      keyId: identity.keyId,
    }),
  );
}
