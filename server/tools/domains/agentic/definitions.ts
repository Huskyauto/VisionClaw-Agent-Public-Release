/**
 * Tools-layer-split S20 — agentic-domain tool definitions (first batch).
 *
 * Selection: the 3 self-healing supervisor tools that cluster contiguously in
 * both the legacy TOOL_DEFINITIONS array and the legacy switch — `self_heal`,
 * `self_heal_log`, `self_heal_inspect`. In the facade each was an individual
 * switch arm that read `params._tenantId` (fail-closed guard) and dispatched
 * into `./agentic/self-heal`; `self_heal` additionally read
 * `params._invokedByModel` to label the trigger source. The sole authz/trust
 * channel is `_tenantId` (covered by the trusted ToolContext seam);
 * `_invokedByModel` is a telemetry label NOT in the dispatcher's
 * TRUST_SIGNAL_KEYS strip list, so it survives on `params` exactly as before.
 *
 * The remaining agentic-flavoured tools stay legacy per the smallest-safe-batch
 * precedent: `delegate_task`, `autonomous_task`, `lobster`, `plan_and_execute`,
 * `create_plan`, `self_diagnose`, `orchestrate`, `debate`, `plan_deliverable`,
 * `plan_graph_edit`/`plan_graph_query` are scattered (not contiguous with this
 * cluster) and carry heavier deps / trust seams — they migrate in later agentic
 * passes.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const selfHealDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "self_heal",
    description: "Manually trigger Blueprint's self-healing supervisor on a failed run or arbitrary failure context. Diagnoses the failure and proposes a fix (replan, custom_tool, code_snippet, escalate, give_up). Reversible fixes auto-apply; irreversible fixes auto-escalate via request_approval. All attempts are logged to the self_heal_attempts table for future review and possible promotion into platform code. Use this for manual recovery of stuck runs or when you want a second opinion on a failure.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "number", description: "Optional: the agent_runs.id to attach the heal to (recommended for resumable runs)." },
        originalGoal: { type: "string", description: "What the run was trying to achieve." },
        error: { type: "string", description: "The error message that caused the failure." },
        lastToolName: { type: "string", description: "Optional: the tool that failed last." },
        lastToolArgs: { type: "object", description: "Optional: the arguments passed to the failing tool." },
        recentSteps: { type: "array", items: { type: "object" }, description: "Optional: array of recent step objects from the run timeline." },
      },
      required: ["originalGoal", "error"],
    },
  },
};

export const selfHealLogDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "self_heal_log",
    description: "List past self-heal attempts for the tenant — outcomes, fix types, and which ones are candidates for promotion into platform code. Use this to audit which auto-fixes worked, which failed, and what gaps the agents have filled in on the fly.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many records to return (default 50, max 200)." },
        runId: { type: "number", description: "Optional: filter to a specific run." },
        outcome: { type: "string", enum: ["diagnosing","executing","succeeded","failed","awaiting_approval","blocked_no_run","diagnosis_failed"], description: "Optional: filter by outcome." },
      },
      required: [],
    },
  },
};

export const selfHealInspectDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "self_heal_inspect",
    description: "Read the full record of one self-heal attempt — diagnosis, proposed fix, generated code snippet (if any), and outcome. Use this when you want to see whether a past auto-fix should be promoted into the main platform.",
    parameters: {
      type: "object",
      properties: {
        attemptId: { type: "number", description: "The self_heal_attempts.id to inspect." },
        markPromoted: { type: "boolean", description: "If true and outcome was succeeded, mark this attempt as 'promoted to platform' so it won't be flagged again." },
      },
      required: ["attemptId"],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const agenticDomainDefinitions: ToolDefinition[] = [
  selfHealDefinition,
  selfHealLogDefinition,
  selfHealInspectDefinition,
];
