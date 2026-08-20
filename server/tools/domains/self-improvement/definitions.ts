/**
 * Tools-layer-split S26b — self-improvement-domain tool definitions.
 *
 * The 3 self-improvement tools (`log_experiment`, `get_experiments`,
 * `run_self_improvement`) — a single coherent family backed solely by
 * `server/self-improvement` (`logExperiment` / `getExperimentHistory` /
 * `runSelfImprovementCycle` + signal/stagnation helpers).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const logExperimentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "log_experiment",
    description: "Use AFTER trying a non-trivial new approach (prompt change, tool combo, workflow tweak) so the platform learns what worked. Captures hypothesis, approach, and outcome into the experiments log. Returns the recorded experiment id. Pair with get_experiments to retrieve later. Skip for routine work — only meaningful tries deserve a log entry.",
    parameters: {
      type: "object",
      properties: {
        hypothesis: { type: "string", description: "What you hypothesize will improve (e.g., 'Adding chain-of-thought will improve accuracy')" },
        approach: { type: "string", description: "The specific change or technique applied" },
        category: { type: "string", description: "Category: prompt_optimization, response_quality, tool_usage, persona_tuning, or general" },
        metric: { type: "string", description: "What metric was measured (e.g., accuracy, completeness)" },
        baselineValue: { type: "string", description: "Baseline measurement before the experiment" },
        resultValue: { type: "string", description: "Result measurement after the experiment" },
        status: { type: "string", enum: ["kept", "reverted", "inconclusive", "running"], description: "Outcome status" },
        outcome: { type: "string", description: "Human-readable summary of what happened" },
      },
      required: ["hypothesis", "approach", "category", "status"],
    },
  },
};

export const getExperimentsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_experiments",
    description: "Use BEFORE trying an approach that might already have been tried — also when answering \"what have we learned about X\". Returns the experiment log filtered by topic/persona/date with hypothesis, approach, outcome, and timestamp. Search this before reinventing an approach the platform tested last week.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category (prompt_optimization, response_quality, tool_usage, persona_tuning, general)" },
        limit: { type: "number", description: "Max experiments to return (default 20)" },
      },
      required: [],
    },
  },
};

export const runSelfImprovementDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_self_improvement",
    description: "Launch an autonomous self-improvement cycle with signal extraction and stagnation detection. Scans runtime logs for error patterns, detects repeated failures, auto-selects evolution strategy (balanced/innovate/harden/repair-only), then runs A/B experiments. Inspired by Karpathy's autoresearch + EvoMap's Capability Evolver.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["prompt_optimization", "response_quality", "tool_usage", "persona_tuning"], description: "What area to optimize (default: response_quality)" },
        personaId: { type: "number", description: "Optional persona ID to optimize for a specific agent" },
        strategy: { type: "string", enum: ["balanced", "innovate", "harden", "repair-only"], description: "Evolution strategy preset. If omitted, auto-selects based on runtime signals and stagnation detection." },
      },
      required: [],
    },
  },
};

export const selfImprovementDomainDefinitions: ToolDefinition[] = [
  logExperimentDefinition,
  getExperimentsDefinition,
  runSelfImprovementDefinition,
];
