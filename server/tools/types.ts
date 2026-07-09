/**
 * Tools-layer-split S2 — canonical types for the new `server/tools/` package.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * `ToolDefinition` is shape-identical to the interface in `server/tools.ts`
 * (the legacy monolith). During the strangler-fig migration BOTH exist; the
 * facade in tools.ts remains the single runtime source of truth until S25.
 *
 * HARD RULE (spec § untouchables): nothing in this package may import from
 * `server/tools.ts`, `server/guarded-tool-executor.ts`, or `server/safety/**`.
 * The package must stay acyclic w.r.t. the rest of `server/` — enforced by
 * `tests/tools/registry-invariants.test.ts`.
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * The trusted execution context threaded by the dispatcher (S4+). Handlers
 * receive identity/authz signals ONLY from this object — never from
 * caller-supplied params (`_tenantId` / `_personaId` / `_approvedByGate` are
 * stripped upstream; see the plan-step-authz hardening history).
 */
export interface ToolContext {
  tenantId?: number;
  personaId?: number;
  conversationId?: number;
  /**
   * Trust-seam authz field for the project-scoped Drive tool (`google_drive`).
   * The project id the caller is operating within; used to refuse cross-project
   * writes. Platform-stamped upstream (chat-engine strips ALL caller `_`-keys
   * then re-stamps trusted ones), so relocating the legacy arm's `_projectId`
   * read to this field preserves the exact trust posture — never read a
   * caller-supplied `_projectId` in a handler.
   */
  projectId?: number;
  /**
   * Trust-seam authz field for `write_file`'s freeze-guard: the allowlist of
   * paths the tool may write. MUST be platform-stamped to be effective; same
   * provenance guarantee as `projectId` above. Handlers read this, never a
   * caller-supplied `_allowedPaths`.
   */
  allowedPaths?: string[];
  /** Set by the rate-limit middleware handshake; handlers must not write it. */
  rateLimitChecked?: boolean;
}

/** What every handler resolves with. Legacy arms return loose objects; new
 * handlers should prefer `{ error }` on failure or a structured payload. */
export type ToolResult = Record<string, any>;

export type ToolHandler = (
  params: Record<string, any>,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** A definition paired with its handler — the unit `defineTool` produces and
 * the registry stores. */
export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
