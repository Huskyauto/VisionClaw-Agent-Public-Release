/**
 * Tools-layer-split S25n — agent-eval-domain tool definitions.
 *
 * The 2 contiguous persona-benchmark tools (`run_agent_eval`,
 * `get_eval_report`) — both backed by `server/agent-eval` (runEval /
 * getEvalReport), one coherent cluster (persona quality benchmarking).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const runAgentEvalDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "run_agent_eval",
    description: "Benchmark an agent persona against standardized eval tasks. Measures pass rate, score, and response time. Use to compare persona performance or validate quality after changes.",
    parameters: {
      type: "object",
      properties: {
        persona_id: { type: "number", description: "ID of the persona to evaluate" },
        runs: { type: "number", description: "Number of runs per task (default: 1, max: 3)" },
      },
      required: ["persona_id"],
    },
  },
};

export const getEvalReportDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "get_eval_report",
    description: "Use BEFORE Bob ships a persona prompt change, after running a benchmark sweep, or when answering \"is the platform getting better or worse over time\". Returns pass rates, per-task scores, and timing across all 16 personas. Drops in any score warrant a retro before promoting changes.",
    parameters: {
      type: "object",
      properties: {
        persona_id: { type: "number", description: "Optional: filter to a specific persona" },
      },
      required: [],
    },
  },
};

/** All agent-eval-domain definitions, in facade splice order. */
export const agentEvalDomainDefinitions: ToolDefinition[] = [
  runAgentEvalDefinition,
  getEvalReportDefinition,
];
