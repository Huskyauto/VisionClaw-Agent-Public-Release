/**
 * Tools-layer-split S25n — agent-eval-domain migrated handlers.
 *
 * Selection: the 2 contiguous persona-benchmark tools — `run_agent_eval`,
 * `get_eval_report`. Both backed by `server/agent-eval` (runEval /
 * getEvalReport), one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). Seam edit: the
 * caller-supplied trust signal becomes the trusted `ctx` value (the dispatcher
 * strips + re-stamps it) — `params._tenantId`→`ctx.tenantId`. The legacy arms
 * had NO explicit tenant guard, so NONE is added here — passing `ctx.tenantId`
 * is behavior-identical. The `Math.min(params.runs || 1, 3)` clamp, the
 * pass/avg-score reductions, the `summary` template string, and the
 * `params.persona_id` public read are all verbatim. The backing dependency
 * (`../../../agent-eval`) is pulled via call-time dynamic `import(...)` inside
 * each handler — NOT a top-level static import — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2; mirrors the treasury/
 * finance-market domains' dynamic-import seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  runAgentEvalDefinition,
  getEvalReportDefinition,
} from "./definitions";

async function runAgentEvalHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { runEval } = await import("../../../agent-eval");
  const runs = Math.min(params.runs || 1, 3);
  // Type-only seam cast: legacy passed untyped `params._tenantId` (any); the
  // dispatcher always stamps a real tenantId, so runtime is unchanged.
  const results = await runEval(params.persona_id, ctx.tenantId as number, undefined, runs);
  const passed = results.filter((r) => r.passed).length;
  const avgScore = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2) : "0";
  return {
    summary: `${passed}/${results.length} tasks passed (avg score: ${avgScore})`,
    results,
  };
}

async function getEvalReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { getEvalReport } = await import("../../../agent-eval");
  // Type-only seam cast: legacy passed untyped `params._tenantId` (any);
  // runtime unchanged (dispatcher always stamps a real tenantId).
  const report = await getEvalReport(ctx.tenantId as number, params.persona_id);
  return { report };
}

/** Registered by ./index.ts at import time. */
export const agentEvalDomainTools: RegisteredTool[] = [
  defineTool(runAgentEvalDefinition, runAgentEvalHandler),
  defineTool(getEvalReportDefinition, getEvalReportHandler),
];
