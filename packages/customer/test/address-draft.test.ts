import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import React, { useEffect, useState } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from "react-test-renderer";
let Storefront: typeof import("../src/client/storefront.js").Storefront;
import { FlowViews } from "../src/client/flow-views.js";
import { useAccountRevision } from "../src/client/account.js";

// Radix Tabs schedules animation frames; the Node renderer has no browser clock.
before(async () => {
  // Enable Radix layout effects; host nodes remain renderer-owned (no DOM).
  Object.defineProperty(globalThis, "document", {
    value: {},
    configurable: true,
  });
  Storefront = (await import("../src/client/storefront.js")).Storefront;
  globalThis.requestAnimationFrame = (callback) =>
    setTimeout(() => callback(0), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

const initial = () => ({
  pricing: { country: "CN", currency: "CNY" },
  purchaseReady: true,
  cartReady: true,
  cart: {
    id: "cart",
    version: "v1",
    lines: [{ id: "line", title: "Mug", quantity: 1 }],
    shipping_address: {
      country: "CN",
      recipient: "Buyer",
      phone: "13800138000",
      line1: "Address A",
    },
  },
});

test("storefront loading ends on failure, retries explicitly, and does not replace loaded content during refresh", async () => {
  let tree!: ReactTestRenderer;
  let data: any;
  let error = "";
  let busy = false;
  const calls: string[] = [];
  const render = () =>
    React.createElement(Storefront, {
      draftScope: "loading-flow",
      data,
      error,
      busy,
      now: Date.now(),
      action: async (operation) => {
        calls.push(operation);
        return true;
      },
    });
  const loading = () =>
    tree.root.findAllByProps({ className: "fv-store-loading" });
  const storefront = () => tree.root.findByType("section");
  try {
    await act(async () => {
      tree = create(render());
    });
    assert.equal(loading().length, 1);
    assert.equal(storefront().props["aria-busy"], true);
    assert.equal(tree.root.findAllByType("button").length, 0);
    error = "暂时无法读取店铺，请重试。";
    await act(async () => {
      tree.update(render());
    });
    assert.equal(
      loading().length,
      0,
      "a failed request must not look like an ongoing load",
    );
    assert.equal(storefront().props["aria-busy"], false);
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
    await click(tree, "重新加载");
    assert.deepEqual(calls, ["view"]);
    busy = true;
    await act(async () => {
      tree.update(render());
    });
    assert.equal(loading().length, 1);
    data = initial();
    error = "";
    busy = false;
    await act(async () => {
      tree.update(render());
    });
    assert.equal(loading().length, 0);
    assert.ok(
      tree.root.findAll((node) => node.children.includes("Mug")).length,
    );
    busy = true;
    await act(async () => {
      tree.update(render());
    });
    assert.equal(
      loading().length,
      0,
      "background refresh keeps the current cart visible",
    );
    assert.ok(
      tree.root.findAll((node) => node.children.includes("Mug")).length,
    );
  } finally {
    await act(async () => tree?.unmount());
  }
});
const text = (value: any): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(text).join("")
      : value?.props
        ? text(value.props.children)
        : "";
const button = (tree: ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root
    .findAllByType("button")
    .find((n) => text(n.props.children) === label)!;

test("historical order cards open the exact Order without list permission", async () => {
  const orderId = "historical-order";
  const otherOrder = { id: "different-order", lines: [] };
  const data = {
    ...initial(),
    cart: undefined,
    viewedOrder: otherOrder,
    capabilities: { ucp: true, methods: [{ method: "commerce.orders.get", availability: "supported" }] },
  };
  const calls: unknown[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        data, draftScope: "historical-order", busy: false, now: Date.now(), error: "",
        initialTab: "orders", initialOrderId: orderId,
        action: async (operation, payload, onResult) => {
          calls.push([operation, payload?.intent]);
          onResult?.({ viewedOrder: { id: orderId, lines: [{ id: "line", title: "Historical Mug", quantity: 1 }] } });
          return true;
        },
      }));
    });
    assert.deepEqual(calls, [["shopping", { action: "order-detail", orderId }]]);
    assert(tree.root.findAll(node => node.children.includes("订单详情")).length);
    assert(tree.root.findAll(node => node.children.includes("Historical Mug")).length);
    assert(!JSON.stringify(tree.toJSON()).includes(otherOrder.id));
    await click(tree, "刷新详情");
    assert.deepEqual(calls, Array(2).fill(["shopping", { action: "order-detail", orderId }]));
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("a stopped first Cart exposes explicit original recovery", async () => {
  const calls: string[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        data: {
          ...initial(),
          cart: undefined,
          products: {items: []},
          pending: true,
          cartCreationPending: true,
          canRetryCart: true,
          capabilities: {ucp: true, methods: []},
        },
        draftScope: "cart-recovery", initialTab: "cart", busy: false, now: Date.now(), error: "",
        action: async op => { calls.push(op); return true; },
      }));
    });
    assert.deepEqual(calls, []);
    await click(tree, "刷新购物车");
    await click(tree, "恢复原购物车");
    assert.deepEqual(calls, ["view", "retry-cart"]);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("an expired pending Prepare exposes a separate owner action to reopen the draft", async () => {
  const calls: { operation: string; actionId?: string }[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        data: {
          ...initial(),
          pending: true,
          preparationRecovery: true,
          canReopenDraft: true,
          capabilities: { ucp: true, methods: [] },
        },
        draftScope: "expired-prepare", initialTab: "cart", busy: false, now: Date.now(), error: "",
        action: async (operation, payload) => {
          calls.push({ operation, actionId: payload?.actionId });
          return true;
        },
      }));
    });
    await click(tree, "刷新状态");
    await click(tree, "在原购物车重开结算");
    assert.deepEqual(calls.map(call => call.operation), ["recover-status", "reopen-ucp-draft"]);
    assert.match(calls[1].actionId ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("Cart-only storefront keeps the Cart visible without Checkout or Order actions", async () => {
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        draftScope: "ucp-cart-only",
        data: {
          ...initial(),
          purchaseReady: false,
          capabilities: { ucp: true, methods: [{ method: "commerce.carts.get", availability: "supported" }] },
        },
        busy: false,
        error: "",
        now: Date.now(),
        action: async () => true,
      }));
    });
    assert(tree.root.findAll((node) => node.children.includes("Mug")).length);
    assert(tree.root.findAll((node) => node.children.includes("商家购买服务尚未就绪。")).length);
    for (const label of ["去结算", "继续结算", "去结账", "继续结账", "我的订单"])
      assert.equal(button(tree, label), undefined);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("refreshing a pending UCP purchase is read-only and retry has a separate action", async () => {
  const calls: string[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        draftScope: "ucp-purchase",
        data: {...initial(), pending: true, purchaseRecovery: true, canRetryPurchase: true,
          capabilities: {ucp: true, methods: []}},
        initialTab: "cart", busy: false, error: "", now: Date.now(),
        action: async operation => { calls.push(operation); return true; },
      }));
    });
    await click(tree, "刷新状态");
    await click(tree, "重试原购买请求");
    assert.deepEqual(calls, ["recover-status", "recover"]);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("hosted checkout opens the exact browser link and keeps the original checkout in the refresh scope", async () => {
  const calls: string[] = [];
  const scopes: string[] = [];
  let tree!: ReactTestRenderer;
  const now = Date.now();
  const url = `https://shop.example/ucp/v1/checkout-sessions/draft/handoff#${"a".repeat(43)}`;
  const data = {
    ...initial(),
    checkout: { id: "draft", status: "requires_escalation", hostedHandoff: true, handoff: url },
    capabilities: { ucp: true, methods: [{ method: "commerce.checkouts.get", availability: "supported" }] },
  };
  const render = (at: number) => React.createElement(Storefront, {
    draftScope: "hosted-checkout", data, initialTab: "cart", busy: false, error: "", now: at,
    action: async (operation) => { calls.push(operation); return true; },
    onViewChange: scope => { scopes.push(scope); },
  });
  try {
    await act(async () => { tree = create(render(now)); });
    assert.equal(scopes.at(-1), "checkout");
    const handoff = tree.root.findByProps({ href: url });
    assert.equal(handoff.props.rel, "noopener noreferrer");
    assert.equal(button(tree, "授权浏览器"), undefined);
    assert.equal(button(tree, "核对并继续"), undefined);
    await act(async () => { handoff.props.onClick(); });
    assert(tree.root.findAll(node => node.children.includes("正在核对原结算。付款后可回到这里查看订单。")).length);
    await act(async () => { tree.update(render(now + 301_000)); });
    assert(!tree.root.findAll(node => node.children.includes("正在核对原结算。付款后可回到这里查看订单。")).length);
    await click(tree, "刷新结算状态");
    assert.deepEqual(calls, ["refresh-ucp-checkout"]);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("the browser link opens the separate pairing form and pairing confirms in place", async () => {
  let tree!: ReactTestRenderer;
  const calls: Array<{ operation: string; payload: any }> = [];
  const details = { open: false };
  const code = "a".repeat(43);
  const url = "https://shop.example/ucp/v1/checkout-sessions/draft/handoff";
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        draftScope: "browser-pairing", initialTab: "cart", busy: false, error: "", now: Date.now(),
        data: { ...initial(), checkout: { id: "draft", status: "requires_escalation", handoff: url },
          capabilities: { ucp: true, methods: [{ method: "commerce.checkouts.get", availability: "supported" }] } },
        action: async (operation, payload) => { calls.push({ operation, payload }); return true; },
      }), { createNodeMock: element => element.type === "details" ? details : null });
    });
    await act(async () => tree.root.findByProps({ href: url }).props.onClick());
    assert.equal(details.open, true);
    const pairing = tree.root.findByProps({ className: "fv-browser-pairing" });
    assert.equal(button(tree, "授权浏览器")?.props.disabled, true);
    await act(async () => pairing.findByType("input").props.onChange({ target: { value: code } }));
    await act(async () => pairing.findByType("form").props.onSubmit({ preventDefault: () => {} }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operation, "approve-handoff");
    assert.equal(calls[0]?.payload.challenge, code);
    assert.equal(pairing.findAllByType("input").length, 0);
    assert.equal(pairing.findByProps({ role: "status" }).children.join(""), "已授权，请回到浏览器查看。");
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("checkout preparation offers a separate resume and restores checkout on the same cart after cancellation", async () => {
  const requests: { operation: string; payload?: any }[] = [];
  let tree!: ReactTestRenderer;
  let data = {
    ...initial(),
    preparationRecovery: true,
    canRetryPreparation: true,
    pending: true,
    checkout: { id: "original-draft", status: "incomplete" },
    capabilities: {
      ucp: true,
      ucpCheckoutConfirmation: true,
      methods: ["commerce.checkouts.get", "commerce.checkouts.create"].map(
        (method) => ({ method, availability: "supported" }),
      ),
    },
  };
  const render = () =>
    React.createElement(Storefront, {
      draftScope: "ucp-preparation",
      data,
      initialTab: "cart", busy: false, error: "", now: Date.now(),
      action: async (operation, payload) => { requests.push({ operation, payload }); return true; },
    });
  try {
    await act(async () => { tree = create(render()); });
    await click(tree, "刷新状态");
    await click(tree, "继续原结算准备");
    assert.deepEqual(requests.map(({ operation }) => operation), ["recover-status", "recover"]);
    data = {
      ...data,
      preparationRecovery: false,
      canRetryPreparation: false,
      pending: false,
      checkout: { ...data.checkout, status: "canceled" },
    };
    await act(async () => { tree.update(render()); });
    assert.equal(button(tree, "继续原结算准备"), undefined);
    await click(tree, "重新结算");
    assert.equal(requests.at(-1)?.operation, "shopping");
    assert.deepEqual(requests.at(-1)?.payload.intent, { action: "prepare" });
    assert.equal(requests.at(-1)?.payload.expected_version, "v1");
  } finally {
    await act(async () => tree?.unmount());
  }
});

const address = (tree: ReactTestRenderer) =>
  tree.root.findAllByType("input").find((n) => n.props.name === "line1")!;
const click = async (tree: ReactTestRenderer, label: string) => {
  await act(async () => {
    const target = button(tree, label);
    assert.ok(
      target,
      `Missing ${label}; buttons: ${tree.root
        .findAllByType("button")
        .map((n) => text(n.props.children))
        .join(",")}`,
    );
    await target.props.onClick();
  });
};
const edit = async (tree: ReactTestRenderer, value: string) => {
  await act(async () => {
    address(tree).props.onChange({ target: { value } });
  });
};
const submit = async (tree: ReactTestRenderer) => {
  await act(async () => {
    await tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
};

const physicalUcpDraft = () => ({
  ...initial(),
  checkout: {
    id: "ucp-draft",
    version: "draft-v1",
    status: "incomplete",
    messages: [{ content: "当前无法收取实物订单款项。" }],
    fulfillment: {
      methods: [{
        type: "shipping",
        selected_destination_id: "destination",
        destinations: [{
          id: "destination",
          first_name: "测试买家",
          phone_number: "13800138000",
          street_address: "测试镇旧路 1 号",
        }],
      }],
    },
  },
  capabilities: {
    ucp: true,
    ucpFulfillment: true,
    methods: ["commerce.checkouts.get", "commerce.checkouts.create"].map(method => ({ method, availability: "supported" })),
  },
});

const replacementUcpDraft = () => {
  const data = physicalUcpDraft();
  data.checkout.id = "replacement-draft";
  data.checkout.fulfillment.methods[0]!.destinations[0]!.street_address = "测试镇乙路 2 号";
  return data;
};

test("UCP draft address form warns about a numeric-only CN address before an RPC", async () => {
  let tree!: ReactTestRenderer;
  const requests: string[] = [];
  try {
    await act(async () => {
      tree = create(React.createElement(Storefront, {
        draftScope: "invalid-ucp-contact",
        data: physicalUcpDraft(),
        initialTab: "cart",
        busy: false,
        error: "",
        now: Date.now(),
        action: async operation => { requests.push(operation); return true; },
      }));
    });
    assert.equal(button(tree, "保存到结算草稿").props.disabled, false);
    await edit(tree, "111");
    await submit(tree);
    assert.deepEqual(requests, []);
    assert.equal(address(tree).props.value, "111");
    assert.equal(address(tree).props["aria-invalid"], true);
    assert(tree.root.findAll(node => node.children.includes("请填写完整收货地址，不能只填数字。")).length);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("UCP draft address form preserves an unacknowledged edit and announces only an acknowledged save", async () => {
  let tree!: ReactTestRenderer;
  let data = physicalUcpDraft();
  let resolveSave!: (ok: boolean) => void;
  let submission!: Promise<void>;
  const requests: { operation: string; payload: any }[] = [];
  const edited = "测试镇新庄村 23 号";
  const normalized = "测试镇新庄村23号";
  const successText = "收货信息已保存到结算草稿。";
  const failedText = "未能确认收货信息已保存，请核对原草稿。";
  const hasStatus = (value: string) => tree.root.findAll(node =>
    node.props.role === "status" && text(node.props.children) === value,
  ).length > 0;
  const render = () => React.createElement(Storefront, {
    draftScope: "ucp-contact-response",
    data,
    initialTab: "cart",
    busy: false,
    error: "",
    now: Date.now(),
    action: (operation, payload) => {
      requests.push({ operation, payload });
      return new Promise<boolean>(resolve => { resolveSave = resolve; });
    },
  });
  const startSubmit = async () => {
    await act(async () => {
      submission = tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
  };
  try {
    await act(async () => { tree = create(render()); });
    assert(!hasStatus(successText));
    await edit(tree, edited);
    await startSubmit();
    assert.equal(button(tree, "正在保存…").props.disabled, true);
    assert(!hasStatus(successText));
    await act(async () => { resolveSave(false); await submission; });
    assert.equal(address(tree).props.value, edited);
    assert(!hasStatus(successText));
    assert(tree.root.findByType("form").findAll(node => node.children.includes(failedText)).length);
    assert.equal(button(tree, "保存到结算草稿").props.disabled, false);
    await startSubmit();
    assert.deepEqual(requests.map(({ operation, payload }) => [
      operation, payload.expected_version, payload.checkout_id, payload.patch.shipping_address.line1,
    ]), [["contact", "v1", "ucp-draft", edited], ["contact", "v1", "ucp-draft", edited]]);
    await act(async () => {
      data.checkout.version = "draft-v2";
      data.checkout.fulfillment.methods[0]!.destinations[0]!.street_address = normalized;
      tree.update(render());
      resolveSave(true);
      await submission;
    });
    assert.equal(address(tree).props.value, normalized);
    assert(hasStatus(successText));
    assert(tree.root.findAll(node => node.children.includes("当前无法收取实物订单款项。")).length);
    await edit(tree, "测试镇新庄村 24 号");
    assert(!hasStatus(successText), "new edits must clear the previous save acknowledgement");
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("a canceled UCP draft never prefills its unsaved address into the same cart's replacement", async () => {
  let tree!: ReactTestRenderer;
  let data = physicalUcpDraft();
  const intents: string[] = [];
  const render = () => React.createElement(Storefront, {
    draftScope: "replace-ucp-draft",
    data, initialTab: "cart", busy: false, error: "", now: Date.now(),
    action: async (operation, payload) => {
      assert.equal(operation, "shopping");
      const intent = payload.intent.action;
      intents.push(intent);
      data = intent === "edit-cart"
        ? { ...data, checkout: { ...data.checkout, status: "canceled" } }
        : replacementUcpDraft();
      tree.update(render());
      return true;
    },
  });
  try {
    await act(async () => { tree = create(render()); });
    await edit(tree, "甲草稿的未保存地址");
    await click(tree, "取消草稿并修改购物车");
    await click(tree, "重新结算");
    assert.deepEqual(intents, ["edit-cart", "prepare"]);
    assert.equal(address(tree).props.value, "测试镇乙路 2 号");
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("late UCP save results preserve current edits and a newer draft's acknowledgment", async () => {
  let tree!: ReactTestRenderer;
  let data: ReturnType<typeof physicalUcpDraft> | undefined = physicalUcpDraft();
  const resolves: Array<(ok: boolean) => void> = [];
  const submissions: Array<Promise<void>> = [];
  const render = () => React.createElement(Storefront, {
    draftScope: "late-ucp-save",
    data, initialTab: "cart", busy: false, error: "", now: Date.now(),
    action: () => new Promise<boolean>(resolve => resolves.push(resolve)),
  });
  const startSubmit = () => act(async () => {
    submissions.push(tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  });
  const confirm = (index: number) => act(async () => {
    resolves[index]!(true);
    await submissions[index];
  });
  const savedNotice = () => tree.root.findAll(node => node.props.role === "status" &&
    text(node.props.children) === "收货信息已保存到结算草稿。").length;
  try {
    await act(async () => { tree = create(render()); });
    await edit(tree, "旧草稿正在保存的地址");
    await startSubmit();
    // A failed read remounts the address form while retaining the same local draft.
    data = undefined;
    await act(async () => { tree.update(render()); });
    data = physicalUcpDraft();
    await act(async () => { tree.update(render()); });
    await edit(tree, "旧草稿的新输入");
    await confirm(0);
    assert.equal(address(tree).props.value, "旧草稿的新输入");
    assert.equal(savedNotice(), 0);

    await startSubmit();
    data = replacementUcpDraft();
    await act(async () => { tree.update(render()); });
    await edit(tree, "新草稿提交的地址");
    await startSubmit();
    await act(async () => {
      data!.checkout.fulfillment.methods[0]!.destinations[0]!.street_address = "新草稿服务端规范化地址";
      tree.update(render());
    });
    await confirm(2);
    assert(savedNotice());
    await confirm(1);
    assert(savedNotice(), "the old receipt cannot replace the new draft's acknowledgment");
    assert.equal(address(tree).props.value, "新草稿服务端规范化地址");
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("an unconfirmed save uses a single error message with an inline fallback during recovery", async () => {
  let tree!: ReactTestRenderer;
  let pending = false;
  let error = "";
  let errorCode: string | undefined;
  const failedText = "收货信息未保存，请重试。";
  const pendingText = "暂未收到商店回复，请先核对原操作结果。";
  const fallback = "未能确认收货信息已保存，请核对原草稿。";
  const messages = (message: string) => tree.root.findAllByType("div").filter(node =>
    node.props.role === "alert" && text(node.props.children).includes(message));
  const render = () => React.createElement(Storefront, {
    draftScope: "single-ucp-contact-error",
    data: { ...physicalUcpDraft(), pending }, initialTab: "cart", busy: false, error, errorCode, now: Date.now(),
    action: async () => {
      if (!error) {
        error = failedText;
        errorCode = "CONTACT_NOT_SAVED";
      } else {
        pending = true;
        error = pendingText;
        errorCode = "NETWORK_UNCERTAIN";
      }
      tree.update(render());
      return false;
    },
  });
  try {
    await act(async () => { tree = create(render()); });
    const input = "测试镇新庄村 23 号";
    await edit(tree, input);
    await submit(tree);
    assert.equal(messages(failedText).length, 1);
    assert.equal(messages(fallback).length, 0);
    await submit(tree);
    assert.equal(messages(pendingText).length, 0);
    assert.equal(messages(fallback).length, 1);
    assert.equal(address(tree).props.value, input);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("UCP draft save acknowledgement survives leaving the address form and stays on its original draft", async () => {
  let tree!: ReactTestRenderer;
  let data = physicalUcpDraft();
  const requests: string[] = [];
  const savedNotice = () => tree.root.findAll(node => node.props.role === "status" &&
    text(node.props.children) === "收货信息已保存到结算草稿。");
  const render = () => React.createElement(Storefront, {
    draftScope: "ucp-contact-status-transition",
    data,
    initialTab: "cart",
    busy: false,
    error: "",
    now: Date.now(),
    action: async operation => {
      requests.push(operation);
      data = {
        ...data,
        checkout: { ...data.checkout, version: "draft-v2", status: "requires_escalation" },
      };
      tree.update(render());
      return true;
    },
  });
  try {
    await act(async () => { tree = create(render()); });
    await edit(tree, "测试镇新庄村 23 号");
    await submit(tree);
    assert.deepEqual(requests, ["contact"]);
    assert.equal(address(tree), undefined, "the returned checkout no longer has an editable address form");
    assert(savedNotice().length, "the original draft still shows its successful save");

    data = { ...data, checkout: { ...data.checkout, id: "another-draft" } };
    await act(async () => { tree.update(render()); });
    assert.equal(savedNotice().length, 0, "another checkout for the same cart cannot inherit feedback");
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("manual zero-price checkout never asks for an address or payment selection, but still requires owner confirmation", async () => {
  let tree!: ReactTestRenderer;
  const now = Date.now(),
    expires = now + 60000;
  const calls: string[] = [];
  let data: any = initial();
  delete data.cart.shipping_address;
  data.cart.fulfillment_kind = "manual";
  data.cart.lines[0].catalog = null;
  data.delivery = {
    cart_id: "cart",
    cart_version: "v1",
    delivery_groups: [],
    requirements: [],
  };
  const total = { currency: "CNY", amount_minor: "0" };
  const render = () =>
    React.createElement(Storefront, {
      draftScope: "manual-zero",
      data,
      busy: false,
      error: "",
      now,
      action: async (operation, payload) => {
        const action =
          operation === "shopping" ? payload.intent.action : operation;
        calls.push(action);
        if (action === "quote")
          data = {
            ...data,
            quote: {
              lines: data.cart.lines,
              expires_at: new Date(expires).toISOString(),
              totals: { grand_total: total },
            },
          };
        if (action === "prepare")
          data = { ...data, checkout: { id: "checkout" } };
        if (action === "review")
          data = { ...data, intent: { id: "intent", expiresAt: expires } };
        if (action === "confirm")
          data = {
            ...data,
            order: {
              id: "manual-order",
              status: "open",
              fulfillment_kind: "manual",
              fulfillment_status: "unfulfilled",
              payment: { status: "not_required" },
              payment_required: false,
              lines: data.cart.lines,
              totals: { grand_total: total },
              manual_deliveries: { items: [] },
            },
          };
        tree.update(render());
        return true;
      },
    });
  try {
    await act(async () => {
      tree = create(render());
    });
    await click(tree, "去结账");
    assert.equal(address(tree), undefined);
    assert.ok(calls.includes("prepare-delivery"));
    assert.equal(button(tree, "核对订单信息").props.disabled, false);
    await click(tree, "返回修改");
    await click(tree, "去结账");
    assert.equal(
      address(tree),
      undefined,
      "back navigation must not enter physical address fields",
    );
    await click(tree, "核对订单信息");
    await click(tree, "返回修改");
    assert.equal(address(tree), undefined);
    await click(tree, "核对订单信息");
    await click(tree, "核对并继续");
    assert.equal(tree.root.findAllByProps({ type: "radio" }).length, 0);
    assert.equal(button(tree, "确认下单 · CNY 0.00").props.disabled, false);
    assert.equal(
      calls.includes("confirm"),
      false,
      "zero value must not auto-submit an order",
    );
    await click(tree, "确认下单 · CNY 0.00");
    assert.equal(calls.filter((value) => value === "confirm").length, 1);
    assert.equal(calls.includes("payment-start"), false);
    assert.equal(calls.includes("contact"), false);
    const rendered = JSON.stringify(tree.toJSON());
    assert.ok(rendered.includes("交付进度"));
    assert.equal(rendered.includes("暂无运单信息"), false);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("address B survives save timeout, FlowViews clearing value on refresh failure, and later network recovery", async () => {
  let remote = initial();
  let offline = false;
  let failedReads = 0;
  const requests: string[] = [];
  const ref = { sessionId: "session", flowId: "flow" };
  const views = new FlowViews(async () => {
    if (offline) {
      failedReads++;
      throw Error("NETWORK_TIMEOUT");
    }
    return structuredClone(remote);
  }, 0);
  function Harness() {
    const [data, setData] = useState<any>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(
      () =>
        views.subscribe(
          ref,
          (state) => {
            setData(state.value);
            setError(state.error?.message ?? "");
          },
          { scope: () => "checkout" },
        ),
      [],
    );
    const action = async (op: string, payload: any = {}) => {
      const release = views.hold(ref);
      setBusy(true);
      try {
        requests.push(payload.intent?.action ?? op);
        if (op === "contact") {
          if (offline) throw Error("NETWORK_TIMEOUT");
          remote = {
            ...remote,
            cart: { ...remote.cart, ...payload.patch, version: "v2" },
          };
          // Merchant normalization must replace the draft only after success.
          remote.cart.shipping_address.line1 = "Saved Address B";
          views.publish(ref, structuredClone(remote));
        }
        return true;
      } catch {
        views.invalidate(ref, ["checkout"]);
        return false;
      } finally {
        setBusy(false);
        release();
      }
    };
    return React.createElement(Storefront, {
      draftScope: JSON.stringify([0, ref.sessionId, ref.flowId]),
      data,
      busy,
      error,
      action,
      now: Date.now(),
    });
  }
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(React.createElement(Harness));
    });
    await click(tree, "去结账");
    await edit(tree, "Address B");
    offline = true;
    await submit(tree);
    assert.ok(
      failedReads > 0,
      "the automatic checkout refresh must actually fail",
    );
    assert.equal(
      tree.root.findAllByType("form").length,
      0,
      "failed read unmounts AddressForm",
    );
    assert.deepEqual(requests, ["contact"]);
    offline = false;
    await act(async () => {
      await views.refresh(ref);
    });
    assert.equal(address(tree).props.value, "Address B");
    assert.ok(
      tree.root
        .findAllByType("h4")
        .some((n) => text(n.props.children) === "填写收货地址"),
    );
    assert.equal(remote.cart.shipping_address.line1, "Address A");
    assert.deepEqual(
      requests,
      ["contact"],
      "restoring the read must not advance or query delivery",
    );
    await submit(tree);
    assert.deepEqual(requests, ["contact", "contact", "prepare-delivery"]);
    await click(tree, "返回修改");
    assert.equal(
      address(tree).props.value,
      "Saved Address B",
      "successful save releases the local draft",
    );
  } finally {
    await act(async () => tree?.unmount());
    views.clear();
  }
});

test("address drafts are erased across account, logout, session, flow and cart boundaries", async () => {
  for (const boundary of ["account", "logout", "session", "flow", "cart"]) {
    let data: any = initial();
    let scope = [0, "session", "flow"];
    let tree!: ReactTestRenderer;
    const render = () =>
      React.createElement(Storefront, {
        draftScope: JSON.stringify(scope),
        data,
        busy: false,
        error: "",
        action: async () => true,
        now: Date.now(),
      });
    try {
      await act(async () => {
        tree = create(render());
      });
      await click(tree, "去结账");
      await edit(tree, "Private address B");
      // A missing value alone must retain a draft; a scope change must erase it.
      data = undefined;
      if (boundary === "account" || boundary === "logout")
        scope = [1, "session", "flow"];
      if (boundary === "session") scope = [0, "other-session", "flow"];
      if (boundary === "flow") scope = [0, "session", "other-flow"];
      await act(async () => {
        tree.update(render());
      });
      data = initial();
      if (boundary === "cart") data.cart.id = "other-cart";
      await act(async () => {
        tree.update(render());
      });
      if (boundary !== "cart") await click(tree, "去结账");
      assert.equal(address(tree).props.value, "Address A", boundary);
      scope = [0, "session", "flow"];
      data = initial();
      await act(async () => {
        tree.update(render());
      });
      if (boundary !== "cart") await click(tree, "去结账");
      assert.equal(
        address(tree).props.value,
        "Address A",
        `${boundary} must not resurrect an old draft`,
      );
    } finally {
      await act(async () => tree?.unmount());
    }
  }
});

test("identity change events clear the active draft on logout and account switch", async () => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    value: events,
    configurable: true,
  });
  let tree!: ReactTestRenderer;
  function AccountHarness() {
    const revision = useAccountRevision();
    return React.createElement(Storefront, {
      draftScope: JSON.stringify([revision, "session", "flow"]),
      data: initial(),
      busy: false,
      error: "",
      action: async () => true,
      now: Date.now(),
    });
  }
  try {
    await act(async () => {
      tree = create(React.createElement(AccountHarness));
    });
    for (const transition of ["logout", "account-switch"]) {
      await click(tree, "去结账");
      await edit(tree, `Private ${transition} address`);
      await act(async () => {
        events.dispatchEvent(new Event("frontvia-public-identity-change"));
      });
      await click(tree, "去结账");
      assert.equal(address(tree).props.value, "Address A");
      await click(tree, "返回购物车");
    }
  } finally {
    await act(async () => tree?.unmount());
    Reflect.deleteProperty(globalThis, "window");
  }
});
