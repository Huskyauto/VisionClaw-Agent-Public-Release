/**
 * Simulation Sandbox (S4) — tool definitions for `sandbox_run` / `sandbox_report`.
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * NEW tools (not migrated from the legacy facade). Backed by
 * `server/lib/sandbox/replay.ts` via call-time dynamic import.
 */

import type { ToolDefinition } from "../../types";

export const sandboxRunDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sandbox_run",
    description:
      "Start a Simulation Sandbox what-if replay (trusted personas only). Replays a HISTORICAL corpus under an override bundle inside a side-effect firewall — zero production writes, zero real side effects. corpus='safety' replays past security intent-gate decisions under a different gate mode/categories (free, no LLM). corpus='conversation' or 'orchestration' replays past LLM turns under a DIFFERENT model (spends real LLM budget, hard-capped at $5/run via an atomic budget claim — a refused claim means zero calls fire). Long runs continue in the background; poll sandbox_report for the verdict. Use before changing a persona's safety profile or swapping a default model.",
    parameters: {
      type: "object",
      properties: {
        corpus: {
          type: "string",
          enum: ["safety", "conversation", "orchestration"],
          description: "Which historical corpus to replay.",
        },
        sampleSize: {
          type: "number",
          description: "Number of corpus items to replay (1–200).",
        },
        intentGateMode: {
          type: "string",
          enum: ["off", "moderate", "strict"],
          description: "Safety corpus only: the intent-gate mode to test.",
        },
        restrictedCategories: {
          type: "array",
          items: { type: "string" },
          description:
            "Safety corpus only (optional): restricted categories to test; defaults to each historical row's flagged set.",
        },
        model: {
          type: "string",
          description:
            "Conversation/orchestration corpus only: the model id to replay under (e.g. 'gpt-5-mini').",
        },
        perRunCapUsd: {
          type: "number",
          description:
            "Conversation/orchestration only (optional): per-run LLM spend cap in USD. Default and maximum 5.",
        },
      },
      required: ["corpus", "sampleSize"],
    },
  },
};

export const sandboxReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sandbox_report",
    description:
      "Fetch the report for a Simulation Sandbox run (tenant-scoped, read-only). Pass runId for a specific run, or omit it for the tenant's most recent run. Returns status (running/complete/failed), the verdict (CRITICAL / CHANGES / DRIFT / NO_CHANGE / OK), flip and drift counts, spend totals, and any critical safety flips listed individually.",
    parameters: {
      type: "object",
      properties: {
        runId: {
          type: "number",
          description: "Specific sandbox run id. Omit for the most recent run.",
        },
      },
      required: [],
    },
  },
};

export const sandboxPromoteDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sandbox_promote",
    description:
      "Promote a COMPLETED Simulation Sandbox run into a jury-vetted upgrade proposal on the Improvement list (trusted personas only; spends ~5x a normal LLM call on the 3-frontier-model jury). The jury votes ACCEPT/REJECT/FIX/ESCALATE; approved proposals land on the Improvement list at /admin/sandbox for a human/agent to pick from — NOTHING is auto-applied. Use after sandbox_run + sandbox_report show a change worth adopting (e.g. cheaper model with NO_CHANGE, stricter gate with zero critical flips).",
    parameters: {
      type: "object",
      properties: {
        runId: {
          type: "number",
          description: "The completed sandbox run to promote.",
        },
        title: {
          type: "string",
          description: "Short human-readable name for the proposed upgrade (e.g. 'Swap orchestration tier to gpt-5-mini').",
        },
        rationale: {
          type: "string",
          description: "Optional: why this change is worth adopting — expected benefit (cost/safety/quality), risks considered.",
        },
      },
      required: ["runId", "title"],
    },
  },
};

export const sandboxDomainDefinitions: ToolDefinition[] = [
  sandboxRunDefinition,
  sandboxReportDefinition,
  sandboxPromoteDefinition,
];
