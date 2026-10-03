/**
 * Tools-layer-split S25l — finance-market domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers
 * the migrated handlers at import time. The 4 market-data tools
 * (finance_news, finance_stock_price, finance_stock_search,
 * finance_market_overview) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { financeMarketDomainTools } from "./handlers";

registerTools(financeMarketDomainTools);

export {
  financeNewsDefinition,
  financeStockPriceDefinition,
  financeStockSearchDefinition,
  financeMarketOverviewDefinition,
  financeMarketDomainDefinitions,
} from "./definitions";

export { financeMarketDomainTools } from "./handlers";
