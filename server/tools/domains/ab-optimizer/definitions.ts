/**
 * Tools-layer-split S26b — ab-optimizer-domain tool definitions.
 *
 * The 2 A/B-optimizer tools (`create_ab_experiment`, `record_ab_event`) — a
 * single coherent cluster backed solely by `server/ab-optimizer`
 * (`createAbExperiment` / `recordAbEvent`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createAbExperimentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_ab_experiment",
    description: "Start an A/B experiment over 2+ content variants (e.g. landing copy, email subject). Record impressions/conversions with record_ab_event; the heartbeat auto-concludes once min-sample + min-age are met, picks the winner, and queues the winning variant as a reviewable SOP (proposed skill).",
    parameters: {
      type: "object",
      properties: {
        hypothesis: { type: "string", description: "What you're testing." },
        variants: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, content: { type: "string" } }, required: ["label", "content"] },
          description: "At least 2 variants.",
        },
        metric: { type: "string", description: "Metric to optimize (default conversion_rate)." },
        wedge: { type: "string", description: "Optional wedge/product tag." },
        minSample: { type: "number", description: "Min impressions per variant before concluding." },
        minAgeHours: { type: "number", description: "Min experiment age in hours before concluding." },
      },
      required: ["hypothesis", "variants"],
    },
  },
};

export const recordAbEventDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "record_ab_event",
    description: "Record an impression or conversion for one variant of a running A/B experiment.",
    parameters: {
      type: "object",
      properties: {
        experimentId: { type: "number", description: "experiment id from create_ab_experiment." },
        variantLabel: { type: "string", description: "Which variant." },
        kind: { type: "string", enum: ["impression", "conversion"], description: "Event type." },
      },
      required: ["experimentId", "variantLabel", "kind"],
    },
  },
};

export const abOptimizerDomainDefinitions: ToolDefinition[] = [
  createAbExperimentDefinition,
  recordAbEventDefinition,
];
