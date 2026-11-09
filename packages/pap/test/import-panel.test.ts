import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ImportPanel } from "../src/client/import-panel.js";
const content = (node: any): string =>
  typeof node === "string" ? node : (node.children ?? []).map(content).join("");
const preview = {
  previewId: "preview-only",
  client: { signingKeyConfigured: true },
  sites: [
    {
      resource: "https://shop.test/rpc",
      label: "杯具店",
      description: { methods: [] },
    },
  ],
  discoveryUrl: "https://shop.test/.well-known/poppy.json",
};
test("link and JSON drafts stay separate; inspection alone cannot import and selection requires confirmation", async () => {
  const calls: any[] = [];
  let closed = 0;
  let imported = 0;
  let tree!: ReactTestRenderer;
  const call = async (op: string, payload: unknown) => {
    calls.push({ op, payload });
    return preview;
  };
  await act(async () => {
    tree = create(
      React.createElement(ImportPanel, {
        open: true,
        call,
        onImported: async () => {
          imported++;
        },
        onClose: () => {
          closed++;
        },
      }),
    );
  });
  const button = (name: string) =>
    tree.root.findAllByType("button").find((b) => content(b) === name)!;
  await act(async () => {
    tree.root
      .findByType("input")
      .props.onChange({ target: { value: "https://shop.test/link" } });
  });
  await act(async () => {
    button("使用 JSON 配置").props.onClick();
  });
  await act(async () => {
    tree.root
      .findByType("textarea")
      .props.onChange({ target: { value: '{"sites":[]}' } });
  });
  await act(async () => {
    button("使用服务链接").props.onClick();
  });
  assert.equal(
    tree.root.findByType("input").props.value,
    "https://shop.test/link",
  );
  await act(async () => {
    await tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  assert.deepEqual(calls, [
    { op: "inspect", payload: { configuration: "https://shop.test/link" } },
  ]);
  assert.equal(imported, 0);
  await act(async () => {
    button("返回编辑").props.onClick();
  });
  await act(async () => {
    button("使用 JSON 配置").props.onClick();
  });
  assert.equal(tree.root.findByType("textarea").props.value, '{"sites":[]}');
  await act(async () => {
    await tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  assert.deepEqual(calls[1], {
    op: "inspect",
    payload: { configuration: { sites: [] } },
  });
  await act(async () => {
    await button("添加 1 项服务").props.onClick();
  });
  assert.deepEqual(calls[2], {
    op: "import",
    payload: {
      previewId: "preview-only",
      resources: ["https://shop.test/rpc"],
    },
  });
  assert.equal(imported, 1);
  assert.equal(closed, 1);
  await act(async () => tree.unmount());
});
test("invalid JSON stays editable without RPC, and Escape cannot dismiss an in-flight inspection", async () => {
  let resolve!: (v: any) => void;
  const calls: string[] = [];
  let closed = 0;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      React.createElement(ImportPanel, {
        open: true,
        call: async (op) => {
          calls.push(op);
          return new Promise((r) => {
            resolve = r;
          });
        },
        onImported: async () => {},
        onClose: () => {
          closed++;
        },
      }),
    );
  });
  const button = (name: string) =>
    tree.root.findAllByType("button").find((b) => content(b) === name)!;
  await act(async () => {
    button("使用 JSON 配置").props.onClick();
  });
  await act(async () => {
    tree.root.findByType("textarea").props.onChange({ target: { value: "{" } });
  });
  await act(async () => {
    await tree.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  assert.deepEqual(calls, []);
  assert.equal(tree.root.findByType("textarea").props.value, "{");
  assert.match(content(tree.root), /JSON 不完整/);
  await act(async () => {
    button("使用服务链接").props.onClick();
  });
  await act(async () => {
    tree.root
      .findByType("input")
      .props.onChange({ target: { value: "https://shop.test/link" } });
  });
  let pending: Promise<void>;
  await act(async () => {
    pending = tree.root
      .findByType("form")
      .props.onSubmit({ preventDefault() {} });
  });
  await act(async () => {
    tree.root.findByType("dialog").props.onCancel({ preventDefault() {} });
  });
  assert.equal(closed, 0);
  await act(async () => {
    resolve(preview);
    await pending;
  });
  await act(async () => {
    tree.root.findByType("dialog").props.onCancel({ preventDefault() {} });
  });
  assert.equal(closed, 1);
  await act(async () => tree.unmount());
});
