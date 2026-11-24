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

const success = (value: ReturnType<typeof draft> & { operation?: { status: string } }) => ({ ok: true as const, value });
const failure = (code: string) => ({ ok: false as const, error: { code, details: {} } });
type Reply = ReturnType<typeof success> | ReturnType<typeof failure>;

async function inlineCart(ucp = true) {
  const ui = { flowId: "flow", sessionId: "session", card: "cart" };
  const turn = { data: new Map([["frontvia-customer-cards", { cards: [{ callId: "call", ui }] }]]) };
  let Tail: ComponentType<{ turn: typeof turn }> | undefined;
  const cleanups: (() => void)[] = [];
  const origin = draft("checkout-a", "测试镇甲路 1 号");
  origin.capabilities.ucp = ucp;
  const responses: { read: Promise<Reply>; contact: Reply | Promise<Reply> } = {
    read: Promise.resolve(success(origin)),
    contact: failure("CONTACT_NOT_SAVED"),
  };
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

test("an inline checkout acknowledges a successful save after an in-flight read fails", async () => {
  const { tree, responses, submissions, origin, close } = await inlineCart();
  try {
    let finishRead!: (value: Reply) => void;
    let finishContact!: (value: Reply) => void;
    responses.read = new Promise(resolve => { finishRead = resolve; });
    await act(async () => { browser.dispatchEvent(new Event("focus")); });
    responses.contact = new Promise(resolve => { finishContact = resolve; });

    let submission!: Promise<void>;
    await act(async () => { address(tree)?.props.onChange({ target: { value: typed } }); });
    await act(async () => {
      submission = tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    assert.equal(submissions.length, 1);
    await act(async () => { finishRead(failure("PAP_REQUEST_UNCERTAIN")); });
    assert.equal(address(tree), undefined);

    const saved = draft(origin.checkout.id, "规范化新路 23 号");
    await act(async () => {
      finishContact(success({ ...saved, operation: { status: "succeeded" } }));
      await submission;
    });
    assert.equal(address(tree)?.props.value, "规范化新路 23 号");
    assert(JSON.stringify(tree.toJSON()).includes("收货信息已保存到结算草稿。"));
    assert.equal(submissions.length, 1);
  } finally {
    await close();
  }
});

test("a legacy inline cart rejects a numeric-only Chinese address at the field", async () => {
  const { tree, submissions, close } = await inlineCart(false);
  try {
    const form = tree.root.findByType("form");
    const elements = Object.fromEntries(form.findAllByType("input").map(input => [
      input.props.name, { validity: { valid: true }, focus() {} },
    ]));
    for (const [name, value] of Object.entries({ recipient: "测试买家", line1: "１２３", phone: "13800138000" })) {
      await act(async () => {
        form.findAllByType("input").find(input => input.props.name === name)?.props.onChange({ target: { value } });
      });
    }
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {}, currentTarget: { elements: { namedItem: (key: string) => elements[key] } } });
    });
    assert.equal(submissions.length, 0);
    assert.equal(address(tree)?.props["aria-invalid"], true);
    assert(JSON.stringify(tree.toJSON()).includes("请填写完整收货地址，不能只填数字。"));
  } finally {
    await close();
  }
});
