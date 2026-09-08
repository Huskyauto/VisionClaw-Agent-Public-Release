/**
 * Audit Fix Kit domain barrel — registers handlers at import time and
 * re-exports definitions for the facade splice.
 */
import { registerTools } from "../../registry";
import { auditFixkitDomainTools } from "./handlers";

registerTools(auditFixkitDomainTools);

export { generateAuditFixKitDefinition, auditFixkitDomainDefinitions } from "./definitions";
export { auditFixkitDomainTools } from "./handlers";
