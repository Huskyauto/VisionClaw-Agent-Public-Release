/**
 * Tools-layer-split S25m — treasury-domain migrated handlers.
 *
 * Selection: the 2 contiguous market-forecast tools — `forecast_ticker`,
 * `analyze_portfolio`. Both backed by `server/treasury` (forecastTicker /
 * analyzePortfolio), one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). Seam edit: the
 * caller-supplied trust signal becomes the trusted `ctx` value (the dispatcher
 * strips + re-stamps it) — `params._tenantId`→`ctx.tenantId`. The legacy arms
 * had NO explicit tenant guard; a fail-CLOSED tenant guard was ADDED in
 * R125+125 (post-edit-code-review 2026-07-07 — deliberate behavior change):
 * both handlers reject a missing/non-positive `ctx.tenantId` rather than
 * passing `undefined` into the optionally-typed backing fns. The
 * String()/Number() coercions and the `params.symbol || ""` / `params.holdings
 * || []` / `Number(params.horizonDays) || 30` defaults are all verbatim. The
 * backing dependency (`../../../treasury`) is pulled via call-time dynamic
 * `import(...)` inside each handler — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; mirrors the
 * finance-market/finance/tensions domains' dynamic-import seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  forecastTickerDefinition,
  analyzePortfolioDefinition,
} from "./definitions";

async function forecastTickerHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (typeof ctx.tenantId !== "number" || ctx.tenantId <= 0) {
    return { error: "forecast_ticker requires tenant context (cross-tenant isolation guard)" };
  }
  const { forecastTicker } = await import("../../../treasury");
  return forecastTicker(String(params.symbol || ""), Number(params.horizonDays) || 30, ctx.tenantId);
}

async function analyzePortfolioHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (typeof ctx.tenantId !== "number" || ctx.tenantId <= 0) {
    return { error: "analyze_portfolio requires tenant context (cross-tenant isolation guard)" };
  }
  const { analyzePortfolio } = await import("../../../treasury");
  return analyzePortfolio(params.holdings || [], ctx.tenantId);
}

/** Registered by ./index.ts at import time. */
export const treasuryDomainTools: RegisteredTool[] = [
  defineTool(forecastTickerDefinition, forecastTickerHandler),
  defineTool(analyzePortfolioDefinition, analyzePortfolioHandler),
];
