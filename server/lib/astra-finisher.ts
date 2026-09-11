import { ADMIN_TENANT_ID } from "../auth";

export type AstraServiceTier = "flex" | "default" | "none";

export interface AstraFinishInput {
  tenantId: number;
  preparedDraft: string;
  evidence: string;
  task: string;
  cacheKey?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
  allowStandardFallback?: boolean;
}

export interface AstraFinishResult {
  text: string;
  serviceTier: AstraServiceTier;
  usedAstra: boolean;
}

interface AstraFinisherDeps {
  enabled?: boolean;
  createResponse?: (params: Record<string, any>, options?: Record<string, any>) => Promise<any>;
}

const MAX_DRAFT_CHARS = 72_000;
const MAX_EVIDENCE_CHARS = 48_000;
const MIN_ASTRA_OUTPUT_TOKENS = 4_000;
const MAX_ASTRA_OUTPUT_TOKENS = 25_000;

function boundedText(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function getAstraOutputTokenLimit(preparedDraft: string): number | null {
  const boundedDraft = preparedDraft.trim().slice(0, MAX_DRAFT_CHARS);
  // OpenAI tokenizers operate on UTF-8 bytes, so byte length is a conservative
  // upper bound even for dense code, punctuation, CJK, emoji, and ZWJ text.
  const estimatedDraftTokens = Buffer.byteLength(boundedDraft, "utf8");
  const reasoningHeadroom = Math.max(3_000, Math.ceil(estimatedDraftTokens * 0.5));
  const requiredTokens = Math.max(MIN_ASTRA_OUTPUT_TOKENS, estimatedDraftTokens + reasoningHeadroom);
  return requiredTokens <= MAX_ASTRA_OUTPUT_TOKENS ? requiredTokens : null;
}

function preparedFallback(input: AstraFinishInput): AstraFinishResult {
  return {
    text: input.preparedDraft,
    serviceTier: "none",
    usedAstra: false,
  };
}

function isConfirmedFlexCapacityFailure(error: any): boolean {
  const status = Number(error?.status);
  const code = String(error?.code || error?.error?.code || "").toLowerCase();
  return status === 429 && /resource_unavailable|overload|capacity/.test(code);
}

export async function finishWithAstra(
  input: AstraFinishInput,
  deps: AstraFinisherDeps = {},
): Promise<AstraFinishResult> {
  const enabled = deps.enabled ?? process.env.ASTRA_FINISHER_ENABLED === "1";
  if (!enabled || input.tenantId !== ADMIN_TENANT_ID || !input.preparedDraft.trim()) {
    return preparedFallback(input);
  }

  const adaptiveLimit = getAstraOutputTokenLimit(input.preparedDraft);
  if (adaptiveLimit === null) {
    console.warn("[astra-finisher] Prepared draft cannot safely fit the 25K output ceiling; preserving verified draft");
    return preparedFallback(input);
  }

  let createResponse: NonNullable<AstraFinisherDeps["createResponse"]> | undefined = deps.createResponse;
  if (!createResponse) {
    const { getClientForModel } = await import("../providers");
    const { client } = await getClientForModel("gpt-6-astra", input.tenantId, {
      explicitOwnerSelection: true,
      platformAdminVerified: true,
      meteredOverride: true,
    });
    createResponse = client.responses.create.bind(client.responses) as NonNullable<AstraFinisherDeps["createResponse"]>;
  }

  const requestedOutputTokens = Number.isFinite(input.maxOutputTokens)
    ? Math.floor(input.maxOutputTokens!)
    : adaptiveLimit;
  const maxOutputTokens = Math.max(
    adaptiveLimit,
    Math.min(requestedOutputTokens, MAX_ASTRA_OUTPUT_TOKENS),
  );
  const baseParams = {
    model: "gpt-6-astra",
    instructions:
      "You are the final reasoning and quality layer. The draft and evidence were prepared by other models. " +
      "Resolve contradictions, correct unsupported claims, improve the reasoning, and return only the complete final deliverable. " +
      "Do not mention this review process and do not invent evidence.",
    input:
      `TASK\n${boundedText(input.task, 8_000)}\n\n` +
      `VERIFIED EVIDENCE\n${boundedText(input.evidence, MAX_EVIDENCE_CHARS)}\n\n` +
      `PREPARED DRAFT\n${boundedText(input.preparedDraft, MAX_DRAFT_CHARS)}`,
    reasoning: { effort: input.reasoningEffort ?? "high" },
    max_output_tokens: maxOutputTokens,
    prompt_cache_key: input.cacheKey || "visionclaw-astra-finisher-v1",
    prompt_cache_retention: "24h",
  };

  const run = async (serviceTier: "flex" | "default") => {
    const response = await createResponse!({
      ...baseParams,
      service_tier: serviceTier,
    }, {
      timeout: serviceTier === "flex" ? 15 * 60_000 : 60_000,
      maxRetries: 0,
    });
    if (response?.status && response.status !== "completed") {
      throw new Error(`GPT-6 Astra ${serviceTier} response was ${String(response.status)}`);
    }
    const text = String(response?.output_text || "").trim();
    const minimumUsefulLength = Math.max(150, Math.min(1_000, Math.floor(input.preparedDraft.length * 0.25)));
    if (text.length < minimumUsefulLength) {
      throw new Error(`GPT-6 Astra ${serviceTier} returned an incomplete final answer`);
    }
    return {
      text,
      serviceTier,
      usedAstra: true,
    } satisfies AstraFinishResult;
  };

  try {
    return await run("flex");
  } catch (error: any) {
    console.warn(`[astra-finisher] Flex finalization failed; preserving prepared draft: ${error?.message}`);
    if (input.allowStandardFallback !== true || !isConfirmedFlexCapacityFailure(error)) {
      return preparedFallback(input);
    }
    try {
      return await run("default");
    } catch (fallbackError: any) {
      console.error("[astra-finisher] Standard fallback failed; preserving prepared draft", fallbackError);
      return preparedFallback(input);
    }
  }
}