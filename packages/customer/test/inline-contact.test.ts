import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, before, test } from "node:test";
import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

let apply: typeof import("../src/client/plugin.js").apply;
const browser = new EventTarget();

before(async () => {
  // Match the client build's CSS-as-text import and supply Radix's frame API.
  const css = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith("/src/client/styles.css"))
        return { format: "module", shortCircuit: true, source: 'export default "";' };
      return nextLoad(url, context);
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.requestAnimationFrame = (callback) =>
    setTimeout(() => callback(0), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  try {
    ({ apply } = await import("../src/client/plugin.js"));
  } finally {
    css.deregister();
  }
});

after(() => {
  for (const key of ["document", "window", "requestAnimationFrame", "cancelAnimationFrame"])
    Reflect.deleteProperty(globalThis, key);
});

function draft(id: string, street: string) {
  return {
    pricing: { country: "CN", currency: "CNY" },
    cart: { id: "cart", version: "v1", lines: [{ id: "line", title: "Mug", quantity: 1 }] },
    checkout: {
      id, status: "incomplete",
      fulfillment: {
        methods: [{
          type: "shipping", destinations: [{
            id: "destination", first_name: "测试买家", phone_number: "13800138000",
            street_address: street,
          }],
        }],
      },
    },
    capabilities: {
      ucp: true, ucpFulfillment: true,
      methods: [{ method: "commerce.checkouts.get", availability: "supported" }],
    },
  };
}

const success = (value: ReturnType<typeof draft>) => ({ ok: true as const, value });
const failure = (code: string) => ({ ok: false as const, error: { code, details: {} } });
type Reply = ReturnType<typeof success> | ReturnType<typeof failure>;

async function inlineCart() {
  const ui = { flowId: "flow", sessionId: "session", card: "cart" };
  const turn = { data: new Map([["frontvia-customer-cards", { cards: [{ callId: "call", ui }] }]]) };
  let Tail: ComponentType<{ turn: typeof turn }> | undefined;
  const cleanups: (() => void)[] = [];
  const origin = draft("checkout-a", "测试镇甲路 1 号");
  const responses = { read: Promise.resolve<Reply>(success(origin)), contact: failure("CONTACT_NOT_SAVED") };
  const submissions: { checkout_id: string; patch: { shipping_address: { line1: string } } }[] = [];
  apply({
    effect(run: () => () => void) { cleanups.push(run()); },
    slots: {
      inject(_name: string, register: () => void) { register(); },
      register(slot: { name: string }, component: typeof Tail) {
        if (slot.name === "conversation.chat.turnTail") Tail = component;
      },
    },
    uiConversation: { events: { register() {} }, userText: { register() {} } },
    connection: {
      rpc: {
        async call(_base: string, operation: string, payload: (typeof submissions)[number]) {
          if (operation === "frontvia-customer/view") return responses.read;
          assert.equal(operation, "frontvia-customer/contact");
          submissions.push(payload);
          return responses.contact;
        },
      },
    },
  });
  assert(Tail);
  const element = createElement(Tail, { turn });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(element); });
  return {
    tree, responses, submissions, origin,
    async close() {
      await act(async () => { tree.unmount(); });
      for (const cleanup of cleanups) cleanup();
    },
  };
}

const address = (tree: ReactTestRenderer) =>
  tree.root.findAllByType("input").find(node => node.props.name === "line1");
const typed = "测试镇私有新路 23 号";
const errorForRetiredDraft = "结算草稿已变更，请核对当前草稿后重新保存收货信息。";

async function submitAddress(tree: ReactTestRenderer) {
  const input = address(tree);
  assert(input);
  await act(async () => { input.props.onChange({ target: { value: typed } }); });
  await act(async () => {
    await tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
}

test("an inline checkout retires a contact error when a queued read finds a replacement", async () => {
  const { tree, responses, submissions, close } = await inlineCart();
  try {
    const replacement = draft("checkout-b", "测试镇乙路 2 号");
    let replace!: (value: Reply) => void;
    responses.contact = failure("CONTACT_DRAFT_CHANGED");
    responses.read = new Promise<Reply>((resolve) => { replace = resolve; });
    await submitAddress(tree);
    assert(JSON.stringify(tree.toJSON()).includes(errorForRetiredDraft));
    assert.equal(address(tree)?.props.value, typed);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]?.checkout_id, "checkout-a");
    assert.equal(submissions[0]?.patch.shipping_address.line1, typed);

    await act(async () => { replace(success(replacement)); });
    assert.equal(address(tree)?.props.value, "测试镇乙路 2 号");
    assert(!JSON.stringify(tree.toJSON()).includes(errorForRetiredDraft));
  } finally {
    await close();
  }
});

test("an inline checkout retains typed input through a failed post-contact refresh", async () => {
  const { tree, responses, submissions, origin, close } = await inlineCart();
  try {
    responses.read = Promise.resolve(failure("NETWORK_TIMEOUT"));
    await submitAddress(tree);
    assert.equal(submissions.length, 1);
    assert.equal(address(tree), undefined, "an absent read must not display private address data");
    responses.read = Promise.resolve(success(origin));
    await act(async () => { browser.dispatchEvent(new Event("focus")); });
    assert.equal(address(tree)?.props.value, typed);
    assert.equal(submissions.length, 1, "reading again must not repeat the contact write");
  } finally {
    await close();
  }
});
