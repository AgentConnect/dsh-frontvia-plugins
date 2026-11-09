import { test } from "node:test";
import assert from "node:assert/strict";
import { groupServices } from "../src/client/services.js";
test("services group by verified issuer while resources remain separate", () => {
  const sites = [
    {
      id: "a",
      label: "Calendar",
      domain: "service.test",
      issuer: "https://service.test/a",
    },
    {
      id: "b",
      label: "Notes",
      domain: "service.test",
      issuer: "https://service.test/a",
    },
    {
      id: "c",
      label: "Calendar",
      domain: "service.test",
      issuer: "https://service.test/b",
    },
    { id: "d", label: "Legacy", domain: "service.test" },
    { id: "e", label: "Legacy", domain: "service.test" },
  ];
  const groups = groupServices(sites);
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups[0].sites.map((s) => s.id),
    ["a", "b"],
  );
  assert.equal(groups[1].domain, "https://service.test/b");
  assert.notEqual(groups[2].key, groups[3].key);
});
