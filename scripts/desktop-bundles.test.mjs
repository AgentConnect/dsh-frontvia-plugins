import { test } from "node:test";
import assert from "node:assert/strict";
import { orderFrontviaBundles } from "./desktop-bundles.mjs";
test("upgrading a selected Customer moves prerequisites before its overlay, preserving other selection order", () => {
  const input = [
    "base",
    "dsh-frontvia-customer",
    "other",
    "@awiki/dsh-pap",
    "@agent-network-protocol/dsh-anp-identity",
  ];
  const result = orderFrontviaBundles(input);
  assert.deepEqual(result, [
    "base",
    "@agent-network-protocol/dsh-anp-identity",
    "@awiki/dsh-pap",
    "dsh-frontvia-customer",
    "other",
  ]);
  assert.deepEqual(orderFrontviaBundles(result), result);
  assert.deepEqual(input, [
    "base",
    "dsh-frontvia-customer",
    "other",
    "@awiki/dsh-pap",
    "@agent-network-protocol/dsh-anp-identity",
  ]);
  assert.deepEqual(orderFrontviaBundles(["base", "other"]), ["base", "other"]);
});
test('existing early identity stays before unrelated dependent bundles', () => {
  assert.deepEqual(orderFrontviaBundles(['base','@agent-network-protocol/dsh-anp-identity','other','dsh-frontvia-customer','@awiki/dsh-pap']),['base','@agent-network-protocol/dsh-anp-identity','other','@awiki/dsh-pap','dsh-frontvia-customer']);
});
