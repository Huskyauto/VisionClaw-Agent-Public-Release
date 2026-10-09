/**
 * Tools-layer-split S25l — finance-market-domain tool definitions.
 *
 * The 4 contiguous market-data tools (`finance_news`, `finance_stock_price`,
 * `finance_stock_search`, `finance_market_overview`) — all backed by
 * `server/finance-tools` (fetchFinanceNews / fetchStockPrice / searchStocks /
 * getMarketOverview), one thematically coherent cluster (external A-share / HK
 * market feeds + trending financial news). Distinct from the S17 finance domain
 * (invoicing/expenses/KPI, backed by `business-tools`) — different backing lib,
 * so a separate domain keeps the one-lib-per-domain coherence.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const financeNewsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "finance_news",
    description: "Fetch real-time financial and trending news from multiple global sources. Returns ranked headlines with links. Sources include Cailian Press, WallStreetCN, Xueqiu (Snowball), Hacker News, Weibo, Baidu, and more. Use for market research, trend monitoring, competitive intelligence, or staying current on financial markets.",
    parameters: {
      type: "object",
      properties: {
        sources: {
          type: "array",
          items: { type: "string", enum: ["cls", "wallstreetcn", "xueqiu", "weibo", "zhihu", "baidu", "toutiao", "thepaper", "36kr", "hackernews"] },
          description: "News sources to fetch from. Finance: cls (Cailian), wallstreetcn, xueqiu. Social: weibo, zhihu, baidu. Tech: 36kr, hackernews. Default: cls, wallstreetcn, hackernews",
        },
        count: { type: "number", description: "Number of headlines per source (1-20). Default: 10" },
      },
      required: [],
    },
  },
};

export const financeStockPriceDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "finance_stock_price",
    description: "Get historical stock price data (OHLCV) for A-Share and Hong Kong stocks. Returns daily open/high/low/close/volume with change percentages and a summary. Use for stock analysis, price tracking, trend identification, or financial reporting.",
    parameters: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Stock ticker code (e.g., '600519' for Kweichow Moutai, '00700' for Tencent HK). Must be a numeric code." },
        days: { type: "number", description: "Number of days of history to retrieve (1-365). Default: 30" },
      },
      required: ["ticker"],
    },
  },
};

export const financeStockSearchDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "finance_stock_search",
    description: "Search for stock tickers by company name or code. Supports A-Share (Shanghai/Shenzhen) and Hong Kong markets. Returns matching ticker codes and company names. Use when you need to find the ticker code for a company before looking up its price.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Company name or partial ticker code to search for (e.g., 'Moutai', '600519', 'Tencent')" },
        market: { type: "string", enum: ["a", "hk"], description: "Market to search: 'a' for A-Share (default), 'hk' for Hong Kong" },
      },
      required: ["query"],
    },
  },
};

export const financeMarketOverviewDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "finance_market_overview",
    description: "Get a snapshot of major market indices with current values and daily change percentages. Covers Chinese A-share market indices. Use for quick market pulse checks, daily briefings, or as context for financial analysis.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

/** All finance-market-domain definitions, in facade splice order. */
export const financeMarketDomainDefinitions: ToolDefinition[] = [
  financeNewsDefinition,
  financeStockPriceDefinition,
  financeStockSearchDefinition,
  financeMarketOverviewDefinition,
];
