import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
for (const [folder, name] of [
  ["pap", "dsh-pap"],
  ["customer", "dsh-frontvia-customer"],
]) {
  const root = `packages/${folder}`;
  await mkdir(`${root}/dist`, { recursive: true });
  for (const entry of ["core", "index"])
    await build({
      entryPoints: [`${root}/src/${entry}.ts`],
      bundle: true,
      packages: "external",
      platform: "node",
      target: "node24",
      format: "esm",
      outfile: `${root}/dist/${entry}.js`,
      sourcemap: true,
    });
  const client = await build({
    entryPoints: [`${root}/src/client/plugin.tsx`],
    bundle: true,
    format: "cjs",
    write: false,
    external: ["react", "react/jsx-runtime", "react-dom"],
    loader: { ".css": "text" },
  });
  await writeFile(
    `${root}/dist/client.js`,
    `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;${client.outputFiles[0].text}\nreturn module.exports;}});`,
  );
}
