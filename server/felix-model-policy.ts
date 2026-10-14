import { DEFAULT_CHAT_MODEL_ID, HIGH_END_WORK_MODEL_ID } from "./chat-model-default";
import type { ProviderLane } from "./providers";

type FelixModelContext = {
  tenantId: number;
  ownerTenantId: number;
  personaId: number | null;
  /** Explicit override for tests; the production kill switch is default-on. */
  enabled?: boolean;
  content?: string;
};

/**
 * Owner work upgrades legacy preferences to Luna/Sol per turn. This is a
 * requested route, not an unconditional serving floor: approved provider
 * fallbacks can differ and must be reported as such. This
 * lifts already-open Flash threads (notably Spark's API thread) without
 * changing saved model selections. Exact flag 0 restores the old route on
 * the next turn, including for conversations created while this was on.
 */
export function selectOwnerWorkModel(model: string, context: FelixModelContext): string {
  const enabled = context.enabled ?? (
    process.env.OWNER_WORK_MODEL_ROUTING_ENABLED !== "0" &&
    (context.personaId !== 2 || process.env.FELIX_HIGH_END_MODEL_ENABLED !== "0")
  );
  if (!enabled || !Number.isSafeInteger(context.ownerTenantId) || context.ownerTenantId <= 0 ||
      context.tenantId !== context.ownerTenantId) {
    return model;
  }
  // Only routine/legacy defaults are lifted. Explicit stronger selections and
  // auto-routing retain their existing semantics. Never mutate saved choices.
  if (![DEFAULT_CHAT_MODEL_ID, "deepseek/deepseek-v4.1-flash", "gpt-5.4", "gpt-6-luna"].includes(model)) return model;
  const task = (context.content ?? "").slice(0, 24_000);
  const demanding = /\b(?:comprehensive\s+(?:security\s+)?audit|tenant\s+isolation|multi[- ](?:step|module)|architecture\s+(?:review|refactor)|jury(?:\s+triage)?|complex\s+(?:project|investigation))\b/i.test(task);
  return demanding ? HIGH_END_WORK_MODEL_ID : DEFAULT_CHAT_MODEL_ID;
}

export function selectFelixModel(model: string, context: FelixModelContext): string {
  return context.personaId === 2 ? selectOwnerWorkModel(model, context) : model;
}

export type FelixExpertLane = Readonly<{ modelId: string; actualModelId: string; providerLane: ProviderLane }>;

/** Subscription-first owner work; no new automatic metered-key fallback. */
export function getFelixExpertLanes(
  context: FelixModelContext & { source?: string; model?: string },
): readonly FelixExpertLane[] | null {
  if ((context.enabled ?? (
        process.env.FELIX_HIGH_END_MODEL_ENABLED !== "0" &&
        process.env.OWNER_WORK_MODEL_ROUTING_ENABLED !== "0")) === false ||
      !Number.isSafeInteger(context.ownerTenantId) || context.ownerTenantId <= 0 ||
      context.tenantId !== context.ownerTenantId ||
      context.personaId !== 2 ||
      (context.source !== "api-v1" && context.source !== "a2a")) {
    return null;
  }
  const requested = context.model === "auto" ? DEFAULT_CHAT_MODEL_ID : context.model || DEFAULT_CHAT_MODEL_ID;
  const selected = selectFelixModel(requested, context);
  if (selected !== DEFAULT_CHAT_MODEL_ID && selected !== HIGH_END_WORK_MODEL_ID) return null;
  return [
    { modelId: selected, actualModelId: selected, providerLane: "profundo" },
    // Retain the previously authorized fallback, not a new API-key spend lane.
    { modelId: "gpt-5.4", actualModelId: "gpt-5.4", providerLane: "replit" },
  ];
}