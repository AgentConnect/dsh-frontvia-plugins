import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccountSummary,
  type AccountStatus,
} from "../src/client/account-summary.js";

const render = (status?: AccountStatus, error = false) =>
  renderToStaticMarkup(
    createElement(AccountSummary, { status, error, openAccount() {} }),
  );

test("signed-in Frontvia shows the shared masked identity and account management instead of a login prompt", () => {
  const html = render({
    configured: true,
    signedIn: true,
    phone: "+86 •••• 1234",
  });
  assert.match(html, /已登录 Frontvia 账号 · \+86 •••• 1234/);
  assert.match(html, /管理 Frontvia 账号/);
  assert.doesNotMatch(html, />登录 Frontvia 账号</);
  assert.doesNotMatch(
    render({ configured: true, signedIn: true }),
    /undefined/,
  );
});

test("only a confirmed signed-out account offers login; pending logout, errors and loading never pretend to be signed out", () => {
  assert.match(
    render({ configured: true, signedIn: false }),
    />登录 Frontvia 账号</,
  );
  for (const html of [
    render(),
    render(undefined, true),
    render({ configured: true, signedIn: false, logoutPending: true }),
    render({ configured: false, signedIn: false }),
  ]) {
    assert.doesNotMatch(html, />登录 Frontvia 账号</);
    assert.match(html, /管理 Frontvia 账号/);
  }
  assert.match(render(undefined, true), /暂时无法确认账号状态/);
  assert.match(
    render({ configured: true, signedIn: false, logoutPending: true }),
    /本机已退出/,
  );
});
