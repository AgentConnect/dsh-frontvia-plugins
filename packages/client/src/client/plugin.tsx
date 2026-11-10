import React from "react";
import { DshAccountPanel } from "./personal-panel.js";
// @ts-ignore bundled CSS
import styles from "./styles.css";
export const inject = ["slots", "connection", "layout"];
export function apply(ctx: any) {
  const map: Record<string, string> = {
    "personal-status": "status",
    "personal-code": "requestCode",
    "personal-verify": "verify",
    "personal-logout": "logout",
  };
  async function call(op: string, payload: any = {}) {
    const r = await ctx.connection.rpc.call(
      "/api",
      `frontvia-identity/${map[op]}`,
      payload,
    );
    if (!r.ok)
      throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.value;
  }
  function Panel() {
    return (
      <section className="frontvia-client">
        <style>{styles}</style>
        <h2>Frontvia 账号</h2>
        <DshAccountPanel call={call} />
      </section>
    );
  }
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "dsh-frontvia-client" }, Panel),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "dsh-frontvia-client",
        order: 29,
        label: () => "Frontvia 账号",
      },
      () => <span aria-hidden>◯</span>,
    ),
  );
}
