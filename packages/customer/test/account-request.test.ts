import { test } from "node:test";
import assert from "node:assert/strict";
import { accountRequest } from "../src/client/account-request.js";

test("logout discards a delayed consultation view before it can repopulate the owner's UI", async () => {
  const events = new EventTarget();
  let complete!: (value: unknown) => void;
  let rendered: unknown;
  const response = accountRequest(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    events,
  ).then((value) => {
    rendered = value;
  });
  events.dispatchEvent(new Event("frontvia-public-identity-change"));
  complete({
    conversation: { messages: [{ text: "Person A's private answer" }] },
  });
  await assert.rejects(response, { message: "PERSONAL_ACCOUNT_CHANGED" });
  assert.equal(rendered, undefined);
  const current = {
    conversation: { messages: [{ text: "Person B's answer" }] },
  };
  assert.deepEqual(await accountRequest(async () => current, events), current);
});
