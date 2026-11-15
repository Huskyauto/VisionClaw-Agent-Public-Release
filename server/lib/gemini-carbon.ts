import { randomUUID } from "node:crypto";
import type { Fable52Budget } from "./fable-5-2";

export const CARBON_MODEL = "gemini-4-carbon";
export const CARBON_TIMEOUT_MS = 180_000;
const ALLOWED = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls",
  "max_tokens", "max_completion_tokens", "stream", "stream_options",
  "temperature", "top_p", "top_k", "reasoning_effort", "response_format", "stop", "n",
]);

export function carbonReady(): boolean {
  const key = process.env.GEMINI_HIGH_END_API_KEY;
  return process.env.GEMINI_CARBON_DISABLED !== "1"
    && typeof key === "string" && key.length >= 20 && key.length <= 256 && /^[A-Za-z0-9_.-]+$/.test(key);
}

export function prepareCarbonRequest(params: any): { payload: any; maximumCents: number } {
  if (!params || params.model !== CARBON_MODEL || Object.keys(params).some(k => !ALLOWED.has(k))
    || !Array.isArray(params.messages) || !params.messages.length) throw new Error("Unsupported Carbon request");
  const output = Object.hasOwn(params, "max_completion_tokens") ? params.max_completion_tokens
    : Object.hasOwn(params, "max_tokens") ? params.max_tokens : 32768;
  if (!Number.isSafeInteger(output) || output < 1 || output > 32768
    || (params.max_tokens !== undefined && params.max_completion_tokens !== undefined && params.max_tokens !== params.max_completion_tokens)
    || (params.n !== undefined && params.n !== 1)
    || (params.stream !== undefined && typeof params.stream !== "boolean")
    || (params.reasoning_effort !== undefined && !["low", "medium", "high"].includes(params.reasoning_effort))) {
    throw new Error("Invalid Carbon output or reasoning bound");
  }
  const payload = JSON.parse(JSON.stringify(params));
  for (const key of ["temperature", "top_p", "top_k", "max_completion_tokens", "stream_options"]) delete payload[key];
  payload.max_tokens = output;
  if (payload.stream) payload.stream_options = { include_usage: true };
  let media = false;
  for (const message of payload.messages) {
    if (!message || !["system", "developer", "user", "assistant", "tool"].includes(message.role)
      || Object.keys(message).some(k => !["role", "content", "name", "tool_call_id", "tool_calls"].includes(k))) {
      throw new Error("Unsupported Carbon message");
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === "image_url" && typeof part.image_url?.url === "string") media = true;
        else if (part?.type !== "text" || typeof part.text !== "string") throw new Error("Carbon lane accepts text and images only");
      }
    } else if (typeof message.content !== "string"
      && !(message.role === "assistant" && message.content == null && Array.isArray(message.tool_calls))) {
      throw new Error("Unsupported Carbon content");
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > 2_000_000) throw new Error("Carbon request exceeds wire bound");
  const inputBound = media ? 1_048_576 : bytes * 2 + 8192;
  if (!media && inputBound + output > 1_048_576) throw new Error("Carbon request exceeds conservative context bound");
  // Reserve the higher post-intro price, never speculative cache savings.
  return { payload, maximumCents: Math.ceil((inputBound * 4 + output * 20) / 10000) };
}

export function carbonUsageCost(usage: any, at = new Date()): number {
  const input = usage?.prompt_tokens, output = usage?.completion_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every(v => Number.isSafeInteger(v) && v >= 0)
    || input + output < 1 || cached > input || !Number.isFinite(at.getTime())) {
    throw new Error("Carbon omitted valid usage; reservation retained");
  }
  const multiplier = at.getTime() < Date.UTC(2026, 11, 1) ? 1 : 2;
  return ((input - cached) * 2 + cached * 0.1 + output * 10) * multiplier / 1_000_000;
}

interface CarbonBudget extends Fable52Budget {
  observeOverrun(args: { tenantId: number; reservationId: number; attemptKey: string; observedCostCents: number }): Promise<unknown>;
}

interface CarbonDependencies {
  create(params: any, options: any): Promise<any>;
  checkAccess(): void;
  budget(): Promise<CarbonBudget>;
  record(entry: any): Promise<boolean>;
  now?(): Date;
}

/** Closed owner-paid operation; no SDK/accounting/stream recovery may replay it. */
export function createCarbonCompletion(tenantId: number, deps: CarbonDependencies) {
  let uncertain = false;
  return async (params: any, options: any = {}) => {
    deps.checkAccess();
    if (uncertain) throw new Error("Carbon prior dispatch is uncertain; automatic replay forbidden");
    const { payload, maximumCents } = prepareCarbonRequest(params);
    options.signal?.throwIfAborted();
    const budget = await deps.budget();
    const held = await budget.reserve({ tenantId, attemptKey: `carbon:${randomUUID()}`, maximumCostCents: maximumCents });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CARBON_TIMEOUT_MS);
    timer.unref();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let dispatched = false;
    try {
      deps.checkAccess();
      signal.throwIfAborted();
      const at = deps.now?.() ?? new Date();
      dispatched = true;
      const result = await deps.create(payload, { signal, timeout: CARBON_TIMEOUT_MS, maxRetries: 0 });
      let usage = result?.usage;
      let model = result?.model;
      let meaningful = !!result?.choices?.some((c: any) => c.message?.content || c.message?.tool_calls?.length);
      const buffered: any[] = [];
      if (payload.stream) {
        if (!result?.[Symbol.asyncIterator]) throw new Error("Malformed Carbon stream");
        let bytes = 0;
        for await (const chunk of result) {
          bytes += Buffer.byteLength(JSON.stringify(chunk));
          if (bytes > 8 * 1024 ** 2 || buffered.length >= 10000) throw new Error("Carbon stream exceeds bound");
          if (chunk?.usage) usage = chunk.usage;
          if (chunk?.model) {
            if (model && model !== chunk.model) throw new Error("Carbon stream model changed");
            model = chunk.model;
          }
          meaningful ||= !!chunk?.choices?.some((c: any) => c.delta?.content || c.delta?.tool_calls?.length);
          buffered.push(chunk);
        }
      }
      const costUsd = carbonUsageCost(usage, at);
      const actualCostCents = Math.ceil(costUsd * 100);
      if (!await deps.record({
        tenantId, toolName: "llm.google-carbon", model: CARBON_MODEL,
        tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens,
        cachedTokensIn: usage.prompt_tokens_details?.cached_tokens ?? 0,
        costUsd, operation: "chat.completions.create",
      })) throw new Error("Carbon usage ledger write failed; reservation retained");
      if (actualCostCents > maximumCents) {
        await budget.observeOverrun({ tenantId, reservationId: held.id, attemptKey: held.attemptKey, observedCostCents: actualCostCents });
        throw new Error("Carbon usage exceeded reservation; observed spend recorded and larger hold retained");
      }
      await budget.settle({ tenantId, reservationId: held.id, attemptKey: held.attemptKey, actualCostCents });
      if (typeof model !== "string" || !/^gemini-4-carbon(?:-\d{3}|-\d{4}-\d{2}-\d{2})?$/.test(model) || !meaningful) {
        throw new Error("Carbon returned no usable exact-model completion; no automatic retry");
      }
      if (!payload.stream) return result;
      return (async function* () { for (const chunk of buffered) yield chunk; })();
    } catch (error) {
      if (dispatched) uncertain = true;
      throw error;
    } finally { clearTimeout(timer); }
  };
}
