import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/protocol.js";
test("status reports host identity without enrolling, granting or reading its keys", async () => {
  const f = fixture();
  let enroll = 0;
  try {
    f.service.registerAuthentication({
      id: "identity",
      matches: () => true,
      current: () => ({ identity: "person", generation: "1" }),
      assert: () => {},
      client: {
        current: () => ({
          clientId: "https://identity.test/device",
          callback: "https://identity.test/callback",
          signingKeyRef: "private",
          keyId: "key",
        }),
        ensure: async () => {
          enroll++;
        },
      },
      grant: async () => {
        throw Error("must not grant");
      },
    });
    const status = await f.service.clientStatus();
    assert.deepEqual(status.providers, [
      { id: "identity", clientId: "https://identity.test/device", ready: true },
    ]);
    assert.equal(enroll, 0);
    assert.ok(!JSON.stringify(status).includes("private"));
    assert.equal(f.record.calls.length, 0);
  } finally {
    f.close();
  }
});
test("unavailable provider status does not falsely request PAP self-managed keys", async () => {
  const f = fixture();
  try {
    f.service.registerAuthentication({
      id: "identity",
      matches: () => true,
      current: () => {
        throw Error();
      },
      assert: () => {},
      client: {
        current: () => undefined,
        ensure: async () => {
          throw Error();
        },
      },
      grant: async () => {
        throw Error();
      },
    });
    assert.deepEqual((await f.service.clientStatus()).providers, [
      { id: "identity", clientId: undefined, ready: false },
    ]);
  } finally {
    f.close();
  }
});
