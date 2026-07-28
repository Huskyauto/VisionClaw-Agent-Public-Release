/**
 * Tools-layer-split S25v — minerva-planner-domain tool definitions.
 *
 * The 3 Minerva planning tools (`create_plan`, `list_plans`, `get_plan`) — the
 * plan compose/list/read cluster backed solely by `server/minerva-planner`
 * (`createPlan`/`listPlans`/`getPlan`) — one coherent domain. (`get_minerva_roster`
 * is NOT in this slice: it is backed by `server/capability-registry`, a different
 * lib, so it stays legacy.)
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (names, descriptions, parameter
 * schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createPlanDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_plan",
    description: "Minerva's planner: compose a structured multi-step plan for an objective. Each plan step names an agent, tools, dependencies, cost estimate, and time estimate. Plans are persisted with status=awaiting_approval, a roster snapshot, and emit the plan.proposed event — waking Felix for approve/revise/reject. Minerva does NOT execute work; she proposes plans. Use this when you have a multi-step goal that should go through Felix for approval.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The goal/objective this plan addresses. Be specific — include what done looks like." },
        source: { type: "string", enum: ["user", "agent", "proactive", "event"], description: "Where the plan request originated (default: agent)." },
        sourceRef: { type: "string", description: "Optional reference — e.g. chat conversation ID, event ID, or task ID that triggered planning." },
        parentPlanId: { type: "number", description: "Optional: set when this plan is a revision of a prior plan (Felix's revision feedback is incorporated)." },
        revisionFeedback: { type: "string", description: "Required if parentPlanId is set — Felix's revision feedback driving this new plan version." },
      },
      required: ["objective"],
    },
  },
};

export const listPlansDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_plans",
    description: "Use when Bob asks \"what is Minerva planning\" or \"what is Felix deciding\", before approving any plan to see related history, or when auditing what plans came through this week. Returns plans for this tenant with status (awaiting_approval | approved | executing | rejected | revising | revised | completed | failed). Filter by status to surface decision queues — `awaiting_approval` is the actionable queue.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["awaiting_approval", "approved", "executing", "rejected", "revising", "revised", "completed", "failed"], description: "Optional: filter by plan status. `awaiting_approval` = pending Felix decision; `executing` = plan-executor is running it; `revising` = superseded by a child revision plan; `revised` = the child revision plan itself." },
        limit: { type: "number", description: "Max plans to return (default: 20)." },
      },
      required: [],
    },
  },
};

export const getPlanDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_plan",
    description: "Use when drilling into one specific plan after list_plans surfaced it — typically to read the full step list before approving, to debug a failure, or to extract Minerva's reasoning for replication. Returns plan_json (steps, agents, tools, costs, times) and Felix's decision metadata (rationale, simulator score, weak links).",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "number", description: "The plan ID to fetch." },
      },
      required: ["planId"],
    },
  },
};

export const minervaDomainDefinitions: ToolDefinition[] = [
  createPlanDefinition,
  listPlansDefinition,
  getPlanDefinition,
];
