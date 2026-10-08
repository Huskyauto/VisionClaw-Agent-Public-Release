/**
 * Tools-layer-split S23 — governance-domain migrated handler.
 *
 * Selection: `set_policy` ONLY (see ./definitions.ts header for why the other
 * destructive/owner-only stragglers stay legacy — moving them would touch the
 * safety boundary the contract forbids).
 *
 * The handler body is a MECHANICAL move of the legacy switch arm (standing
 * rules: no renames, no behavior change, no added/removed gate, error strings
 * verbatim). The ONLY edit is the caller-supplied `params._tenantId` read
 * becoming `ctx.tenantId` (the dispatcher strips + re-stamps it from the
 * trusted context). The inline owner-only guard is preserved verbatim:
 *   - fail CLOSED on a missing / non-positive tenant
 *     ("set_policy requires explicit _tenantId (refusing to default to owner tenant)")
 *   - owner-only: refuse any tenant !== 1
 *     ("set_policy is owner-only (tenant 1)...")
 * After the guard, TS narrows `ctx.tenantId` to a number, matching the legacy
 * `params._tenantId` flow into policy-engine.
 *
 * The external dependency (`./policy-engine`) is pulled via a call-time dynamic
 * `import(...)` inside the handler — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8–S22 used).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { setPolicyDefinition } from "./definitions";

async function setPolicyHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { createPolicy, listPoliciesForTenant, deletePolicy } = await import("../../../policy-engine");
  // R76 — Owner-only and fail-closed on missing tenant context.
  // tenant 1 is the owner tenant (Bob/[Your Company]); refuse silently otherwise
  // to prevent privilege escalation by non-owner personas.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "set_policy requires explicit _tenantId (refusing to default to owner tenant)" };
  }
  if (tid !== 1) {
    return { error: "set_policy is owner-only (tenant 1). Non-owner tenants cannot modify their own HITL policies via this tool." };
  }
  const action = String(params.action || "list");
  try {
    if (action === "list") {
      const rows = await listPoliciesForTenant(tid);
      return { success: true, policies: rows, count: rows.length };
    }
    if (action === "delete") {
      const id = Number(params.policy_id);
      if (!id) return { error: "policy_id is required for delete" };
      await deletePolicy(tid, id);
      return { success: true, deleted: id };
    }
    if (action === "create") {
      const scopeKind = String(params.scope_kind || "");
      const scopeValue = String(params.scope_value || "");
      const policyAction = String(params.policy_action || "");
      if (!scopeKind || !scopeValue || !policyAction) {
        return { error: "scope_kind, scope_value, and policy_action are required for create" };
      }
      const created = await createPolicy({
        tenantId: tid,
        scopeKind: scopeKind as any,
        scopeValue,
        action: policyAction as any,
        maxAmountCents: params.max_amount_cents,
        reason: params.reason,
      });
      return { success: true, policy: created };
    }
    return { error: `unknown action: ${action}` };
  } catch (e) {
    return { error: `set_policy failed: ${(e as Error).message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const governanceDomainTools: RegisteredTool[] = [
  defineTool(setPolicyDefinition, setPolicyHandler),
];
