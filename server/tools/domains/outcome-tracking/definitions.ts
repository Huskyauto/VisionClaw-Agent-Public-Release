/**
 * Tools-layer-split S26e — outcome-tracking-domain tool definition.
 *
 * The single outcome-learning tool (`track_outcome`) — backed solely by
 * `server/outcome-tracker` (`trackAction` / `recordOutcome` / `getOutcomes` /
 * `getPatterns`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const trackOutcomeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "track_outcome",
    description: "Track an action's expected outcome for later measurement. Use after performing trackable actions (emails sent, content published, deals proposed, outreach completed) to enable learning from results. You can also record measured outcomes when results become available.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["track", "record_result", "view", "view_patterns"], description: "Action to perform" },
        actionType: { type: "string", description: "Type: email_sent, content_published, outreach_sent, deal_proposal, task_completed" },
        actionRef: { type: "string", description: "Reference ID (email ID, URL, deal ID)" },
        description: { type: "string", description: "What was done" },
        expectedOutcome: { type: "string", description: "Expected result (e.g., 'prospect replies within 3 days')" },
        expectedMetric: { type: "string", description: "Metric to track: reply_rate, engagement, conversion, views" },
        expectedValue: { type: "number", description: "Predicted value" },
        outcomeId: { type: "number", description: "ID of outcome to update (for record_result)" },
        actualValue: { type: "number", description: "Measured value (for record_result)" },
        actualOutcome: { type: "string", description: "What actually happened (for record_result)" },
        status: { type: "string", enum: ["success", "partial", "failure", "unknown"], description: "Result status" },
      },
      required: ["action"],
    },
  },
};

export const outcomeTrackingDomainDefinitions: ToolDefinition[] = [
  trackOutcomeDefinition,
];
