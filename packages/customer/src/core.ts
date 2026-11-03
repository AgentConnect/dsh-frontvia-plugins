import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  Vault,
  Serial,
  fail,
  canonical,
  type PapService,
  type Secrets,
} from "dsh-pap/core";
import { z } from "zod";
import { ConsultationService, consultationSite } from "./consultation.js";
export type CustomerConfig = {
  dataDir: string;
  sites: {
    siteId: string;
    storeId: string;
    confirmationKeyRef?: string;
    confirmationKid?: string;
    mockPayment?: boolean;
  }[];
};
export type PapPort = Pick<
  PapService,
  "apiVersion" | "sites" | "status" | "connect" | "identity" | "request"
> &
  Partial<Pick<PapService, "canAccess" | "signResourceStatement">>;
type Command = {
  key: string;
  method: string;
  params: any;
  status: "pending" | "done";
  result?: any;
};
type Intent = {
  id: string;
  expiresAt: number;
  snapshot: any;
  visibleHash: string;
  nonce: string;
  key: string;
  token?: string;
};
export type Flow = {
  id: string;
  sessionId: string;
  connectionRef: string;
  siteId: string;
  storeId: string;
  connection: any;
  products?: any;
  variants?: any;
  cart?: any;
  delivery?: any;
  quote?: any;
  checkout?: any;
  order?: any;
  orders?: any;
  ordersCursor?: string;
  operation?: any;
  intent?: Intent;
  pending?: string;
  commands: Record<string, Command>;
  invocations?: Record<string, string>;
  updatedAt: string;
  capabilities?: any;
  purchaseReady?: boolean;
};
const pricing = { country: "US", currency: "USD", locale: "en-US" };
const personalProfile = "frontvia.personal_purchase.v1";
const profile = "frontvia.pap_subject_purchase.v1";
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const version = z.string().min(1).max(128);
const address = z
  .object({
    country: z.literal("US"),
    recipient: z.string().min(1).max(200),
    line1: z.string().min(1).max(300),
    line2: z.string().max(300).optional(),
    city: z.string().min(1).max(100),
    region: z.string().min(1).max(100),
    postal_code: z.string().min(1).max(40),
    phone: z.string().max(40).optional(),
  })
  .strict();
export const contactSchema = z
  .object({ email: z.email(), shipping_address: address })
  .strict();
const privateKeys = new Set([
  "email",
  "phone",
  "shipping_address",
  "billing_address",
  "customer",
  "customer_id",
  "buyer",
  "user_id",
  "identity_ref",
  "confirmation",
  "bytes_base64",
  "next_actions",
  "return_url",
  "access_token",
  "refresh_token",
  "token",
  "session_id",
  "note",
  "extensions",
]);
export function modelData(value: any): any {
  if (Array.isArray(value)) return value.slice(0, 20).map(modelData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !privateKeys.has(k))
        .map(([k, v]) => [
          k,
          k === "next_cursor" && typeof v === "string" && v.length <= 4096
            ? v
            : modelData(v),
        ]),
    );
  return typeof value === "string" ? value.slice(0, 2000) : value;
}
export class CustomerService {
  readonly consultation: ConsultationService;
  private serial = new Serial();
  constructor(
    readonly config: CustomerConfig,
    readonly pap: PapPort,
    private secrets: Secrets,
    private vault: Vault,
  ) {
    if (pap.apiVersion !== 1) fail("PAP_VERSION_UNSUPPORTED");
    this.consultation = new ConsultationService(pap, vault);
  }
  private save(f: Flow) {
    f.updatedAt = new Date().toISOString();
    this.vault.set(`flow:${f.id}`, f);
  }
  flow(sessionId: string, flowId: string): Flow {
    const f = this.vault.get<Flow>(`flow:${flowId}`);
    if (!f || f.sessionId !== sessionId) fail("FLOW_NOT_OWNED");
    if (this.pap.canAccess?.(f.connectionRef) === false)
      fail("PERSONAL_ACCOUNT_CHANGED");
    const submitted = f.intent?.token && f.commands[f.intent.key];
    if (!f.pending && submitted && submitted.status === "done") {
      this.retireFailedConfirmation(f, submitted, submitted.result?.operation);
      if (!f.intent) this.save(f);
    }
    return f;
  }
  list(sessionId?: string) {
    return this.vault
      .keys("flow:")
      .map((k) => this.vault.get<Flow>(k)!)
      .filter((f) => !sessionId || f.sessionId === sessionId)
      .filter((f) => this.pap.canAccess?.(f.connectionRef) !== false)
      .map((f) => ({
        flowId: f.id,
        sessionId: f.sessionId,
        siteId: f.siteId,
        updatedAt: f.updatedAt,
        pending: !!f.pending,
      }))
      .concat(this.consultation.list(sessionId));
  }
  private policy(f: Flow): CustomerConfig["sites"][number] {
    const configured = this.config.sites.find(
      (s) => s.siteId === f.siteId && s.storeId === f.storeId,
    );
    if (configured) return configured;
    const site = this.pap.sites().find((s) => s.id === f.siteId);
    if (
      site?.description?.methods.includes("commerce.capabilities.get") &&
      site.service?.store_id === f.storeId
    )
      return { siteId: f.siteId, storeId: f.storeId };
    return fail("SITE_NOT_APPROVED");
  }
  private async read(
    f: Flow,
    method: string,
    params = {},
    signal?: AbortSignal,
  ) {
    if (method !== "capabilities.get")
      this.requireMethod(f, `commerce.${method}`);
    const r = await this.pap.request(
      f.connectionRef,
      `commerce.${method}`,
      params,
      signal,
    );
    if (r.error)
      fail(
        typeof r.error.data?.type === "string" &&
          /^[A-Z_]{1,70}$/.test(r.error.data.type)
          ? r.error.data.type
          : `COMMERCE_${r.error.code}`,
      );
    if (!r.result || !("data" in r.result)) fail("INVALID_COMMERCE_RESPONSE");
    return r.result.data;
  }
  private requireMethod(f: Flow, method: string) {
    const advertised = this.pap.sites().find((s) => s.id === f.siteId)
      ?.description?.methods;
    if (advertised && !advertised.includes(method))
      fail("METHOD_NOT_ADVERTISED");
    if (!Array.isArray(f.capabilities?.methods)) fail("CAPABILITIES_INVALID");
    if (
      !f.capabilities.methods.some(
        (m: any) => m.method === method && m.availability === "supported",
      )
    )
      fail("METHOD_UNAVAILABLE");
  }
  private async currentCapabilities(f: Flow) {
    const cap = await this.read(f, "capabilities.get");
    if (cap.store_id !== f.storeId || !Array.isArray(cap.methods))
      fail("STORE_BINDING_MISMATCH");
    f.capabilities = cap;
    f.purchaseReady = await this.purchaseReady(f);
  }
  private purchaseProfile(f: Flow) {
    return this.pap.identity(f.connectionRef).personalSignedIn
      ? personalProfile
      : profile;
  }
  private cartReady(f: Flow) {
    const method = f.cart
      ? "commerce.carts.lines.add"
      : "commerce.carts.create";
    const advertised = this.pap.sites().find((s) => s.id === f.siteId)
      ?.description?.methods;
    return !!(
      (!advertised || advertised.includes(method)) &&
      f.capabilities?.methods?.some(
        (m: any) => m.method === method && m.availability === "supported",
      ) &&
      f.capabilities?.business_profiles?.some(
        (p: any) =>
          p.id === this.purchaseProfile(f) && p.availability === "supported",
      )
    );
  }
  private async purchaseReady(f: Flow) {
    const p = this.policy(f);
    return !!(
      (this.purchaseProfile(f) === personalProfile
        ? !!this.pap.signResourceStatement
        : p.confirmationKeyRef &&
          p.confirmationKid &&
          (await this.secrets.get(p.confirmationKeyRef))) &&
      f.capabilities?.business_profiles?.some(
        (v: any) =>
          v.id === this.purchaseProfile(f) && v.availability === "supported",
      ) &&
      f.capabilities.methods?.some(
        (v: any) =>
          v.method === "commerce.checkouts.confirm" &&
          v.availability === "supported",
      )
    );
  }
  async connect(sessionId: string, siteId: string) {
    if (!sessionId || sessionId.length > 200) fail("SESSION_REQUIRED");
    // A DSH chat retains its model context. Do not mix a second personal
    // account into a chat containing the first account's tool responses.
    for (const prefix of ["flow:", "consultation:"]) {
      for (const key of this.vault.keys(prefix)) {
        const saved = this.vault.get<{
          sessionId: string;
          connectionRef: string;
        }>(key)!;
        if (
          saved.sessionId === sessionId &&
          this.pap.canAccess?.(saved.connectionRef) === false
        )
          fail("PERSONAL_CHAT_ACCOUNT_CHANGED");
      }
    }
    const site = this.pap.sites().find((s) => s.id === siteId);
    if (consultationSite(site))
      return this.consultation.connect(sessionId, siteId);
    return this.serial.run(`connect:${sessionId}:${siteId}`, async () => {
      const policy =
        this.config.sites.find((s) => s.siteId === siteId) ??
        (site?.description?.methods.includes("commerce.capabilities.get") &&
        site.service?.store_id
          ? { siteId, storeId: site.service.store_id }
          : fail("SITE_NOT_APPROVED"));
      const existing = this.list(sessionId).find((f) => f.siteId === siteId),
        flowId = existing?.flowId ?? randomUUID();
      return this.serial.run(flowId, async () => {
        const c = await this.pap.connect(siteId);
        const f: Flow = existing
          ? this.flow(sessionId, flowId)
          : {
              id: flowId,
              sessionId,
              siteId,
              storeId: policy.storeId,
              connectionRef: c.connectionRef,
              connection: null,
              commands: {},
              updatedAt: "",
            };
        if (f.connectionRef !== c.connectionRef) fail("IDENTITY_CHANGED");
        const cap = await this.read(f, "capabilities.get");
        if (cap.store_id !== policy.storeId) fail("STORE_BINDING_MISMATCH");
        f.capabilities = cap;
        const connections = cap.methods?.some(
          (m: any) =>
            m.method === "commerce.connections.list" &&
            m.availability === "supported",
        )
          ? await this.read(f, "connections.list")
          : [];
        const entries = Array.isArray(connections)
          ? connections
          : (connections.items ?? connections.connections ?? []);
        const selected =
          entries.find((v: any) => v.current === true) ??
          (entries.length === 1 ? entries[0] : undefined);
        if (
          selected &&
          (typeof selected.connection_id !== "string" ||
            !Number.isSafeInteger(selected.generation))
        )
          fail("CONNECTION_SELECTION_REQUIRED");
        if (
          f.connection &&
          selected &&
          canonical(f.connection) !==
            canonical({
              connection_id: selected.connection_id,
              generation: selected.generation,
            })
        )
          fail("CONNECTION_GENERATION_CHANGED");
        if (selected)
          f.connection = {
            connection_id: selected.connection_id,
            generation: selected.generation,
          };
        this.save(f);
        return this.result(f, "connection", {
          sites: this.pap.sites(),
          connection: this.pap.status(c.connectionRef),
          capabilities: cap,
          cartReady: this.cartReady(f),
          purchaseReady: await this.purchaseReady(f),
        });
      });
    });
  }
  private result(f: Flow, card: string, data: any) {
    return {
      ...modelData(data),
      ui: {
        kind: "frontvia-customer",
        card,
        flowId: f.id,
        sessionId: f.sessionId,
      },
      flowId: f.id,
    };
  }
  private apply(f: Flow, method: string, data: any) {
    if (data.operation) f.operation = data.operation;
    const r = data.resource;
    if (r) {
      if (method.startsWith("commerce.carts.")) {
        f.cart = r;
        delete f.quote;
        delete f.intent;
      }
      if (method.startsWith("commerce.quotes.")) {
        f.quote = r;
        delete f.intent;
      }
      if (method.startsWith("commerce.checkouts.")) f.checkout = r;
      if (
        method === "commerce.checkouts.cancel" &&
        r.status === "canceled" &&
        r.can_start_new_attempt
      ) {
        delete f.checkout;
        delete f.quote;
        delete f.intent;
      }
    }
  }
  private async write(
    f: Flow,
    method: string,
    params: any,
    callId: string,
    signal?: AbortSignal,
  ) {
    await this.currentCapabilities(f);
    this.requireMethod(f, method);
    if (
      !f.capabilities?.business_profiles?.some(
        (p: any) =>
          p.id === this.purchaseProfile(f) && p.availability === "supported",
      )
    )
      fail("PURCHASE_PROFILE_UNAVAILABLE");
    const key = digest([f.id, callId, method]),
      old = f.commands[key];
    if (
      old &&
      digest(old.params) !==
        digest({ ...params, meta: { idempotency_key: key } })
    )
      fail("IDEMPOTENCY_CONFLICT");
    if (old?.status === "done") return old.result;
    if (f.pending) fail("RESOLVE_PENDING_OPERATION");
    // Cancellation before admission must not create an unknown remote operation.
    signal?.throwIfAborted();
    const command: Command = {
      key,
      method,
      params: { ...params, meta: { idempotency_key: key } },
      status: "pending",
    };
    f.commands[key] = command;
    f.pending = key;
    this.save(f);
    const response = await this.pap.request(
      f.connectionRef,
      method,
      command.params,
      signal,
    );
    if (response.error) {
      if (
        [-32602, -32601, 1101, 1102, 1103, 1201, 1203, 1301].includes(
          response.error.code,
        ) &&
        !response.error.data?.operation_id
      ) {
        command.status = "done";
        command.result = { error: modelData(response.error) };
        delete f.pending;
        this.save(f);
      }
      fail(
        response.error.data?.type &&
          /^[A-Z_]{1,70}$/.test(response.error.data.type)
          ? response.error.data.type
          : "OPERATION_NOT_COMPLETED",
      );
    }
    const data = response.result?.data;
    if (!data?.operation) fail("INVALID_OPERATION_RESPONSE");
    this.apply(f, method, data);
    if (
      data.operation.status === "succeeded" ||
      (data.operation.status === "failed" && data.operation.effects === "none")
    ) {
      command.status = "done";
      command.result = data;
      delete f.pending;
    }
    this.save(f);
    return data;
  }
  private change(f: Flow, expected: unknown) {
    if (!f.cart) fail("CART_REQUIRED");
    if (typeof expected !== "string" || !expected)
      fail("CART_VERSION_REQUIRED");
    if (expected !== f.cart.version) fail("CART_VERSION_CHANGED");
    if (f.checkout && !f.checkout.can_start_new_attempt)
      fail("CHECKOUT_IN_PROGRESS");
    return { cart_id: f.cart.id, expected_version: expected };
  }
  async tool(
    sessionId: string,
    name: string,
    args: any,
    callId: string,
    signal?: AbortSignal,
  ) {
    if (name === "frontvia_consultation" || name === "frontvia_knowledge")
      return this.consultation.tool(
        sessionId,
        id.parse(args.flowId),
        name,
        args,
        callId,
        signal,
      );
    if (name === "frontvia_connection") {
      if (args.action === "connect")
        return this.connect(sessionId, args.siteId);
      return {
        sites: this.pap.sites(),
        flows: this.list(sessionId),
        connections: this.pap.status(),
      };
    }
    const flowId = id.parse(args.flowId);
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      this.policy(f);
      await this.currentCapabilities(f);
      const invocationKey = digest(callId),
        inputHash = digest([name, args]);
      f.invocations ??= {};
      if (
        f.invocations[invocationKey] &&
        f.invocations[invocationKey] !== inputHash
      )
        fail("IDEMPOTENCY_CONFLICT");
      f.invocations[invocationKey] = inputHash;
      this.save(f);
      const original = Object.values(f.commands).find(
        (c) => c.key === digest([f.id, callId, c.method]),
      );
      if (original) {
        if (original.status === "done")
          return this.result(f, "cart", original.result);
        return this.result(f, "order", await this.recover(f));
      }
      let data: any;
      let card = "cart";
      if (name === "frontvia_products") {
        card = "products";
        if (args.action === "browse" || args.action === "search") {
          const query =
            args.action === "search" ? args.query?.trim() : undefined;
          data = await this.read(
            f,
            "products.search",
            {
              context: pricing,
              ...(query ? { query } : {}),
              page: {
                limit: 8,
                ...(args.cursor ? { cursor: args.cursor } : {}),
              },
            },
            signal,
          );
          f.products = data;
        } else if (args.action === "get")
          data = await this.read(
            f,
            "products.get",
            { product_id: id.parse(args.product_id), context: pricing },
            signal,
          );
        else if (args.action === "variants") {
          data = await this.read(
            f,
            "variants.list",
            {
              product_id: id.parse(args.product_id),
              context: pricing,
              page: {
                limit: 20,
                ...(args.cursor ? { cursor: args.cursor } : {}),
              },
            },
            signal,
          );
          f.variants = data;
        } else fail("INVALID_ACTION");
      } else if (name === "frontvia_cart") {
        if (args.action === "get") {
          data = f.cart
            ? await this.read(f, "carts.get", { cart_id: f.cart.id }, signal)
            : { cart: null };
          if (data.id) f.cart = data;
        } else if (args.action === "delivery_options") {
          if (!f.cart) fail("CART_REQUIRED");
          data = await this.read(
            f,
            "carts.delivery_options.list",
            { cart_id: f.cart.id },
            signal,
          );
          f.delivery = data;
        } else {
          let method: string;
          let params: any;
          if (args.action === "add" && !f.cart) {
            method = "carts.create";
            params = {
              context: pricing,
              lines: [
                {
                  variant_id: id.parse(args.variant_id),
                  quantity: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .parse(args.quantity),
                },
              ],
            };
          } else {
            const base = this.change(f, args.expected_version);
            if (args.action === "add") {
              method = "carts.lines.add";
              params = {
                ...base,
                line: {
                  variant_id: id.parse(args.variant_id),
                  quantity: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .parse(args.quantity),
                },
              };
            } else if (args.action === "update") {
              method = "carts.lines.update";
              params = {
                ...base,
                line_id: id.parse(args.line_id),
                quantity: z.number().int().min(1).max(100).parse(args.quantity),
              };
            } else if (args.action === "remove") {
              method = "carts.lines.remove";
              params = { ...base, line_id: id.parse(args.line_id) };
            } else if (args.action === "delivery_select") {
              method = "carts.delivery_option.select";
              params = {
                ...base,
                group_id: id.parse(args.group_id),
                option_id: id.parse(args.option_id),
              };
            } else fail("INVALID_ACTION");
          }
          data = await this.write(
            f,
            `commerce.${method}`,
            params,
            callId,
            signal,
          );
        }
      } else if (name === "frontvia_checkout") {
        card = "quote";
        if (args.action === "quote")
          data = await this.write(
            f,
            "commerce.quotes.create",
            this.change(f, args.expected_version),
            callId,
            signal,
          );
        else if (args.action === "revise") {
          if (f.pending || f.intent?.token) fail("RESOLVE_PENDING_OPERATION");
          if (!f.checkout) {
            delete f.quote;
            delete f.intent;
            data = { readyToRequote: true };
          } else {
            f.checkout = await this.read(
              f,
              "checkouts.get",
              { checkout_id: f.checkout.id },
              signal,
            );
            const payment = f.checkout.payment_summary;
            if (
              f.checkout.status !== "requires_action" ||
              f.checkout.order_ids?.length ||
              payment?.authorized_amount?.amount_minor !== "0" ||
              payment?.captured_amount?.amount_minor !== "0"
            )
              fail("CHECKOUT_IN_PROGRESS");
            delete f.intent;
            this.save(f);
            data = await this.write(
              f,
              "commerce.checkouts.cancel",
              { checkout_id: f.checkout.id },
              callId,
              signal,
            );
          }
        } else if (args.action === "prepare") {
          if (f.pending) fail("RESOLVE_PENDING_OPERATION");
          const q = f.quote;
          if (
            !q?.checkout_allowed ||
            !f.cart ||
            q.cart_version !== f.cart.version ||
            !(Date.parse(q.expires_at) > Date.now())
          )
            fail("QUOTE_CHANGED");
          if (f.checkout && !f.checkout.can_start_new_attempt)
            data = await this.read(
              f,
              "checkouts.get",
              { checkout_id: f.checkout.id },
              signal,
            );
          else
            data = await this.write(
              f,
              "commerce.checkouts.create",
              {
                quote_id: q.id,
                expected_cart_version: q.cart_version,
                amount_limit: { mode: "exact", value: q.totals.grand_total },
              },
              callId,
              signal,
            );
        } else if (args.action === "status") data = await this.refresh(f);
        else fail("INVALID_ACTION");
      } else if (name === "frontvia_orders") {
        card = "order";
        if (args.action === "recover") data = await this.recover(f);
        else if (args.action === "list") {
          f.ordersCursor = args.cursor;
          data = await this.ordersPage(f, signal);
          f.orders = data;
        } else if (args.action === "get") {
          data = await this.read(
            f,
            "orders.get",
            { order_id: id.parse(args.order_id) },
            signal,
          );
          f.order = data;
        } else fail("INVALID_ACTION");
      } else fail("TOOL_NOT_ALLOWED");
      this.save(f);
      return this.result(f, card, {
        data,
        ...(name === "frontvia_products" &&
        (args.action === "browse" || args.action === "search")
          ? {
              catalog: {
                mode:
                  args.action === "browse" || !args.query?.trim()
                    ? "browse"
                    : "search",
                returnedCount: Array.isArray(data.items)
                  ? data.items.length
                  : 0,
                hasMore: data.page?.has_more === true,
              },
              nextStep:
                data.page?.has_more === true
                  ? "先展示本页商品名称和价格；用户要求更多时才用 page.next_cursor 翻页，不要猜关键词搜索或自动读取规格。"
                  : "本次查询没有下一页。现在向用户展示返回的商品名称和价格；没有结果则说明未找到。不要猜关键词搜索或自动读取规格。",
            }
          : {}),
        cartVersion: f.cart?.version,
        contactReady: !!f.cart?.email && !!f.cart?.shipping_address?.line1,
        pending: !!f.pending,
      });
    });
  }
  private async ordersPage(f: Flow, signal?: AbortSignal) {
    const page = await this.read(
      f,
      "orders.list",
      {
        connection: f.connection,
        page: {
          limit: 10,
          ...(f.ordersCursor ? { cursor: f.ordersCursor } : {}),
        },
      },
      signal,
    );
    const orders = [];
    for (const order of (page.items ?? []).slice(0, 10)) {
      // Current Commerce returns references; also accept full Order pages.
      orders.push(
        order.id
          ? order
          : await this.read(
              f,
              "orders.get",
              {
                order_id: id.parse(order.order_id),
              },
              signal,
            ),
      );
    }
    return { ...page, items: orders };
  }
  private async refresh(f: Flow) {
    await this.currentCapabilities(f);
    if (f.cart)
      f.cart = await this.read(f, "carts.get", { cart_id: f.cart.id });
    if (f.quote)
      f.quote = await this.read(f, "quotes.get", { quote_id: f.quote.id });
    if (f.checkout) {
      f.checkout = await this.read(f, "checkouts.get", {
        checkout_id: f.checkout.id,
      });
      if (f.checkout.order_ids?.[0])
        f.order = await this.read(f, "orders.get", {
          order_id: f.checkout.order_ids[0],
        });
    }
    if (f.order && !f.checkout?.order_ids?.includes(f.order.id))
      f.order = await this.read(f, "orders.get", { order_id: f.order.id });
    if (f.orders) f.orders = await this.ordersPage(f);
    this.save(f);
    return {
      cart: f.cart,
      quote: f.quote,
      checkout: f.checkout,
      order: f.order,
      orders: f.orders,
      operation: f.operation,
    };
  }
  private async recover(f: Flow) {
    if (f.pending) {
      const c = f.commands[f.pending];
      if (!c) fail("RECOVERY_STATE_INVALID");
      const r = await this.pap.request(
        f.connectionRef,
        "commerce.operations.lookup",
        { method: c.method, idempotency_key: c.key },
      );
      if (r.error) fail("ORIGINAL_RESULT_UNKNOWN");
      const op = r.result?.data;
      if (!op?.id) fail("ORIGINAL_RESULT_UNKNOWN");
      f.operation = op;
      if (
        op.status === "succeeded" ||
        (op.status === "failed" && op.effects === "none")
      ) {
        const ref = op.result_ref;
        let resource = null;
        if (ref?.id) {
          const kind = c.method.startsWith("commerce.carts.")
            ? "carts"
            : c.method.startsWith("commerce.quotes.")
              ? "quotes"
              : "checkouts";
          resource = await this.read(f, `${kind}.get`, {
            [`${kind.slice(0, -1)}_id`]: ref.id,
          });
        }
        c.result = { operation: op, resource };
        c.status = "done";
        delete f.pending;
        this.apply(f, c.method, c.result);
        this.retireFailedConfirmation(f, c, op);
      }
      this.save(f);
    }
    return this.refresh(f);
  }
  async view(sessionId: string, flowId: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.refresh(f);
      return this.humanView(f);
    });
  }
  private retireFailedConfirmation(f: Flow, command: Command, operation: any) {
    if (
      command.method === "commerce.checkouts.confirm" &&
      operation?.status === "failed" &&
      operation.effects === "none" &&
      f.intent?.key === command.key
    ) {
      // Keep the original command (including its key and receipt) for audit.
      // A subsequent review must create fresh consent; old cards stay invalid.
      delete f.intent;
    }
  }
  private humanView(f: Flow) {
    return {
      flowId: f.id,
      sessionId: f.sessionId,
      siteId: f.siteId,
      storeId: f.storeId,
      products: f.products,
      variants: f.variants,
      cart: f.cart,
      delivery: f.delivery,
      quote: f.quote,
      checkout: f.checkout && {
        id: f.checkout.id,
        status: f.checkout.status,
        payment_summary: f.checkout.payment_summary,
      },
      order: f.order,
      orders: f.orders,
      operation: f.operation,
      pending: !!f.pending,
      intent: f.intent && {
        id: f.intent.id,
        expiresAt: f.intent.expiresAt,
        submitted: !!f.intent.token,
      },
      capabilities: f.capabilities,
      cartReady: this.cartReady(f),
      purchaseReady: f.purchaseReady,
      mockPayment: this.policy(f).mockPayment === true,
    };
  }
  async contact(
    sessionId: string,
    flowId: string,
    expected: string,
    patch: unknown,
    actionId: string,
  ) {
    const contact = contactSchema.parse(patch);
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.write(
        f,
        "commerce.carts.update",
        { ...this.change(f, expected), patch: contact },
        actionId,
      );
      return this.humanView(f);
    });
  }
  private snapshot(f: Flow) {
    const c = f.checkout?.confirmation,
      q = f.quote,
      cart = f.cart,
      identity = this.pap.identity(f.connectionRef),
      amount = q?.totals?.grand_total;
    if (
      identity.signedIn ||
      f.checkout?.identity_kind !== "pap_subject" ||
      f.checkout?.mode !== "client_confirmation" ||
      f.checkout?.status !== "requires_action" ||
      c?.profile !== this.purchaseProfile(f)
    )
      fail("CLIENT_CONFIRMATION_UNAVAILABLE");
    if (
      !q?.checkout_allowed ||
      !(Date.parse(q.expires_at) > Date.now()) ||
      q.cart_id !== cart?.id ||
      q.cart_version !== cart.version ||
      f.checkout.cart_id !== cart.id ||
      f.checkout.quote_id !== q.id
    )
      fail("QUOTE_CHANGED");
    if (
      c.issuer !== identity.issuer ||
      c.resource !== identity.resource ||
      c.store_id !== f.storeId ||
      c.connection_id !== f.connection.connection_id ||
      c.generation !== f.connection.generation ||
      c.quote_id !== q.id ||
      c.snapshot_hash !== q.snapshot_hash ||
      !/^[a-f0-9]{64}$/.test(c.snapshot_hash) ||
      c.amount_minor !== amount?.amount_minor ||
      c.currency !== "USD" ||
      amount.currency !== "USD" ||
      !/^\d+$/.test(amount.amount_minor)
    )
      fail("CONFIRMATION_BINDING_MISMATCH");
    return {
      ...c,
      client_id: identity.clientId,
      user_id:
        this.purchaseProfile(f) === personalProfile
          ? c.user_id
          : identity.userId,
      checkout_id: f.checkout.id,
    };
  }
  async review(sessionId: string, flowId: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      if (f.pending) fail("RESOLVE_PENDING_OPERATION");
      await this.refresh(f);
      if (f.intent?.token) return this.humanView(f);
      if (!f.purchaseReady) fail("PURCHASE_CONFIRMATION_UNAVAILABLE");
      const snapshot = this.snapshot(f),
        visibleHash = digest({ cart: f.cart, quote: f.quote });
      if (
        !f.intent ||
        f.intent.expiresAt <= Date.now() ||
        f.intent.visibleHash !== visibleHash
      ) {
        f.intent = {
          id: randomUUID(),
          snapshot,
          visibleHash,
          expiresAt: Math.min(
            Date.parse(f.quote.expires_at),
            Date.now() + 120000,
          ),
          key: randomUUID(),
          nonce: randomUUID(),
        };
        this.save(f);
      }
      return this.humanView(f);
    });
  }
  /** Called only from the owner UI adapter, never registered as a tool. */
  async confirm(sessionId: string, flowId: string, intentId: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId),
        intent = f.intent;
      if (!intent || intent.id !== intentId) fail("CONFIRMATION_REQUIRED");
      if (intent.token) {
        await this.recover(f);
        return this.humanView(f);
      }
      if (f.pending) fail("RESOLVE_PENDING_OPERATION");
      if (intent.expiresAt <= Date.now()) fail("CONFIRMATION_EXPIRED");
      await this.refresh(f);
      if (!f.purchaseReady) fail("PURCHASE_CONFIRMATION_UNAVAILABLE");
      if (
        canonical(this.snapshot(f)) !== canonical(intent.snapshot) ||
        digest({ cart: f.cart, quote: f.quote }) !== intent.visibleHash
      )
        fail("QUOTE_CHANGED");
      const issued = Math.floor(Date.now() / 1000),
        expiry = Math.min(issued + 120, Math.floor(intent.expiresAt / 1000));
      if (expiry <= issued) fail("CONFIRMATION_EXPIRED");
      const claims = {
        ...intent.snapshot,
        idempotency_key: intent.key,
        nonce: intent.nonce,
        iat: issued,
        exp: expiry,
      };
      if (this.purchaseProfile(f) === personalProfile) {
        if (!this.pap.signResourceStatement)
          fail("PURCHASE_CONFIRMATION_UNAVAILABLE");
        intent.token = this.pap.signResourceStatement(
          f.connectionRef,
          "frontvia-personal-purchase+jwt",
          claims,
        );
      } else {
        const policy = this.policy(f),
          key =
            (policy.confirmationKeyRef &&
              (await this.secrets.get(policy.confirmationKeyRef))) ??
            fail("CONFIRMATION_KEY_REQUIRED");
        if (!policy.confirmationKid) fail("CONFIRMATION_KEY_REQUIRED");
        if (Buffer.from(key, "base64url").length !== 32)
          fail("INVALID_CONFIRMATION_KEY");
        const body = [
          {
            alg: "HS256",
            typ: "frontvia-purchase-confirmation+jwt",
            kid: policy.confirmationKid,
          },
          claims,
        ]
          .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
          .join(".");
        intent.token = `${body}.${createHmac("sha256", Buffer.from(key, "base64url")).update(body).digest("base64url")}`;
      }
      const c: Command = {
        key: intent.key,
        method: "commerce.checkouts.confirm",
        params: {
          checkout_id: f.checkout.id,
          idempotency_key: intent.key,
          confirmation: intent.token,
        },
        status: "pending",
      };
      f.commands[c.key] = c;
      f.pending = c.key;
      this.save(f);
      const r = await this.pap.request(f.connectionRef, c.method, c.params);
      if (r.error) fail("CONFIRMATION_NOT_COMPLETED");
      const d = r.result?.data;
      if (!d?.operation) fail("INVALID_OPERATION_RESPONSE");
      this.apply(f, c.method, d);
      if (
        d.operation.status === "succeeded" ||
        (d.operation.status === "failed" && d.operation.effects === "none")
      ) {
        c.status = "done";
        c.result = d;
        delete f.pending;
        this.retireFailedConfirmation(f, c, d.operation);
      }
      this.save(f);
      await this.refresh(f);
      return this.humanView(f);
    });
  }
}
