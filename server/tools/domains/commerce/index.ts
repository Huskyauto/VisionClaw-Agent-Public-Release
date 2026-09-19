/**
 * Commerce domain — Sell & Fulfill slice barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Born-migrated domain. Payment-link metadata carries
 * ONLY the SKU; delivery happens exclusively via the Stripe webhook pipeline.
 */
import { registerTools } from "../../registry";
import { commerceDomainTools } from "./handlers";

registerTools(commerceDomainTools);

export {
  productListingCreateDefinition,
  productListingListDefinition,
  createPaymentLinkDefinition,
  commerceDomainDefinitions,
} from "./definitions";

export { commerceDomainTools } from "./handlers";
