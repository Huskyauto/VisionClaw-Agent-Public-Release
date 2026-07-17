/**
 * Tools-layer-split S26b — ab-optimizer-domain migrated handlers.
 *
 * Selection: the 2 A/B-optimizer tools — `create_ab_experiment` /
 * `record_ab_event`. Backed solely by `server/ab-optimizer`
 * (`createAbExperiment` / `recordAbEvent`) — one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * signals DIRECTLY — `params._tenantId` for its pre-existing fail-closed guard
 * (`if (!params._tenantId) return { error: "... cross-tenant isolation guard" }`)
 * AND as the backing-lib `tenantId` scope; `create_ab_experiment` additionally
 * read `params._personaId` (`typeof params._personaId === "number" ? ... : null`).
 * Both signals are ToolContext-carried — migrated handlers read `ctx.tenantId` /
 * `ctx.personaId` (the same platform-derived values) in the SAME order with
 * IDENTICAL error strings, guards, and value-validation. No re-stamp is needed
 * (the arms consumed the signals themselves — as guards and discrete args — they
 * did not forward the whole params object into the lib). `_tenantId` + `_personaId`
 * are the ONLY stripped signals these arms read (grepped — no `_conversationId` /
 * `_projectId`).
 *
 * The backing `../../../ab-optimizer` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `ab-optimizer` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createAbExperimentDefinition,
  recordAbEventDefinition,
} from "./definitions";

async function createAbExperimentHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for create_ab_experiment (cross-tenant isolation guard)" };
  if (!params.hypothesis || !Array.isArray(params.variants) || params.variants.length < 2) {
    return { error: "hypothesis and at least 2 variants are required" };
  }
  try {
    const { createAbExperiment } = await import("../../../ab-optimizer");
    return await createAbExperiment({
      tenantId: ctx.tenantId,
      hypothesis: params.hypothesis,
      variants: params.variants,
      metric: params.metric,
      wedge: params.wedge ?? null,
      personaId: typeof ctx.personaId === "number" ? ctx.personaId : null,
      minSample: params.minSample,
      minAgeHours: params.minAgeHours,
    });
  } catch (e: any) { return { error: e?.message || "create_ab_experiment failed" }; }
}

async function recordAbEventHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for record_ab_event (cross-tenant isolation guard)" };
  if (typeof params.experimentId !== "number" || !params.variantLabel || !params.kind) {
    return { error: "experimentId, variantLabel and kind are required" };
  }
  try {
    const { recordAbEvent } = await import("../../../ab-optimizer");
    const ok = await recordAbEvent(ctx.tenantId, params.experimentId, params.variantLabel, params.kind === "conversion" ? "conversion" : "impression");
    return { ok, recorded: ok };
  } catch (e: any) { return { error: e?.message || "record_ab_event failed" }; }
}

/** Registered by ./index.ts at import time. */
export const abOptimizerDomainTools: RegisteredTool[] = [
  defineTool(createAbExperimentDefinition, createAbExperimentHandler),
  defineTool(recordAbEventDefinition, recordAbEventHandler),
];
