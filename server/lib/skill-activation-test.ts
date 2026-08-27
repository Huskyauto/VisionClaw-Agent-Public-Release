/**
 * Skill activation / trigger-precision test.
 *
 * Concept lifted from the "Turn YouTube Videos Into Claude Skills" workflow,
 * step 04 "Test First (5 related, 3 unrelated)": before a skill goes live, prove
 * it ACTIVATES on queries it should handle and stays QUIET on unrelated ones.
 *
 * Why this matters here: skills are selected purely by semantic similarity
 * between the user's query and the skill's description+body (see `recall_capabilities`
 * / `skillSearch`). The existing jury gates a skill's CONTENT (reusability,
 * correctness, safety) — nothing measures its TRIGGER precision. An over-broad
 * description silently surfaces the skill on unrelated queries (noise); an
 * over-narrow one never loads (dead skill). This test makes that measurable.
 *
 * The verdict is margin-based and therefore embedding-model-agnostic: it does not
 * rely on a magic absolute cosine threshold. The core question is discrimination —
 * is the WORST related probe still more similar to the skill than the BEST
 * unrelated probe, by a margin? A soft absolute floor only catches the degenerate
 * "everything is low-similarity" case.
 *
 * Pure logic with an injected `embed` fn (testable offline). Fail-open by design:
 * if embeddings are unavailable or probes are insufficient, `ran=false` and the
 * caller should treat the skill as un-evaluated, NOT rejected — this is a quality
 * signal, not a safety gate.
 */

export interface ActivationProbeResult {
  query: string;
  similarity: number;
  expected: "fire" | "quiet";
  ok: boolean;
}

export interface ActivationPrecisionReport {
  ran: boolean;
  pass: boolean;
  margin: number;
  fireFloor: number;
  quietCeiling: number;
  falseTriggers: ActivationProbeResult[];
  misses: ActivationProbeResult[];
  probes: ActivationProbeResult[];
  summary: string;
  reason?: string;
}

export interface ActivationTestOptions {
  /** The text a query is matched against at selection time (name + description + body). */
  skillText: string;
  /** Probe queries that SHOULD surface this skill. */
  relatedProbes: string[];
  /** Probe queries that should NOT surface this skill. */
  unrelatedProbes: string[];
  /** Embedding fn — injected for testability. Returns null on failure. */
  embed: (text: string) => Promise<number[] | null>;
  /** Required separation between the worst related and best unrelated probe. */
  minMargin?: number;
  /** Soft absolute floor for related probes (catches "all low similarity"). */
  absoluteFloor?: number;
  /** Minimum probe counts to consider the test meaningful. */
  minRelated?: number;
  minUnrelated?: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function unevaluated(reason: string): ActivationPrecisionReport {
  return {
    ran: false,
    pass: false,
    margin: 0,
    fireFloor: 0,
    quietCeiling: 0,
    falseTriggers: [],
    misses: [],
    probes: [],
    summary: `not evaluated: ${reason}`,
    reason,
  };
}

export async function evaluateActivationPrecision(
  opts: ActivationTestOptions,
): Promise<ActivationPrecisionReport> {
  const minMargin = opts.minMargin ?? 0.05;
  const absoluteFloor = opts.absoluteFloor ?? 0.15;
  const minRelated = opts.minRelated ?? 2;
  const minUnrelated = opts.minUnrelated ?? 1;

  const related = (opts.relatedProbes || []).map(s => (s || "").trim()).filter(Boolean);
  const unrelated = (opts.unrelatedProbes || []).map(s => (s || "").trim()).filter(Boolean);
  const skillText = (opts.skillText || "").trim();

  if (!skillText) return unevaluated("empty skill text");
  if (related.length < minRelated) return unevaluated(`need >= ${minRelated} related probes (got ${related.length})`);
  if (unrelated.length < minUnrelated) return unevaluated(`need >= ${minUnrelated} unrelated probes (got ${unrelated.length})`);

  // Fully fail-open: a throwing embedder must yield ran=false, never propagate.
  const safeEmbed = async (text: string): Promise<number[] | null> => {
    try {
      return await opts.embed(text);
    } catch {
      return null;
    }
  };

  const skillVec = await safeEmbed(skillText);
  if (!skillVec || skillVec.length === 0) return unevaluated("skill embedding unavailable");

  const embedProbe = async (query: string, expected: "fire" | "quiet"): Promise<ActivationProbeResult | null> => {
    const v = await safeEmbed(query);
    if (!v || v.length === 0) return null;
    return { query, similarity: cosine(skillVec, v), expected, ok: false };
  };

  const fireResults = (await Promise.all(related.map(q => embedProbe(q, "fire")))).filter(
    (r): r is ActivationProbeResult => r !== null,
  );
  const quietResults = (await Promise.all(unrelated.map(q => embedProbe(q, "quiet")))).filter(
    (r): r is ActivationProbeResult => r !== null,
  );

  if (fireResults.length < minRelated || quietResults.length < minUnrelated) {
    return unevaluated("too many probe embeddings failed");
  }

  const fireFloor = Math.min(...fireResults.map(r => r.similarity));
  const quietCeiling = Math.max(...quietResults.map(r => r.similarity));
  const margin = fireFloor - quietCeiling;

  // A related probe "misses" if it sinks into the quiet band or below the floor.
  const misses = fireResults.filter(r => r.similarity < absoluteFloor || r.similarity <= quietCeiling);
  // An unrelated probe "false-triggers" if it climbs into the fire band.
  const falseTriggers = quietResults.filter(r => r.similarity >= fireFloor);

  for (const r of fireResults) r.ok = r.similarity >= absoluteFloor && r.similarity > quietCeiling;
  for (const r of quietResults) r.ok = r.similarity < fireFloor;

  const pass = margin >= minMargin && misses.length === 0 && falseTriggers.length === 0;

  const probes = [...fireResults, ...quietResults];
  const summary =
    `${pass ? "PASS" : "FAIL"} margin=${margin.toFixed(3)} ` +
    `fireFloor=${fireFloor.toFixed(3)} quietCeil=${quietCeiling.toFixed(3)} ` +
    `(${fireResults.length} related, ${quietResults.length} unrelated, ` +
    `${falseTriggers.length} false-trigger${falseTriggers.length === 1 ? "" : "s"}, ` +
    `${misses.length} miss${misses.length === 1 ? "" : "es"})`;

  return { ran: true, pass, margin, fireFloor, quietCeiling, falseTriggers, misses, probes, summary };
}
