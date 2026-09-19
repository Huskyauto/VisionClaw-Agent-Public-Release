/**
 * Audit Fix Kit domain — handler. Trust signals come from ctx (dispatcher
 * strips + re-stamps), never from params. Business logic lives in
 * server/audit-fix-kit.ts, pulled via call-time dynamic import (acyclic).
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { generateAuditFixKitDefinition } from "./definitions";

async function generateAuditFixKitHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Fail closed on missing tenant context — the kit spends LLM budget and
  // writes into uploads/; cost attribution must land on a real tenant.
  if (!Number.isInteger(ctx.tenantId as any) || (ctx.tenantId as number) <= 0) {
    return { error: "Tenant context required to generate a Fix Kit." };
  }
  const website = String(params.website || "").trim();
  const company = String(params.company || "").trim();
  if (!website || !company) {
    return { error: "Both website and company are required." };
  }
  const { generateAuditFixKit } = await import("../../../audit-fix-kit");
  const kit = await generateAuditFixKit({
    website,
    company,
    industry: params.industry ? String(params.industry) : undefined,
    tenantId: ctx.tenantId as number,
    orderId: `tool-${Date.now().toString(36)}`,
  });
  if (!kit.success) {
    return { error: kit.error || "Fix Kit generation failed", issues: kit.issues };
  }
  return {
    success: true,
    filePath: kit.filePath,
    fileName: kit.fileName,
    files: kit.files.map((f) => ({ fileName: f.fileName, installNote: f.installNote })),
    issues: kit.issues,
    auditScore: kit.audit?.overallScore,
    auditGrade: kit.audit?.grade,
    modelUsed: kit.modelUsed,
    nextStep:
      kit.issues.length > 0
        ? "Kit is DEGRADED — review issues[] before delivering; excluded files need manual authoring."
        : "Review the zip, then ship via deliver_product (HITL) — never email raw links yourself.",
  };
}

/** Registered by ./index.ts at import time. */
export const auditFixkitDomainTools: RegisteredTool[] = [
  defineTool(generateAuditFixKitDefinition, generateAuditFixKitHandler),
];
