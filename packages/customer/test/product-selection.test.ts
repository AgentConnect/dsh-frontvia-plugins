import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ProductSelection } from "../src/client/product-selection.js";
import {
  catalogSnapshot,
  withHistoricalCatalog,
} from "../src/client/catalog-history.js";

const variant = {
  id: "v1",
  product_id: "p1",
  title: "Default",
  sku: "LAMP-60-PRO",
  selected_options: [{ name: "尺寸", value: "60cm" }],
  unit_price: { currency: "CNY", amount_decimal: "289.90" },
  availability: { status: "in_stock", quantity_available: 99 },
};
const render = (data: any) =>
  renderToStaticMarkup(
    createElement(ProductSelection, {
      data,
      busy: false,
      canAsk: true,
      ask: async () => {},
      onCart() {},
      formatPrice: (v) => (v ? `${v.currency} ${v.amount_decimal}` : "待核对"),
      children: createElement("div", null, "完整商品列表"),
    }),
  );

test("chat catalog snapshots keep multiple photos; switching photos and returning to the list never send an agent command", async () => {
  const products = {
    items: [
      {
        id: "p1",
        title: "桌面台灯",
        images: [
          { url: "https://shop.test/front.jpg", alt: "正面" },
          { url: "https://shop.test/side.jpg", alt: "侧面" },
        ],
      },
    ],
  };
  const snapshot = catalogSnapshot({
    ui: { card: "products" },
    catalogSnapshot: {
      version: 1,
      products,
      variants: { items: [variant] },
      variantProductId: "p1",
    },
  });
  const data = withHistoricalCatalog({ cartReady: true }, snapshot);
  const commands: unknown[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(
        createElement(ProductSelection, {
          data,
          busy: false,
          canAsk: true,
          ask: async (intent) => {
            commands.push(intent);
          },
          formatPrice: () => "CNY 289.90",
          onCart() {},
          children: createElement("div", { "aria-label": "测试商品列表" }),
        }),
      );
    });
    const mainImage = () =>
      tree.root.findByProps({ className: "fv-detail-image" }).findByType("img");
    assert.equal(mainImage().props.alt, "正面");
    await act(async () => {
      tree.root
        .findByProps({ "aria-label": "查看第 2 张商品图片" })
        .props.onClick();
    });
    assert.equal(mainImage().props.alt, "侧面");
    assert.deepEqual(commands, []);
    await act(async () => {
      tree.root
        .findAllByType("button")
        .find((n) => n.props.children?.includes?.("加购 1 件"))!
        .props.onClick();
    });
    assert.deepEqual(commands, [
      {
        action: "add",
        variantId: "v1",
        productName: "桌面台灯",
        variantName: "Default",
        quantity: 1,
      },
    ]);
    await act(async () => {
      tree.root
        .findAllByType("button")
        .find((n) => n.props.children?.includes?.("返回商品列表"))!
        .props.onClick();
    });
    assert.ok(tree.root.findByProps({ "aria-label": "测试商品列表" }));
    assert.equal(
      tree.root.findAllByProps({ className: "fv-product-gallery" }).length,
      0,
    );
    assert.equal(commands.length, 1);
  } finally {
    await act(async () => tree?.unmount());
  }
});

test("a saved variant result replaces the full list with the selected product, exact options, price and stock", () => {
  // No variantProductId: existing installed flows must also recover correctly.
  const html = render({
    products: {
      items: [
        { id: "p1", title: "桌面台灯" },
        { id: "p2", title: "其他商品" },
      ],
    },
    variants: { items: [variant] },
    cartReady: true,
  });
  for (const text of [
    "桌面台灯",
    "默认规格",
    "尺寸：60cm",
    "LAMP-60-PRO",
    "CNY 289.90",
    "可购 99 件",
    "返回商品列表",
    "加购 1 件",
  ])
    assert(html.includes(text), text);
  assert.doesNotMatch(html, /完整商品列表|其他商品/);
});

test("empty variant results stay on specifications; browsing shows only the catalog; unknown stock is not invented", () => {
  const empty = render({ variantProductId: "p2", variants: { items: [] } });
  assert.match(empty, /暂无可购买规格/);
  assert.doesNotMatch(empty, /完整商品列表/);
  const list = render({ products: { items: [] } });
  assert.match(list, /完整商品列表/);
  assert.doesNotMatch(list, /返回商品列表/);
  const unknown = render({
    variants: { items: [{ ...variant, availability: { status: "unknown" } }] },
    cartReady: true,
  });
  assert.match(unknown, /库存待核对/);
  assert.doesNotMatch(unknown, /可购 0 件/);
  const soldOut = render({
    variants: {
      items: [
        {
          ...variant,
          availability: { status: "out_of_stock", quantity_available: 0 },
        },
      ],
    },
    cartReady: true,
  });
  assert.match(soldOut, /暂不可加购/);
  assert.match(soldOut, /disabled=""/);
});
