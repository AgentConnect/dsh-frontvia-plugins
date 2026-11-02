import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PapService, Vault } from "../packages/pap/dist/core.js";
const dir = resolve(".local/native"),
  config = JSON.parse(await readFile(resolve(dir, "pap.json"), "utf8")),
  secret = JSON.parse(await readFile(resolve(dir, "secrets.json"), "utf8"));
const vault = new Vault(
  resolve(config.dataDir, "pap.sqlite"),
  secret[config.storageKeyRef],
);
try {
  const pap = new PapService(
    config,
    { get: async (k) => secret[k], set: async () => {} },
    vault,
  );
  const connection = await pap.connect("test-shop");
  const responses = {};
  for (const [method, params] of [
    ["capabilities.get", {}],
    ["connections.list", {}],
    [
      "products.search",
      {
        context: { country: "US", currency: "USD", locale: "en-US" },
        query: "Mug",
        page: { limit: 8 },
      },
    ],
  ]) {
    const r = await pap.request(
      connection.connectionRef,
      `commerce.${method}`,
      params,
    );
    if (r.error)
      throw new Error("Commerce probe failed: " + JSON.stringify(r.error));
    responses[method] = r.result.data;
  }
  await writeFile(
    resolve(dir, "wire-results.json"),
    JSON.stringify(
      {
        status: "PASS",
        connection: pap.status(connection.connectionRef),
        responses,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      methods: Object.keys(responses),
      connections: responses["connections.list"],
      products: responses["products.search"],
    }),
  );
} finally {
  vault.close();
}
