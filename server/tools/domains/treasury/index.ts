/**
 * Tools-layer-split S25m — treasury domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 market-forecast tools (forecast_ticker,
 * analyze_portfolio) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { treasuryDomainTools } from "./handlers";

registerTools(treasuryDomainTools);

export {
  forecastTickerDefinition,
  analyzePortfolioDefinition,
  treasuryDomainDefinitions,
} from "./definitions";

export { treasuryDomainTools } from "./handlers";
