import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { PapError } from "../src/state.js";
import { runUiRequest } from "../src/ui-request.js";

const view = { sessionId: "session", flowId: randomUUID(), scopes: ["cart"] };

test("invalid request input does not start the shopping read", async () => {
  const result = await runUiRequest("view", { ...view, scopes: ["unknown"] }, async () => assert.fail("read called"));
  assert.equal(result.ok ? undefined : result.error.code, "INVALID_UI_REQUEST");
});

test("valid requests keep business failures and result semantics", async () => {
  assert.deepEqual(await runUiRequest("view", view, async (value) => value), { ok: true, value: view });
  const result = await runUiRequest("view", view, async () => { throw new PapError("FLOW_NOT_OWNED"); });
  assert.equal(result.ok ? undefined : result.error.code, "FLOW_NOT_OWNED");
});

test("internal read and action errors return safe, correlatable errors without exposing private data", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const read = await runUiRequest("view", view, async () => z.literal("expected").parse("private data"));
  const action = await runUiRequest("confirm-ucp", { ...view, scopes: undefined, actionId: randomUUID() }, async () => assert.fail("unexpected dispatch"));
  assert.equal(action.ok ? undefined : action.error.code, "INVALID_UI_REQUEST");
  const { scopes, ...reference } = view;
  const failure = await runUiRequest("confirm-ucp", { ...reference, actionId: randomUUID() }, async () => {
    throw new TypeError("private action detail");
  });
  assert.ok(!read.ok && !failure.ok);
  assert.equal(read.error.code, "SHOPPING_VIEW_FAILED");
  assert.equal(failure.error.code, "FRONTVIA_UI_ACTION_FAILED");
  assert.equal(warn.mock.callCount(), 2);
  for (const [i, result] of [read, failure].entries()) {
    const text = String(warn.mock.calls[i].arguments[0]);
    const referenceId = (result.error.details as { referenceId: string }).referenceId;
    assert.match(referenceId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(JSON.parse(text), {
      event: "frontvia_customer_ui_failure", operation: i ? "confirm-ucp" : "view",
      reference_id: referenceId, reason: i ? "type_error" : "invalid_internal_data",
    });
    assert.doesNotMatch(text + JSON.stringify(result), /private/);
  }
});
