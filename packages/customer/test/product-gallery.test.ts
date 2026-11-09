import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { productImage, productImages } from "../src/client/product-image.js";
import { ProductGallery } from "../src/client/product-gallery.js";

test("product images retain ordered HTTPS images and alt text, skipping invalid and duplicate entries", () => {
  const product = {
    images: [
      null,
      { url: "javascript:alert(1)" },
      { url: "http://shop.test/a.jpg" },
      { url: "https://user:secret@shop.test/private" },
      { url: "https://shop.test/a.jpg", alt: "正面" },
      { url: "https://shop.test/a.jpg" },
      { url: "https://shop.test/b.jpg", alt: "侧面" },
    ],
  };
  assert.deepEqual(productImages(product), [
    { url: "https://shop.test/a.jpg", alt: "正面" },
    { url: "https://shop.test/b.jpg", alt: "侧面" },
  ]);
  assert.equal(productImage(product), "https://shop.test/a.jpg");
  assert.deepEqual(productImages({ images: { url: "bad" } }), []);
});

test("gallery switches photos, preserves selection on refresh, resets on product change, and handles missing/failed images", async () => {
  let product: any = {
    id: "one",
    title: "杯垫",
    images: [
      { url: "https://shop.test/front.jpg", alt: "正面" },
      { url: "https://shop.test/side.jpg", alt: "侧面" },
    ],
  };
  let tree!: ReactTestRenderer;
  const render = () => React.createElement(ProductGallery, { product });
  const main = () => tree.root.findByProps({ className: "fv-detail-image" });
  const img = () => main().findByType("img");
  const choose = async (index: number) => {
    await act(async () => {
      tree.root.findAllByType("button")[index].props.onClick();
    });
  };
  try {
    await act(async () => {
      tree = create(render());
    });
    assert.equal(img().props.alt, "正面");
    await choose(1);
    assert.equal(img().props.src, "https://shop.test/side.jpg");
    assert.equal(
      tree.root.findAllByType("button")[1].props["aria-pressed"],
      true,
    );
    product = {
      ...product,
      images: [...product.images, { url: "https://shop.test/detail.jpg" }],
    };
    await act(async () => {
      tree.update(render());
    });
    assert.equal(img().props.alt, "侧面");
    await act(async () => {
      img().props.onError();
    });
    assert.ok(main().findByProps({ "aria-label": "图片暂不可用" }));
    await choose(0);
    assert.equal(img().props.alt, "正面");
    product = {
      id: "two",
      title: "新商品",
      images: [{ url: "https://shop.test/side.jpg" }],
    };
    await act(async () => {
      tree.update(render());
    });
    assert.equal(img().props.alt, "新商品");
    assert.equal(tree.root.findAllByType("button").length, 0);
    product = { ...product, images: [] };
    await act(async () => {
      tree.update(render());
    });
    assert.ok(main().findByProps({ "aria-label": "暂无商品图片" }));
  } finally {
    await act(async () => tree?.unmount());
  }
});
