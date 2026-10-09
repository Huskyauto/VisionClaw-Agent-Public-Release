/**
 * Tools-layer-split S22 — delivery domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. BOTH tools migrate (definitions AND handlers).
 */
import { registerTools } from "../../registry";
import { deliveryDomainTools } from "./handlers";

registerTools(deliveryDomainTools);

export {
  deliverProductDefinition,
  deliveryStatusDefinition,
  generateEvidenceDocketDefinition,
  deliveryDomainDefinitions,
} from "./definitions";

export { deliveryDomainTools } from "./handlers";
