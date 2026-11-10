import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

for (const legacy of [false, true])
  test(`all three archives are preflighted and failed ${legacy ? "legacy replacement" : "installation"} restores the previous profile and runtime files`, async () => {
    const root = await mkdtemp(join(tmpdir(), "Frontvia installer & spaces "));
    const profile = join(root, "profiles", "desktop");
    const archives = join(root, ".local", "packages");
    const manifest = JSON.stringify({
      private: true,
      dependencies: {
        "@awiki/dsh-pap": "0.1.4",
        ...(legacy
          ? {
              "dsh-identity-client":
                "file:.local-packages/frontvia/dsh-identity-client-0.1.0-old.tgz",
              "dsh-pap": "file:.local-packages/frontvia/dsh-pap-0.1.0-old.tgz",
            }
          : {
              "dsh-frontvia-pap": "0.0.9",
              "dsh-pap": "npm:@awiki/dsh-pap@0.1.4",
            }),
      },
      dsh: {
        profile: {
          bundles: [
            "@awiki/dsh-pap",
            ...(legacy
              ? ["dsh-identity-client", "dsh-pap"]
              : ["dsh-frontvia-pap", "dsh-pap"]),
          ],
        },
      },
    });
    const entry = resolve("scripts/install-desktop.mjs");
    const wrapper = join(
      root,
      process.platform === "win32" ? "DSH Desktop.cmd" : "DSH Desktop",
    );
    const env = {
      ...process.env,
      DSH_HOME: root,
      DSH_DESKTOP_CLI: wrapper,
      FRONTVIA_LEGACY: legacy ? "yes" : "no",
    };
    try {
      await mkdir(profile, { recursive: true });
      await mkdir(archives, { recursive: true });
      await writeFile(join(profile, "identity-config.json"), "{}", {
        mode: 0o600,
      });
      await writeFile(join(profile, "package.json"), manifest);
      await writeFile(join(profile, "pnpm-lock.yaml"), "previous lock");
      const driver = join(root, "cli.cjs");
      await writeFile(
        driver,
        `
const fs=require('node:fs'),p=require('node:path');
const profile=p.join(process.env.DSH_HOME,'profiles','desktop'), manifest=p.join(profile,'package.json');
const args=process.argv.slice(2),marker=p.join(profile,'runtime-state');
if(args[0]==='--version') { console.log('0.2.2-rc.1');process.exit(0); }
if(args[3]==='add') {
 if(args.length!==7)process.exit(3);
 fs.appendFileSync(p.join(profile,'calls'),'add\\n');
 const pkg=JSON.parse(fs.readFileSync(manifest));
 if(pkg.dependencies['@awiki/dsh-pap']!=='0.1.4'||!pkg.dsh.profile.bundles.includes('@awiki/dsh-pap'))throw Error('generic PAP changed');
 if(process.env.FRONTVIA_LEGACY==='yes') {
  if(pkg.dependencies['dsh-identity-client']||pkg.dependencies['dsh-pap']||pkg.dsh.profile.bundles.includes('dsh-pap'))throw Error('legacy provider still enabled');
 } else if(pkg.dependencies['dsh-pap']!=='npm:@awiki/dsh-pap@0.1.4')throw Error('unrelated PAP changed');
 pkg.dependencies['dsh-frontvia-pap']='file:'+args[5];
 fs.writeFileSync(manifest,JSON.stringify(pkg));fs.writeFileSync(p.join(profile,'pnpm-lock.yaml'),'partial lock');
 fs.writeFileSync(marker,'partial');process.exit(1);
}
if(args[3]==='install' && args[4]==='--frozen-lockfile' && fs.readFileSync(p.join(profile,'pnpm-lock.yaml'),'utf8')==='previous lock') {
 fs.appendFileSync(p.join(profile,'calls'),'repair\\n');fs.writeFileSync(marker,'previous');process.exit(0);
}
process.exit(4);
`,
      );
      await writeFile(
        wrapper,
        process.platform === "win32"
          ? `@"${process.execPath}" "%~dp0cli.cjs" %*\r\n`
          : '#!/usr/bin/env node\nrequire("./cli.cjs");\n',
        { mode: 0o755 },
      );
      const pair: { name: string; path: string; sha256: string }[] = [];
      for (const name of [
        "dsh-frontvia-client",
        "dsh-frontvia-pap",
        "dsh-frontvia-customer",
      ]) {
        const path = join(archives, name + ".tgz");
        await writeFile(path, name);
        pair.push({
          name,
          path,
          sha256: createHash("sha256").update(name).digest("hex"),
        });
      }
      const savePair = () =>
        writeFile(
          join(archives, "manifest.json"),
          JSON.stringify({ runtime: "0.2.2-rc.1", artifacts: pair }),
        );
      const run = (...args: string[]) =>
        execFileSync(process.execPath, [entry, ...args], {
          cwd: root,
          env,
          stdio: "pipe",
        });
      await writeFile(
        join(archives, "manifest.json"),
        JSON.stringify({ runtime: "0.2.1-rc.3", artifacts: pair }),
      );
      assert.throws(run, /请使用与插件兼容的 DSH Desktop CLI/);
      assert.equal(
        await readFile(join(profile, "package.json"), "utf8"),
        manifest,
      );
      await assert.rejects(readFile(join(profile, "calls")), {
        code: "ENOENT",
      });
      pair[1].sha256 = "invalid";
      await savePair();
      assert.throws(run, /安装包校验失败/);
      await assert.rejects(readFile(join(profile, "calls")), {
        code: "ENOENT",
      });
      pair[1].sha256 = createHash("sha256").update(pair[1].name).digest("hex");
      await savePair();
      if (legacy) {
        assert.throws(run, /检测到旧版 Frontvia 插件/);
        assert.equal(
          await readFile(join(profile, "package.json"), "utf8"),
          manifest,
        );
        await assert.rejects(readFile(join(profile, "calls")), {
          code: "ENOENT",
        });
      }
      assert.throws(
        () => run(...(legacy ? ["--replace-legacy-frontvia"] : [])),
        /DSH 命令失败/,
      );
      assert.equal(
        await readFile(join(profile, "package.json"), "utf8"),
        manifest,
      );
      assert.equal(
        await readFile(join(profile, "pnpm-lock.yaml"), "utf8"),
        "previous lock",
      );
      assert.equal(
        await readFile(join(profile, "runtime-state"), "utf8"),
        "previous",
      );
      assert.equal(
        await readFile(join(profile, "calls"), "utf8"),
        "add\nrepair\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
