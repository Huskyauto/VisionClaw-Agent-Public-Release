/**
 * Tools-layer-split S25z — task-forces-domain tool definitions.
 *
 * The 4 task-force lifecycle tools (`create_task_force`, `list_task_forces`,
 * `charge_task_force`, `sunset_task_force`) — a single coherent cluster backed
 * solely by `server/agentic/task-forces` (`createTaskForce` / `listTaskForces` /
 * `chargeTaskForce` / `sunsetTaskForce`). Grep confirmed `server/tools.ts` is the
 * ONLY external caller of that backing module.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createTaskForceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_task_force",
    description: "Spin up a scoped task-force: a bounded sub-team of personas with its own mission, budget, and optional deadline. Charges/usage are tracked against the task-force budget. Use to ring-fence a focused initiative without polluting the main tenant's accounting.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short task-force name." },
        mission: { type: "string", description: "What this task-force is chartered to accomplish." },
        personaIds: { type: "array", items: { type: "number" }, description: "Persona ids assigned to the task-force." },
        budgetUsd: { type: "number", minimum: 0, description: "Optional spend budget in USD." },
        deadline: { type: "string", description: "Optional ISO deadline." },
      },
      required: ["name", "mission"],
    },
  },
};

export const listTaskForcesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_task_forces",
    description: "List this tenant's task-forces, optionally filtered by status (active/paused/completed/sunset).",
    parameters: { type: "object", properties: { status: { type: "string", description: "Optional status filter." } } },
  },
};

export const chargeTaskForceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "charge_task_force",
    description: "Record spend against a task-force's budget. Returns remaining budget and whether the charge pushed it over.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "task-force id" },
        amountUsd: { type: "number", minimum: 0, description: "Amount to charge in USD." },
      },
      required: ["id", "amountUsd"],
    },
  },
};

export const sunsetTaskForceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sunset_task_force",
    description: "Close a task-force (status → sunset) when its mission is done or abandoned, optionally recording a result summary.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "task-force id" },
        result: { type: "object", description: "Optional result/outcome summary." },
      },
      required: ["id"],
    },
  },
};

export const taskForcesDomainDefinitions: ToolDefinition[] = [
  createTaskForceDefinition,
  listTaskForcesDefinition,
  chargeTaskForceDefinition,
  sunsetTaskForceDefinition,
];
