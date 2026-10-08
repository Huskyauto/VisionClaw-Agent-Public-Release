/**
 * Tools-layer-split strategic-memory domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Tools (S26h): record_failure_pattern /
 * recall_failure_patterns (R98.7) + record_strategic_win / recall_strategic_wins
 * (R98.12 W7). All INLINE db logic against memory_entries (no backing lib).
 */
import { registerTools } from "../../registry";
import { strategicMemoryDomainTools } from "./handlers";

registerTools(strategicMemoryDomainTools);

export {
  recordFailurePatternDefinition,
  recallFailurePatternsDefinition,
  recordStrategicWinDefinition,
  recallStrategicWinsDefinition,
  strategicMemoryDomainDefinitions,
} from "./definitions";

export { strategicMemoryDomainTools } from "./handlers";
