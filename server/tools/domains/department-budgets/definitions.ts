/**
 * Tools-layer-split S26a — department-budgets-domain tool definitions.
 *
 * The 2 department-budget tools (`set_department_budget`, `check_department_budget`)
 * — a single coherent cluster backed solely by `server/agentic/department-budgets`
 * (`setDepartmentBudget` / `checkDepartmentBudget` / `checkAllBudgets`). Grep
 * confirmed `server/tools.ts` is the ONLY external caller of those backing fns.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const setDepartmentBudgetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "set_department_budget",
    description: "Set a spend cap for a department (executive, engineering, marketing, sales, finance, operations, research, creative, support). When spend approaches the cap the heartbeat emits budget.warning; over the cap it emits budget.exceeded and the budget guard throttles that department's spend.",
    parameters: {
      type: "object",
      properties: {
        department: { type: "string", description: "Department id." },
        limitUsd: { type: "number", minimum: 0, description: "Spend cap in USD for the period." },
        period: { type: "string", enum: ["monthly", "weekly"], description: "Budget window (default monthly)." },
      },
      required: ["department", "limitUsd"],
    },
  },
};

export const checkDepartmentBudgetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "check_department_budget",
    description: "Check current spend vs cap for a department (or all departments if omitted).",
    parameters: { type: "object", properties: { department: { type: "string", description: "Optional department id; omit for all." } } },
  },
};

export const departmentBudgetsDomainDefinitions: ToolDefinition[] = [
  setDepartmentBudgetDefinition,
  checkDepartmentBudgetDefinition,
];
