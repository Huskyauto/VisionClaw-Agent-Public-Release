import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { opportunityBankFileDefinition, ownerBusinessOverviewDefinition } from "./definitions";
import {
  createArrayOverviewSource,
  parseOwnerBusinessOverviewParams,
  readOwnerBusinessOverview,
  type OverviewSection,
  type OverviewSource,
} from "../../../lib/owner-business-overview";

async function overviewHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!Number.isSafeInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0 || ctx.personaId !== 2)
    return { error: "Owner Felix context required" };
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (ctx.tenantId !== ownerTenantId()) return { error: "Owner tenant required" };
  try {
    parseOwnerBusinessOverviewParams(params);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid overview arguments" };
  }
  try {
    const [
      { countStoredIncomeOpportunities, readStoredIncomeOpportunityPage, INCOME_OPPORTUNITIES },
      { countProductsForOverview, readProductsPageForOverview },
      { getPublicCatalog },
      { OWNER_SERVICE_OFFERINGS },
    ] = await Promise.all([
      import("../../../lib/income-opportunities"),
      import("../../../lib/commerce-catalog"),
      import("../../../product-catalog"),
      import("../../../lib/owner-service-offerings"),
    ]);
    const tenantId = ctx.tenantId as number;
    const sources: Record<OverviewSection, OverviewSource> = {
      storedIdeas: {
        count: () => countStoredIncomeOpportunities(tenantId),
        page: (offset, limit) => readStoredIncomeOpportunityPage(tenantId, offset, limit),
      },
      builtinIdeas: createArrayOverviewSource(INCOME_OPPORTUNITIES),
      registeredProducts: {
        count: () => countProductsForOverview(tenantId),
        page: (offset, limit) => readProductsPageForOverview(tenantId, offset, limit),
      },
      builtinProducts: createArrayOverviewSource(getPublicCatalog()),
      serviceOfferings: createArrayOverviewSource(OWNER_SERVICE_OFFERINGS),
    };
    return await readOwnerBusinessOverview(params, sources);
  } catch (err) {
    console.error("[owner-business-overview] read failed", err);
    return { error: "Owner overview data is unavailable; coverage is unknown. Do not infer empty inventory or zero sales." };
  }
}

async function fileHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!Number.isSafeInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0 || ctx.personaId !== 2) {
    return { error: "Only Felix in the owner tenant can file an opportunity" };
  }
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (ctx.tenantId !== ownerTenantId()) return { error: "Opportunity Bank is owner-only" };
  if (process.env.INCOME_OPPORTUNITY_FILING_ENABLED === "0") return { error: "Opportunity filing is disabled" };
  const { fileIncomeOpportunitySchema } = await import("@shared/schema");
  const parsed = fileIncomeOpportunitySchema.safeParse(params);
  if (!parsed.success) return { error: "Invalid opportunity fields", details: parsed.error.flatten() };
  try {
    const { fileIncomeOpportunity } = await import("../../../lib/income-opportunities");
    const { opportunity, created } = await fileIncomeOpportunity(ctx.tenantId as number, parsed.data);
    return { success: true, created, id: opportunity.id, slug: opportunity.slug, evidence: opportunity.evidence, location: "/admin/income-opportunities" };
  } catch (err) {
    console.error("[income-opportunities] filing failed", err);
    return { error: "Opportunity could not be saved. Do not claim it was filed." };
  }
}

export const incomeOpportunityDomainTools: RegisteredTool[] = [
  defineTool(opportunityBankFileDefinition, fileHandler),
  defineTool(ownerBusinessOverviewDefinition, overviewHandler),
];