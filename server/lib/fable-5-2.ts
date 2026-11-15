import { randomUUID } from "node:crypto";

export const FABLE_52_MODEL = "claude-fable-5-2";
/** Exact owner-selected review deadlines only; arbitrary overrides retain the default. */
export function fable52Timeout(requested: unknown): number {
  return requested === 600_000 ? 600_000 : requested === 180_000 ? 180_000 : 60_000;
}
const REQUEST_KEYS = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls",
  "max_tokens", "max_completion_tokens", "stream", "stream_options",
  "temperature", "top_p", "top_k", "thinking", "reasoning_effort",
  "stop", "n", "response_format",
]);

/** Official OpenAI-compatible transport: thinking is on by default, effort is ignored. */
export function prepareFable52Request(params: any): { payload: any; maximumCents: number } {
  if (!params || params.model !== FABLE_52_MODEL ||
      Object.keys(params).some(key => !REQUEST_KEYS.has(key)) ||
      !Array.isArray(params.messages) || !params.messages.length) {
    throw new Error("Fable 5.2 requires an exact model and supported chat request");
  }
  const output = Object.hasOwn(params, "max_completion_tokens") ? params.max_completion_tokens :
    Object.hasOwn(params, "max_tokens") ? params.max_tokens : 32768;
  if (!Number.isSafeInteger(output) || output < 1 || output > 128000 ||
      (params.n !== undefined && params.n !== 1) ||
      (params.stream !== undefined && typeof params.stream !== "boolean")) {
    throw new Error("Fable 5.2 output bound is invalid");
  }
  if (Object.hasOwn(params, "max_tokens") && Object.hasOwn(params, "max_completion_tokens") &&
      params.max_tokens !== params.max_completion_tokens) throw new Error("Conflicting Fable 5.2 output bounds");
  if (params.tool_choice !== undefined && !["auto", "none"].includes(params.tool_choice)) {
    throw new Error("Fable 5.2 does not support forced tool use");
  }
  if (params.response_format !== undefined &&
      (params.response_format?.type !== "json_schema" || params.response_format?.json_schema?.strict !== true)) {
    throw new Error("Fable 5.2 requires strict json_schema response format");
  }
  const payload = JSON.parse(JSON.stringify(params));
  for (const key of ["temperature", "top_p", "top_k", "thinking", "reasoning_effort",
    "max_completion_tokens", "stream_options"]) delete payload[key];
  payload.max_tokens = output;
  if (payload.stream) payload.stream_options = { include_usage: true };
  let media = false;
  for (const message of payload.messages) {
    if (!message || !["system", "developer", "user", "assistant", "tool"].includes(message.role) ||
        Object.keys(message).some(key => !["role", "content", "name", "tool_call_id", "tool_calls"].includes(key))) {
      throw new Error("Fable 5.2 message shape is unsupported");
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === "image_url" && typeof part.image_url?.url === "string") media = true;
        else if (part?.type !== "text" || typeof part.text !== "string")
          throw new Error("Fable 5.2 accepts text and images only");
      }
    } else if (typeof message.content !== "string" &&
        !(message.role === "assistant" && message.content == null && Array.isArray(message.tool_calls))) {
      throw new Error("Fable 5.2 message content is unsupported");
    }
  }
  // No compatibility-layer caching. UTF-8 bytes plus framing reserve bound
  // text/schema tokens; unknown image tokenization reserves the entire context.
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > 2_000_000) throw new Error("Fable 5.2 request exceeds the bounded wire size");
  const inputBound = media ? 1_000_000 : bytes * 2 + 8192;
  if (inputBound + output > 1_000_000 && !media) {
    throw new Error("Fable 5.2 request exceeds the conservative context bound");
  }
  return { payload, maximumCents: Math.ceil((inputBound * 8 + output * 40) / 10000) };
}

export interface Fable52Budget {
  reserve(args: { tenantId: number; attemptKey: string; maximumCostCents: number }): Promise<{ id: number; attemptKey: string }>;
  settle(args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number }): Promise<unknown>;
}

function usageCents(usage: any): number {
  if (!Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens < 0 ||
      !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens < 0 ||
      usage.prompt_tokens + usage.completion_tokens < 1) {
    throw new Error("Fable 5.2 omitted valid usage; reservation retained");
  }
  return Math.ceil((usage.prompt_tokens * 8 + usage.completion_tokens * 40) / 10000);
}

/** Closed paid operation: validate and reserve before dispatch; never replay uncertainty. */
export function createFable52Completion(
  create: (params: any, options?: any) => Promise<any>,
  checkAccess: () => void,
  tenantId: number,
  budget: () => Promise<Fable52Budget>,
) {
  let uncertain = false;
  return async (params: any, options: any = {}) => {
    checkAccess();
    if (uncertain) throw new Error("Fable 5.2 previous dispatch is uncertain; no automatic replay");
    const { payload, maximumCents } = prepareFable52Request(params);
    options.signal?.throwIfAborted();
    const store = await budget();
    const held = await store.reserve({
      tenantId, attemptKey: `fable52:${randomUUID()}`, maximumCostCents: maximumCents,
    });
    const controller = new AbortController();
    const timeout = fable52Timeout(options.timeout);
    const timer = setTimeout(() => controller.abort(new Error("Fable 5.2 request deadline exceeded")), timeout);
    timer.unref();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      checkAccess();
      signal.throwIfAborted();
      // create is the mandatory-ledger wrapper: accounting succeeds before release.
      const result = await create(payload, { signal, timeout, maxRetries: 0 });
      let usage = result?.usage;
      const buffered: any[] = [];
      if (payload.stream) {
        if (!result?.[Symbol.asyncIterator]) throw new Error("Fable 5.2 malformed stream");
        for await (const chunk of result) {
          if (chunk?.usage) usage = chunk.usage;
          buffered.push(chunk);
        }
      }
      const actualCostCents = usageCents(usage);
      if (actualCostCents > maximumCents) throw new Error("Fable 5.2 usage exceeded reserved maximum");
      await store.settle({ tenantId, reservationId: held.id, attemptKey: held.attemptKey, actualCostCents });
      if (!payload.stream) return result;
      return (async function* () { for (const chunk of buffered) yield chunk; })();
    } catch (error) {
      uncertain = true;
      throw error;
    } finally { clearTimeout(timer); }
  };
}
