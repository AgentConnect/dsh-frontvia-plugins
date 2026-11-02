// Run through playwright-cli run-code --filename after starting the isolated DSH.
// All intercepted Commerce UI responses are synthetic. No model or purchase request.
async (page) => {
  const fixture = {
    flowId: "058231ab-3002-49ae-ac13-f2ffe9ea1060",
    sessionId: "session-ui-fixture",
    siteId: "test-shop",
    storeId: "store-test",
    products: {
      items: [
        {
          id: "mug",
          title: "Travel Mug",
          price_range: { min: { amount_minor: "1234", currency: "USD" } },
        },
        {
          id: "bag",
          title: "Canvas Bag",
          price_range: { min: { amount_minor: "1990", currency: "USD" } },
        },
      ],
    },
    variants: {
      items: [
        {
          id: "mug-default",
          title: "Travel Mug · Default",
          unit_price: { amount_minor: "1234", currency: "USD" },
        },
      ],
    },
    cart: {
      id: "cart-ui",
      version: "v1",
      lines: [
        {
          id: "line-ui",
          title: "Travel Mug",
          quantity: 1,
          unit_price: { amount_minor: "1234", currency: "USD" },
        },
      ],
      totals: { grand_total: { amount_minor: "1234", currency: "USD" } },
    },
    pending: false,
  };
  const state = {
    fixture,
    requests: [],
    failContact: false,
    failView: false,
    lostConfirm: false,
    delay: 0,
    captures: 0,
  };
  await page.unroute("**/api/frontvia-customer/*");
  await page.route("**/api/frontvia-customer/*", async (route) => {
    const b = route.request().postDataJSON();
    const op = b.method.split("/").at(-1);
    const control = await page.evaluate(() => window.__fvTestControl || {});
    Object.assign(state, control);
    if (control.fixture) state.fixture = control.fixture;
    let value = state.fixture;
    let error;
    if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
    if (op === "list")
      value = {
        flows: [
          {
            flowId: fixture.flowId,
            sessionId: fixture.sessionId,
            siteId: "test-shop",
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    else if (op === "view" && state.failView)
      error = { code: "CONNECTION_DISCONNECTED" };
    else if (op === "contact") {
      state.requests.push({
        op,
        expected_version: b.payload.expected_version,
        keys: Object.keys(b.payload.patch),
      });
      if (state.failContact) error = { code: "CART_VERSION_CHANGED" };
      else {
        state.fixture.cart = {
          ...state.fixture.cart,
          ...b.payload.patch,
          version: "v2",
        };
        value = state.fixture;
      }
    } else if (op === "review") {
      state.requests.push({ op });
      state.fixture.intent = {
        id: "intent-ui",
        expiresAt: Date.now() + 120000,
        submitted: false,
      };
      value = state.fixture;
    } else if (op === "confirm") {
      state.requests.push({ op, keys: Object.keys(b.payload) });
      state.captures += state.fixture.intent?.submitted ? 0 : 1;
      state.fixture.intent = { ...state.fixture.intent, submitted: true };
      state.fixture.order = {
        id: "order-ui",
        display_number: "1",
        lines: state.fixture.cart.lines,
        payment: { status: "paid" },
        fulfillment_status: "unfulfilled",
        totals: state.fixture.quote.totals,
      };
      if (state.lostConfirm) {
        await page.evaluate((s) => {
          window.__fvTestState = s;
          window.__fvTestControl = {};
        }, state);
        await route.abort();
        return;
      }
      value = state.fixture;
    } else if (op === "recover") {
      state.fixture.pending = false;
      value = state.fixture;
    }
    await page.evaluate((s) => {
      window.__fvTestState = s;
      window.__fvTestControl = {};
    }, state);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "server-response",
        rpcId: b.rpcId,
        result: error
          ? { ok: false, error: { ...error, message: error.code, details: {} } }
          : { ok: true, value },
      }),
    });
  });
  await page.reload();
  await page
    .getByRole("region", { name: "Frontvia 购物卡片" })
    .last()
    .waitFor();
  await page
    .getByRole("region", { name: "Frontvia 购物卡片" })
    .last()
    .getByRole("tab", { name: "收货配送" })
    .click();
  await page
    .getByRole("textbox", { name: "收货人", exact: true })
    .last()
    .waitFor();
  return { fixture: "synthetic UI responses in real DSH host", ready: true };
}
