import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductDescription } from "../src/client/product-description.js";

const render = (product: any) =>
  renderToStaticMarkup(createElement(ProductDescription, { product }));

test("product description renders merchant headings, lists, formatting and tables from the canonical Markdown field", () => {
  const html = render({
    description: "旧纯文本",
    description_markdown:
      "## 商品说明\n**双色杯**，只能手洗。\n\n- 白色\n- 黑色\n\n| 参数 | 内容 |\n| --- | --- |\n| 数量 | 1 |",
  });
  for (const expected of [
    "<h4>商品说明</h4>",
    "<strong>双色杯</strong>",
    "<ul>",
    "<li><p>黑色</p></li>",
    "<table>",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /##|旧纯文本/);
  assert.match(
    render({ description: "兼容纯文本\n第二行" }),
    /兼容纯文本<br\/>第二行/,
  );
  assert.equal(render({}), "");
});

test("merchant HTML and unsafe links remain inert; only registered gallery images are loaded", () => {
  const html = render({
    description_markdown:
      "<script>alert(1)</script>\n\n[危险](javascript:alert%281%29) [凭据](https://user:password@example.test/) [正常](https://example.test/info)\n\n![跟踪](https://tracker.test/pixel) ![商品图](https://images.test/cup.png)",
    images: [{ url: "https://images.test/cup.png" }],
  });
  assert.doesNotMatch(
    html,
    /<script>|href="javascript:|href="https:\/\/user:|src="https:\/\/tracker/,
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.test\/info"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.match(html, /referrerPolicy="no-referrer"/i);
});
