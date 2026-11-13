import { test } from "node:test";
import assert from "node:assert/strict";
import { historyDefinition as history } from "../src/client/history.js";
import { toolPresentation, renderToolValue } from "../src/tool-presentation.js";
import { withHistoricalCatalog } from "../src/client/catalog-history.js";
const ui = (flowId = "flow") => ({
  kind: "frontvia-customer",
  card: "products",
  sessionId: "session",
  flowId,
});
const event = (turn: number, data: any, flow = "flow", extra = {}) => ({
  type: "tool/result",
  seq: turn,
  data: {
    turn,
    message: {
      source: { callId: `call-${turn}` },
      content: [
        {
          type: "text",
          text: JSON.stringify({ ui: ui(flow), data, ...extra }),
        },
      ],
    },
  },
});
const start = (event: any, previous?: any) =>
  history.start(
    {},
    { event },
    { previous: () => previous && { state: previous } },
  );
const lamp = {
  id: "lamp",
  title: "台灯",
  images: [{ url: "https://shop.test/lamp.png" }],
  price_range: { minimum: { currency: "CNY", amount_decimal: "289.90" } },
};
const variant = (id: string) => ({
  id: id + "-sku",
  product_id: id,
  title: "Default",
  unit_price: {
    currency: "CNY",
    amount_decimal: id === "lamp" ? "289.90" : "0.01",
  },
});

test("legacy transcript replay retains each turn's product and image through subsequent selections and live order updates", () => {
  const events = [
    event(1, { items: [lamp, { id: "coaster", title: "杯垫" }] }),
    event(2, { items: [variant("lamp")] }),
    event(3, { items: [variant("coaster")] }),
  ];
  const replay = () => {
    let state: any;
    return events.map((e) => (state = start(e, state)));
  };
  const states = replay();
  assert.deepEqual(replay(), states);
  const catalog = states[1].cards[0].catalog;
  assert.equal(catalog.variantProductId, "lamp");
  assert.equal(
    catalog.products.items[0].images[0].url,
    "https://shop.test/lamp.png",
  );
  assert.equal(states[2].cards[0].catalog.variantProductId, "coaster");
  assert.equal(states[0].cards[0].catalog.variants, undefined);
  const live = {
    variants: { items: [variant("coaster")] },
    cart: { version: "v9" },
    order: { payment: { status: "paid" } },
    intent: { id: "current" },
  };
  const view = withHistoricalCatalog(live, {
    ...catalog,
    cart: { version: "old" },
    intent: { id: "forged" },
  } as any);
  assert.equal(view.variants.items[0].product_id, "lamp");
  assert.equal(view.cart, live.cart);
  assert.equal(view.order, live.order);
  assert.equal(view.intent, live.intent);
  assert.equal(withHistoricalCatalog(undefined, catalog), undefined);
  assert.deepEqual(states, replay());
});

test("new snapshots restore without preceding history, preserve empty specifications, and never inherit another flow's catalog", () => {
  const empty = start(
    event(4, {}, "flow", {
      catalogSnapshot: {
        version: 1,
        products: { items: [lamp] },
        variants: { items: [] },
        variantProductId: "lamp",
      },
    }),
  );
  assert.deepEqual(empty.cards[0].catalog.variants.items, []);
  const other = start(
    event(5, { items: [variant("other")] }, "another-flow"),
    empty,
  );
  assert.equal(other.cards[0].catalog.products, undefined);
  const next = history.update(
    { state: empty },
    { event: event(4, { items: [variant("coaster")] }) },
  );
  assert.equal(next.cards.length, 1);
  assert.equal(empty.cards[0].catalog.variantProductId, "lamp");
});


test("native and nested tool history survives model text spill without carrying transaction state", () => {
  const value = { ui: ui(), data: { items: [lamp], description: "x".repeat(60000) },
    catalogSnapshot: { version: 1, products: { items: [lamp] } },
    cart: { version: "private-live-cart" }, quote: { id: "private-quote" } };
  const meta = toolPresentation(value);
  const rendered = renderToolValue(value);
  assert.equal(JSON.parse(rendered).catalogSnapshot, undefined);
  assert.deepEqual(JSON.parse(rendered).data.items, [lamp]);
  assert.doesNotMatch(JSON.stringify(meta), /private-live-cart|private-quote/);
  const content = [{ type: "text", text: rendered.slice(0, 50000) + "(truncated by Host)" }];
  for (const type of ["tool/result", "tool/ptc-dispatch"]) {
    const e = { type, seq: 10, data: { turn: 3, meta, content,
      message: { source: { callId: "large-catalog" }, content } } };
    const state = start(e);
    assert.equal(state.cards[0].ui.flowId, "flow");
    assert.equal(state.cards[0].catalog.products.items[0].title, "台灯");
  }
});
