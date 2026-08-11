/**
 * Tools-layer-split S23 — governance-domain tool definitions (the
 * "destructive/owner-only stragglers LAST" slice).
 *
 * Selection: `set_policy` ONLY — the owner-only trust-tier policy engine
 * (R76; HITL-bypass policy writes) that S6 (security) explicitly deferred to
 * this straggler slice per the contract ordering. It is a clean mechanical
 * move: an INLINE owner-only guard (tenant 1), a single call-time dynamic
 * dependency (`./policy-engine`), and no tools.ts module-scope helper.
 *
 * The other destructive/owner-only stragglers STAY LEGACY — moving them would
 * touch the safety boundary the contract forbids (Scope-out + stop-condition):
 *   - `exec` / `lobster` / `run_command` / `kill` — owner-driven shell gate is
 *     enforced at the dispatch case (admin-tenant ∧ owner-channel) and internal
 *     callers deliberately bypass via direct fn calls; relocating entangles the
 *     two-layer governance boundary.
 *   - `write_file` / `google_drive` — read `_allowedPaths` /
 *     `_projectDriveFolderId` / `_projectId` trust channels not yet on
 *     ToolContext (S5 deferred to a dedicated trust-seam slice).
 *
 * Definition is a VERBATIM copy of the object previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const setPolicyDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "set_policy",
    description: "R76 — Trust-tier policy engine. Create or update a per-tenant tool policy that pre-approves or blocks specific tool calls so they bypass HITL. Owner-only. Use 'list' to see active policies, 'create' to add one, 'delete' to remove. Examples: allow send_email to your own address, allow google_workspace:read*, deny exec entirely.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "delete"], description: "What to do." },
        scope_kind: { type: "string", enum: ["tool", "tool_action", "tool_recipient_pattern"], description: "How the policy is scoped (create only)." },
        scope_value: { type: "string", description: "For tool: the tool name (or *). For tool_action: 'tool:action' (e.g. 'google_workspace:read*'). For tool_recipient_pattern: 'tool|recipient_pattern' (e.g. 'send_email|*@example.com')." },
        policy_action: { type: "string", enum: ["allow", "deny", "require_approval"], description: "What the policy does (create only)." },
        max_amount_cents: { type: "number", description: "Optional spending cap in cents." },
        reason: { type: "string", description: "Human-readable rationale." },
        policy_id: { type: "number", description: "ID to delete (delete only)." },
      },
      required: ["action"],
    },
  },
};

/** Full ordered set (facade array order), for any consumer that wants the
 * domain's definitions. */
export const governanceDomainDefinitions: ToolDefinition[] = [
  setPolicyDefinition,
];
