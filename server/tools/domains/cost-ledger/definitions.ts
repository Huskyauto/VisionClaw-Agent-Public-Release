/**
 * Tools-layer-split S26c — cost-ledger-domain tool definitions.
 *
 * The 2 owner-only financial tools (`revenue_vs_cost`, `agent_cost_summary`)
 * — a single coherent cluster backed solely by `server/agentic/cost-ledger`
 * (`getRevenueVsCost` / `getCostSummary`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const revenueVsCostDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_vs_cost",
    description: "Show a unified revenue-vs-agent-cost dashboard for a period. Sums Stripe + Coinbase revenue, subtracts estimated AI/tool costs from the ledger, and returns burn ratio and a health verdict. Use when the user asks 'how are we doing financially' or before authorizing new spend.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window in days (default 7, max 90)." },
      },
      required: [],
    },
  },
};

export const agentCostSummaryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "agent_cost_summary",
    description: "Break down agent/tool costs by tool and model for a period, showing which tools are driving spend. Owner-only.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window in days (default 7)." },
      },
      required: [],
    },
  },
};

export const costLedgerDomainDefinitions: ToolDefinition[] = [
  revenueVsCostDefinition,
  agentCostSummaryDefinition,
];
