/**
 * Tools-layer-split S26d — recurring-messages-domain tool definitions.
 *
 * The 3 recurring-schedule tools (`schedule_message`, `list_scheduled_messages`,
 * `cancel_scheduled_message`) — a single coherent cluster backed solely by
 * `server/recurring-messages` (`createScheduledMessage` / `listScheduledMessages` /
 * `cancelScheduledMessage`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const scheduleMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "schedule_message",
    description: "Schedule a recurring message to a user at a cadence. Accepts natural language ('every Monday at 7am') OR a literal cron expression. The prompt can be a literal message OR (if expandViaPersona is set) a prompt that gets run through that persona at delivery time to generate fresh content. Examples: daily morning check-in, weekly weigh-in reminder, hourly motivation ping.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label for this scheduled job" },
        naturalSchedule: { type: "string", description: "Natural-language cadence, e.g. 'every weekday at 7am' or 'every Monday at 9'" },
        cron: { type: "string", description: "OR a literal cron expression (5 fields)" },
        prompt: { type: "string", description: "Either the literal message OR a prompt for the persona to expand at delivery time" },
        expandViaPersona: { type: "number", description: "If set, send `prompt` through this persona at delivery time and ship the response. Omit for a literal message." },
        channel: { type: "string", enum: ["telegram", "sms", "whatsapp", "email", "web"] },
        telegramChatId: { type: "number" },
        phoneNumber: { type: "string", description: "E.164 phone for sms/whatsapp" },
        email: { type: "string" },
        conversationId: { type: "number" },
      },
      required: ["title", "prompt", "channel"],
    },
  },
};

export const listScheduledMessagesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_scheduled_messages",
    description: "List all recurring scheduled messages for the current tenant. Returns id, title, cron, next_run_at, status. Use before scheduling to avoid duplicates.",
    parameters: { type: "object", properties: { activeOnly: { type: "boolean", description: "Only show active jobs. Default false." } } },
  },
};

export const cancelScheduledMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cancel_scheduled_message",
    description: "Use when Bob says \"stop sending those\" — also when retiring a stale automation or replacing it with a new schedule. Permanent: the schedule row is deleted, not paused. Returns success. If a temporary pause is wanted instead, ask Bob — pausing requires a different op.",
    parameters: { type: "object", properties: { id: { type: "number", description: "Scheduled message id" } }, required: ["id"] },
  },
};

export const recurringMessagesDomainDefinitions: ToolDefinition[] = [
  scheduleMessageDefinition,
  listScheduledMessagesDefinition,
  cancelScheduledMessageDefinition,
];
