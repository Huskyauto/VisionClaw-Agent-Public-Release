/**
 * Simulation Sandbox (S4) — domain barrel. Registers the two NEW tools
 * (sandbox_run / sandbox_report) at import time and re-exports definitions.
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 */
import { registerTools } from "../../registry";
import { sandboxDomainTools } from "./handlers";

registerTools(sandboxDomainTools);

export {
  sandboxRunDefinition,
  sandboxReportDefinition,
  sandboxDomainDefinitions,
} from "./definitions";

export { sandboxDomainTools } from "./handlers";
