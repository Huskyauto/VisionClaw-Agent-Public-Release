/**
 * Tools-layer-split S25d — commitment-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const commitmentCreateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "commitment_create",
    description: "R104 — Register a long-running commitment (an obligation a persona is taking on that will outlive the current chat turn). The platform tracks status, expects periodic heartbeats, and escalates to the owner via the daily digest if a commitment passes its due_at without a recent heartbeat. Use this whenever an agent says 'I will do X by Y' to create a real audit trail Bob (or another persona) can inspect later.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "What is being promised, in plain language." },
        due_at: { type: "string", description: "Optional ISO timestamp by which the commitment should be fulfilled. If omitted, no auto-escalation." },
        heartbeat_interval_ms: { type: "number", description: "How long the platform should tolerate silence before considering the commitment stale. Default 1h. Min 5min." },
        persona: { type: "string", description: "Optional override; defaults to the calling persona." },
      },
      required: ["description"],
    },
  },
};

export const commitmentListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "commitment_list",
    description: "R104 — List commitments for the calling tenant. Optionally filter by status (active|paused|completed|cancelled|escalated).",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: ["active", "paused", "completed", "cancelled", "escalated"], description: "Optional status filter." } },
      required: [],
    },
  },
};

export const commitmentHeartbeatDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "commitment_heartbeat",
    description: "R104 — Record a heartbeat against an active commitment: a short note explaining current progress, optionally with structured evidence (links, ids, metrics). Resets the staleness timer.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Commitment id." },
        note: { type: "string", description: "Brief progress note." },
        evidence: { description: "Optional JSON evidence (object/array) — file paths, ids, scores, etc." },
      },
      required: ["id", "note"],
    },
  },
};

export const commitmentCompleteDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "commitment_complete",
    description: "R104 — Mark a commitment completed. Include a final note summarizing what was delivered.",
    parameters: {
      type: "object",
      properties: { id: { type: "number" }, note: { type: "string", description: "Final summary." } },
      required: ["id"],
    },
  },
};

export const commitmentCancelDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "commitment_cancel",
    description: "R104 — Cancel a commitment that will not be fulfilled. Provide a reason — this leaves a clear audit trail.",
    parameters: {
      type: "object",
      properties: { id: { type: "number" }, reason: { type: "string", description: "Why it's being cancelled." } },
      required: ["id", "reason"],
    },
  },
};

export const commitmentDomainDefinitions: ToolDefinition[] = [
  commitmentCreateDefinition,
  commitmentListDefinition,
  commitmentHeartbeatDefinition,
  commitmentCompleteDefinition,
  commitmentCancelDefinition,
];
