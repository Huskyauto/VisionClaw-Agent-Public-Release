/**
 * Tools-layer-split S26c — wake-scheduler-domain tool definitions.
 *
 * The 3 durable-wake tools (`schedule_wake`, `cancel_wake`, `list_wakes`)
 * — a single coherent cluster backed solely by `server/agentic/wake-scheduler`
 * (`scheduleWake` / `cancelWake` / `listWakes`; `runDueWakes` is the internal
 * heartbeat cron, not a tool).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const scheduleWakeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "schedule_wake",
    description: "Schedule a durable future wake-up: the system will autonomously resume work toward `goal` at `wakeAt`, even days later, surviving restarts. Use for follow-ups ('check on X tomorrow', 'in 3 days draft the report'). Optionally condition-based: set `triggerEvent` to ALSO wake early the moment a matching platform event fires (e.g. 'email.replied', 'payment.failed', 'lead.qualified', or a wildcard like 'email.*') — wakeAt then acts as the backstop deadline. Persisted in the DB and scanned by the heartbeat.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What to do when this wake fires (imperative, self-contained)." },
        wakeAt: { type: "string", description: "ISO timestamp when to wake (must be in the future). With triggerEvent set, this is the backstop deadline if the event never arrives." },
        kind: { type: "string", description: "Optional category tag (e.g. 'followup', 'reminder', 'recheck')." },
        maxAttempts: { type: "number", minimum: 1, maximum: 10, description: "Retries if the wake action fails (default 3)." },
        triggerEvent: { type: "string", description: "Optional event-bus event type that fires this wake early — exact ('email.replied') or category wildcard ('email.*')." },
        triggerFilter: { type: "object", description: "Optional JSON containment filter on the triggering event's data payload (only events whose data contains these key/values match). Requires triggerEvent." },
      },
      required: ["goal", "wakeAt"],
    },
  },
};

export const cancelWakeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cancel_wake",
    description: "Cancel a previously scheduled wake by its id (from schedule_wake / list_wakes).",
    parameters: { type: "object", properties: { id: { type: "number", description: "wake schedule id" } }, required: ["id"] },
  },
};

export const listWakesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_wakes",
    description: "List this tenant's scheduled wakes, optionally filtered by status (pending/fired/cancelled/failed).",
    parameters: { type: "object", properties: { status: { type: "string", description: "Optional status filter." } } },
  },
};

export const wakeSchedulerDomainDefinitions: ToolDefinition[] = [
  scheduleWakeDefinition,
  cancelWakeDefinition,
  listWakesDefinition,
];
