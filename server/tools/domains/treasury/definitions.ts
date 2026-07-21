/**
 * Tools-layer-split S25m — treasury-domain tool definitions.
 *
 * The 2 contiguous market-forecast tools (`forecast_ticker`,
 * `analyze_portfolio`) — both backed by `server/treasury` (forecastTicker /
 * analyzePortfolio), one thematically coherent cluster (structural market
 * analysis; never buy/sell advice). Distinct from the S25l finance-market
 * domain (external A-share/HK feeds, backed by `finance-tools`) — different
 * backing lib, so a separate domain keeps the one-lib-per-domain coherence.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const forecastTickerDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "forecast_ticker",
    description: "Generate a directional market forecast for a single stock/crypto symbol over the next N trading days. Pulls 90 days of free OHLC history, computes SMAs + volatility, then asks an LLM analyst for a calibrated trend (bullish/bearish/neutral) + confidence + reasoning. Returns structural analysis ONLY — never specific price targets, never buy/sell advice.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol (e.g. 'AAPL', 'MSFT', 'BTC.V'). US equities auto-suffixed with '.us'." },
        horizonDays: { type: "number", description: "Forecast horizon in trading days. Default 30. Max 365." },
      },
      required: ["symbol"],
    },
  },
};

export const analyzePortfolioDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "analyze_portfolio",
    description: "Analyze a portfolio of holdings: fetches live prices, computes weights, concentration risk (HIGH/MODERATE/LOW), HHI-based diversification score (0-100), and structural recommendations. NEVER returns buy/sell advice — only structural observations like rebalancing or sector exposure. Caps at 25 positions per call.",
    parameters: {
      type: "object",
      properties: {
        holdings: {
          type: "array",
          description: "Array of positions",
          items: { type: "object", properties: { symbol: { type: "string" }, shares: { type: "number" } }, required: ["symbol", "shares"] },
        },
      },
      required: ["holdings"],
    },
  },
};

/** All treasury-domain definitions, in facade splice order. */
export const treasuryDomainDefinitions: ToolDefinition[] = [
  forecastTickerDefinition,
  analyzePortfolioDefinition,
];
