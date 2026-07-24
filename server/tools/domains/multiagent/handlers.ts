/**
 * Tools-layer-split S19 — multiagent-domain migrated handlers.
 *
 * Selection: the 3 Mixture-of-Agents / multi-model tools — `ensemble_query`,
 * `jury_triage`, `second_opinion`. In the legacy facade each was an individual
 * switch arm that:
 *   - fail-closed guarded on `params._tenantId` ("Tenant context required …");
 *   - forwarded `tenantId: params._tenantId` + `invokedVia: params._invokedVia
 *     || "tool"` into the underlying engine (`./moa`, `./lib/jury-triage`,
 *     `./second-opinion`);
 *   - (ensemble_query + jury_triage) set the owner metered-override
 *     `meteredOverride: params._tenantId === ADMIN_TENANT_ID`.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). The ONLY edit: the
 * caller-supplied `params._tenantId` read becomes `ctx.tenantId` (the dispatcher
 * strips + re-stamps it from the trusted context). `params._invokedVia` is
 * preserved verbatim — it is NOT in the dispatcher's TRUST_SIGNAL_KEYS strip
 * list, so it survives on the stripped `params` exactly as the legacy arms saw
 * it (telemetry label, not an authz signal). The metered-override comparison
 * `ctx.tenantId === ADMIN_TENANT_ID` is behavior-identical to the legacy
 * `params._tenantId === ADMIN_TENANT_ID` because the dispatcher stamps
 * `ctx.tenantId` from the platform's own `_tenantId`.
 *
 * All external dependencies (`../../../moa`, `../../../lib/jury-triage`,
 * `../../../second-opinion`, `../../../auth`) are pulled via call-time dynamic
 * `import(...)` inside each handler — NOT top-level static imports — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; same seam S8–S18
 * used). No tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  ensembleQueryDefinition,
  juryTriageDefinition,
  secondOpinionDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function ensembleQueryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for ensemble_query" };
  const { executeMoA } = await import("../../../moa");
  // R125+1 — proposer_pool is optional; only forward if it's a valid enum
  // value. Anything else (undefined, unknown string, wrong type) silently
  // falls through to the default frontier pool — fail-safe.
  // R125+13.18 — added 'polarity' pool + restate_gate + dissent_quota.
  const poolRaw = params.proposer_pool;
  const validatedPool = (poolRaw === "frontier" || poolRaw === "cheap" || poolRaw === "mixed" || poolRaw === "polarity")
    ? poolRaw as "frontier" | "cheap" | "mixed" | "polarity"
    : undefined;
  const { ADMIN_TENANT_ID: TID_ENS } = await import("../../../auth");
  const r = await executeMoA({
    question: params.question || "",
    tenantId: ctx.tenantId,
    invokedVia: params._invokedVia || "tool",
    pool: validatedPool,
    restateGate: params.restate_gate === true,
    dissentQuota: params.dissent_quota === true,
    // Owner explicit-jury paid override (admin tenant only) — real
    // cross-provider metered proposers instead of the free-lane collapse.
    meteredOverride: ctx.tenantId === TID_ENS,
  });
  return {
    answer: r.aggregated,
    aggregator: r.aggregatorModel,
    proposers: r.proposers.map(p => ({ model: p.modelId, provider: p.provider, ok: p.ok, latencyMs: p.latencyMs, error: p.error, answerLen: p.answer?.length || 0, label: p.label, role: p.role })),
    successful: r.proposers.filter(p => p.ok).length,
    totalLatencyMs: r.totalLatencyMs,
    loggedAs: r.responseId,
    // R98.24 — MNEMA Nugget 3: surface jury concordance to callers so
    // downstream consumers (Felix, autonomous agents) can route to HITL
    // when shouldEscalate is true (κ < 0.5 or single-proposer success).
    concordance: r.concordance,
    shouldEscalate: r.shouldEscalate,
    // R125+52.41 — auto Fusion cross-check rides along on low-confidence
    // (shouldEscalate) ensembles. Present only when the auto-hook succeeded.
    secondOpinion: r.secondOpinion,
    // R125+13.18 — Council-of-High-Intelligence telemetry surfaces. Each
    // is undefined unless the corresponding gate was enabled by the caller.
    restatements: r.restatements,
    restateDivergence: r.restateDivergence,
    questionAmbiguous: r.questionAmbiguous,
    dissentTriggered: r.dissentTriggered,
    steelmenCount: r.steelmen?.length,
  };
}

async function juryTriageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R125+3.6 — multi-model jury verdict for an open issue/finding.
  if (!ctx.tenantId) return { error: "Tenant context required for jury_triage" };
  const { juryTriage } = await import("../../../lib/jury-triage");
  const issueText = String(params.issue_text || "").trim();
  if (issueText.length < 10) return { error: "issue_text must be ≥10 chars" };
  const { ADMIN_TENANT_ID: TID_JURY } = await import("../../../auth");
  const d = await juryTriage({
    issueText,
    context: typeof params.context === "string" ? params.context : undefined,
    tenantId: ctx.tenantId,
    invokedVia: params._invokedVia || "tool",
    // Owner explicit-jury paid override (admin tenant only).
    meteredOverride: ctx.tenantId === TID_JURY,
  });
  return {
    verdict: d.verdict,
    majority: d.majority,
    concordance: d.concordance,
    shouldEscalate: d.shouldEscalate,
    votes: d.votes.map(v => ({ model: v.model, provider: v.provider, verdict: v.verdict, rationale: v.rationale, ok: v.ok })),
    fixProposal: d.fixProposal,
    aggregatorAnswer: d.aggregatorAnswer,
    totalLatencyMs: d.totalLatencyMs,
    loggedAs: d.loggedAs,
  };
}

async function secondOpinionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R125+52.41 — independent external cross-check via OpenRouter Fusion.
  // Budget-capped (~$25/day), metered, fail-open (never throws).
  if (!ctx.tenantId) return { error: "Tenant context required for second_opinion" };
  const { getSecondOpinion } = await import("../../../second-opinion");
  const q = String(params.question || "").trim();
  if (q.length < 10) return { error: "question must be ≥10 chars" };
  return await getSecondOpinion({
    question: q,
    draftAnswer: typeof params.draft_answer === "string" ? params.draft_answer : undefined,
    tenantId: ctx.tenantId,
    invokedVia: params._invokedVia || "tool",
  });
}

/** Registered by ./index.ts at import time. */
export const multiagentDomainTools: RegisteredTool[] = [
  defineTool(ensembleQueryDefinition, ensembleQueryHandler),
  defineTool(juryTriageDefinition, juryTriageHandler),
  defineTool(secondOpinionDefinition, secondOpinionHandler),
];
