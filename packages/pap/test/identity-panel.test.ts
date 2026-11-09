import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityPanel } from "../src/client/identity-panel.js";

test("PAP alone offers installation guidance and only shows the login button when the identity panel exists", () => {
  const identity = { configured: true, signedIn: false };
  const alone = renderToStaticMarkup(
    createElement(IdentityPanel, { identity }),
  );
  assert.match(alone, /请安装或启用 DSH 账号插件/);
  assert.doesNotMatch(alone, /<button/);
  assert.match(
    renderToStaticMarkup(
      createElement(IdentityPanel, { identity, openAccount() {} }),
    ),
    /打开 DSH 账号/,
  );
});

test("signed-in and pending-logout accounts keep an actionable account entry", () => {
  const render = (identity: any) =>
    renderToStaticMarkup(
      createElement(IdentityPanel, { identity, openAccount() {} }),
    );
  const signedIn = render({
    configured: true,
    signedIn: true,
    phone: "+86 •••• 1234",
  });
  assert.match(signedIn, /已登录 DSH 账号/);
  assert.match(signedIn, /管理账号/);
  assert.doesNotMatch(signedIn, /账号管理和退出登录请前往|undefined/);
  const pending = render({
    configured: true,
    signedIn: false,
    logoutPending: true,
  });
  assert.match(pending, /退出尚未完成/);
  assert.match(pending, /管理账号/);
});
