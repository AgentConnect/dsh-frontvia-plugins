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
    assert.ok(tree.root.findAll((node) => node.children.includes("Mug")).length);
    busy = true;
    await act(async () => {
      tree.update(render());
    });
    assert.equal(
      loading().length,
      0,
      "background refresh keeps the current cart visible",
    );
    assert.ok(tree.root.findAll((node) => node.children.includes("Mug")).length);
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
        events.dispatchEvent(new Event("dsh-identity-change"));
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
