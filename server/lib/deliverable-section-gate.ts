// Deliverable section quality gate — the fail-closed check that keeps a
// customer-facing PDF (AI readiness audit, research report) from shipping
// with "(This section could not be generated ...)" placeholder text inside.
//
// Contract (self-repair loop, dispatch-not-just-detect):
//   1. After the generation pass, callers run findFailedSectionIndices().
//   2. Failed sections get ONE full retry pass (the transient-infra remedy
//      the "retry" routing owns — the fulfillment IS the retry loop owner).
//   3. If any section is STILL a placeholder, the fulfillment must return
//      success:false (never ship the PDF) AND capture a repair incident so
//      the self-repair loop classifies/escalates it. Shipping error text to
//      a paying customer is never an acceptable outcome.
//
// Pure module: no imports, no side effects — unit-testable with zero mocks.

/**
 * Prefixes generateSection() error paths emit. Any section body that starts
 * with one of these (after trim) is a FAILED section, not customer content.
 */
export const SECTION_PLACEHOLDER_PREFIXES = [
  "(This section could not be generated",
  "(No content generated",
] as const;

/**
 * Builders for the placeholder strings generateSection() emits — the ONLY
 * place these literals live. Generators must use these (never hand-write the
 * text) so the gate's prefix check can never drift from what is emitted.
 */
export function buildErrorPlaceholder(errMessage: string | undefined, product: "audit" | "report"): string {
  return `${SECTION_PLACEHOLDER_PREFIXES[0]} automatically. Error: ${(errMessage || "unknown").slice(0, 200)}. Please contact support and we will regenerate this ${product} or refund.)`;
}

export function buildNoContentPlaceholder(suffix?: string): string {
  return `${SECTION_PLACEHOLDER_PREFIXES[1]} for this section. The agent may need to retry.${suffix ? ` ${suffix}` : ""})`;
}

/** True when a section body is empty or a generation-failure placeholder. */
export function isFailedSectionBody(body: string | undefined | null): boolean {
  const t = (body ?? "").trim();
  if (!t) return true;
  return SECTION_PLACEHOLDER_PREFIXES.some((p) => t.startsWith(p));
}

/** Indices of failed sections in a generated-body array (order preserved). */
export function findFailedSectionIndices(bodies: Array<string | undefined | null>): number[] {
  const out: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    if (isFailedSectionBody(bodies[i])) out.push(i);
  }
  return out;
}

/**
 * Human-readable summary for the failure error / incident detail, e.g.
 * `3/10 sections failed: "Executive Summary", "Risks & Compliance Notes", …`
 */
export function describeFailedSections(
  headings: string[],
  failedIndices: number[],
  total: number,
): string {
  const names = failedIndices.slice(0, 5).map((i) => `"${headings[i] ?? `#${i + 1}`}"`);
  const more = failedIndices.length > 5 ? `, +${failedIndices.length - 5} more` : "";
  return `${failedIndices.length}/${total} sections failed generation: ${names.join(", ")}${more}`;
}
