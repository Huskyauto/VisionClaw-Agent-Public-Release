import type { ToolDefinition } from "../../types";

export const businessPilotDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "business_pilot",
    description: "Run owner-requested advisory health, release, governance, cost or website-readiness pilots. Felix/Forge interactive owner chat only. Call describe first for the exact input schema; use supplied evidence, never guesses. Four analyses save private history; readiness is read-only and returned unsaved. Cannot delete, approve, certify, send, switch models or schedule itself.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["describe", "run", "list", "get"] },
        kind: { type: "string", enum: ["health", "release", "governance", "cost", "readiness"] },
        input: { type: "object", description: "Exact input returned by describe. Required for run. Unknown health values use null; evidence is not independently verified." },
        requestId: { type: "string", format: "uuid", description: "Required for saving the four analyses. Reuse unchanged across retries." },
        baselineId: { type: "string", format: "uuid", description: "Health only: saved matching earlier nonoverlapping baseline." },
        runId: { type: "string", format: "uuid", description: "Required for get; choose an exact ID from list." },
      },
      required: ["action", "kind"],
      additionalProperties: false,
    },
  },
};
