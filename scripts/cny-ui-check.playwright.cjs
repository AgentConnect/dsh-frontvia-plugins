// Run with playwright-cli run-code --filename after opening a fresh cny-ui-fixture.
async (page) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const confirm = page.getByRole("button", { name: "确认购买", exact: true });
  await confirm.waitFor();
  if (!await confirm.isDisabled()) throw Error("Confirmation needs explicit review");
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.screenshot({ path: ".local/cny-ui/desktop-light.png", fullPage: true, animations: "disabled" });
  await page.evaluate(() => document.body.classList.add("dark"));
  await page.screenshot({ path: ".local/cny-ui/desktop-dark.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Horizontal overflow");
  await page.screenshot({ path: ".local/cny-ui/mobile-dark.png", fullPage: true, animations: "disabled" });
  await page.getByRole("checkbox", { name: "我已核对商品、收货信息和应付金额" }).check();
  await confirm.click();
  const payment = page.getByRole("link", { name: "去支付宝付款" });
  await payment.waitFor();
  if (await payment.getAttribute("target") !== "_blank" || await payment.getAttribute("rel") !== "noopener noreferrer") throw Error("Payment navigation must be isolated");
  await page.screenshot({ path: ".local/cny-ui/mobile-payment.png", fullPage: true, animations: "disabled" });
  // Synthetic channel fact. Never open or submit an actual payment.
  await page.evaluate(() => fetch("/__fixture/paid", { method: "POST" }));
  await page.getByRole("button", { name: "刷新订单与答复" }).click();
  await page.getByText("已付款", { exact: true }).waitFor();
  if (await payment.count()) throw Error("Paid order still offers payment");
  await page.reload();
  await page.getByText("已付款", { exact: true }).waitFor();
  const stats = await page.evaluate(() => fetch("/__fixture/stats").then(r => r.json()));
  if (stats.confirmations !== 1) throw Error("Reload duplicated confirmation");
  if (errors.length) throw Error(errors.join("; "));
  await page.screenshot({ path: ".local/cny-ui/mobile-paid.png", fullPage: true, animations: "disabled" });
  return { status: "PASS", stats, pageErrors: errors, title: await page.title() };
}
