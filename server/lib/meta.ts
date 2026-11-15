/** Owner-funded standard Meta API lane. No Contributor mode or implicit customer access. */
export const META_BASE_URL = "https://api.meta.ai/v1";
export const META_UPSTREAM_MODEL = "muse-spark-1.3";
export const META_MODEL_ID = `meta-direct/${META_UPSTREAM_MODEL}`;
export const META_CONTRIBUTOR_MODEL_ID = "meta-direct/muse-spark-1.3-contributor";
export const META_WONDER_MODEL_ID = "meta-direct/muse-wonder-1.0";
export const META_MAX_OUTPUT = 32_768;
export const META_INPUT_PER_MILLION = 1.25;
export const META_OUTPUT_PER_MILLION = 4.25;
export const META_MODELS = [
  { id: META_CONTRIBUTOR_MODEL_ID, upstream: "muse-spark-1.3-contributor", tier: "fast" as const,
    label: "Muse Spark 1.3 Contributor (Meta credits)", input: 0.10, output: 0.20, effort: "minimal" },
  { id: META_MODEL_ID, upstream: META_UPSTREAM_MODEL, tier: "balanced" as const,
    label: "Muse Spark 1.3 (Meta credits)", input: 1.25, output: 4.25, effort: "minimal" },
  { id: META_WONDER_MODEL_ID, upstream: "muse-wonder-1.0", tier: "reasoning" as const,
    label: "Muse Wonder (Meta credits)", input: 4, output: 20, effort: "high" },
];
export function metaModel(id: string) {
  return META_MODELS.find(model => model.id === id || model.upstream === id);
}
/** A title's visible text is short, but Meta's output budget also includes reasoning. */
export function metaTitleTokenLimit(modelId: string): number {
  return metaModel(modelId) ? 1024 : 30;
}
/** Helper-owned allowance, not an override of arbitrary caller output contracts. */
export function metaHelperTokenLimit(modelId: string, visibleLimit: number): number {
  const model = metaModel(modelId);
  if (!model) return visibleLimit;
  return Math.min(META_MAX_OUTPUT, Math.max(visibleLimit,
    model.id === META_WONDER_MODEL_ID ? 16384 :
      model.id === META_CONTRIBUTOR_MODEL_ID ? 1024 : 4096));
}
export function metaModelForTier(tier?: string, env: Record<string, string | undefined> = process.env): string {
  if (tier === "powerful" || tier === "reasoning") return META_WONDER_MODEL_ID;
  if (tier === "fast" && env.META_CONTRIBUTOR_APPROVED === "1") return META_CONTRIBUTOR_MODEL_ID;
  return META_MODEL_ID;
}

export interface MetaSelection {
  juryLane?: boolean;
  explicitOwnerSelection?: boolean;
  providerLane?: string;
  forbidMeteredFallback?: boolean;
  allowMeteredFallback?: boolean;
  freeTierOnly?: boolean;
}

export function metaReady(env: Record<string, string | undefined> = process.env): boolean {
  return env.META_ENABLED !== "0" && !!env.META_API_KEY?.trim();
}

export function metaPrimaryAllowed(
  tenantId: number | undefined, contextTenant: number | null, options: MetaSelection = {},
  env: Record<string, string | undefined> = process.env,
): boolean {
  return tenantId === 1 && contextTenant === 1 && metaReady(env) &&
    env.META_PRIMARY_ENABLED === "1" && options.juryLane !== true &&
    options.explicitOwnerSelection !== true && options.providerLane === undefined &&
    options.forbidMeteredFallback !== true && options.allowMeteredFallback !== false &&
    options.freeTierOnly !== true;
}

const ALLOWED_PARAMS = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls", "temperature",
  "top_p", "stop", "seed", "frequency_penalty", "presence_penalty",
  "response_format", "reasoning_effort", "stream", "stream_options",
  "max_tokens", "max_completion_tokens", "n",
]);

export function metaRequest(params: any, modelId: string = META_MODEL_ID): { payload: any; maximumUsd: number } {
  const model = metaModel(modelId);
  if (!model || (model.id === META_CONTRIBUTOR_MODEL_ID && process.env.META_CONTRIBUTOR_APPROVED !== "1")) {
    throw new Error("Meta model unavailable or Contributor approval absent");
  }
  if (!params || typeof params !== "object" || Array.isArray(params) ||
      Object.keys(params).some(key => !ALLOWED_PARAMS.has(key)) ||
      (params.n !== undefined && params.n !== 1) ||
      !Array.isArray(params.messages) || !params.messages.length || params.messages.length > 512) {
    throw new Error("Unsupported Meta completion request");
  }
  if (params.tools !== undefined && (!Array.isArray(params.tools) || params.tools.length > 128 ||
      params.tools.some((tool: any) => tool?.type !== "function" ||
        Object.keys(tool).some(key => !["type", "function"].includes(key))))) {
    throw new Error("Meta accepts native function tools only, not billable hosted tools");
  }
  if (params.tool_choice !== undefined && !["auto", "none"].includes(params.tool_choice)) {
    throw new Error("Meta supports auto tool selection only; required/named selection cannot be weakened");
  }
  const requested = params.max_completion_tokens ?? params.max_tokens ?? 4096;
  if (!Number.isSafeInteger(requested) || requested < 1 ||
      (params.max_completion_tokens !== undefined && params.max_tokens !== undefined &&
        params.max_completion_tokens !== params.max_tokens) ||
      (params.stream !== undefined && typeof params.stream !== "boolean") ||
      (params.reasoning_effort !== undefined &&
        !["minimal", "low", "medium", "high", "xhigh", "max"].includes(params.reasoning_effort))) {
    throw new Error("Invalid Meta output or reasoning limit");
  }
  const serialized = JSON.stringify(params);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > 1_000_000) throw new Error("Meta request exceeds the bounded input size");
  let media = false;
  const BENIGN_NULLABLE = ["refusal", "annotations", "audio", "function_call", "reasoning_content"];
  for (const message of params.messages) {
    if (message && typeof message === "object") {
      for (const key of BENIGN_NULLABLE) {
        const v = (message as any)[key];
        if (key in message && (v == null || (Array.isArray(v) && v.length === 0))) delete (message as any)[key];
      }
    }
    if (!message || typeof message !== "object" ||
        Object.keys(message).some(key => !["role", "content", "name", "tool_call_id", "tool_calls"].includes(key)) ||
        !["system", "developer", "user", "assistant", "tool"].includes(message.role)) {
      throw new Error("Unsupported Meta message");
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === "text" && typeof part.text === "string" &&
            Object.keys(part).every(key => ["type", "text"].includes(key))) continue;
        if (part?.type === "image_url" && typeof part.image_url?.url === "string" &&
            /^(https?:\/\/|data:image\/)/.test(part.image_url.url) &&
            Object.keys(part).every(key => ["type", "image_url"].includes(key)) &&
            Object.keys(part.image_url).every(key => ["url", "detail"].includes(key))) {
          media = true;
          continue;
        }
        throw new Error("Unsupported Meta media input");
      }
    } else if (typeof message.content !== "string" &&
        !(message.role === "assistant" && message.content == null && Array.isArray(message.tool_calls))) {
      throw new Error("Meta requires text, image, or native tool-call messages");
    }
  }
  const payload = JSON.parse(serialized);
  for (const message of payload.messages) {
    for (const key of BENIGN_NULLABLE) {
      if (key in message && (message[key] == null || (Array.isArray(message[key]) && message[key].length === 0))) delete message[key];
    }
  }
  delete payload.max_completion_tokens;
  payload.model = model.upstream;
  payload.max_tokens = Math.min(requested, META_MAX_OUTPUT);
  payload.reasoning_effort ??= model.effort;
  if (payload.tool_choice === "none") {
    delete payload.tools;
    delete payload.tool_choice;
    delete payload.parallel_tool_calls;
  }
  if (model.id === META_CONTRIBUTOR_MODEL_ID && payload.reasoning_effort === "max") {
    throw new Error("Meta Contributor does not support max reasoning");
  }
  if (payload.stream) payload.stream_options = { include_usage: true };
  // UTF-8 bytes conservatively bound text tokens. Media reserves the entire
  // model's 1M-token context instead of guessing a remote image's dimensions.
  const maximumUsd = ((media ? 1_048_576 : bytes + 4096) * model.input +
    payload.max_tokens * model.output) / 1_000_000;
  return { payload, maximumUsd };
}

export function metaUsageCost(usage: any, modelId: string = META_MODEL_ID): number | undefined {
  const model = metaModel(modelId);
  if (!model) return undefined;
  if (!Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens < 0 ||
      !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens < 0 ||
      usage.prompt_tokens + usage.completion_tokens === 0) return undefined;
  // Deliberately do not deduct caching from the spend hold; ledger is conservative.
  return (usage.prompt_tokens * model.input +
    usage.completion_tokens * model.output) / 1_000_000;
}
