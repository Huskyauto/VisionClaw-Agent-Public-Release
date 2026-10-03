import type { ToolDefinition } from "../../types";

export const queryTraceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "query_trace",
    description: "R101 — Causality graphs. Fetch the full span tree for a trace_id (the unified observability layer that ties every tool call, LLM call, delegate, and subagent back to the originating user turn). Use to debug 'why did X happen' questions: pass the trace_id surfaced in result.__trace.traceId of any tool call to see the full causality chain. Tenant-scoped — traces from other tenants are invisible.",
    parameters: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "The trace UUID to fetch (returned in result.__trace.traceId of any traced tool call)." },
      },
      required: ["traceId"],
    },
  },
};