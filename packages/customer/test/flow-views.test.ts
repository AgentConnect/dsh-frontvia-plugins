import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowViews } from "../src/client/flow-views.js";
const ref = { sessionId: "session", flowId: "flow" };
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<any>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("same-flow cards share reads and mutation updates; an earlier pending read cannot overwrite a new cart", async () => {
  const old = deferred();
  let calls = 0;
  const views = new FlowViews(async () => {
    calls++;
    return old.promise;
  }, 0);
  const a: any[] = [],
    b: any[] = [];
  const offA = views.subscribe(ref, (v) => a.push(v));
  const offB = views.subscribe(ref, (v) => b.push(v));
  await flush();
  assert.equal(calls, 1);
  views.publish(ref, { cart: { version: "v2" }, order: { status: "paid" } });
  old.resolve({ cart: { version: "v1" } });
  await flush();
  assert.deepEqual(a.at(-1), b.at(-1));
  assert.equal(a.at(-1).value.cart.version, "v2");
  assert.equal(a.at(-1).value.order.status, "paid");
  offA();
  offB();
  views.clear();
});

test("tool updates during a read schedule a fresh read and account changes discard all late private responses", async () => {
  const first = deferred(),
    second = deferred();
  let calls = 0;
  const views = new FlowViews(
    () => (++calls === 1 ? first.promise : second.promise),
    0,
  );
  const received: any[] = [];
  const off = views.subscribe(ref, (v) => received.push(v));
  views.invalidate(ref);
  views.invalidate(ref);
  first.resolve({ cart: { version: "stale" } });
  await flush();
  assert.equal(calls, 2);
  assert.equal(received.at(-1).value, undefined);
  views.clear();
  second.resolve({ shipping_address: "private" });
  await flush();
  assert.equal(received.at(-1).value, undefined);
  assert(!JSON.stringify(received).includes("private"));
  off();
});

test("polling is per flow, pauses while hidden, handles access failures, and stops after the last card unmounts", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0,
    active = true,
    deny = false;
  const views = new FlowViews(
    async () => {
      calls++;
      if (deny) throw new Error("FLOW_NOT_OWNED");
      return { order: { version: calls } };
    },
    15000,
    () => active,
  );
  const received: any[] = [];
  const offA = views.subscribe(ref, (v) => received.push(v));
  const offB = views.subscribe(ref, () => {});
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(calls, 2);
  active = false;
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(calls, 2);
  active = true;
  deny = true;
  views.refreshAll();
  await flush();
  assert.equal(received.at(-1).value, undefined);
  assert.equal(received.at(-1).error.message, "FLOW_NOT_OWNED");
  offA();
  offB();
  const before = calls;
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, before);
  views.clear();
});

test("different sessions and flows never receive each other's cart or order", async () => {
  const views = new FlowViews(
    async (r) => ({ cart: { id: r.sessionId + r.flowId } }),
    0,
  );
  const a: any[] = [],
    b: any[] = [];
  const other = { ...ref, sessionId: "other" };
  const offA = views.subscribe(ref, (v) => a.push(v));
  const offB = views.subscribe(other, (v) => b.push(v));
  await flush();
  views.publish(ref, { order: { id: "only-a" } });
  assert.equal(a.at(-1).value.order.id, "only-a");
  assert.equal(b.at(-1).value.order, undefined);
  offA();
  offB();
  views.clear();
});

test("idle and settled flows do not poll; payment stays fast and paid shipping uses a slower interval", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const views = new FlowViews(async () => {
    calls++;
    return { cart: { id: "cart" } };
  }, 15000);
  const off = views.subscribe(ref, () => {});
  await flush();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  views.publish(ref, {
    order: { id: "o", status: "canceled", payment: { status: "voided" } },
  });
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  views.publish(ref, { order: { id: "o", payment: { status: "unpaid" } } });
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(calls, 2);
  views.publish(ref, {
    order: {
      id: "o",
      payment: { status: "paid" },
      fulfillment_status: "unfulfilled",
    },
  });
  t.mock.timers.tick(45000);
  await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(calls, 3);
  views.publish(ref, {
    order: {
      id: "o",
      payment: { status: "paid" },
      fulfillment_status: "delivered",
    },
  });
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 3);
  off();
  views.clear();
});

test("offscreen cards do no initial or periodic reads, and visible cards merge only their page interests", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const reads: any[] = [];
  let visible = false;
  const views = new FlowViews(async (value) => {
    reads.push(value);
    return { order: { payment: { status: "unpaid" } } };
  });
  const offHidden = views.subscribe(ref, () => {}, {
    scope: () => "checkout",
    visible: () => visible,
  });
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads.length, 0);
  const offCatalog = views.subscribe(ref, () => {}, { scope: () => "catalog" });
  await flush();
  assert.deepEqual(reads.at(-1).scopes, ["catalog"]);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads.length, 1);
  visible = true;
  views.invalidate(ref);
  await flush();
  assert.deepEqual(
    new Set(reads.at(-1).scopes),
    new Set(["checkout", "catalog"]),
  );
  visible = false;
  offCatalog();
  views.refreshAll();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads.length, 2);
  offHidden();
  views.clear();
});

test("owner actions suppress background queueing and a failed edit refreshes cart state even from catalog", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const reads: any[] = [];
  const views = new FlowViews(async (value) => {
    reads.push(value);
    return { order: { payment: { status: "unpaid" } } };
  });
  const off = views.subscribe(ref, () => {}, { scope: () => "catalog" });
  await flush();
  const release = views.hold(ref);
  views.publish(ref, { pending: true });
  t.mock.timers.tick(45000);
  views.invalidate(ref, ["checkout"]);
  await flush();
  assert.equal(reads.length, 1);
  release();
  await flush();
  assert.equal(reads.length, 2);
  assert.deepEqual(reads.at(-1).scopes, ["checkout"]);
  off();
  views.clear();
});
