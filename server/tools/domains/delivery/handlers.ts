/**
 * Tools-layer-split S22 — delivery-domain migrated handlers.
 *
 * Selection: BOTH delivery tools migrate — `deliver_product` and
 * `delivery_status`. Neither switch arm uses a tools.ts module-scope helper:
 * `deliver_product` depends only on `./delivery-pipeline`
 * (deliverDigitalProduct), `./lib/outbound-redaction` (enforceOutbound), and
 * the `storage` singleton — all pulled via call-time dynamic import (the
 * memory/knowledge domains already dynamic-import `storage`; server/storage.ts
 * does NOT import the tools facade, so this stays acyclic). `delivery_status`
 * depends only on `./delivery-pipeline`. `plan_deliverable` is an
 * agentic-domain tool and STAYS LEGACY per the smallest-safe-batch precedent
 * (S3).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate, error strings verbatim).
 * The ONLY edit is the caller-supplied `params._tenantId` read becoming
 * `ctx.tenantId` (the dispatcher strips + re-stamps it from the trusted
 * context). No gate is added or removed:
 *   - `deliver_product` keeps its R95 outbound-redaction gate on the
 *     agent-supplied email subject/body verbatim (returns `{ error }` on a
 *     blocked payload; appends the `redactionWarning` when a payload was
 *     redacted-but-allowed) and its tenant-email backfill via
 *     `storage.getTenant`.
 *   - `delivery_status` keeps its owner-only guard verbatim (the inline
 *     `ADMIN_TENANT_ID = 1` const and the `!== ADMIN_TENANT_ID` early return)
 *     plus the per-tenant scoping of every read; after the guard TS narrows
 *     `ctx.tenantId` to a number, matching the legacy `params._tenantId`.
 *
 * External dependencies are pulled via call-time dynamic `import(...)` inside
 * each handler — NOT top-level static imports — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2; same seam S8–S21 used). No tools.ts
 * module-scope helpers moved (none owned by the migrated pair).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  deliverProductDefinition,
  deliveryStatusDefinition,
  generateEvidenceDocketDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function deliverProductHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // FAIL CLOSED on missing tenant context: deliver_product forwards
  // ctx.tenantId into the delivery pipeline, which defaults a missing tenant
  // to the admin tenant (1). An incomplete/nonstandard invocation that omits
  // tenant context must NOT silently attribute a customer delivery (logs +
  // signed links) to the admin tenant — require a valid tenant explicitly
  // (post-edit-code-review MEDIUM, 2026-07-09).
  if (!Number.isInteger(ctx.tenantId as any) || (ctx.tenantId as number) <= 0) {
    return { error: "Tenant context required to deliver a product." };
  }
  const { deliverDigitalProduct } = await import("../../../delivery-pipeline");
  const filePath = params.filePath || `uploads/${params.fileName}`;
  let customerEmail = params.customerEmail;
  let customerName = params.customerName;
  if (!customerEmail && ctx.tenantId) {
    const { storage } = await import("../../../storage");
    const t = await storage.getTenant(ctx.tenantId);
    if (t) {
      customerEmail = t.email;
      customerName = customerName || t.name;
    }
  }
  // R95 — gate the agent-supplied email subject/body of the customer
  // delivery email (the file payload itself is binary and not scanned
  // here; if scanning of delivered file contents is desired add it to
  // delivery-pipeline directly).
  const { enforceOutbound } = await import("../../../lib/outbound-redaction");
  let emailSubject = params.emailSubject;
  let emailBody = params.emailBody;
  let redacted = false;
  if (typeof emailSubject === "string" && emailSubject.length > 0) {
    const g = enforceOutbound(emailSubject, { surface: "deliver_product:subject" });
    if (!g.ok) return { error: g.error };
    emailSubject = g.payload; redacted ||= g.redacted;
  }
  if (typeof emailBody === "string" && emailBody.length > 0) {
    const g = enforceOutbound(emailBody, { surface: "deliver_product:body" });
    if (!g.ok) return { error: g.error };
    emailBody = g.payload; redacted ||= g.redacted;
  }
  const result = await deliverDigitalProduct({
    tenantId: ctx.tenantId,
    customerName,
    customerEmail,
    productName: params.productName,
    fileName: params.fileName,
    filePath,
    orderId: params.orderId,
    stripePaymentId: params.stripePaymentId,
    emailSubject,
    emailBody,
    sendEmail: !!customerEmail,
  });
  return redacted ? { ...(result as any), redactionWarning: "Outbound payload redacted by R95 safety gate." } : result;
}

async function deliveryStatusHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // delivery_logs now carries a per-tenant column (tenant_id, backfilled to
  // the owner tenant). This management tool stays owner-restricted as
  // defense in depth; every read below is ALSO tenant-scoped to the caller
  // so it can never surface another tenant's customer PII / download links.
  const ADMIN_TENANT_ID = 1;
  if (ctx.tenantId !== ADMIN_TENANT_ID) {
    return { error: "delivery_status is restricted to the platform owner. Customer-facing order lookup uses /api/orders/:sessionId." };
  }
  const dp = await import("../../../delivery-pipeline");
  switch (params.command) {
    case "status":
      if (!params.deliveryId) return { error: "deliveryId required" };
      // getDeliveryStatus returns DeliveryLog | null; legacy flowed the null
      // through executeTool's loose `any` return. Cast only bridges the
      // stricter migrated-handler ToolResult contract (type-only, no behavior
      // change) — the null passthrough is preserved verbatim.
      return dp.getDeliveryStatus(params.deliveryId, ctx.tenantId) as any;
    case "list":
      return dp.listDeliveries(params.limit || 50, 0, ctx.tenantId);
    case "stats":
      return dp.getDeliveryStats(ctx.tenantId);
    case "retry":
      if (!params.deliveryId) return { error: "deliveryId required" };
      return dp.retryDelivery(params.deliveryId, ctx.tenantId);
    default:
      return { error: "Unknown command. Use: status, list, stats, retry" };
  }
}

// generate_evidence_docket — assembles the portable per-deliverable Evidence
// Docket (goal contract + verification verdicts + jury κ + security audit +
// replay pointer), tenant-scoped, then delivers it via the standard pipeline
// (File Delivery HARD RULE). Reads tenant + conversation from the trusted ctx
// (the dispatcher strips + re-stamps them); the caller MAY override the audited
// conversation via params.conversationId, but every gathered row is still
// scoped to ctx.tenantId so no cross-tenant read is possible.
async function generateEvidenceDocketHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) {
    return { error: "generate_evidence_docket requires a tenant context." };
  }
  const conversationId =
    typeof params.conversationId === "number" ? params.conversationId : ctx.conversationId;

  const { buildEvidenceDocket } = await import("../../../evidence-docket");
  // Advisory per-run rigor knob (PROOF_LOOPS L1–L5). parseProofLevel is
  // fail-open: an unrecognized value falls back to the L2 default rather than
  // erroring — the level only tunes docket strictness, never gates execution.
  const { parseProofLevel } = await import("../../../lib/proof-level");
  const proofLevel = parseProofLevel(params.proofLevel) ?? undefined;
  const built = await buildEvidenceDocket({
    tenantId: ctx.tenantId,
    conversationId,
    orderId: typeof params.orderId === "string" ? params.orderId : undefined,
    runId: typeof params.runId === "string" ? params.runId : undefined,
    includeCustomerPii: params.includeCustomerPii === true,
    proofLevel,
  });

  // Stage the artifact + machine-readable sidecar in uploads/ for the delivery
  // pipeline (which self-hosts + secret-scans fail-closed before it ships).
  const fs = await import("node:fs");
  const path = await import("node:path");
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const base = `evidence-docket-${ctx.tenantId}-${conversationId ?? "adhoc"}-${Date.now()}`;
  const htmlName = `${base}.html`;
  const jsonName = `${base}.json`;
  const htmlPath = path.join(uploadsDir, htmlName);
  const jsonPath = path.join(uploadsDir, jsonName);
  fs.writeFileSync(htmlPath, built.html, "utf8");
  fs.writeFileSync(jsonPath, built.json, "utf8");

  // Recipient: explicit emailTo, else the tenant owner (mirrors deliver_product).
  let customerEmail = typeof params.emailTo === "string" ? params.emailTo : undefined;
  let customerName: string | undefined;
  if (!customerEmail) {
    const { storage } = await import("../../../storage");
    const t = await storage.getTenant(ctx.tenantId);
    if (t) {
      customerEmail = t.email;
      customerName = t.name;
    }
  }
  const sendEmail = params.sendEmail !== false && !!customerEmail;

  const { deliverDigitalProduct } = await import("../../../delivery-pipeline");
  const productName =
    typeof params.productName === "string" && params.productName.length > 0
      ? params.productName
      : "Evidence Docket";
  const result = await deliverDigitalProduct({
    tenantId: ctx.tenantId,
    customerName: customerName || "Reviewer",
    customerEmail,
    productName,
    fileName: htmlName,
    filePath: htmlPath,
    additionalFiles: [
      { fileName: jsonName, filePath: jsonPath, description: "Machine-readable Evidence Docket (JSON)" },
    ],
    sendEmail,
    emailSubject: `Evidence Docket — ${built.docket.summary.overallVerdict}`,
    emailBody: `Attached is the portable Evidence Docket for conversation ${conversationId ?? "(ad-hoc)"}. Overall verdict: ${built.docket.summary.overallVerdict}. It bundles the goal contract, verification verdicts, jury concordance, security audit trail, delivery record, and a replay pointer for end-to-end review.`,
  });

  return {
    success: (result as any).success,
    deliveryId: (result as any).deliveryId,
    downloadLink: (result as any).downloadLink,
    shareableLink: (result as any).shareableLink,
    folderLink: (result as any).folderLink,
    verdict: built.docket.summary.overallVerdict,
    proofLevel: built.docket.proofLevel.level,
    proofDebt: built.docket.proofDebt,
    summary: built.docket.summary,
    redactionClasses: built.docket.redactionClasses,
  };
}

/** Registered by ./index.ts at import time. */
export const deliveryDomainTools: RegisteredTool[] = [
  defineTool(deliverProductDefinition, deliverProductHandler),
  defineTool(deliveryStatusDefinition, deliveryStatusHandler),
  defineTool(generateEvidenceDocketDefinition, generateEvidenceDocketHandler),
];
