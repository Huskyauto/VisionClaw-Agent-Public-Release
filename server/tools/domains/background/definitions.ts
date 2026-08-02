/**
 * Tools-layer-split S25u — background-tasks-domain tool definitions.
 *
 * The 3 background-task tools (`run_background_task`, `check_background_task`,
 * `list_background_tasks`) — the async job launch/poll/list cluster backed solely
 * by `server/background-tasks` — one coherent domain.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (names, descriptions, parameter
 * schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const runBackgroundTaskDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_background_task",
    description: "Launch a long-running tool in the background without blocking. Returns a task_id you can poll with check_background_task. Use this for slow operations like deep_research, produce_video, orchestrate, browser tasks, or any tool that takes more than 30 seconds. The tool runs asynchronously and you can check its status later.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Name of the tool to run in the background" },
        params: { type: "object", description: "Parameters to pass to the tool" },
      },
      required: ["tool_name"],
    },
  },
};

export const checkBackgroundTaskDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "check_background_task",
    description: "Check the status of a background task launched with run_background_task. Returns status (pending/running/completed/failed), elapsed time, progress updates, and the result when complete.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID returned by run_background_task" },
        wait: { type: "boolean", description: "If true, block until the task completes (up to 60 seconds)" },
      },
      required: ["task_id"],
    },
  },
};

export const listBackgroundTasksDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_background_tasks",
    description: "Use when checking on long-running work (\"is my video done?\"), when investigating why a follow-up tool call is blocked, or before launching another expensive job to avoid stacking. Returns active/queued/completed tasks for this tenant with status, tool name, and elapsed time.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const backgroundDomainDefinitions: ToolDefinition[] = [
  runBackgroundTaskDefinition,
  checkBackgroundTaskDefinition,
  listBackgroundTasksDefinition,
];
