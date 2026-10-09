/**
 * Tools-layer-split S6 — security domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { securityDomainTools } from "./handlers";

registerTools(securityDomainTools);

export {
  scanForSecretsDefinition,
  agentSecurityScanDefinition,
  complianceAuditDefinition,
  verifyOutboundSafetyDefinition,
  scanForPromptInjectionDefinition,
  securityDomainDefinitions,
} from "./definitions";

export { securityDomainTools } from "./handlers";
