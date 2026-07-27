/**
 * Tools-layer-split S26a — department-budgets domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 2 tools (set_department_budget /
 * check_department_budget) migrate their definitions AND handlers.
 * Backed by server/agentic/department-budgets.
 */
import { registerTools } from "../../registry";
import { departmentBudgetsDomainTools } from "./handlers";

registerTools(departmentBudgetsDomainTools);

export {
  setDepartmentBudgetDefinition,
  checkDepartmentBudgetDefinition,
  departmentBudgetsDomainDefinitions,
} from "./definitions";

export { departmentBudgetsDomainTools } from "./handlers";
