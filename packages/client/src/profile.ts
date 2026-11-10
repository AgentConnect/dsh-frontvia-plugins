import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Secrets } from "./types.js";
import { fail, Vault } from "./storage.js";

export function readProfileConfig<T>(path: string): T {
  const st = lstatSync(path);
  if (!st.isFile() || st.uid !== process.getuid?.() || st.mode & 0o077)
    fail("PROTECTED_CONFIG_REQUIRED");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** ProfileContext is supplied by the DSH launcher, including the Electron host. */
export function profileStorage(
  profile: { name: string; dir: string },
  plugin: "identity",
) {
  if (!profile?.name || !isAbsolute(profile.dir)) fail("DSH_PROFILE_REQUIRED");
  const scope = createHash("sha256")
    .update(profile.name)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return {
    dataDir: join(profile.dir, "plugin-data", "dsh", plugin),
    storageKeyRef: `DSH_${plugin.toUpperCase()}_STORAGE_${scope}`,
    sites: [],
  };
}

export async function openProfileVault(
  path: string,
  keyRef: string,
  secrets: Secrets,
) {
  const existing = await secrets.get(keyRef);
  const key = existing ?? randomBytes(32).toString("base64url");
  const vault = new Vault(path, key);
  try {
    const record = vault.firstRecordId();
    if (record) {
      if (!existing) fail("STORAGE_KEY_REQUIRED");
      vault.get(record);
    }
    await secrets.set(keyRef, key);
    return vault;
  } catch (error) {
    vault.close();
    throw error;
  }
}
