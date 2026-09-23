/**
 * Tools-layer-split S25t — crews-domain tool definitions.
 *
 * The 2 crews tools (`create_crew`, `create_flow`) — the crewAI-inspired
 * autonomous-agent-team + event-driven-flow orchestration cluster. Both are
 * ADMIN-ONLY and backed solely by `server/crews-engine` — one coherent domain.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (names, descriptions, parameter
 * schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createCrewDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_crew",
    description: "Create and manage Crews — autonomous agent teams inspired by crewAI. A Crew has agents (with role/goal/backstory), tasks (with description/expected_output), and a process type (sequential or hierarchical). Sequential runs tasks in order, passing outputs forward. Hierarchical uses a manager LLM to select the best agent for each task and synthesizes all outputs. Use kickoff to execute the crew with inputs.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["create", "list", "get", "update", "delete", "add_agent", "remove_agent", "add_task", "remove_task", "kickoff", "runs", "run_status"], description: "create: new crew. list: all crews. get: crew with agents+tasks. update: modify crew. delete: remove crew. add_agent: add agent to crew. remove_agent: remove agent. add_task: add task. remove_task: remove task. kickoff: execute crew. runs: list runs. run_status: get run details." },
        crewId: { type: "number", description: "Crew ID (required for most commands)" },
        name: { type: "string", description: "Crew or agent name" },
        description: { type: "string", description: "Crew description or task description" },
        process: { type: "string", enum: ["sequential", "hierarchical"], description: "Process type (default: sequential)" },
        role: { type: "string", description: "Agent role (required for add_agent)" },
        goal: { type: "string", description: "Agent goal (required for add_agent)" },
        backstory: { type: "string", description: "Agent backstory" },
        personaId: { type: "number", description: "Link to platform persona" },
        allowDelegation: { type: "boolean", description: "Allow agent to delegate to others" },
        tools: { type: "array", items: { type: "string" }, description: "Tool names available to agent/task" },
        agentId: { type: "number", description: "Agent ID (for remove_agent or task assignment)" },
        taskId: { type: "number", description: "Task ID (for remove_task)" },
        expectedOutput: { type: "string", description: "What the task output should look like (required for add_task)" },
        contextTaskIds: { type: "array", items: { type: "number" }, description: "Task IDs whose output feeds into this task" },
        guardrail: { type: "string", description: "Validation rule for task output" },
        inputs: { type: "object", description: "Input variables for kickoff (interpolated into task descriptions via {key})" },
        runId: { type: "number", description: "Run ID (for run_status)" },
        memoryEnabled: { type: "boolean", description: "Enable crew memory" },
      },
      required: ["command"],
    },
  },
};

export const createFlowDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_flow",
    description: "Create and manage Flows — event-driven workflow orchestration inspired by crewAI Flows. Flows have steps with three types: @start (entry points), @listen (triggered when dependencies complete), @router (conditional branching). Steps can trigger crew kickoffs, LLM calls, or custom transforms. Use for multi-crew pipelines, conditional routing, and complex agentic workflows.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["create", "list", "add_step", "list_steps", "kickoff", "delete"], description: "create: new flow. list: all flows. add_step: add step. list_steps: show steps. kickoff: execute flow. delete: remove flow." },
        flowId: { type: "number", description: "Flow ID (required for most commands)" },
        name: { type: "string", description: "Flow or step name" },
        description: { type: "string", description: "Flow description" },
        stepType: { type: "string", enum: ["start", "listen", "router"], description: "Step type: start (entry), listen (triggered by deps), router (conditional branch)" },
        listenTo: { type: "array", items: { type: "string" }, description: "Step names this step listens to (for listen/router)" },
        routerOutputs: { type: "array", items: { type: "string" }, description: "Possible route names (for router steps)" },
        crewId: { type: "number", description: "Crew to kickoff when step executes" },
        actionType: { type: "string", enum: ["crew_kickoff", "llm_call", "transform"], description: "What the step does (default: crew_kickoff)" },
        actionConfig: { type: "object", description: "Config for the action (e.g. {prompt, model} for llm_call)" },
        inputs: { type: "object", description: "Input variables for flow kickoff" },
      },
      required: ["command"],
    },
  },
};

/** All crews-domain definitions, in facade splice order. */
export const crewsDomainDefinitions: ToolDefinition[] = [
  createCrewDefinition,
  createFlowDefinition,
];
