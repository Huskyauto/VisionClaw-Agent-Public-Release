/**
 * Tools-layer-split S25w — safety-layer-domain tool definitions.
 *
 * The 2 emotional-safety intervention tools (`detect_emotional_state`,
 * `grounding_intervention`) — the shame-spiral detect → ground cluster backed
 * solely by `server/safety-layer` (`detectEmotionalState` /
 * `generateGroundingIntervention`) — one coherent domain. (`stress_intervention`,
 * the adjacent legacy arm, calls a function defined INSIDE `server/tools.ts`, not
 * a separate lib, so it stays legacy; `track_intervention` reads `params._userId`,
 * which ToolContext does not carry — it needs a dedicated trust-seam slice and
 * stays legacy too; the fatigue pair `detect_fatigue`/`micro_sabbatical` is backed
 * by `server/skill-evolution`, a DIFFERENT lib — excluded.)
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals); the facade now re-imports these const refs so the
 * LLM-facing surface (names, descriptions, parameter schemas, ordering) is
 * byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const detectEmotionalStateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "detect_emotional_state",
    description: "Safety: scan a user message for shame-spiral / catastrophic / self-attack language patterns. Returns intensity (low/medium/high), pattern names matched, and whether intervention is needed. CRITICAL: if needsImmediateIntervention=true, the user expressed distress requiring an immediate grounding response — pair with grounding_intervention.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The user message to scan." },
      },
      required: ["message"],
    },
  },
};

export const groundingInterventionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "grounding_intervention",
    description: "Safety: generate a grounding intervention script (somatic / breathwork / sensory) for a detected shame-spiral state. Call AFTER detect_emotional_state confirms intervention is needed. Selects intervention based on intensity. Returns script, action type, and follow-up prompt.",
    parameters: {
      type: "object",
      properties: {
        intensity: { type: "string", enum: ["low", "medium", "high"], description: "Intensity from detect_emotional_state." },
        needs_immediate: { type: "boolean", description: "Whether immediate intervention is required (from detect_emotional_state)." },
        patterns: { type: "array", items: { type: "string" }, description: "Matched pattern names from detect_emotional_state." },
        previous_intervention_ids: { type: "array", items: { type: "string" }, description: "IDs already offered, to avoid repetition." },
      },
      required: [],
    },
  },
};

export const safetyDomainDefinitions: ToolDefinition[] = [
  detectEmotionalStateDefinition,
  groundingInterventionDefinition,
];
