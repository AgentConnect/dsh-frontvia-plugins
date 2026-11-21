import { z } from "zod";
import { fail } from "./state.js";
import type { UcpOperation, UcpRequest, UcpResponse } from "./ucp-business.js";

export const ASK_METHOD = "ucp.ask";
const ASK_CAPABILITY = "dev.ucp.common.ask";
const VERSION = "2026-08-25";

type AskOperation = UcpOperation & { account?: boolean; blocked?: boolean };
export function askOperations(capabilities: string[] | undefined, operations: AskOperation[]) {
  return capabilities?.includes(ASK_CAPABILITY)
    ? operations.filter(operation => operation.channel === "ucp" && operation.operationId === "ask_business"
      && operation.method === "POST" && !operation.account && !operation.blocked && !operation.pathParameters?.length)
    : [];
}

const conversationSchema = z.object({
  id: z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/),
  expires_at: z.iso.datetime({ offset: true }).optional(),
});
export type AskConversation = z.infer<typeof conversationSchema> & { operationRef: string };

export type AskInput = {
  query: string;
  ids?: string[];
  idempotencyKey: string;
  conversation?: AskConversation;
};

export async function requestAsk(operation: UcpOperation, input: AskInput, send: (request: UcpRequest) => Promise<UcpResponse>) {
  const continuation = input.conversation?.operationRef === operation.operationRef ? input.conversation : undefined;
  const { status, body } = await send({
    operationRef: operation.operationRef,
    idempotencyKey: input.idempotencyKey,
    body: {
      query: input.query,
      ...(input.ids?.length ? { ids: input.ids } : {}),
      ...(continuation ? { conversation: { id: continuation.id } } : {}),
    },
  });
  if (status !== 200 || body?.ucp?.status === "error") fail("UCP_ASK_FAILED");
  if (body?.ucp?.version !== VERSION || !Array.isArray(body.ucp.capabilities?.[ASK_CAPABILITY]) ||
      !body.ucp.capabilities[ASK_CAPABILITY].some((entry: any) => entry?.version === VERSION) ||
      typeof body.answer?.plain !== "string" || !body.answer.plain.trim() || body.answer.plain.length > 12000)
    fail("INVALID_UCP_ASK_RESPONSE");
  const parsed = conversationSchema.safeParse(body.conversation);
  if (body.conversation !== undefined && !parsed.success) fail("INVALID_UCP_ASK_RESPONSE");
  const relatedLinks: Array<{url?: unknown; type?: unknown; title?: unknown; id?: unknown} | null> =
    Array.isArray(body.links) ? body.links.slice(0, 12) : [];
  const links = relatedLinks.flatMap(link => {
    if (typeof link?.url !== "string" || link.url.length > 2048 || typeof link.type !== "string" || link.type.length > 64)
      return [];
    const url = URL.parse(link.url);
    if (!url || url.protocol !== "https:" || url.username || url.password) return [];
    return [{ url: url.href, type: link.type,
      ...(typeof link.title === "string" ? { title: link.title.slice(0, 300) } : {}),
      ...(typeof link.id === "string" && link.id.length <= 512 ? { id: link.id } : {}),
    }];
  });
  return {
    answer: body.answer.plain as string,
    links,
    ...(parsed.success ? { conversation: { ...parsed.data, operationRef: operation.operationRef } } : {}),
  };
}

export type AskResponse = Awaited<ReturnType<typeof requestAsk>>;
