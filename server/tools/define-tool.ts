/**
 * Tools-layer-split S2 — `defineTool`: the single constructor for new-package
 * tools. Validates the definition shape at MODULE LOAD time so a malformed
 * tool fails the boot/typecheck loop loudly instead of surfacing as a broken
 * LLM contract at runtime.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { RegisteredTool, ToolDefinition, ToolHandler } from "./types";

/** Throws with a precise message when a definition violates the invariants
 * the LLM contract depends on. Exported for direct unit-testing. */
export function assertValidDefinition(def: ToolDefinition): void {
  if (def.type !== "function") {
    throw new Error(`[define-tool] type must be "function" (got ${JSON.stringify((def as any).type)})`);
  }
  const fn = def.function;
  if (!fn || typeof fn !== "object") {
    throw new Error(`[define-tool] missing function block`);
  }
  if (typeof fn.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(fn.name)) {
    throw new Error(`[define-tool] tool name must be snake_case (got ${JSON.stringify(fn.name)})`);
  }
  if (typeof fn.description !== "string" || fn.description.trim().length === 0) {
    throw new Error(`[define-tool] ${fn.name}: description must be a non-empty string`);
  }
  if (!fn.parameters || typeof fn.parameters !== "object" || fn.parameters.type !== "object") {
    throw new Error(`[define-tool] ${fn.name}: parameters must be a JSON-Schema object (type: "object")`);
  }
}

// Exact executor metadata, not an underscore wildcard or a public-field
// allowlist: typos and protected business fields must still fail strict schemas.
// Opt-in preserves legacy handlers which consume these hints from params.
const FRAMEWORK_METADATA_KEYS = [
  "_invokedByModel", "_invokedVia", "_skipTracking", "_selfHeal", "conversationId",
  "_userId", "_personaName", "_projectDriveFolderId",
] as const;

export function defineTool(
  definition: ToolDefinition,
  handler: ToolHandler,
  options?: { publicArgumentsOnly?: boolean },
): RegisteredTool {
  assertValidDefinition(definition);
  if (typeof handler !== "function") {
    throw new Error(`[define-tool] ${definition.function.name}: handler must be a function`);
  }
  if (!options?.publicArgumentsOnly) return { definition, handler };
  return {
    definition,
    handler: (params, ctx) => {
      const input = { ...params };
      for (const key of FRAMEWORK_METADATA_KEYS) {
        // A declared public field wins: conversationId is a real argument for
        // some tools. This option must not silently erase their business input.
        if (!Object.prototype.hasOwnProperty.call(definition.function.parameters.properties ?? {}, key)) {
          delete input[key];
        }
      }
      return handler(input, ctx);
    },
  };
}
