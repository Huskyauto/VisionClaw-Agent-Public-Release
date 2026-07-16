// Shared param-adaptation primitives for resilient LLM invocation.
//
// Lives in its own module (it imports NOTHING from providers.ts or
// resilient-llm.ts) so BOTH the universal client-factory wrapper in
// server/providers.ts AND the higher-level resilientChatCompletion loop in
// server/lib/resilient-llm.ts can use it without a circular import.
//
// "Param-adaptation" = when a provider route rejects an OPTIONAL request param
// (a direct-key Claude route rejecting response_format AND/OR temperature; an
// endpoint that wants legacy max_tokens instead of max_completion_tokens),
// strip/swap the offending param and retry the SAME model rather than hard
// failing. This is the exact failure class that broke the BWB recap.

import { logSilentCatch } from "./silent-catch";

export const MAX_PARAM_STRIPS = 4;

// Mutates `createParams` IN PLACE to drop/swap a single OPTIONAL param that the
// provider just rejected. Returns the adapted param's name (for logging) or
// null when the error is NOT a recognized param rejection — in which case the
// caller must rethrow / fail over rather than silently swallow it. Order
// matters: most-common rejections first. NEVER touches required fields
// (messages, model) — it can only ever make a request MORE conservative.
export function stripRejectedParam(createParams: any, apiErr: any): string | null {
  const msg = apiErr?.message || apiErr?.error?.message || "";
  if (!msg) return null;

  if (msg.includes("temperature") && createParams.temperature !== undefined) {
    delete createParams.temperature;
    return "temperature";
  }
  if (/response_format|json_object|json_schema/i.test(msg) && createParams.response_format !== undefined) {
    delete createParams.response_format;
    return "response_format";
  }
  // Some endpoints want the legacy max_tokens instead of max_completion_tokens
  // (or reject the latter as "unsupported"/"unknown").
  if (
    /max_completion_tokens|max_tokens|unsupported parameter|unknown parameter/i.test(msg) &&
    createParams.max_completion_tokens !== undefined &&
    createParams.max_tokens === undefined
  ) {
    createParams.max_tokens = createParams.max_completion_tokens;
    delete createParams.max_completion_tokens;
    return "max_completion_tokens→max_tokens";
  }
  return null;
}

const PARAM_ADAPT_FLAG = "__vcParamAdapted";

export interface ParamAdaptEvent {
  model: string | undefined;
  adapted: string;
  attempt: number;
}

// Idempotently wraps a client's chat.completions.create so a provider rejecting
// an OPTIONAL param is auto-adapted and retried against the SAME model instead
// of hard-failing. Wrapping client-SOURCE factories (getUserClient / getReplit
// / getIntegrationClient / getSubscriptionClient) with this is what makes
// param-adaptation UNIVERSAL across every getClientForModel() caller (~65 call
// sites) with zero call-site churn.
//
// Bounded by MAX_PARAM_STRIPS. The caller's AbortSignal (passed via the second
// `options` arg, e.g. create(params, { signal })) ALWAYS wins — once aborted we
// stop and never strip-retry past the deadline.
//
// Idempotent: re-wrapping the SAME (cached) client object is a no-op — the flag
// is stored on the client object, so even though the cost-tracking wrapper
// re-wraps `.create` on every call (it is not idempotent), this param-adapt
// layer is added at most once and never stacks.
export function wrapClientWithParamAdaptation<
  T extends { chat: { completions: { create: any } } },
>(client: T, onEvent?: (e: ParamAdaptEvent) => void): T {
  if ((client as any)[PARAM_ADAPT_FLAG]) return client;
  const orig = client.chat.completions.create.bind(client.chat.completions);

  (client.chat.completions as any).create = async function paramAdaptedCreate(
    params: any,
    options?: any,
  ) {
    // Copy-on-first-strip so we never mutate the caller's params object.
    let working = params;
    for (let attempt = 0; ; attempt++) {
      try {
        return await orig(working, options);
      } catch (apiErr: any) {
        if (options?.signal?.aborted) throw apiErr; // caller deadline wins
        if (attempt >= MAX_PARAM_STRIPS) throw apiErr;
        if (working === params) working = { ...params };
        const adapted = stripRejectedParam(working, apiErr);
        if (!adapted) throw apiErr; // not a param rejection — let it propagate
        const evt: ParamAdaptEvent = { model: working?.model, adapted, attempt: attempt + 1 };
        try {
          console.log(JSON.stringify({ evt: "llm_param_adapt", scope: "client", ...evt }));
          onEvent?.(evt);
        } catch (_silentErr) { logSilentCatch("server/lib/param-adaptation.ts", _silentErr); }
        // loop retries with the adapted params
      }
    }
  };

  (client as any)[PARAM_ADAPT_FLAG] = true;
  return client;
}
