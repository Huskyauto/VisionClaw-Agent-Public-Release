import { HIGH_END_WORK_MODEL_ID } from "./chat-model-default";
import type { ProviderLane } from "./providers";

type FelixModelContext = {
  tenantId: number;
  ownerTenantId: number;
  personaId: number | null;
  /** Explicit override for tests; the production kill switch is default-on. */
  enabled?: boolean;
};

/**
 * Owner Felix has a per-turn high-end quality floor for cheap models. This
 * lifts already-open Flash threads (notably Spark's API thread) without
 * changing saved model selections. Exact flag 0 restores the old route on
 * the next turn, including for conversations created while this was on.
 */
export function selectFelixModel(model: string, context: FelixModelContext): string {
  if ((context.enabled ?? process.env.FELIX_HIGH_END_MODEL_ENABLED !== "0") === false ||
      context.tenantId !== context.ownerTenantId ||
      context.personaId !== 2) {
    return model;
  }
  return model === "deepseek/deepseek-v4.1-flash" ||
    model === "gpt-5.4"
    ? HIGH_END_WORK_MODEL_ID
    : model;
}

export type FelixExpertLane = Readonly<{ modelId: string; actualModelId: string; providerLane: ProviderLane }>;

/** Owner-Felix agent ingress is pinned to Replit, never an external fallback. */
export function getFelixExpertLanes(
  context: FelixModelContext & { source?: string },
): readonly FelixExpertLane[] | null {
  if ((context.enabled ?? process.env.FELIX_HIGH_END_MODEL_ENABLED !== "0") === false ||
      context.tenantId !== context.ownerTenantId ||
      context.personaId !== 2 ||
      (context.source !== "api-v1" && context.source !== "a2a")) {
    return null;
  }
  return [
    { modelId: "gpt-5.4", actualModelId: "gpt-5.4", providerLane: "replit" },
  ];
}