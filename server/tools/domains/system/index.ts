/**
 * Tools-layer-split S3/S4 — system domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and (S4) registers the first
 * migrated handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { systemDomainTools } from "./handlers";

registerTools(systemDomainTools);

export {
  testApiKeysDefinition,
  checkSystemStatusDefinition,
  listModelsDefinition,
  templateScraperStatsDefinition,
  getUsageAnalyticsDefinition,
  systemDomainDefinitions,
} from "./definitions";

export { systemDomainTools } from "./handlers";
