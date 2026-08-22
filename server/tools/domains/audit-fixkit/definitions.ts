/**
 * Audit Fix Kit domain — tool definition for `generate_audit_fix_kit`, the
 * done-for-you remediation generator behind the $1,997 /audit DFY tier.
 * Born in the new tools package (girth-gate hard rule — no new legacy arms).
 */

import type { ToolDefinition } from "../../types";

export const generateAuditFixKitDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "generate_audit_fix_kit",
    description:
      "Generate the done-for-you AI-Readiness Fix Kit for an audited website: llms.txt written from the site's real content, validated schema.org JSON-LD, corrected head meta tags, AI-crawler robots.txt rules, and a prioritized punch-list README — packaged as a single zip under uploads/. Every LLM-written file is grounded on the actually-fetched page (no invented facts) and validated fail-closed; excluded files are reported in issues[]. Use when fulfilling a $1,997 done-for-you audit order, when Bob asks to 'build the fixes' for an audited site, or to prep a remediation package before a sales call. Does NOT deliver anything — pass the returned filePath to deliver_product (or the review queue) for the HITL-gated ship.",
    parameters: {
      type: "object",
      properties: {
        website: { type: "string", description: "The customer's website URL (https://…)" },
        company: { type: "string", description: "Business name as it should appear in the generated files" },
        industry: { type: "string", description: "Optional industry hint from intake" },
      },
      required: ["website", "company"],
    },
  },
};

export const auditFixkitDomainDefinitions: ToolDefinition[] = [generateAuditFixKitDefinition];
