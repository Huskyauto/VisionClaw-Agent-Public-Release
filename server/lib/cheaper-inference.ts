/** Owner wallet transport. Automatic authority is a separate exact opt-in policy. */
export const CHEAPER_INFERENCE_MODEL_ID = "cheaperinference/gpt-5.6-luna";
export const CHEAPER_INFERENCE_UPSTREAM_MODEL = "gpt-5.6-luna";
export const CHEAPER_INFERENCE_BASE_URL = "https://api.cheaperinference.com/v1";
export const CHEAPER_INFERENCE_MAX_OUTPUT = 8192;
export const CHEAPER_INFERENCE_MAX_REQUEST_BYTES = 192 * 1024;

export function cheaperInferenceReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CHEAPER_INFERENCE_ENABLED !== "0" && !!env.CHEAPER_INFERENCE_API_KEY?.trim();
}

export function assertCheaperInferenceAccess(
  tenantId: number | undefined,
  grant: { explicitOwnerSelection?: boolean; platformAdminVerified?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const manual = grant.explicitOwnerSelection === true && grant.platformAdminVerified === true;
  const automatic = env.CHEAPER_INFERENCE_AUTOMATIC_ENABLED === "1";
  if (tenantId !== 1 || (!manual && !automatic) || !cheaperInferenceReady(env)) {
    throw new Error("CheaperInference requires an enabled key and explicit verified platform-owner selection");
  }
}

export function guardCheaperInferenceRequest(params: Record<string, any>, upstream = CHEAPER_INFERENCE_UPSTREAM_MODEL): Record<string, any> {
  if (params.model !== upstream) {
    throw new Error("CheaperInference is pinned to gpt-5.6-luna");
  }
  if (params.reasoning?.mode === "pro") {
    throw new Error("CheaperInference Pro requires the separate Responses API; this lane uses standard Chat Completions");
  }
  if (params.service_tier !== undefined && !["auto", "default", "standard"].includes(params.service_tier)) {
    throw new Error("CheaperInference uses standard service tier only");
  }
  if (params.audio || params.modalities?.some((m: unknown) => m !== "text")) {
    throw new Error("Audio output is not supported by this CheaperInference lane");
  }
  for (const field of ["max_tokens", "max_completion_tokens"]) {
    if (Object.hasOwn(params, field) && (
      typeof params[field] !== "number" || !Number.isSafeInteger(params[field]) ||
      params[field] < 1 || params[field] > CHEAPER_INFERENCE_MAX_OUTPUT
    )) throw new Error("CheaperInference output limit must be an integer from 1 to 8192");
  }
  if (params.max_tokens !== undefined && params.max_completion_tokens !== undefined &&
      params.max_tokens !== params.max_completion_tokens) {
    throw new Error("CheaperInference output limits conflict");
  }
  if (params.n !== undefined && params.n !== 1) {
    throw new Error("CheaperInference supports one completion per request");
  }
  if (params.stream !== undefined && typeof params.stream !== "boolean") {
    throw new Error("CheaperInference stream must be a boolean");
  }
  const { max_tokens, ...rest } = params;
  const payload = {
    ...rest, n: 1, max_completion_tokens: rest.max_completion_tokens ?? max_tokens ?? 4096,
    ...(rest.stream === true ? { stream_options: { ...rest.stream_options, include_usage: true } } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > CHEAPER_INFERENCE_MAX_REQUEST_BYTES) {
    throw new Error("CheaperInference request exceeds the 192 KiB limit");
  }
  return payload;
}

/** Live receipt wins; token estimates are dated catalog rates, not a free lane. */
export function cheaperInferenceCostFields(providerLabel: string, usage: any): { costUsd?: number } {
  if (providerLabel !== "llm.cheaperinference") return {};
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
    return { costUsd: usage.cost };
  }
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) ||
      cached > input) throw new Error("CheaperInference omitted valid billing evidence");
  // Provider catalog verified 2026-10-11. Above 272k input, use long-context rates.
  const long = input > 272_000;
  const dollars = ((input - cached) * (long ? 0.16 : 0.08) +
    // No verified long-context cache discount: estimate conservatively at full input.
    cached * (long ? 0.16 : 0.008) + output * (long ? 0.72 : 0.48)) / 1_000_000;
  return { costUsd: Number(dollars.toFixed(12)) };
}
