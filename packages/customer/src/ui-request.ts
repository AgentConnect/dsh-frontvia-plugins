import { randomUUID } from "node:crypto";
import type { ConnectionRpcResult } from "@deepseek-ai/dsh-client-connection";
import { ZodError } from "zod";
import { PapError } from "./state.js";
import { uiSchemas } from "./ui-contract.js";

export async function runUiRequest<T>(
  operation: keyof typeof uiSchemas,
  payload: unknown,
  run: (args: (typeof uiSchemas)[keyof typeof uiSchemas]["_output"]) => Promise<T>,
): Promise<ConnectionRpcResult<T>> {
  const parsed = uiSchemas[operation].safeParse(payload);
  if (!parsed.success)
    return { ok: false, error: { code: "INVALID_UI_REQUEST", message: "请求参数无效", details: {} } };
  try {
    return { ok: true, value: await run(parsed.data) };
  } catch (error) {
    if (error instanceof PapError)
      return { ok: false, error: { code: error.code, message: error.code, details: {} } };
    const referenceId = randomUUID();
    console.warn(JSON.stringify({
      event: "frontvia_customer_ui_failure", operation, reference_id: referenceId,
      reason: error instanceof ZodError ? "invalid_internal_data" : error instanceof TypeError ? "type_error" : "unexpected",
    }));
    const read = operation === "view";
    return { ok: false, error: {
      code: read ? "SHOPPING_VIEW_FAILED" : "FRONTVIA_UI_ACTION_FAILED",
      message: read ? "暂时无法读取购物进度" : "请求未完成，请先核对原操作结果",
      details: { referenceId },
    } };
  }
}
