import { test } from "node:test";
import assert from "node:assert/strict";
import { historyDefinition as history } from "../src/client/history.js";
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
