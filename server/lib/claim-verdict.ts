/**
 * Claim-verdict taxonomy + gate — PURE logic, no LLM, no providers, no DB.
 *
 * Split out of cove-verifier.ts so this can be unit-tested in isolation:
 * cove-verifier imports ../providers, which has a top-level setInterval that
 * keeps the event loop alive and would hang the node:test runner at exit.
 * Everything here is a pure function over plain data.
 *
 * Concept emulated (NOT copied) from the ARS "Claim Verification Protocol"
 * (Phase E) reviewed 2026-06-30. See cove-verifier.ts gradeClaims() for the
 * LLM-driven orchestration that consumes these.
 */

export type ClaimVerdict =
  | "VERIFIED"
  | "MINOR_DISTORTION"
  | "MAJOR_DISTORTION"
  | "UNVERIFIABLE"
  | "UNVERIFIABLE_ACCESS";

export type VerdictGate = "PASS" | "PASS_WITH_NOTES" | "FAIL";

export interface ClaimGrade {
  claim: string;
  question: string;
  independentAnswer: string;
  verdict: ClaimVerdict;
  detail: string;
}

export interface ClaimVerdictReport {
  mode: "draft" | "final";
  totalClaims: number;
  sampledClaims: number;
  samplingRatio: number;
  grades: ClaimGrade[];
  counts: Record<ClaimVerdict, number>;
  gate: VerdictGate;
  modelUsed: string;
  durationMs: number;
  warning?: string;
}

export function emptyVerdictCounts(): Record<ClaimVerdict, number> {
  return { VERIFIED: 0, MINOR_DISTORTION: 0, MAJOR_DISTORTION: 0, UNVERIFIABLE: 0, UNVERIFIABLE_ACCESS: 0 };
}

/**
 * Pure gate logic. PASS iff zero MAJOR_DISTORTION AND zero UNVERIFIABLE.
 * MINOR_DISTORTION / UNVERIFIABLE_ACCESS downgrade to PASS_WITH_NOTES but do
 * not block.
 */
export function computeVerdictGate(counts: Record<ClaimVerdict, number>): VerdictGate {
  if ((counts.MAJOR_DISTORTION || 0) > 0 || (counts.UNVERIFIABLE || 0) > 0) return "FAIL";
  if ((counts.MINOR_DISTORTION || 0) > 0 || (counts.UNVERIFIABLE_ACCESS || 0) > 0) return "PASS_WITH_NOTES";
  return "PASS";
}

/**
 * Pure sample-size logic. final → all; draft → at least `minSample`, otherwise
 * ceil(ratio * total), capped at total.
 */
export function planSampleSize(total: number, mode: "draft" | "final", ratio = 0.3, minSample = 5): number {
  if (total <= 0) return 0;
  if (mode === "final") return total;
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.3;
  const floor = Number.isFinite(minSample) ? Math.max(0, Math.floor(minSample)) : 5;
  const k = Math.ceil(r * total);
  return Math.min(total, Math.max(floor, k));
}

/** Evenly-strided distinct indices so a draft sample spans the whole document. */
export function strideSampleIndices(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 0) return [];
  const idxs = new Set<number>();
  for (let i = 0; i < k; i++) idxs.add(Math.min(n - 1, Math.floor((i * n) / k)));
  return Array.from(idxs).sort((a, b) => a - b);
}

/** Normalize a free-text verdict label to the canonical enum, or null. */
export function normalizeVerdict(s: string): ClaimVerdict | null {
  const up = String(s || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (up === "VERIFIED" || up === "MINOR_DISTORTION" || up === "MAJOR_DISTORTION" || up === "UNVERIFIABLE" || up === "UNVERIFIABLE_ACCESS") {
    return up as ClaimVerdict;
  }
  return null;
}
