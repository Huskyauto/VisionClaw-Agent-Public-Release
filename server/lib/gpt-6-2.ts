import { randomUUID } from "node:crypto";

export const GPT_62_STANDARD_RATES = {
  "gpt-6.2-sol": { in: 0.002, out: 0.01 },
  "gpt-6.2-astra": { in: 0.008, out: 0.04 },
} as const;
export type Gpt62ModelId = keyof typeof GPT_62_STANDARD_RATES;
export const GPT_62_TIMEOUT_MS = 180_000;

export function isGpt62Model(id: string): id is Gpt62ModelId {
  return Object.hasOwn(GPT_62_STANDARD_RATES, id);
}

export function gpt62Ready(): boolean {
  return process.env.OPENAI_GPT_62_DISABLED !== "1" && !!process.env.OPENAI_API_KEY?.trim();
}

const KEYS = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls", "response_format",
  "stream", "stream_options", "temperature", "top_p", "reasoning_effort", "max_tokens",
  "max_completion_tokens", "n", "service_tier",
]);

function prepare(model: Gpt62ModelId, params: any) {
  if (params?.model !== model || Object.keys(params).some(key => !KEYS.has(key)) ||
      !Array.isArray(params.messages) || params.messages.length === 0 ||
      (params.n !== undefined && params.n !== 1) ||
      (params.stream !== undefined && typeof params.stream !== "boolean") ||
      (params.service_tier !== undefined && params.service_tier !== "default")) {
    throw new Error("GPT-6.2 requires an exact-model, single-output Standard chat request");
  }
  const output = Object.hasOwn(params, "max_completion_tokens") ? params.max_completion_tokens :
    Object.hasOwn(params, "max_tokens") ? params.max_tokens : 32768;
  if (!Number.isSafeInteger(output) || output < 1 || output > 128000 ||
      (Object.hasOwn(params, "max_tokens") && params.max_tokens !== output) ||
      (params.tools !== undefined && (!Array.isArray(params.tools) ||
        params.tools.some((tool: any) => tool?.type !== "function")))) {
    throw new Error("GPT-6.2 requires a bounded output and local function tools only");
  }
  if (params.reasoning_effort !== undefined &&
      !["low", "medium", "high", "xhigh"].includes(params.reasoning_effort)) {
    throw new Error("GPT-6.2 requires a supported reasoning effort");
  }
  const { max_tokens, stream_options, temperature, top_p, ...rest } = params;
  const payload = JSON.parse(JSON.stringify({
    ...rest, max_completion_tokens: output, service_tier: "default",
    ...(params.stream ? { stream_options: { include_usage: true } } : {}),
  }));
  if (!payload.tools?.length) {
    if (payload.tool_choice !== undefined && !["auto", "none"].includes(payload.tool_choice)) {
      throw new Error("GPT-6.2 cannot force a tool without a tool roster");
    }
    delete payload.tools;
    delete payload.tool_choice;
  }
  let hasImage = false;
  for (const message of payload.messages) {
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === "image_url") hasImage = true;
        else if (part?.type !== "text") throw new Error("GPT-6.2 supports only text and image inputs");
      }
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  const input = hasImage ? 922_000 : bytes * 2 + 8192;
  if (bytes > 2_000_000 || input > 922_000) throw new Error("GPT-6.2 request exceeds its input bound");
  const rates = GPT_62_STANDARD_RATES[model];
  const long = input > 272_000;
  // Standard's 30-minute writes cost 1.25×; no cache-retention override.
  const maximumCents = Math.ceil((input * rates.in * (long ? 2 : 1) * 1.25 +
    output * rates.out * (long ? 1.5 : 1)) / 10);
  return { payload, maximumCents };
}

interface Gpt62Dependencies {
  checkAccess(): void;
  create(params: any, options: any): Promise<any>;
  reserve(args: { tenantId: number; attemptKey: string; maximumCostCents: number }): Promise<{ id: number; attemptKey: string }>;
  settle(args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number }): Promise<unknown>;
  observeOverrun(args: { tenantId: number; reservationId: number; attemptKey: string; observedCostCents: number }): Promise<unknown>;
  estimate(model: string, input: number, output: number, cached: number, writes: number): number;
  record(entry: any): Promise<boolean>;
}

export function createGpt62Completion(model: Gpt62ModelId, tenantId: number, deps: Gpt62Dependencies) {
  let busy = false;
  let uncertain = false;
  return async (params: any, options: { signal?: AbortSignal } = {}) => {
    deps.checkAccess();
    if (busy || uncertain) throw new Error("GPT-6.2 client is busy or prior dispatch is uncertain; no replay");
    const { payload, maximumCents } = prepare(model, params);
    options.signal?.throwIfAborted();
    const deadline = new AbortController();
    const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
    busy = true;
    let dispatched = false;
    const timer = setTimeout(() => deadline.abort(), GPT_62_TIMEOUT_MS);
    timer.unref();
    try {
      const held = await deps.reserve({ tenantId, attemptKey: `gpt62:${randomUUID()}`, maximumCostCents: maximumCents });
      const reservation = { tenantId, reservationId: held.id, attemptKey: held.attemptKey };
      try {
        deps.checkAccess();
        signal.throwIfAborted();
      } catch (error) {
        await deps.settle({ ...reservation, actualCostCents: 0 });
        throw error;
      }
      dispatched = true;
      const result = await deps.create(payload, { signal, timeout: GPT_62_TIMEOUT_MS, maxRetries: 0 });
      let usage: any;
      let exact = true;
      let completed = false;
      let meaningful = false;
      const read = (part: any) => {
        if (part?.usage) usage = part.usage;
        exact &&= part?.model === model && [undefined, "default"].includes(part.service_tier);
        for (const choice of part?.choices ?? []) {
          const message = choice.message ?? choice.delta;
          meaningful ||= (typeof message?.content === "string" && !!message.content.trim()) ||
            !!message?.tool_calls?.length;
          completed ||= ["stop", "tool_calls"].includes(choice.finish_reason);
        }
      };
      const buffered: any[] = [];
      if (payload.stream) {
        if (!result?.[Symbol.asyncIterator]) throw new Error("GPT-6.2 returned an invalid stream");
        let bytes = 0;
        for await (const part of result) {
          bytes += Buffer.byteLength(JSON.stringify(part));
          if (bytes > 8 * 1024 ** 2 || buffered.length >= 10000) throw new Error("GPT-6.2 stream exceeded its bound");
          read(part);
          buffered.push(part);
        }
      } else read(result);
      const input = usage?.prompt_tokens;
      const output = usage?.completion_tokens;
      const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const writes = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
      if (![input, output, cached, writes].every(n => Number.isSafeInteger(n) && n >= 0) ||
          input + output < 1 || cached + writes > input) throw new Error("GPT-6.2 omitted valid usage; reservation retained");
      const costUsd = deps.estimate(model, input, output, cached, writes);
      const actualCostCents = Math.ceil(costUsd * 100);
      if (actualCostCents > maximumCents) {
        await deps.observeOverrun({ ...reservation, observedCostCents: actualCostCents });
      }
      if (!await deps.record({
        tenantId, model, toolName: "llm.openai", tokensIn: input, tokensOut: output,
        cachedTokensIn: cached, cacheWriteTokens: writes, costUsd,
        operation: payload.stream ? "chat.completions.create.stream" : "chat.completions.create",
      })) throw new Error("GPT-6.2 usage ledger write failed; reservation retained");
      if (actualCostCents > maximumCents) {
        throw new Error("GPT-6.2 observed spend exceeded its reservation");
      }
      await deps.settle({ ...reservation, actualCostCents });
      if (!exact || !completed || !meaningful) throw new Error("GPT-6.2 did not return a complete exact-model answer");
      signal.throwIfAborted();
      if (!payload.stream) {
        Object.defineProperty(result, Symbol.for("visionclaw.cost-ledger-recorded"), { value: true });
        return result;
      }
      return (async function* () { yield* buffered; })();
    } catch (error) {
      uncertain = dispatched;
      throw error;
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };
}
