/**
 * Tools-layer-split S26e — skill-evolution-domain tool definition.
 *
 * The single tool-performance tool (`tool_performance_report`) — backed solely by
 * `server/skill-evolution` (`getToolPerformanceReport` / `runEvolutionCycle` /
 * `getEvolutionSummary`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const toolPerformanceReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "tool_performance_report",
    description: "Get a performance report for all tracked tools — success rates, failure rates, average durations, and last error messages. Use to identify underperforming tools, diagnose recurring failures, or monitor platform health. Can also trigger a skill evolution cycle to auto-optimize underperforming tools.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["report", "evolve", "summary"], description: "What to do: 'report' shows performance data, 'evolve' triggers optimization cycle, 'summary' shows evolution status." },
      },
      required: [],
    },
  },
};

// Tools-layer-split S26g — wellness fatigue pair (pure transforms, SEAM: NONE).
// Both backed by server/skill-evolution (detectUserFatigue /
// generateMicroSabbaticalIntervention); moved VERBATIM from inline literals.
export const detectFatigueDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "detect_fatigue",
    description: "Wellness: scan a user message for late-night fatigue / craving / stress signals. Returns detected boolean, confidence (0-100), fatigue type (late_night | general_exhaustion | stress_craving), and matched keywords. Use BEFORE responding when user is messaging late at night or mentions tiredness/cravings, then pair with micro_sabbatical for an intervention.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The user message to scan." },
      },
      required: ["message"],
    },
  },
};

export const microSabbaticalDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "micro_sabbatical",
    description: "Wellness: generate a sensory-rich micro-sabbatical intervention (60-120 sec) to replace a craving with a 'receive instead of reach' experience. Call AFTER detect_fatigue confirms fatigue. Returns an intervention with sensory focus (auditory/visual/tactile/thermal). Pairs with track_intervention to log effectiveness.",
    parameters: {
      type: "object",
      properties: {
        fatigue_type: { type: "string", enum: ["late_night", "general_exhaustion", "stress_craving"], description: "Type of fatigue detected (from detect_fatigue)." },
        previous_intervention_ids: { type: "array", items: { type: "string" }, description: "IDs of interventions already offered in this conversation, to avoid repetition." },
      },
      required: [],
    },
  },
};

export const skillEvolutionDomainDefinitions: ToolDefinition[] = [
  toolPerformanceReportDefinition,
  detectFatigueDefinition,
  microSabbaticalDefinition,
];
