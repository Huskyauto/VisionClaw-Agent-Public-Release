/**
 * Tools-layer-split skill-evolution domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time. Tools: tool_performance_report (S26e) + the wellness fatigue pair
 * detect_fatigue / micro_sabbatical (S26g). All backed by server/skill-evolution.
 */
import { registerTools } from "../../registry";
import { skillEvolutionDomainTools } from "./handlers";

registerTools(skillEvolutionDomainTools);

export {
  toolPerformanceReportDefinition,
  detectFatigueDefinition,
  microSabbaticalDefinition,
  skillEvolutionDomainDefinitions,
} from "./definitions";

export { skillEvolutionDomainTools } from "./handlers";
