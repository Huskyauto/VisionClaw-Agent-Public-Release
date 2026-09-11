/**
 * Outbound quality gate — the app-wide self-healing modality (Bob directive
 * 2026-07-27: "the same solution ... should be across the whole app").
 *
 * One shared contract for EVERY surface that ships content to a customer or
 * the public (email bodies, social posts, video finals, standalone PDFs):
 *   1. SCAN  — scanCustomerFacingText() runs the $0 failure-mode checklist
 *              plus the section-placeholder prefixes over the outgoing text.
 *   2. BLOCK — a HARD finding means the content NEVER ships (fail-closed for
 *              quality, exactly like the audit/report section gate).
 *   3. REPORT — reportQualityIncident() files the failure with the self-repair
 *              loop (captureIncident → classify → dispatch remedy → escalate),
 *              fire-and-forget so the hot path never blocks on it.
 *
 * The SCAN itself is pure (no DB, no LLM, no imports with side effects) so it
 * is unit-testable with zero mocks. Internal scanner errors fail OPEN (a
 * scanner bug must never sink a legit delivery) but findings fail CLOSED.
 */
import { SECTION_PLACEHOLDER_PREFIXES } from "./deliverable-section-gate";
import { scanFailureModes } from "./deliverable-failure-modes";

export interface OutboundScanResult {
  blocked: boolean;
  reasons: string[];
  /** true when the scanner itself crashed and the result is fail-open, NOT a real "clean" verdict */
  degraded?: boolean;
}

// High-precision provider/API error text that has actually leaked into a
// customer deliverable before (Herchenbach audit incident, 2026-07): a raw
// HTTP error line pasted where content should be. Kept deliberately narrow —
// these shapes essentially never occur in legitimate customer copy.
const PROVIDER_ERROR_PATTERNS: RegExp[] = [
  /\bError:\s*\d{3}\s/, // "Error: 400 ..." raw status-code leak
  /\bUnsupported parameter\b/i,
  /\bmax_completion_tokens\b/,
  /\brate[_ ]limit[_ ]exceeded\b/i,
  /\bcontext[_ ]length[_ ]exceeded\b/i,
];

/**
 * Scan a piece of customer/public-facing text for generation-failure debris.
 * Pure, $0, fail-open on internal error.
 */
export function scanCustomerFacingText(text: string | undefined | null): OutboundScanResult {
  try {
    const t = String(text ?? "");
    const reasons: string[] = [];

    // The audit/report section placeholders — anywhere in the body, not just
    // at the start (an email/post can embed a failed section mid-document).
    for (const prefix of SECTION_PLACEHOLDER_PREFIXES) {
      if (t.includes(prefix)) {
        reasons.push(`section-failure placeholder present: "${prefix}..."`);
        break;
      }
    }

    for (const re of PROVIDER_ERROR_PATTERNS) {
      const m = re.exec(t);
      if (m) {
        reasons.push(`provider/API error text in outbound content: "${m[0].slice(0, 80).trim()}"`);
        break;
      }
    }

    // Shared HARD failure modes (AI meta leakage, unfilled placeholders,
    // runtime error tokens, truncation markers, effectively-empty content).
    const scan = scanFailureModes(t, { ext: ".txt" });
    reasons.push(...scan.blocking);

    return { blocked: reasons.length > 0, reasons };
  } catch (e) {
    // Fail-open BY DESIGN (a scanner bug must never sink a legit delivery),
    // but never silently: log loudly with the stack and mark the result
    // degraded so callers/telemetry can distinguish "clean" from "unscanned".
    console.error("[outbound-quality-gate] scanner crashed — content shipped UNSCANNED (fail-open)", e);
    return { blocked: false, reasons: [], degraded: true };
  }
}

export interface QualityIncidentInput {
  tenantId: number;
  signature: string; // stable dedup key, e.g. "email_quality_gate_blocked"
  title: string;
  error: string;
  stage: string; // e.g. "outbound-email", "scheduled-post", "video-finalize"
  candidateFiles?: string[];
  metadata?: any;
}

/**
 * File the blocked delivery with the self-repair loop. Fire-and-forget: the
 * dynamic import + .catch mean a repair-loop outage can never take down the
 * delivery path itself (mirrors the audit-fulfillment pattern).
 */
export function reportQualityIncident(input: QualityIncidentInput): void {
  import("../agentic/repair-incident")
    .then(({ captureIncident }) =>
      captureIncident({
        tenantId: input.tenantId,
        source: "felix_deliverable",
        title: input.title.slice(0, 200),
        signature: input.signature,
        error: input.error.slice(0, 2000),
        stage: input.stage,
        candidateFiles: input.candidateFiles,
        felixFailureKind: "verify_failed",
        metadata: input.metadata,
      }),
    )
    .catch((e: any) =>
      console.warn(`[outbound-quality-gate] incident capture failed (non-fatal): ${e?.message || e}`),
    );
}
