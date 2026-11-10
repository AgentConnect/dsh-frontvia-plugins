import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

// Load the packaged browser entry as the DSH module loader does. Existing
// generic management panels must survive registration of the Frontvia panels.
test("built Frontvia browser plugins register distinct modules and panels alongside generic PAP", () => {
  const require = createRequire(import.meta.url);
  const modules = new Map<string, any>();
  const main = new Map<string, any>([["pap-connections", "generic PAP"]]);
  const sidebar = new Map<string, any>([["pap-connections", "generic PAP"]]);
  const ctx = {
    slots: {
      inject(_name: string, register: () => void) {
        register();
      },
      register(slot: any, component: any) {
        const target = slot.name === "main" ? main : sidebar;
        const key = slot.key ?? slot.id;
        assert(!target.has(key), `duplicate panel: ${key}`);
        target.set(key, component);
      },
    },
  };
  for (const folder of ["client", "pap"]) {
    const source = readFileSync(
      new URL(`../../${folder}/dist/client.js`, import.meta.url),
      "utf8",
    );
    runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load(entry: any) {
            assert(!modules.has(entry.id), `duplicate module: ${entry.id}`);
            modules.set(entry.id, entry.factory(require));
          },
        },
      },
    });
  }
  assert.deepEqual(
    [...modules.keys()],
    ["dsh-frontvia-client", "dsh-frontvia-pap"],
  );
  for (const plugin of modules.values()) plugin.apply(ctx);
  for (const panels of [main, sidebar]) {
    assert.equal(panels.get("pap-connections"), "generic PAP");
    assert(panels.has("dsh-frontvia-client"));
    assert(panels.has("frontvia-pap-connections"));
    assert.equal(panels.size, 3);
  }
});
