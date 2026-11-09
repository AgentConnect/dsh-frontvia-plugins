import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ProductSelection } from "../src/client/product-selection.js";
import { cardMessage, cardMessageRule } from "../src/client/card-message.js";
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

test("chat quantity editing sends the exact count and blocks invalid, stale-stock and unavailable additions", async () => {
  let tree!: ReactTestRenderer;
  let data: any = {
    flowId: "flow-one",
    cartReady: true,
    variants: {
      items: [
        {
          ...variant,
          availability: { status: "in_stock", quantity_available: 5 },
        },
      ],
    },
  };
  const messages: string[] = [];
  const renderCard = () =>
    createElement(ProductSelection, {
      data,
      busy: false,
      canAsk: true,
      formatPrice: () => "CNY 289.90",
      onCart() {},
      children: null,
      ask: async (intent) => {
        messages.push(
          cardMessage("27c7071a-3c3a-445b-ac23-d33dae7af4e2", intent),
        );
      },
    });
  const input = () => tree.root.findByType("input");
  const add = () => tree.root.findAllByType("button").at(-1)!;
  const edit = async (value: string) => {
    await act(async () => input().props.onChange({ target: { value } }));
  };
  const update = async () => {
    await act(async () => {
      tree.update(renderCard());
    });
  };
  try {
    await act(async () => {
      tree = create(renderCard());
    });
    assert.equal(input().props.max, 5);
    for (const value of ["", "0", "-1", "1.5", "6"]) {
      await edit(value);
      assert.equal(add().props.disabled, true, value);
      await act(async () => {
        await add().props.onClick();
      });
    }
    assert.equal(messages.length, 0);
    await edit("3");
    assert.equal(add().props.disabled, false);
    await act(async () => {
      await add().props.onClick();
    });
    assert.equal(JSON.parse(messages[0].split("\n")[1]).intent.quantity, 3);
    assert.match(
      cardMessageRule.match(messages[0], 0)!.data.display,
      /加购 3 件/,
    );

    data = {
      ...data,
      variants: {
        items: [{ ...variant, id: "v2", availability: { status: "unknown" } }],
      },
    };
    await update();
    assert.equal(
      input().props.value,
      "1",
      "variant quantities are independent",
    );
    assert.equal(input().props.max, 100);
    await edit("101");
    assert.equal(add().props.disabled, true);
    data = {
      ...data,
      variants: {
        items: [
          {
            ...variant,
            availability: { status: "in_stock", quantity_available: 2 },
          },
        ],
      },
    };
    await update();
    assert.equal(input().props.value, "3");
    assert.equal(
      add().props.disabled,
      true,
      "stock falling below the draft blocks submission",
    );
    data = { ...data, flowId: "flow-two" };
    await update();
    assert.equal(
      input().props.value,
      "1",
      "another shopping flow starts with its own count",
    );
    data = {
      ...data,
      variants: {
        items: [
          {
            ...variant,
            availability: { status: "out_of_stock", quantity_available: 0 },
          },
        ],
      },
    };
    await update();
    assert.equal(input().props.disabled, true);
    assert.equal(add().props.disabled, true);
    await act(async () => {
      await add().props.onClick();
    });
    assert.equal(messages.length, 1);
  } finally {
    await act(async () => tree?.unmount());
  }
});

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
