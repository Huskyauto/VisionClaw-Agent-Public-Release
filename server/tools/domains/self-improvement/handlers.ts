/**
 * Tools-layer-split S26b — self-improvement-domain migrated handlers.
 *
 * Selection: the 3 self-improvement tools — `log_experiment` / `get_experiments`
 * / `run_self_improvement`. Backed solely by `server/self-improvement`
 * (`logExperiment` / `getExperimentHistory` / `runSelfImprovementCycle` +
 * `extractSignalsFromLogs` / `detectStagnation` / `autoSelectStrategy`) — one
 * coherent family.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — as the backing-lib `tenantId` scope
 * (`log_experiment` / `get_experiments`) AND for a pre-existing fail-closed guard
 * (`run_self_improvement`: `if (!params._tenantId) return { error: "..." }`).
 * Migrated handlers read `ctx.tenantId` (the same platform-derived value) in the
 * SAME order with IDENTICAL error strings, guards, and value-validation. No
 * re-stamp is needed (the arms consumed the signal themselves — as a discrete arg
 * and a guard — they did not forward the whole params object into the lib).
 * `_tenantId` is the ONLY stripped trust signal these arms read: `personaId` in
 * `run_self_improvement` is the PUBLIC caller param (not the stripped `_personaId`),
 * so it stays read from `params` verbatim (grepped — no `_personaId` /
 * `_conversationId` / `_projectId`).
 *
 * The backing `../../../self-improvement` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `self-improvement` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  logExperimentDefinition,
  getExperimentsDefinition,
  runSelfImprovementDefinition,
} from "./definitions";

async function logExperimentHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { logExperiment } = await import("../../../self-improvement");
  return logExperiment({
    hypothesis: params.hypothesis,
    approach: params.approach,
    category: params.category || "general",
    metric: params.metric,
    baselineValue: params.baselineValue,
    resultValue: params.resultValue,
    status: params.status,
    outcome: params.outcome,
    tenantId: ctx.tenantId,
  });
}

async function getExperimentsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { getExperimentHistory } = await import("../../../self-improvement");
  const exps = await getExperimentHistory(params.limit || 20, params.category, ctx.tenantId);
  return { experiments: exps, count: exps.length };
}

async function runSelfImprovementHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { runSelfImprovementCycle, extractSignalsFromLogs, detectStagnation, autoSelectStrategy } = await import("../../../self-improvement");
  const validCats = ["prompt_optimization", "response_quality", "tool_usage", "persona_tuning"];
  const validStrategies = ["balanced", "innovate", "harden", "repair-only"];
  const category = validCats.includes(params.category) ? params.category : "response_quality";
  if (!ctx.tenantId) return { error: "Tenant context required for run_self_improvement" };
  const tenantId = ctx.tenantId;
  const signals = extractSignalsFromLogs();
  const stagnation = await detectStagnation(category, tenantId);
  const manualOverride = validStrategies.includes(params.strategy);
  const strategy = manualOverride ? params.strategy : autoSelectStrategy(signals, stagnation);
  const results = await runSelfImprovementCycle({
    category,
    personaId: params.personaId ? parseInt(String(params.personaId)) : undefined,
    strategy,
    _manualStrategyOverride: manualOverride,
    _signals: signals,
    _stagnation: stagnation,
    tenantId,
  });
  return {
    strategy,
    signalsDetected: signals.length,
    signals: signals.slice(0, 5),
    stagnation: { isStagnant: stagnation.isStagnant, consecutiveFailures: stagnation.consecutiveFailures, recommendation: stagnation.recommendation },
    experimentsRun: results.length,
    kept: results.filter(r => r.status === "kept").length,
    reverted: results.filter(r => r.status === "reverted").length,
    inconclusive: results.filter(r => r.status === "inconclusive").length,
    results,
  };
}

/** Registered by ./index.ts at import time. */
export const selfImprovementDomainTools: RegisteredTool[] = [
  defineTool(logExperimentDefinition, logExperimentHandler),
  defineTool(getExperimentsDefinition, getExperimentsHandler),
  defineTool(runSelfImprovementDefinition, runSelfImprovementHandler),
];
