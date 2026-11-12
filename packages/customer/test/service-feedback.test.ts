import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceFeedback } from "../src/client/service-feedback.js";

test("identity and connection failures provide the matching recovery entry", () => {
  assert.match(serviceFeedback(new Error("IDENTITY_CHANGED")).text, /身份/);
  assert.equal(
    serviceFeedback(new Error("IDENTITY_CHANGED")).action,
    "settings",
  );
  assert.equal(serviceFeedback(new Error("FLOW_NOT_OWNED")).action, "services");
  assert.equal(serviceFeedback(new Error("FLOW_NOT_OWNED")).retry, false);
  assert.match(serviceFeedback(new Error("PAP_DISCONNECTED")).text, /连接/);
});
test("unexpected failures offer read retry and never expose raw response data", () => {
  const result = serviceFeedback(new Error("https://shop.test?access=private"));
  assert.equal(result.code, "SERVICE_READ_FAILED");
  assert.equal(result.retry, true);
  assert.match(result.text, /重试/);
  assert.doesNotMatch(JSON.stringify(result), /private|shop.test/);
  assert.equal(
    serviceFeedback(new Error("PAP_NETWORK_ERROR")).code,
    "PAP_NETWORK_ERROR",
  );
});
test("local plugin transport failure is distinguished from a remote merchant outage", () => {
  const feedback = serviceFeedback(new Error("transport failure for /api/frontvia-customer/view: HTTP 404"));
  assert.equal(feedback.code, "CLIENT_HTTP_404");
  assert.equal(feedback.action, "plugins");
  assert.match(feedback.text, /插件尚未就绪/);
});
