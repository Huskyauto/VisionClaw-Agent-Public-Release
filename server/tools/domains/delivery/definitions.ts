/**
 * Tools-layer-split S22 — delivery-domain tool definitions.
 *
 * Selection: the 2 CONTIGUOUS delivery tools in both the legacy
 * TOOL_DEFINITIONS array and the legacy switch — `deliver_product` (the
 * digital-product delivery pipeline entry point; File Delivery HARD RULE) and
 * `delivery_status` (owner-only multi-channel delivery audit + retry).
 *
 * BOTH definitions AND both handlers move (unlike S21 media): neither switch
 * arm uses a tools.ts module-scope helper — `deliver_product` depends only on
 * app-graph modules (`./delivery-pipeline`, `./lib/outbound-redaction`, and the
 * `storage` singleton), all pulled via call-time dynamic import;
 * `delivery_status` depends only on `./delivery-pipeline`. `plan_deliverable`
 * is an agentic-domain tool and STAYS LEGACY per the smallest-safe-batch
 * precedent (S3).
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const deliverProductDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "deliver_product",
    description: "Full automated digital product delivery pipeline. Creates a dated subfolder in Google Drive, uploads the file, makes it publicly shareable, sends a branded delivery email to the customer, and logs the entire transaction. Use this for any order fulfillment or digital product delivery. Returns working download/folder links and delivery tracking ID. If no filePath is given, looks in uploads/ for the fileName.",
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer's full name (used for subfolder naming and email)" },
        customerEmail: { type: "string", description: "Customer's email address for delivery notification. If omitted, no email is sent but upload still happens." },
        productName: { type: "string", description: "Name of the product being delivered (shown in email and logs)" },
        fileName: { type: "string", description: "Name of the file to deliver (e.g. 'Contract.pdf')" },
        filePath: { type: "string", description: "Local file path. If omitted, looks in uploads/ for fileName" },
        orderId: { type: "string", description: "Optional order/invoice ID for tracking" },
        stripePaymentId: { type: "string", description: "Optional Stripe payment ID to link delivery to payment" },
        emailSubject: { type: "string", description: "Custom email subject line. Default: 'Your order is ready: {productName}'" },
        emailBody: { type: "string", description: "Custom email body text. Default: branded template with download link" },
      },
      required: ["customerName", "productName", "fileName"],
    },
  },
};

export const deliveryStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "delivery_status",
    description: "Use AFTER any send_message / scheduled-delivery to confirm receipt, when a recipient says \"I never got it\", or when auditing recent multi-channel deliveries. Returns delivery rows with channel, status (sent/delivered/failed), timestamp, and error. Includes a retry sub-op for failed deliveries.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["status", "list", "stats", "retry"], description: "Operation: status (check one), list (recent deliveries), stats (counts), retry (retry failed)" },
        deliveryId: { type: "number", description: "Delivery ID (for 'status' and 'retry')" },
        limit: { type: "number", description: "Max results for 'list' (default 50)" },
      },
      required: ["command"],
    },
  },
};

export const generateEvidenceDocketDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_evidence_docket",
    description: "Produce a portable, reviewer-facing Evidence Docket for a piece of work: one inspectable HTML + JSON artifact bundling the goal contract(s), completion-verification verdicts, jury concordance (κ), the security audit trail (intent-gate checks + tool-policy blocks), the delivery record, and a step-ledger replay pointer — everything an external or institutional reviewer needs to audit a deliverable end-to-end. All data is tenant-scoped; secrets/PII are redacted. Delivers the bundle via the standard delivery pipeline (self-hosted + Drive links) and returns the links. Use when asked for a provenance/audit report, an evidence pack, or proof of a deliverable's quality gates.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "number", description: "The conversation whose work to audit. Defaults to the current conversation." },
        orderId: { type: "string", description: "Optional order id to tie delivery-log rows exactly." },
        runId: { type: "string", description: "Optional step-ledger run id, recorded as the replay pointer." },
        productName: { type: "string", description: "Docket title shown in the artifact/email. Default: 'Evidence Docket'." },
        sendEmail: { type: "boolean", description: "Whether to email the docket to the tenant owner (or emailTo). Default true when a recipient resolves." },
        emailTo: { type: "string", description: "Override recipient email. Defaults to the tenant owner." },
        includeCustomerPii: { type: "boolean", description: "Keep customer email/phone in the docket. Default false (stripped for external reviewers)." },
      },
      required: [],
    },
  },
};

/** Full ordered set (facade array order), for any consumer that wants the
 * domain's definitions. */
export const deliveryDomainDefinitions: ToolDefinition[] = [
  deliverProductDefinition,
  deliveryStatusDefinition,
  generateEvidenceDocketDefinition,
];
