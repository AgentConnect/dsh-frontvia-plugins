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

test("public identity status never asks for a Frontvia phone login",()=>{
 const ready=render({configured:true,provider:'dsh-public-identity',state:'ready'});
 assert.match(ready,/已通过公共身份接入/);assert.match(ready,/公共身份与 PAP 设置/);
 const empty=render({configured:false,state:'unconfigured'});assert.match(empty,/提供店铺域名/);
 for(const html of [ready,empty,render(),render(undefined,true),render({configured:false,state:'permission_denied'})])assert.doesNotMatch(html,/手机号|登录 Frontvia|管理 Frontvia 账号/);
 assert.match(render(undefined,true),/暂时无法核对公共身份/);
});
