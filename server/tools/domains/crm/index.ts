/**
 * Tools-layer-split — crm domain barrel. Re-exports definitions for the legacy
 * facade's TOOL_DEFINITIONS splice, and registers the migrated handlers at
 * import time.
 */
import { registerTools } from "../../registry";
import { crmDomainTools } from "./handlers";

registerTools(crmDomainTools);

export {
  addCustomerDefinition,
  updateCustomerDefinition,
  listCustomersDefinition,
  logInteractionDefinition,
  customerPipelineDefinition,
  crmDomainDefinitions,
} from "./definitions";

export { crmDomainTools } from "./handlers";
