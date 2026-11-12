import { resolve, dirname, basename } from "node:path";
/** Frontvia packages are built and installed from this workspace only. */
export const pluginPackages = [
  { folder: "customer", name: "dsh-frontvia-customer" },
];

/** Only old local archives staged by the Frontvia installer are upgrade targets.
 * An unrelated generic PAP plugin must remain installed and untouched. */
export const legacyPackageNames = ["dsh-identity-client", "dsh-pap", "dsh-frontvia-client", "dsh-frontvia-pap"];
export function legacyFrontviaPackages(manifest, profile) {
  const directory = resolve(profile, ".local-packages", "frontvia");
  return legacyPackageNames.filter((name) => {
    const spec = manifest.dependencies?.[name];
    if (typeof spec !== "string" || !spec.startsWith("file:")) return false;
    const archive = resolve(profile, spec.slice(5));
    return (
      dirname(archive) === directory &&
      basename(archive).startsWith(name + "-") &&
      archive.endsWith(".tgz")
    );
  });
}
