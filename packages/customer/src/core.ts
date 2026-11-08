import { viewScopes, type ViewScope } from "./view-scope.js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  Vault,
  Serial,
  fail,
  canonical,
  type PapService,
  type Secrets,
} from "dsh-pap/core";
import { ReadCache, SharedReads } from "./read-cache.js";
import { z } from "zod";
import {
  shoppingActionSchema,
  type ShoppingAction,
} from "./shopping-action.js";
import { contactSchema, cartContactReady } from "./contact-fields.js";
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
  Partial<
    Pick<
      PapService,
      | "canAccess"
      | "signResourceStatement"
      | "capabilityCacheKey"
      | "hostedPayment"
    >
  >;
type Command = {
  key: string;
  method: string;
  params: any;
  status: "pending" | "done" | "discarded";
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
  variantProductId?: string;
  cart?: any;
  delivery?: any;
  quote?: any;
  checkout?: any;
  order?: any;
  orders?: any;
  viewedOrder?: any;
  ordersCursor?: string;
  operation?: any;
  intent?: Intent;
  pending?: string;
  commands: Record<string, Command>;
  invocations?: Record<string, string>;
  updatedAt: string;
  capabilities?: any;
  purchaseReady?: boolean;
  paymentQr?: {
    checkoutId: string;
    expiresAt: string;
    svg: string;
    payee: string;
    amount: any;
  };
};
function pricing(f: Flow) {
  const c = f.capabilities?.default_context;
  if (
    !c ||
    !(
      (c.country === "CN" && c.currency === "CNY" && c.locale === "zh-CN") ||
      (c.country === "US" &&
        c.currency === "USD" &&
        ["en-US", "zh-CN"].includes(c.locale))
    )
  )
    fail("PRICING_CONTEXT_UNSUPPORTED");
  return {
    country: c.country as "CN" | "US",
    currency: c.currency as "CNY" | "USD",
    locale: c.locale as string,
  };
}
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
export { contactSchema } from "./contact-fields.js";
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
  "paymentQr",
  "qr_svg",
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
  private capabilitiesCache = new ReadCache(120000);
  private catalogCache = new ReadCache(60000, Date.now, 32);
  private views = new SharedReads();
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
    signal?.throwIfAborted();
    if (method !== "capabilities.get")
      this.requireMethod(f, `commerce.${method}`);
    const fetch = async () => {
      try {
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
        if (!r.result || !("data" in r.result))
          fail("INVALID_COMMERCE_RESPONSE");
        return r.result.data;
      } catch (error) {
        this.capabilitiesCache.clear();
        this.catalogCache.clear();
        throw error;
      }
    };
    const catalog = [
      "products.search",
      "products.get",
      "variants.list",
    ].includes(method);
    const generation =
      catalog && this.pap.capabilityCacheKey?.(f.connectionRef);
    // Display metadata only. Transaction state is never served from this cache.
    return catalog
      ? this.catalogCache.get(
          generation
            ? canonical([
                f.sessionId,
                f.siteId,
                f.storeId,
                generation,
                method,
                params,
              ])
            : undefined,
          fetch,
        )
      : fetch();
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
  private async currentCapabilities(f: Flow, fresh = false) {
    if (fresh) this.catalogCache.clear();
    const key = this.pap.capabilityCacheKey?.(f.connectionRef);
    const cap = await this.capabilitiesCache.get(
      key ? `${f.siteId}:${key}` : undefined,
      () => this.read(f, "capabilities.get"),
      fresh,
    );
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
  /** A dedicated owner shopping session does not require an Agent conversation.
   * Retrying the same entry action reuses its durable flow. */
  async openStore(siteId: string, actionId: string) {
    z.uuid().parse(actionId);
    const site = this.pap.sites().find((s) => s.id === siteId);
    if (!site || consultationSite(site)) fail("SITE_NOT_APPROVED");
    const result = await this.connect(`storefront:${actionId}`, siteId);
    return result.ui;
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
        await this.currentCapabilities(f);
        const cap = f.capabilities;
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
      ...modelData({
        ...data,
        catalogSnapshot: {
          version: 1,
          products: f.products,
          variants: f.variants,
          variantProductId: f.variantProductId,
        },
      }),
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
        delete f.delivery;
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
        r.can_start_new_attempt &&
        !r.order_ids?.length &&
        !f.intent?.token
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
    await this.currentCapabilities(f, true);
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
    if (old?.status === "discarded") fail("OPERATION_DISCARDED");
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
    return this.finishWrite(f, command, response);
  }
  private finishWrite(f: Flow, command: Command, response: any) {
    const method = command.method;
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
    this.views.clear();
    if (
      name === "frontvia_consultation" &&
      ["ask", "answer_accept"].includes(args.action)
    )
      fail("DIRECT_COMMERCE_REQUIRED");
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
    return this.serial.run(flowId, () =>
      this.shoppingTool(sessionId, flowId, name, args, callId, signal),
    );
  }
  // Caller holds the flow lease, including all steps of a manual UI action.
  private async shoppingTool(
    sessionId: string,
    flowId: string,
    name: string,
    args: any,
    callId: string,
    signal?: AbortSignal,
  ) {
    const f = this.flow(sessionId, flowId);
    this.policy(f);
    // Every write rechecks in write(); recovery may dispatch the original
    // command directly, so it also requires fresh discovery here.
    await this.currentCapabilities(
      f,
      name === "frontvia_orders" && args.action === "recover",
    );
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
      if (original.status === "discarded") fail("OPERATION_DISCARDED");
      if (original.status === "done")
        return this.result(f, "cart", original.result);
      return this.result(f, "order", await this.recover(f));
    }
    let data: any;
    let card = "cart";
    if (name === "frontvia_products") {
      card = "products";
      if (args.action === "browse" || args.action === "search") {
        const query = args.action === "search" ? args.query?.trim() : undefined;
        data = await this.read(
          f,
          "products.search",
          {
            context: pricing(f),
            ...(query ? { query } : {}),
            page: {
              limit: 8,
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
          signal,
        );
        f.products = data;
        delete f.variants;
        delete f.variantProductId;
      } else if (args.action === "get" || args.action === "detail") {
        const product_id = id.parse(args.product_id),
          context = pricing(f);
        if (args.action === "detail") {
          // Publish the pair atomically under the existing flow lease. Real
          // merchant measurements did not justify concurrent connection reads.
          data = await this.read(
            f,
            "products.get",
            { product_id, context },
            signal,
          );
          f.variants = await this.read(
            f,
            "variants.list",
            { product_id, context, page: { limit: 20 } },
            signal,
          );
          f.variantProductId = product_id;
        } else {
          data = await this.read(
            f,
            "products.get",
            { product_id, context },
            signal,
          );
          delete f.variants;
          delete f.variantProductId;
        }
        f.products = { items: [data] };
      } else if (args.action === "variants") {
        data = await this.read(
          f,
          "variants.list",
          {
            product_id: id.parse(args.product_id),
            context: pricing(f),
            page: {
              limit: 20,
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
          signal,
        );
        f.variants = data;
        f.variantProductId = args.product_id;
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
            context: pricing(f),
            lines: [
              {
                variant_id: id.parse(args.variant_id),
                quantity: z.number().int().min(1).max(100).parse(args.quantity),
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
                quantity: z.number().int().min(1).max(100).parse(args.quantity),
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
        data = await this.ordersPage(f, signal, !args.referencesOnly);
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
              returnedCount: Array.isArray(data.items) ? data.items.length : 0,
              hasMore: data.page?.has_more === true,
            },
            nextStep:
              data.page?.has_more === true
                ? "先展示本页商品名称和价格；用户要求更多时才用 page.next_cursor 翻页，不要猜关键词搜索或自动读取规格。"
                : "本次查询没有下一页。现在向用户展示返回的商品名称和价格；没有结果则说明未找到。不要猜关键词搜索或自动读取规格。",
          }
        : {}),
      cartVersion: f.cart?.version,
      contactReady: contactSchema.safeParse({
        ...(f.cart?.email ? { email: f.cart.email } : {}),
        shipping_address: f.cart?.shipping_address,
      }).success,
      pending: !!f.pending,
    });
  }
  /** Owner UI uses the same commerce rules and durable commands as chat tools.
   * The action never confirms a purchase or initiates a payment. */
  async shopping(
    sessionId: string,
    flowId: string,
    input: ShoppingAction,
    signal?: AbortSignal,
  ) {
    const { intent, expected_version, actionId } =
      shoppingActionSchema.parse(input);
    this.views.clear();
    return this.serial.run(flowId, async () => {
      this.flow(sessionId, flowId);
      const run = async (name: string, args: any, step: string) => {
        signal?.throwIfAborted();
        const result: any = await this.shoppingTool(
          sessionId,
          flowId,
          name,
          { flowId, ...args },
          `ui:${actionId}:${step}`,
          signal,
        );
        if (
          result.operation?.status === "failed" ||
          result.data?.operation?.status === "failed" ||
          result.data?.error ||
          result.error
        )
          fail("OPERATION_NOT_COMPLETED");
        const current = this.flow(sessionId, flowId);
        if (current.pending) fail("RESOLVE_PENDING_OPERATION");
        return current;
      };
      const quote = async () => {
        const current = this.flow(sessionId, flowId);
        await run(
          "frontvia_checkout",
          {
            action: "quote",
            expected_version: current.cart?.version,
          },
          "quote",
        );
        await run("frontvia_checkout", { action: "prepare" }, "prepare");
      };
      switch (intent.action) {
        case "browse":
          if (intent.refresh) this.catalogCache.clear();
          await run(
            "frontvia_products",
            {
              action: intent.query ? "search" : "browse",
              query: intent.query,
              cursor: intent.cursor,
            },
            "browse",
          );
          break;
        case "product":
          if (intent.refresh) this.catalogCache.clear();
          await run(
            "frontvia_products",
            { action: "detail", product_id: intent.productId },
            "product",
          );
          break;
        case "variant-page":
          await run(
            "frontvia_products",
            {
              action: "variants",
              product_id: intent.productId,
              cursor: intent.cursor,
            },
            "variants",
          );
          break;
        case "update-line":
        case "remove-line": {
          const current = this.flow(sessionId, flowId);
          if (current.intent?.token || current.order)
            fail("CART_ALREADY_SUBMITTED");
          if (current.checkout) {
            if (!expected_version || current.cart?.version !== expected_version)
              fail("CART_VERSION_CHANGED");
            // Only retire an unsubmitted checkout. revise verifies there is no
            // order, captured/authorized payment or uncertain operation.
            await run(
              "frontvia_checkout",
              { action: "revise" },
              "revise-before-line",
            );
          }
          await run(
            "frontvia_cart",
            {
              action: intent.action === "update-line" ? "update" : "remove",
              line_id: intent.lineId,
              ...(intent.action === "update-line"
                ? { quantity: intent.quantity }
                : {}),
              expected_version,
            },
            "line",
          );
          break;
        }
        case "prepare-delivery": {
          const initial = this.flow(sessionId, flowId);
          this.change(initial, expected_version);
          if (!cartContactReady(initial.cart, pricing(initial).country))
            fail("CONTACT_REQUIRED");
          // Query current merchant options before choosing. Keep each write tied
          // to the latest cart revision, and never quote/submit as a side effect.
          let current = await run(
            "frontvia_cart",
            { action: "delivery_options" },
            "delivery-options",
          );
          const groups = current.delivery?.delivery_groups ?? [];
          for (const { id: groupId } of groups) {
            const delivery = current.delivery;
            if (
              delivery?.cart_id !== current.cart?.id ||
              delivery?.cart_version !== current.cart?.version
            )
              fail("CART_VERSION_CHANGED");
            if (delivery.requirements?.some((r: any) => r.blocking)) break;
            const group = delivery.delivery_groups.find(
              (g: any) => g.id === groupId,
            );
            if (
              !group ||
              group.options.some((o: any) => o.id === group.selected_option_id)
            )
              continue;
            // Unknown/estimated fees need a customer's choice; don't treat them
            // as free. BigInt preserves the API's integer minor-unit amounts.
            const options = group.options.filter(
              (o: any) =>
                o.price_status === "known" &&
                o.amount?.currency === pricing(current).currency &&
                typeof o.amount?.amount_minor === "string" &&
                /^\d+$/.test(o.amount.amount_minor),
            );
            const cheapest = options.reduce(
              (best: any, option: any) =>
                !best ||
                BigInt(option.amount.amount_minor) <
                  BigInt(best.amount.amount_minor)
                  ? option
                  : best,
              undefined,
            );
            if (!cheapest) continue;
            await run(
              "frontvia_cart",
              {
                action: "delivery_select",
                group_id: groupId,
                option_id: cheapest.id,
                expected_version: current.cart.version,
              },
              `delivery:${groupId}`,
            );
            current = await run(
              "frontvia_cart",
              { action: "delivery_options" },
              `delivery-options:${groupId}`,
            );
          }
          break;
        }
        case "select-delivery":
          await run(
            "frontvia_cart",
            {
              action: "delivery_select",
              group_id: intent.groupId,
              option_id: intent.optionId,
              expected_version,
            },
            "delivery",
          );
          await run(
            "frontvia_cart",
            { action: "delivery_options" },
            "delivery-options",
          );
          break;
        case "quote":
          await run(
            "frontvia_checkout",
            { action: "quote", expected_version },
            "quote",
          );
          break;
        case "edit-cart": {
          const current = this.flow(sessionId, flowId);
          if (!expected_version || current.cart?.version !== expected_version)
            fail("CART_VERSION_CHANGED");
          await run("frontvia_checkout", { action: "revise" }, "revise");
          break;
        }
        case "orders":
          await run(
            "frontvia_orders",
            { action: "list", cursor: intent.cursor, referencesOnly: true },
            "orders",
          );
          break;
        case "order-detail": {
          // Browsing a historic order must never retarget the active checkout's payment/cancel controls.
          const current = this.flow(sessionId, flowId);
          this.policy(current);
          await this.currentCapabilities(current);
          current.viewedOrder = await this.read(
            current,
            "orders.get",
            { order_id: intent.orderId },
            signal,
          );
          this.save(current);
          break;
        }
        case "variants":
          await run(
            "frontvia_products",
            { action: "variants", product_id: intent.productId },
            "variants",
          );
          break;
        case "add":
          await run(
            "frontvia_cart",
            {
              action: "add",
              variant_id: intent.variantId,
              quantity: intent.quantity,
              expected_version,
            },
            "add",
          );
          break;
        case "delivery-options":
          await run(
            "frontvia_cart",
            { action: "delivery_options" },
            "delivery-options",
          );
          break;
        case "delivery":
          await run(
            "frontvia_cart",
            {
              action: "delivery_select",
              group_id: intent.groupId,
              option_id: intent.optionId,
              expected_version,
            },
            "delivery",
          );
          await quote();
          break;
        case "requote": {
          const current = this.flow(sessionId, flowId);
          if (!expected_version || current.cart?.version !== expected_version)
            fail("CART_VERSION_CHANGED");
          await run("frontvia_checkout", { action: "revise" }, "revise");
          await quote();
          break;
        }
        case "prepare":
          await run("frontvia_checkout", { action: "prepare" }, "prepare");
          break;
      }
      return this.humanView(this.flow(sessionId, flowId));
    });
  }
  private async ordersPage(f: Flow, signal?: AbortSignal, hydrate = true) {
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
    if (!hydrate) return page;
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
  private async refresh(
    f: Flow,
    fresh = false,
    scopes: readonly ViewScope[] = ["all"],
  ) {
    await this.currentCapabilities(f, fresh);
    const includes = (scope: ViewScope) =>
      scopes.includes("all") || scopes.includes(scope);
    const submitted = !!f.intent?.token || !!f.order;
    // Completed cart/quote snapshots do not change with payment or fulfillment.
    const cart =
      scopes.includes("all") ||
      (!submitted && (includes("cart") || includes("checkout")));
    const quote =
      scopes.includes("all") || (!submitted && includes("checkout"));
    const checkout = includes("checkout") || includes("order");
    if (cart && f.cart)
      f.cart = await this.read(f, "carts.get", { cart_id: f.cart.id });
    if (quote && f.quote)
      f.quote = await this.read(f, "quotes.get", { quote_id: f.quote.id });
    const fetchedOrders = new Map<string, any>();
    const order = async (orderId: string) => {
      if (!fetchedOrders.has(orderId))
        fetchedOrders.set(
          orderId,
          await this.read(f, "orders.get", { order_id: orderId }),
        );
      return fetchedOrders.get(orderId);
    };
    if (checkout && f.checkout) {
      f.checkout = await this.read(f, "checkouts.get", {
        checkout_id: f.checkout.id,
      });
      if (f.checkout.order_ids?.[0])
        f.order = await order(f.checkout.order_ids[0]);
    }
    if (checkout && f.order && !fetchedOrders.has(f.order.id))
      f.order = await order(f.order.id);
    if (includes("order-detail") && f.viewedOrder)
      f.viewedOrder = await order(f.viewedOrder.id);
    // Listing is explicit. Never turn a background refresh into N+1 history reads.
    if (Array.isArray(f.orders?.items))
      f.orders.items = f.orders.items.map(
        (item: any) => fetchedOrders.get(item.id ?? item.order_id) ?? item,
      );
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
  private discardableAddition(f: Flow) {
    return (
      !!f.pending &&
      !f.order &&
      !f.intent?.token &&
      ["commerce.carts.create", "commerce.carts.lines.add"].includes(
        f.commands[f.pending]?.method,
      )
    );
  }
  /** Stop waiting locally. This never replays or reverses a merchant mutation. */
  async discardCartAddition(sessionId: string, flowId: string) {
    this.views.clear();
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      this.policy(f);
      if (f.pending) {
        if (!this.discardableAddition(f)) fail("CART_DISCARD_UNAVAILABLE");
        const command = f.commands[f.pending];
        command.status = "discarded";
        delete f.pending;
        this.save(f);
      }
      // The merchant cart remains authoritative, including a late successful add.
      // A read failure must not resurrect the discarded command.
      await this.refresh(f, false, ["cart"]);
      return this.humanView(f);
    });
  }
  /** Explicit owner-UI retry: only reversible cart edits, never checkout/payment. */
  async retryCart(sessionId: string, flowId: string) {
    this.views.clear();
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      this.policy(f);
      if (!f.pending) {
        await this.refresh(f);
        return this.humanView(f);
      }
      const command = f.commands[f.pending];
      if (!command || !this.retryableCart(f)) fail("CART_RETRY_UNAVAILABLE");
      await this.currentCapabilities(f, true);
      this.requireMethod(f, command.method);
      if (
        !f.capabilities?.business_profiles?.some(
          (p: any) =>
            p.id === this.purchaseProfile(f) && p.availability === "supported",
        )
      )
        fail("PURCHASE_PROFILE_UNAVAILABLE");
      await this.recover(f, true);
      return this.humanView(f);
    });
  }
  private retryableCart(f: Flow) {
    return (
      !!f.pending &&
      !f.order &&
      !f.intent?.token &&
      !f.checkout &&
      [
        "commerce.carts.create",
        "commerce.carts.lines.add",
        "commerce.carts.lines.update",
        "commerce.carts.lines.remove",
        "commerce.carts.update",
        "commerce.carts.delivery_option.select",
      ].includes(f.commands[f.pending]?.method)
    );
  }
  private async recover(f: Flow, retryCart = false) {
    if (f.pending) {
      const c = f.commands[f.pending];
      if (!c) fail("RECOVERY_STATE_INVALID");
      const r = await this.pap.request(
        f.connectionRef,
        "commerce.operations.lookup",
        { method: c.method, idempotency_key: c.key },
      );
      if (r.error) {
        if (
          retryCart &&
          r.error.code === 1003 &&
          !r.error.data?.operation_id &&
          this.retryableCart(f)
        ) {
          // Reuse the stored payload and key exactly; do not create a second operation.
          const response = await this.pap.request(
            f.connectionRef,
            c.method,
            c.params,
          );
          this.finishWrite(f, c, response);
          return this.refresh(f);
        }
        fail("ORIGINAL_RESULT_UNKNOWN");
      }
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
  async view(
    sessionId: string,
    flowId: string,
    requestedScopes: readonly ViewScope[] = ["all"],
  ) {
    const scopes = [
      ...new Set(
        z.array(z.enum(viewScopes)).min(1).max(6).parse(requestedScopes),
      ),
    ].sort();
    const f = this.flow(sessionId, flowId);
    const generation =
      this.pap.capabilityCacheKey?.(f.connectionRef) ?? "uncached";
    return this.views.run(
      `${sessionId}:${flowId}:${generation}:${scopes.join(",")}`,
      () =>
        this.serial.run(flowId, async () => {
          const current = this.flow(sessionId, flowId);
          await this.refresh(current, false, scopes);
          return this.humanView(current);
        }),
    );
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
      variantProductId: f.variantProductId,
      cart: f.cart,
      delivery: f.delivery,
      quote: f.quote,
      checkout: f.checkout && {
        id: f.checkout.id,
        status: f.checkout.status,
        payment_summary: f.checkout.payment_summary,
        paymentAction: this.paymentAction(f),
        paymentExpiresAt: this.paymentAction(f, true, true)?.expiresAt,
      },
      order: f.order,
      orders: f.orders,
      viewedOrder: f.viewedOrder,
      operation: f.operation,
      pending: !!f.pending,
      canRetryCart: this.retryableCart(f),
      canDiscardCartAddition: this.discardableAddition(f),
      pendingAction: f.pending
        ? (
            {
              "commerce.carts.create": "cart-add",
              "commerce.carts.lines.add": "cart-add",
              "commerce.carts.lines.update": "cart-update",
              "commerce.carts.lines.remove": "cart-remove",
              "commerce.carts.update": "contact",
              "commerce.carts.delivery_option.select": "delivery",
              "commerce.quotes.create": "quote",
              "commerce.checkouts.create": "checkout",
              "commerce.checkouts.confirm": "order",
              "commerce.checkouts.cancel": "cancel",
            } as Record<string, string>
          )[f.commands[f.pending]?.method]
        : undefined,
      cancelPending:
        !!f.pending &&
        f.commands[f.pending]?.method === "commerce.checkouts.cancel",
      canCancelOrder: this.canCancelOrder(f),
      intent: f.intent && {
        id: f.intent.id,
        expiresAt: f.intent.expiresAt,
        submitted: !!f.intent.token,
      },
      capabilities: f.capabilities,
      pricing: pricing(f),
      cartReady: this.cartReady(f),
      purchaseReady: f.purchaseReady,
      mockPayment: this.policy(f).mockPayment === true,
      paymentQr: this.visiblePaymentQr(f),
      inlinePayment:
        !!this.pap.hostedPayment &&
        pricing(f).currency === "CNY" &&
        !!this.paymentAction(f, false, true),
    };
  }
  async contact(
    sessionId: string,
    flowId: string,
    expected: string,
    patch: unknown,
    actionId: string,
  ) {
    this.views.clear();
    const contact = contactSchema.parse(patch);
    // Empty optional form fields are absent on the Commerce wire, which rejects
    // supplied empty address values. Country-required fields were checked above.
    for (const key of ["city", "region", "postal_code", "phone"] as const) {
      if (!contact.shipping_address[key]) delete contact.shipping_address[key];
    }
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.currentCapabilities(f, true);
      if (contact.shipping_address.country !== pricing(f).country)
        fail("ADDRESS_COUNTRY_MISMATCH");
      await this.write(
        f,
        "commerce.carts.update",
        { ...this.change(f, expected), patch: contact },
        actionId,
      );
      return this.humanView(f);
    });
  }
  private canCancelOrder(f: Flow) {
    const unpaid = [
      "unpaid",
      "not_paid",
      "requires_action",
      "pending",
      "failed",
    ];
    const summary = f.checkout?.payment_summary;
    return !!(
      !f.pending &&
      f.intent?.token &&
      f.order &&
      f.checkout?.status === "completed" &&
      f.checkout.order_ids?.length === 1 &&
      f.checkout.order_ids[0] === f.order.id &&
      f.order.status === "open" &&
      f.order.fulfillment_status === "unfulfilled" &&
      f.order.totals?.grand_total?.currency === "CNY" &&
      unpaid.includes(f.order.payment?.status) &&
      (!summary?.status || unpaid.includes(summary.status)) &&
      [
        summary?.authorized_amount,
        summary?.captured_amount,
        f.order.payment?.authorized_amount,
        f.order.payment?.captured_amount,
      ].every((v) => !v || /^0+$/.test(v.amount_minor)) &&
      f.capabilities?.methods?.some(
        (m: any) =>
          m.method === "commerce.checkouts.cancel" &&
          m.availability === "supported",
      )
    );
  }
  /** Owner-only: close the original payment at the merchant before canceling. */
  async cancelOrder(sessionId: string, flowId: string) {
    this.views.clear();
    return this.serial
      .run(flowId, async () => {
        const f = this.flow(sessionId, flowId);
        if (f.pending) fail("RESOLVE_PENDING_OPERATION");
        if (!f.checkout || !f.intent?.token) fail("ORDER_CANCEL_UNAVAILABLE");
        await this.currentCapabilities(f, true);
        f.checkout = await this.read(f, "checkouts.get", {
          checkout_id: f.checkout.id,
        });
        if (f.checkout.order_ids?.length !== 1)
          fail("ORDER_CANCEL_UNAVAILABLE");
        f.order = await this.read(f, "orders.get", {
          order_id: f.checkout.order_ids[0],
        });
        this.flow(sessionId, flowId);
        if (f.checkout.status === "canceled" && f.order.status === "canceled") {
          delete f.paymentQr;
          this.save(f);
          return this.humanView(f);
        }
        if (!this.canCancelOrder(f)) {
          this.save(f);
          fail("ORDER_CANCEL_UNAVAILABLE");
        }
        delete f.paymentQr;
        this.save(f);
        await this.write(
          f,
          "commerce.checkouts.cancel",
          { checkout_id: f.checkout.id },
          randomUUID(),
        );
        // A pending receipt is not cancellation success. Recovery uses its saved key.
        if (!f.pending) await this.refresh(f);
        return this.humanView(f);
      })
      .finally(() => this.views.clear());
  }
  private visiblePaymentQr(f: Flow) {
    const qr = f.paymentQr;
    if (
      !qr ||
      qr.checkoutId !== f.checkout?.id ||
      f.pending ||
      Date.parse(qr.expiresAt) <= Date.now() ||
      ["canceled", "failed"].includes(f.order?.status) ||
      ["canceled", "failed"].includes(f.checkout?.status) ||
      ![
        "unpaid",
        "not_paid",
        "requires_action",
        "partially_paid",
        "pending",
      ].includes(
        f.order?.payment?.status ?? f.checkout?.payment_summary?.status,
      )
    )
      return;
    return qr;
  }
  /** An explicit owner click starts payment for the already confirmed original order. */
  async startPayment(sessionId: string, flowId: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      if (!f.intent?.token || f.pending || !f.checkout?.order_ids?.length)
        fail("CONFIRMATION_REQUIRED");
      if (!this.pap.hostedPayment) fail("INLINE_PAYMENT_UNAVAILABLE");
      // Read only this original checkout and its order; do not re-quote or confirm.
      f.checkout = await this.read(f, "checkouts.get", {
        checkout_id: f.checkout.id,
      });
      if (!f.checkout.order_ids?.[0]) fail("PAYMENT_RESULT_UNKNOWN");
      f.order = await this.read(f, "orders.get", {
        order_id: f.checkout.order_ids[0],
      });
      delete f.paymentQr;
      this.save(f);
      const link =
        this.paymentAction(f, false, true) ?? fail("PAYMENT_LINK_UNAVAILABLE");
      const response = await this.pap.hostedPayment(
        f.connectionRef,
        link.url,
        f.checkout.id,
      );
      this.flow(sessionId, flowId); // Recheck ownership after network I/O.
      const d = response?.data;
      if (
        !d ||
        d.checkout_id !== f.checkout.id ||
        d.expires_at !== Math.floor(Date.parse(link.expiresAt) / 1000) ||
        canonical(d.quote?.totals?.grand_total) !==
          canonical(f.order.totals?.grand_total) ||
        !d.payment ||
        typeof d.payment.status !== "string"
      )
        fail("PAYMENT_RESULT_UNKNOWN");
      f.order.payment = d.payment;
      f.order.status = d.order_status;
      if (d.can_pay && d.action) {
        if (
          d.action.type !== "alipay_qr" ||
          Math.floor(Date.parse(d.action.expires_at) / 1000) !== d.expires_at ||
          typeof d.payee_name !== "string" ||
          !d.payee_name.trim() ||
          d.payee_name.length > 200 ||
          typeof d.qr_svg !== "string" ||
          d.qr_svg.length > 256000 ||
          !/^<\?xml[^>]*>\s*<svg\b|^<svg\b/.test(d.qr_svg) ||
          /<(?!\/?(?:svg|path|rect)\b|\?xml\b)|\bon\w+\s*=|href\s*=|url\s*\(|<!/i.test(
            d.qr_svg,
          )
        )
          fail("INVALID_PAYMENT_QR");
        f.paymentQr = {
          checkoutId: f.checkout.id,
          expiresAt: new Date(d.expires_at * 1000).toISOString(),
          svg: d.qr_svg,
          payee: d.payee_name,
          amount: d.quote.totals.grand_total,
        };
      }
      this.save(f);
      return this.humanView(f);
    });
  }
  private paymentAction(f: Flow, allowExpired = false, allowPending = false) {
    if (!f.intent?.token || f.pending || !f.checkout?.order_ids?.length) return;
    if (
      ["canceled", "failed"].includes(f.checkout.status) ||
      ["canceled", "failed"].includes(f.order?.status) ||
      ![
        "unpaid",
        "not_paid",
        "requires_action",
        "partially_paid",
        ...(allowPending ? ["pending"] : []),
      ].includes(f.order?.payment?.status ?? f.checkout.payment_summary?.status)
    )
      return;
    const a = f.checkout.next_actions?.find(
      (a: any) => a.type === "redirect" && a.purpose === "payment",
    );
    if (!a || !Number.isFinite(Date.parse(a.expires_at))) return;
    if (!allowExpired && Date.parse(a.expires_at) <= Date.now()) return;
    try {
      const u = new URL(a.url),
        issuer = new URL(this.pap.identity(f.connectionRef).issuer);
      if (
        u.protocol !== "https:" ||
        u.origin !== issuer.origin ||
        u.username ||
        u.password ||
        u.hash
      )
        return;
      return { url: u.href, expiresAt: a.expires_at };
    } catch {
      return;
    }
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
      c.currency !== pricing(f).currency ||
      amount.currency !== pricing(f).currency ||
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
    this.views.clear();
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      if (f.pending) fail("RESOLVE_PENDING_OPERATION");
      await this.refresh(f, true);
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
    this.views.clear();
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
      await this.refresh(f, true);
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
      await this.refresh(f, true);
      return this.humanView(f);
    });
  }
}
