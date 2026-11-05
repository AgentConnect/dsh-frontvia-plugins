import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityPanel } from "../src/client/identity-panel.js";

test("PAP alone offers installation guidance and only shows the login button when the Customer panel exists", () => {
  const identity = { configured: true, signedIn: false };
  const alone = renderToStaticMarkup(
    createElement(IdentityPanel, { identity }),
  );
  assert.match(alone, /请安装或启用 Frontvia 服务插件/);
  assert.doesNotMatch(alone, /<button/);
  assert.match(
    renderToStaticMarkup(
      createElement(IdentityPanel, { identity, openAccount() {} }),
    ),
    /打开 Frontvia 服务/,
  );
});
