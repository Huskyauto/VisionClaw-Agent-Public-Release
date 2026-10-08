import { createHash } from "node:crypto";

// Increment when assessment rules change so older receipts cannot match anew.
export const EVIDENCE_OBSERVER_VERSION = "source-observation-v1.1" as const;
export const EVIDENCE_LIMITS = { output: 16_000, sources: 6, sourceChars: 24_000, units: 60, semanticUnits: 12 } as const;
export interface EvidenceSource {
  id: string;
  title: string;
  text: string;
  tenantId: number;
  provenance: "supplied_context" | "retrieved_context";
  locator?: string;
  asOf?: string;
}
export interface EvidenceInput { tenantId: number; output: string; sources?: EvidenceSource[] }
type UnitStatus = "unresolved" | "exact_source_match" | "possible_conflict" | "provisional_support" | "provisional_conflict";
export interface EvidenceUnit {
  id: string;
  text: string;
  status: UnitStatus;
  evidence: { sourceId: string; quote: string }[];
  arithmetic?: { correct: boolean; computed: number; stated: number };
}
export interface EvidenceObservation {
  version: typeof EVIDENCE_OBSERVER_VERSION;
  mode: "observe";
  verified: false;
  completeFactualCoverage: false;
  sourceIndependenceEstablished: false;
  sourceAuthenticityEstablished: false;
  tenantId: number;
  outputSha256: string;
  sourcePackSha256: string;
  observationId: string;
  status: "observed" | "no_sources" | "unavailable" | "disabled";
  reason?: string;
  sources: (Omit<EvidenceSource, "text" | "tenantId"> & { sha256: string })[];
  units: EvidenceUnit[];
  coverage: { totalUnits: number; examinedUnits: number; omittedUnits: number };
  sourceCoverage: { suppliedCount: number; examinedCount: number; uniqueContentCount: number };
  semanticReview: "not_run" | "completed" | "partial" | "unavailable";
  semanticCoverage: { requestedUnits: number; assessedUnits: number };
  audit: { persisted: boolean; activityId?: number; state: "not_attempted" | "persisted" | "unconfirmed"; evidenceRetained?: "source_spans" | "hashes_only" };
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
function sentences(text: string): string[] {
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .flatMap(part => part.segment.split(/\n+/)).map(clean).filter(Boolean);
}
function sourceError(tenantId: number, sources: EvidenceSource[]): string | undefined {
  if (!Array.isArray(sources) || sources.length > EVIDENCE_LIMITS.sources) return "invalid_source_pack";
  const seen = new Set<string>();
  let chars = 0;
  for (const s of sources) {
    if (!s || s.tenantId !== tenantId || typeof s.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) ||
        seen.has(s.id) || typeof s.title !== "string" || !s.title.trim() || s.title.length > 200 ||
        typeof s.text !== "string" || !s.text.trim() ||
        !["supplied_context", "retrieved_context"].includes(s.provenance) ||
        (s.locator !== undefined && (typeof s.locator !== "string" || s.locator.length > 500)) ||
        (s.asOf !== undefined && (typeof s.asOf !== "string" || s.asOf.length > 100))) return "invalid_source_pack";
    chars += s.text.length;
    if (chars > EVIDENCE_LIMITS.sourceChars) return "source_pack_over_limit";
    seen.add(s.id);
  }
}
function packHash(sources: EvidenceSource[]): string {
  return hash(JSON.stringify(sources.map(s => ({
    id: s.id, title: s.title, sha256: hash(s.text), tenantId: s.tenantId,
    provenance: s.provenance, locator: s.locator ?? null, asOf: s.asOf ?? null,
  }))));
}
function identity(tenantId: number, outputHash: string, sourceHash: string): string {
  return hash(JSON.stringify([EVIDENCE_OBSERVER_VERSION, tenantId, outputHash, sourceHash]));
}
function canonicalNumericValue(value: string): string {
  // Compare decimal spelling exactly, without binary floating-point rounding.
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").replaceAll(",", "").split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimal = fraction.replace(/0+$/, "");
  const sign = value.startsWith("-") && (integer !== "0" || decimal) ? "-" : "";
  return sign + integer + (decimal ? "." + decimal : "");
}
function numericKey(text: string): { key: string; value: string } | null {
  // Only the final numeric value may vary: preceding dates/entities stay exact.
  // This is a possible lexical conflict, never a semantic contradiction proof.
  const matches = [...text.matchAll(/[-+]?\d+(?:,\d{3})*(?:\.\d+)?/g)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;
  return { key: text.slice(0, last.index) + "<value>" + text.slice(last.index + last[0].length), value: canonicalNumericValue(last[0]) };
}
function arithmetic(text: string): EvidenceUnit["arithmetic"] {
  const m = text.match(/^(-?\d+(?:\.\d+)?)\s*([+*/×÷-])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)\.?$/);
  if (!m) return undefined;
  const a = Number(m[1]), b = Number(m[3]), stated = Number(m[4]);
  const computed = m[2] === "+" ? a + b : m[2] === "-" ? a - b :
    (m[2] === "*" || m[2] === "×") ? a * b : a / b;
  return { correct: Number.isFinite(computed) && Math.abs(computed - stated) <= 1e-9 * Math.max(1, Math.abs(computed)), computed, stated };
}
export function observeEvidence(input: EvidenceInput): EvidenceObservation {
  const output = typeof input.output === "string" ? input.output : "";
  const rawSources = input.sources ?? [];
  const error = !Number.isInteger(input.tenantId) || input.tenantId <= 0 ? "invalid_tenant" :
    !output.trim() || output.length > EVIDENCE_LIMITS.output ? "output_over_limit_or_empty" : sourceError(input.tenantId, rawSources);
  const sources = error ? [] : rawSources;
  const outputSha256 = hash(output);
  const sourcePackSha256 = error ? hash("invalid-source-pack") : packHash(sources);
  const allUnits = error ? [] : sentences(output);
  const sourceUnits = sources.flatMap(s => sentences(s.text).map(text => ({ sourceId: s.id, text })));
  const units: EvidenceUnit[] = allUnits.slice(0, EVIDENCE_LIMITS.units).map((text, i) => {
    const calculation = arithmetic(text);
    const key = numericKey(text);
    const conflicts = key ? sourceUnits.filter(s => {
      const other = numericKey(s.text);
      return other && other.key === key.key && other.value !== key.value;
    }) : [];
    const matches = text.length >= 12 ? sourceUnits.filter(s => s.text === text) : [];
    const selected = conflicts.length ? conflicts : matches;
    return {
      id: `u${i + 1}`, text,
      status: conflicts.length || calculation?.correct === false ? "possible_conflict" : matches.length ? "exact_source_match" : "unresolved",
      evidence: selected.slice(0, 3).map(s => ({ sourceId: s.sourceId, quote: s.text.slice(0, 600) })),
      arithmetic: calculation,
    };
  });
  return {
    version: EVIDENCE_OBSERVER_VERSION, mode: "observe", verified: false,
    completeFactualCoverage: false, sourceIndependenceEstablished: false, sourceAuthenticityEstablished: false,
    tenantId: input.tenantId, outputSha256, sourcePackSha256,
    observationId: identity(input.tenantId, outputSha256, sourcePackSha256),
    status: error ? "unavailable" : sources.length ? "observed" : "no_sources", reason: error,
    sources: sources.map(({ text, tenantId: _tenant, ...s }) => ({ ...s, sha256: hash(text) })),
    units, coverage: { totalUnits: allUnits.length, examinedUnits: units.length, omittedUnits: allUnits.length - units.length },
    sourceCoverage: { suppliedCount: Array.isArray(rawSources) ? rawSources.length : 0, examinedCount: sources.length, uniqueContentCount: new Set(sources.map(s => hash(s.text))).size },
    semanticReview: "not_run", semanticCoverage: { requestedUnits: 0, assessedUnits: 0 },
    audit: { persisted: false, state: "not_attempted" },
  };
}
/** Arithmetic has its own deterministic check; do not spend an AI call on it. */
export function semanticUnits(receipt: EvidenceObservation): EvidenceUnit[] {
  return receipt.units.slice(0, EVIDENCE_LIMITS.semanticUnits).filter(u => u.status === "unresolved" && !u.arithmetic);
}
export function observationMatches(receipt: EvidenceObservation, input: EvidenceInput): boolean {
  if (receipt.version !== EVIDENCE_OBSERVER_VERSION || receipt.status === "unavailable" || receipt.status === "disabled") return false;
  const fresh = observeEvidence(input);
  return fresh.status !== "unavailable" && receipt.tenantId === fresh.tenantId &&
    receipt.outputSha256 === fresh.outputSha256 && receipt.sourcePackSha256 === fresh.sourcePackSha256 &&
    receipt.observationId === fresh.observationId;
}
/** A semantic vote is advisory; checked quotations establish existence, not entailment. */
export function applySemanticReview(receipt: EvidenceObservation, raw: unknown, sources: EvidenceSource[] = []): EvidenceObservation {
  const eligible = semanticUnits(receipt);
  const failed = { ...receipt, semanticReview: "unavailable" as const, semanticCoverage: { requestedUnits: eligible.length, assessedUnits: 0 } };
  if (!Array.isArray(raw) || raw.length > EVIDENCE_LIMITS.semanticUnits ||
      receipt.status !== "observed" || sourceError(receipt.tenantId, sources) || packHash(sources) !== receipt.sourcePackSha256) {
    return failed;
  }
  const byId = new Map(sources.map(s => [s.id, s.text]));
  const seen = new Set<string>();
  const valid = new Map<string, { verdict: string; evidence: EvidenceUnit["evidence"] }>();
  for (const j of raw) {
    if (!j || typeof j.unitId !== "string" || seen.has(j.unitId) ||
        !eligible.some(u => u.id === j.unitId) ||
        !["supported", "contradicted", "conflicting", "insufficient"].includes(j.verdict) ||
        !Array.isArray(j.evidence) || j.evidence.length > 3) return failed;
    seen.add(j.unitId);
    const evidence = j.evidence.filter((e: any) => e && typeof e.sourceId === "string" &&
      typeof e.quote === "string" && e.quote.length >= 12 && e.quote.length <= 600 &&
      byId.get(e.sourceId)?.includes(e.quote));
    if (evidence.length !== j.evidence.length || (j.verdict !== "insufficient" && !evidence.length)) continue;
    valid.set(j.unitId, { verdict: j.verdict, evidence });
  }
  return {
    ...receipt, semanticReview: valid.size === eligible.length ? "completed" : "partial",
    semanticCoverage: { requestedUnits: eligible.length, assessedUnits: valid.size },
    units: receipt.units.map(u => {
      const j = valid.get(u.id);
      if (!j || u.status !== "unresolved" || j.verdict === "insufficient") return u;
      return { ...u, status: j.verdict === "supported" ? "provisional_support" : "provisional_conflict", evidence: j.evidence };
    }),
  };
}