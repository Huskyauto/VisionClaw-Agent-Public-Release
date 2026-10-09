import { registerTools } from "../../registry";
import { cmmcProspectingDomainTools } from "./handlers";

registerTools(cmmcProspectingDomainTools);

export { discoverCmmcProspectsDefinition, lookupSamCompanyCageDefinition, lookupSamExactCompanyDefinition, cmmcProspectingDomainDefinitions } from "./definitions";
export { cmmcProspectingDomainTools } from "./handlers";
export { configureCmmcProspectingService } from "./service";