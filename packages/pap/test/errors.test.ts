import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage } from "../src/client/errors.js";
test("identity and OAuth errors have actionable safe diagnostics", () => {
  for (const code of [
    "IDENTITY_AUDIENCE_UNTRUSTED",
    "PAP_DEVICE_ENROLLMENT_UNAVAILABLE",
    "SIGNING_KEY_REQUIRED",
    "OAUTH_INVALID_GRANT",
  ])
    assert.ok(errorMessage(new Error(code)).includes(code));
  assert.match(
    errorMessage(new Error("IDENTITY_AUDIENCE_UNTRUSTED")),
    /个人凭据未发送/,
  );
  for (const secret of [
    "token=secret",
    "https://private/?assertion=secret",
    "PRIVATE KEY",
  ])
    assert.ok(!errorMessage(new Error(secret)).includes(secret));
});
