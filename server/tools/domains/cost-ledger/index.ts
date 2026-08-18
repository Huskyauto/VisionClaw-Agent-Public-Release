/**
 * Tools-layer-split S26c — cost-ledger domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (revenue_vs_cost / agent_cost_summary)
 * migrate their definitions AND handlers. Backed by server/agentic/cost-ledger.
 */
import { registerTools } from "../../registry";
import { costLedgerDomainTools } from "./handlers";

registerTools(costLedgerDomainTools);

export {
  revenueVsCostDefinition,
  agentCostSummaryDefinition,
  costLedgerDomainDefinitions,
} from "./definitions";

export { costLedgerDomainTools } from "./handlers";
