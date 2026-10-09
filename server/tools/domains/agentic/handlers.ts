/**
 * Tools-layer-split S20 — agentic-domain migrated handlers (first batch).
 *
 * Selection: the 3 self-healing supervisor tools — `self_heal`,
 * `self_heal_log`, `self_heal_inspect`. In the legacy facade each was an
 * individual switch arm that:
 *   - fail-closed guarded on `params._tenantId` ("Tenant context required");
 *   - dispatched into `./agentic/self-heal` (attemptSelfHeal /
 *     listSelfHealAttempts / getSelfHealAttempt / markPromotedToPlatform);
 *   - (self_heal only) read `params._invokedByModel` to set triggerSource.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate, error strings
 * verbatim). The ONLY edit: the caller-supplied `params._tenantId` read becomes
 * `ctx.tenantId` (the dispatcher strips + re-stamps it from the trusted
 * context). `params._invokedByModel` is preserved verbatim — it is NOT in the
 * dispatcher's TRUST_SIGNAL_KEYS strip list, so it survives on the stripped
 * `params` exactly as the legacy arm saw it (telemetry label, not an authz
 * signal).
 *
 * The single external dependency (`../../../agentic/self-heal`, i.e.
 * server/agentic/self-heal — the facade's `./agentic/self-heal`) is pulled via
 * call-time dynamic `import(...)` inside each handler — NOT a top-level static
 * import — so the domain module statically imports only within server/tools/
 * and cannot recurse back into the app graph (acyclicity invariant, plan.md S2;
 * same seam S8–S19 used). No tools.ts module-scope helpers moved (none owned).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  selfHealDefinition,
  selfHealLogDefinition,
  selfHealInspectDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function selfHealHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  if (!params.originalGoal || !params.error) return { error: "originalGoal and error are required" };
  try {
    const { attemptSelfHeal } = await import("../../../agentic/self-heal");
    const res = await attemptSelfHeal({
      tenantId,
      runId: params.runId ? Number(params.runId) : null,
      triggerSource: params._invokedByModel ? "model_request" : "user_request",
      originalGoal: String(params.originalGoal),
      failure: {
        error: String(params.error),
        lastToolName: params.lastToolName,
        lastToolArgs: params.lastToolArgs,
        recentSteps: Array.isArray(params.recentSteps) ? params.recentSteps : [],
      },
    });
    return res;
  } catch (err: any) {
    return { error: `self_heal failed: ${err.message}` };
  }
}

async function selfHealLogHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  const limit = Math.max(1, Math.min(Number(params.limit) || 50, 200));
  try {
    const { listSelfHealAttempts } = await import("../../../agentic/self-heal");
    const rows = await listSelfHealAttempts(tenantId, limit, {
      runId: params.runId ? Number(params.runId) : undefined,
      outcome: params.outcome,
    });
    return {
      count: rows.length,
      attempts: rows.map(r => ({
        id: r.id,
        runId: r.runId,
        triggerSource: r.triggerSource,
        originalGoal: r.originalGoal?.slice(0, 200),
        fixType: r.fixType,
        outcome: r.outcome,
        reversible: r.reversible,
        promotedToPlatform: r.promotedToPlatform,
        createdAt: r.createdAt,
      })),
      promotionCandidates: rows.filter(r => r.outcome === "succeeded" && !r.promotedToPlatform).length,
    };
  } catch (err: any) {
    return { error: `self_heal_log failed: ${err.message}` };
  }
}

async function selfHealInspectHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  const attemptId = Number(params.attemptId);
  if (!attemptId) return { error: "attemptId is required" };
  try {
    const { getSelfHealAttempt, markPromotedToPlatform } = await import("../../../agentic/self-heal");
    const row = await getSelfHealAttempt(attemptId, tenantId);
    if (!row) return { error: `Self-heal attempt ${attemptId} not found for this tenant` };
    if (params.markPromoted === true && row.outcome === "succeeded" && !row.promotedToPlatform) {
      await markPromotedToPlatform(attemptId, tenantId);
      (row as any).promotedToPlatform = true;
    }
    return row;
  } catch (err: any) {
    return { error: `self_heal_inspect failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const agenticDomainTools: RegisteredTool[] = [
  defineTool(selfHealDefinition, selfHealHandler),
  defineTool(selfHealLogDefinition, selfHealLogHandler),
  defineTool(selfHealInspectDefinition, selfHealInspectHandler),
];
