import { test } from "node:test";
import assert from "node:assert/strict";
import { groupMerchants } from "../src/client/merchants.js";
const site = (
  id: string,
  store = "one",
  issuer = "https://identity.test/a",
) => ({
  id,
  label: "Frontvia Commerce JSON-RPC transport",
  domain: "shop.test",
  issuer,
  service: { store_id: store },
});
test("PAP groups shopping and consultation by issuer and store, selecting the human merchant name", () => {
  const groups = groupMerchants([
    site("shopping"),
    { ...site("consultation"), label: "杯具店" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "杯具店");
  assert.deepEqual(
    groups[0].sites.map((s) => s.id),
    ["shopping", "consultation"],
  );
});
test("same domain and label do not merge different stores or authorities", () => {
  const groups = groupMerchants(
    [
      site("a"),
      site("b", "two"),
      site("c", "one", "https://identity.test/b"),
    ].map((s) => ({ ...s, label: "同名店铺" })),
  );
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((g) => g.key)).size, 3);
});
test("incomplete bindings remain separate and cannot join an identified merchant", () => {
  const groups = groupMerchants([
    site("a"),
    { ...site("b"), issuer: undefined },
    { ...site("c"), service: undefined },
    { ...site("d"), service: undefined },
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].title, "shop.test");
});
