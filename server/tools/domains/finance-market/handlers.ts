/**
 * Tools-layer-split S25l — finance-market-domain migrated handlers.
 *
 * Selection: the 4 contiguous market-data tools — `finance_news`,
 * `finance_stock_price`, `finance_stock_search`, `finance_market_overview`. All
 * backed by `server/finance-tools` (fetchFinanceNews / fetchStockPrice /
 * searchStocks / getMarketOverview), one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). NO trust
 * seam: the legacy arms read ZERO `_`-prefixed trust signals — they consume
 * only PUBLIC params (sources, count, ticker, days, query, market) and the
 * backing fns are tenant-agnostic external market feeds. `ctx` is therefore
 * unused (named `_ctx`). The ONLY edit vs the legacy arms is the relative
 * import path (`./finance-tools`→`../../../finance-tools`); the clamp math
 * (Math.min/Math.max), the "ticker is required" / "query is required" error
 * strings, and the `params.market || "a"` default are all verbatim. The backing
 * dependency (`../../../finance-tools`) is pulled via call-time dynamic
 * `import(...)` inside each handler — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; mirrors the
 * finance/tensions/memory/knowledge domains' dynamic-import seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  financeNewsDefinition,
  financeStockPriceDefinition,
  financeStockSearchDefinition,
  financeMarketOverviewDefinition,
} from "./definitions";

async function financeNewsHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { fetchFinanceNews } = await import("../../../finance-tools");
  const sources = Array.isArray(params.sources) ? params.sources : undefined;
  const count = Math.min(Math.max(params.count || 10, 1), 20);
  return fetchFinanceNews(sources, count);
}

async function financeStockPriceHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { fetchStockPrice } = await import("../../../finance-tools");
  if (!params.ticker) return { error: "ticker is required (e.g., '600519' for Moutai)" };
  const days = Math.min(Math.max(params.days || 30, 1), 365);
  return fetchStockPrice(params.ticker, days);
}

async function financeStockSearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { searchStocks } = await import("../../../finance-tools");
  if (!params.query) return { error: "query is required (company name or ticker code)" };
  return searchStocks(params.query, params.market || "a");
}

async function financeMarketOverviewHandler(
  _params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { getMarketOverview } = await import("../../../finance-tools");
  return getMarketOverview();
}

/** Registered by ./index.ts at import time. */
export const financeMarketDomainTools: RegisteredTool[] = [
  defineTool(financeNewsDefinition, financeNewsHandler),
  defineTool(financeStockPriceDefinition, financeStockPriceHandler),
  defineTool(financeStockSearchDefinition, financeStockSearchHandler),
  defineTool(financeMarketOverviewDefinition, financeMarketOverviewHandler),
];
