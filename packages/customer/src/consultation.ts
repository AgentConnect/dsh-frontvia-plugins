import { createHash, randomUUID } from "node:crypto";
import { Vault, Serial, fail, canonical } from "dsh-pap/core";
import { modelData, type PapPort } from "./core.js";

type Command = {
  method: string;
  params: any;
  inputHash: string;
  status: "pending" | "done";
  result?: any;
};
type Flow = {
  id: string;
  sessionId: string;
  siteId: string;
  connectionRef: string;
  capabilities: any;
  conversation?: any;
  pending?: string;
  commands: Record<string, Command>;
  sources: Record<string, any>;
  answers: Record<string, any>;
  knowledge?: any;
  updatedAt: string;
};
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const consultationSite = (site: any) =>
  site?.description?.profile === "frontvia.merchant_consultation.v1" &&
  site.description.methods.includes("consultation.capabilities.get");
export class ConsultationService {
  private serial = new Serial();
  constructor(
    private pap: PapPort,
    private vault: Vault,
  ) {}
  private save(f: Flow) {
    f.updatedAt = new Date().toISOString();
    this.vault.set(`consultation:${f.id}`, f);
  }
  private flow(sessionId: string, flowId: string) {
    const f = this.vault.get<Flow>(`consultation:${flowId}`);
    if (!f || f.sessionId !== sessionId) fail("FLOW_NOT_OWNED");
    if (this.pap.canAccess?.(f.connectionRef) === false)
      fail("PERSONAL_ACCOUNT_CHANGED");
    if (!consultationSite(this.pap.sites().find((s) => s.id === f.siteId)))
      fail("CONSULTATION_UNAVAILABLE");
    return f;
  }
  owns(flowId: string) {
    return !!this.vault.get(`consultation:${flowId}`);
  }
  list(sessionId?: string) {
    return this.vault
      .keys("consultation:")
      .map((k) => this.vault.get<Flow>(k)!)
      .filter((f) => !sessionId || f.sessionId === sessionId)
      .filter((f) => this.pap.canAccess?.(f.connectionRef) !== false)
      .map((f) => ({
        flowId: f.id,
        sessionId: f.sessionId,
        siteId: f.siteId,
        kind: "consultation",
        pending: !!f.pending,
        updatedAt: f.updatedAt,
      }));
  }
  private async rpc(
    f: Flow,
    method: string,
    params: any = {},
    signal?: AbortSignal,
  ) {
    const response = await this.pap.request(
      f.connectionRef,
      method,
      params,
      signal,
    );
    if (response.error) {
      const type = response.error.data?.type ?? response.error.message;
      fail(
        typeof type === "string" && /^[A-Z_]{1,70}$/.test(type)
          ? type
          : "CONSULTATION_UNAVAILABLE",
      );
    }
    if (!response.result || !("data" in response.result))
      fail("INVALID_CONSULTATION_RESPONSE");
    return response.result.data;
  }
  private async capabilities(f: Flow) {
    const cap = await this.rpc(f, "consultation.capabilities.get");
    if (
      cap.profile !== "frontvia.merchant_consultation.v1" ||
      cap.availability !== "supported" ||
      !Array.isArray(cap.methods)
    )
      fail("CONSULTATION_UNAVAILABLE");
    f.capabilities = cap;
    this.save(f);
    return cap;
  }
  private allowed(f: Flow, method: string) {
    const site = this.pap.sites().find((s) => s.id === f.siteId);
    if (!site?.description?.methods.includes(method))
      fail("METHOD_NOT_ADVERTISED");
    if (method.startsWith("consultation.knowledge.")) {
      if (f.capabilities.knowledge !== "supported")
        fail("KNOWLEDGE_UNAVAILABLE");
    } else if (
      !method.startsWith("consultation.answers.") &&
      !f.capabilities.methods.includes(method)
    )
      fail("METHOD_UNAVAILABLE");
  }
  async connect(sessionId: string, siteId: string) {
    if (!sessionId || sessionId.length > 200) fail("SESSION_REQUIRED");
    return this.serial.run(`connect:${sessionId}:${siteId}`, async () => {
      const existing = this.list(sessionId).find((f) => f.siteId === siteId),
        flowId = existing?.flowId ?? randomUUID();
      return this.serial.run(flowId, async () => {
        const site = this.pap.sites().find((s) => s.id === siteId);
        if (!consultationSite(site)) fail("CONSULTATION_UNAVAILABLE");
        const c = await this.pap.connect(siteId);
        const f: Flow = existing
          ? this.flow(sessionId, flowId)
          : {
              id: flowId,
              sessionId,
              siteId,
              connectionRef: c.connectionRef,
              capabilities: null,
              commands: {},
              sources: {},
              answers: {},
              updatedAt: "",
            };
        if (f.connectionRef !== c.connectionRef) fail("IDENTITY_CHANGED");
        await this.capabilities(f);
        return this.result(f, { capabilities: f.capabilities });
      });
    });
  }
  private result(f: Flow, data: any) {
    return {
      flowId: f.id,
      data: modelData(data),
      ui: {
        kind: "frontvia-customer",
        card: "consultation",
        flowId: f.id,
        sessionId: f.sessionId,
      },
    };
  }
  private remember(f: Flow, value: any) {
    for (const hit of [
      ...(value?.data?.hits ?? []),
      ...(value?.hits ?? []),
      ...(value?.data?.sources ?? []),
      ...(value?.sources ?? []),
      ...(value?.data?.source ? [value.data.source] : []),
    ]) {
      const locator = Object.fromEntries(
        [
          "collection_id",
          "document_id",
          "version",
          "index_generation",
          "ordinal",
        ].map((k) => [k, hit[k]]),
      );
      if (Object.values(locator).some((v) => v === undefined)) continue;
      const sourceRef = digest(locator);
      f.sources[sourceRef] = locator;
      hit.sourceRef = sourceRef;
    }
    for (const pointer of value?.prepared_answers ?? []) {
      const answerRef = digest(pointer);
      f.answers[answerRef] = pointer;
      pointer.answerRef = answerRef;
    }
    // Bound local references without changing the server's authoritative data.
    f.sources = Object.fromEntries(Object.entries(f.sources).slice(-100));
    f.answers = Object.fromEntries(Object.entries(f.answers).slice(-30));
    return value;
  }
  private async send(f: Flow, command: Command) {
    this.allowed(f, command.method);
    let data: any;
    try {
      data = await this.rpc(f, command.method, command.params);
    } catch (e: any) {
      if (
        ["INVALID_PARAMS", "VERSION_REQUIRED", "VERSION_CONFLICT"].includes(
          e.code,
        )
      ) {
        command.status = "done";
        command.result = { error: { code: e.code } };
        delete f.pending;
        this.save(f);
      }
      throw e;
    }
    command.status = "done";
    command.result = data;
    delete f.pending;
    if (data.conversation_id) f.conversation = { ...f.conversation, ...data };
    this.save(f);
    return data;
  }
  async tool(
    sessionId: string,
    flowId: string,
    name: string,
    args: any,
    callId: string,
    signal?: AbortSignal,
  ) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.capabilities(f);
      if (name === "frontvia_knowledge") return this.knowledge(f, args, signal);
      if (args.action === "recover") {
        signal?.throwIfAborted();
        if (f.pending)
          await this.send(
            f,
            f.commands[f.pending] ?? fail("PENDING_COMMAND_MISSING"),
          );
        return this.result(f, await this.current(f));
      }
      if (args.action === "get")
        return this.result(f, await this.current(f, args.before));
      if (args.action === "answer_get" || args.action === "answer_accept") {
        const pointer =
          f.answers[args.answerRef] ?? fail("ANSWER_REFERENCE_REQUIRED");
        const method =
          args.action === "answer_get"
            ? "consultation.answers.get"
            : "consultation.answers.accept";
        this.allowed(f, method);
        const data = await this.rpc(
          f,
          method,
          Object.fromEntries(
            ["kind", "prepared_id", "generation"].map((k) => [k, pointer[k]]),
          ),
          signal,
        );
        return this.result(f, data);
      }
      const key = digest([f.id, callId]),
        old = f.commands[key];
      if (old) {
        // Raw tool arguments are compared separately from saved concurrency fields.
        if (old.inputHash !== digest(args)) fail("IDEMPOTENCY_CONFLICT");
        if (old.status === "done") return this.result(f, old.result);
        fail("RESOLVE_PENDING_OPERATION");
      }
      if (f.pending) fail("RESOLVE_PENDING_OPERATION");
      let method: string, params: any;
      if (args.action === "ask") {
        method = "consultation.messages.submit";
        if (
          f.conversation?.conversation_id &&
          (!Number.isSafeInteger(args.expected_version) ||
            args.expected_version !== f.conversation.version)
        )
          fail("CONSULTATION_VERSION_REQUIRED");
        params = {
          text: args.text,
          idempotency_key: key,
          ...(args.product_ids ? { product_ids: args.product_ids } : {}),
          ...(f.conversation?.conversation_id
            ? {
                conversation_id: f.conversation.conversation_id,
                expected_version: args.expected_version,
              }
            : {}),
        };
      } else if (args.action === "help") {
        method = "consultation.help.request";
        if (!f.conversation?.conversation_id) fail("CONVERSATION_REQUIRED");
        params = {
          conversation_id: f.conversation.conversation_id,
          reason: args.reason,
          idempotency_key: key,
        };
      } else fail("INVALID_ACTION");
      this.allowed(f, method);
      signal?.throwIfAborted();
      // Keep local invocation binding out of the public request.
      const command: Command = {
        method,
        params,
        inputHash: digest(args),
        status: "pending",
      };
      f.commands[key] = command;
      f.pending = key;
      this.save(f);
      return this.result(f, await this.send(f, command));
    });
  }
  private async current(f: Flow, before?: string) {
    if (!f.conversation?.conversation_id) return { status: "no_question" };
    this.allowed(f, "consultation.conversations.get");
    const data = await this.rpc(f, "consultation.conversations.get", {
      conversation_id: f.conversation.conversation_id,
      ...(before ? { before } : {}),
    });
    f.conversation = this.remember(f, data);
    this.save(f);
    return data;
  }
  private async knowledge(f: Flow, args: any, signal?: AbortSignal) {
    const method = `consultation.knowledge.${args.action}`;
    this.allowed(f, method);
    let params: any;
    if (args.action === "search" || args.action === "lookup")
      params = { query: args.query, limit: args.limit ?? 5 };
    else if (args.action === "source" || args.action === "original")
      params = f.sources[args.sourceRef] ?? fail("SOURCE_REFERENCE_REQUIRED");
    else if (args.action === "access")
      params = {
        dependencies: Array.isArray(f.knowledge?.dependencies)
          ? f.knowledge.dependencies
          : [],
      };
    else fail("INVALID_ACTION");
    if (args.action === "access") {
      const access = await this.rpc(f, method, params, signal);
      if (access.status !== "current" || access.availability !== "supported") {
        delete f.knowledge;
        this.save(f);
      }
      return this.result(f, access);
    }
    // Remove stale UI evidence before any new read; failures never show it as current.
    delete f.knowledge;
    this.save(f);
    const data = this.remember(f, await this.rpc(f, method, params, signal));
    if (args.action === "original") {
      delete data.bytes_base64;
      data.downloadSourceRef = args.sourceRef;
    }
    f.knowledge = data;
    this.save(f);
    return this.result(f, data);
  }
  async view(sessionId: string, flowId: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.capabilities(f);
      const conversation = await this.current(f);
      if (f.knowledge?.dependencies?.length) {
        try {
          this.allowed(f, "consultation.knowledge.access");
          const access = await this.rpc(f, "consultation.knowledge.access", {
            dependencies: f.knowledge.dependencies,
          });
          if (
            access.status !== "current" ||
            access.availability !== "supported"
          )
            fail("KNOWLEDGE_SOURCE_EXPIRED");
        } catch {
          delete f.knowledge;
          this.save(f);
        }
      }
      return {
        flowId: f.id,
        sessionId: f.sessionId,
        siteId: f.siteId,
        kind: "consultation",
        capabilities: f.capabilities,
        conversation,
        knowledge: f.knowledge,
        pending: !!f.pending,
      };
    });
  }
  async original(sessionId: string, flowId: string, sourceRef: string) {
    return this.serial.run(flowId, async () => {
      const f = this.flow(sessionId, flowId);
      await this.capabilities(f);
      this.allowed(f, "consultation.knowledge.original");
      const locator = f.sources[sourceRef] ?? fail("SOURCE_REFERENCE_REQUIRED");
      const data = await this.rpc(
        f,
        "consultation.knowledge.original",
        locator,
      );
      if (
        typeof data.bytes_base64 !== "string" ||
        data.bytes_base64.length > 800000 ||
        !Number.isSafeInteger(data.size)
      )
        fail("INVALID_ORIGINAL_RESPONSE");
      const bytes = Buffer.from(data.bytes_base64, "base64");
      if (bytes.length !== data.size || digestBytes(bytes) !== data.sha256)
        fail("INVALID_ORIGINAL_RESPONSE");
      return {
        filename: String(data.filename)
          .replace(/[\\/\x00-\x1f]/g, "_")
          .slice(0, 180),
        content_type: "application/octet-stream",
        bytes_base64: data.bytes_base64,
      };
    });
  }
}
const digestBytes = (v: Buffer) => createHash("sha256").update(v).digest("hex");
