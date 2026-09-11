/**
 * Tools-layer-split S28 — minds-domain tool definitions.
 *
 * The Imbue-inspired autonomous multi-agent "Mind" family (2 tools):
 * `create_mind` + `mind_ticket`. Definitions are a VERBATIM lift of the inline
 * object literals previously in server/tools.ts's TOOL_DEFINITIONS array —
 * same name/description/parameters (the LLM-facing contract is byte-identical);
 * only their storage location changes. The facade re-imports these const refs
 * and splices them back at their original array positions.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createMindDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_mind",
    description: "Create or manage a Mind — an autonomous multi-agent system inspired by Imbue's Minds framework. A Mind has 4 roles: talking (user-facing), thinking (orchestration brain), working (execution), verifying (quality judge). Minds use tickets to track work, events for communication, and structured verification with PASSED/FAILED verdicts.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["create", "list", "dashboard", "update", "idle_check"], description: "create: create a new mind. list: list all minds. dashboard: get full mind status with ticket summary. update: modify mind settings. idle_check: run housekeeping/proactive check." },
        name: { type: "string", description: "Mind name (required for create)" },
        purpose: { type: "string", description: "What this mind is trying to accomplish (required for create)" },
        soul: { type: "string", description: "Personality traits (e.g. 'loyal, helpful, honest')" },
        mindId: { type: "number", description: "Mind ID (required for dashboard, update, idle_check)" },
        maxConcurrentWorkers: { type: "number", description: "Max parallel workers (default 5, max 20)" },
        talkingPersonaId: { type: "number", description: "Persona ID for the talking (user-facing) role" },
        thinkingPersonaId: { type: "number", description: "Persona ID for the thinking (orchestration) role" },
      },
      required: ["command"],
    },
  },
};

export const mindTicketDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mind_ticket",
    description: "Manage tickets within a Mind system. Tickets track work that needs to be done. Supports creating tickets with priorities (0=critical, 1=high, 2=normal, 3=low), delegating to worker agents, and verifying completed work with AI-powered PASSED/FAILED verdicts and confidence scores.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["create", "list", "delegate", "verify", "update_status"], description: "create: create a ticket. list: list tickets. delegate: assign to worker agent. verify: AI-judge completed work. update_status: change ticket status." },
        mindId: { type: "number", description: "Mind ID (required for create, list)" },
        ticketId: { type: "number", description: "Ticket ID (required for delegate, verify, update_status)" },
        title: { type: "string", description: "Ticket title (required for create)" },
        description: { type: "string", description: "What needs to be done" },
        acceptanceCriteria: { type: "string", description: "What 'done' looks like" },
        priority: { type: "number", description: "0=critical, 1=high, 2=normal (default), 3=low" },
        ticketType: { type: "string", description: "Type of ticket (default: task)" },
        dependsOn: { type: "array", items: { type: "number" }, description: "Ticket IDs this depends on" },
        status: { type: "string", description: "New status (for update_status)" },
        personaId: { type: "number", description: "Persona to assign as worker (for delegate)" },
        model: { type: "string", description: "LLM model for the worker (for delegate)" },
      },
      required: ["command"],
    },
  },
};

export const mindsDomainDefinitions: ToolDefinition[] = [
  createMindDefinition,
  mindTicketDefinition,
];
