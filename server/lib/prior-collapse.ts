// ─────────────────────────────────────────────────────────────────────────────
// Prior-collapse detection — the ONE borrow from the Bilevel Autoresearch
// paper (arXiv:2603.23420): an OUTER loop watches an INNER proposal loop and
// fires when a new proposal is SEMANTICALLY near-identical to an already
// rejected/failed prior — the "stuck prior" signal. Instead of burning another
// attempt on a proven-losing idea, the caller PERTURBS (injects a directive /
// skips the doomed verify) — "perturb, not retry".
//
// Complements server/agentic/stuck-detector.ts (exact-hash identical-output
// detection): this is the EMBEDDING-space near-dupe check that catches
// re-proposals with cosmetic rewording the hash can't see.
//
// Conventions (RULER precedent, R125+137.14):
//   • Quality signal → fails OPEN everywhere: embedding unavailable / throws ⇒
//     NOT collapsed. A detection error can never block a loop.
//   • Kill switch: PRIOR_COLLAPSE=off (default ON); threshold override
//     PRIOR_COLLAPSE_THRESHOLD (default 0.95, clamped to [0.5, 0.999]) —
//     conservative: a false positive costs a skipped attempt, so we only fire
//     on near-certain semantic dupes.
//   • Pure logic (cosine, maxSimilarityToPriors, serializers, env parsing) is
//     exported and unit-testable with NO LLM/DB; the embedding fetch is an
//     injectable EmbedFn whose default LAZY-imports server/embeddings.ts, so
//     this module is import-safe for tests.
//   • Loops OPT IN by constructing a tracker at their PRODUCTION entrypoint
//     (nightly script / defaultDeps) and passing it through the existing
//     injection seams — hermetic unit tests never touch the network.
// ─────────────────────────────────────────────────────────────────────────────

export interface CollapseVerdict {
  collapsed: boolean;
  /** Max cosine similarity vs remembered priors; null = unavailable (fail-open) or no priors. */
  similarity: number | null;
  /** Index of the closest remembered prior (present only when a comparison ran). */
  matchedPrior?: number;
  /**
   * TRUE when the check could not actually run (embedding outage / thrown
   * check). Distinguishes "verified not collapsed" from "infra failure —
   * unknown" so callers/telemetry can see collapse detection silently going
   * dark (silent-failure-hunter finding, 2026-07-14). Still fail-OPEN.
   */
  degraded?: true;
  /** Short reason when degraded (no stack — this is a quality signal, not an error path). */
  degradedReason?: string;
}

/** The seam shape loops accept — satisfied by PriorCollapseTracker and test stubs. */
export interface PriorCollapseLike {
  check(text: string): Promise<CollapseVerdict>;
  remember(text: string): Promise<void>;
}

export type EmbedFn = (text: string) => Promise<number[] | null>;

// ─── Env / config (pure, fail-open to defaults) ─────────────────────────────

export function priorCollapseEnabled(): boolean {
  const v = (process.env.PRIOR_COLLAPSE || "").trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

export function priorCollapseThreshold(): number {
  const raw = Number(process.env.PRIOR_COLLAPSE_THRESHOLD);
  if (!Number.isFinite(raw)) return 0.95;
  return Math.min(0.999, Math.max(0.5, raw));
}

// ─── Pure math ───────────────────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function maxSimilarityToPriors(
  candidate: number[],
  priors: number[][],
): { max: number; index: number } {
  let max = -Infinity;
  let index = -1;
  for (let i = 0; i < priors.length; i++) {
    const s = cosine(candidate, priors[i]);
    if (s > max) {
      max = s;
      index = i;
    }
  }
  return index === -1 ? { max: 0, index: -1 } : { max, index };
}

// ─── Proposal serializers (pure) ─────────────────────────────────────────────

/** Canonical text for a skill-optimizer bounded edit (op/target/text). */
export function renderSkillEditText(edit: { op: string; target?: string; text?: string }): string {
  return `${edit.op}\n${edit.target ?? ""}\n${edit.text ?? ""}`.slice(0, 8000);
}

/** Canonical text for a repo-surgeon fix proposal (the actual diff content). */
export function renderFixProposalText(p: {
  edits?: Array<{ path: string; find: string; replace: string }>;
  newFiles?: Array<{ path: string; content: string }>;
}): string {
  const parts: string[] = [];
  for (const e of p.edits ?? []) {
    parts.push(`EDIT ${e.path}\n<<<\n${e.find}\n===\n${e.replace}\n>>>`);
  }
  for (const f of p.newFiles ?? []) {
    parts.push(`NEW ${f.path}\n${f.content}`);
  }
  return parts.join("\n\n").slice(0, 8000);
}

// ─── Perturbation directives ─────────────────────────────────────────────────

export function buildPerturbationDirective(
  similarity: number | null,
  kind: "skill-edit" | "fix-proposal",
): string {
  const sim = similarity == null ? "very high" : `≈${similarity.toFixed(3)}`;
  if (kind === "skill-edit") {
    return (
      `PRIOR-COLLAPSE WARNING: your last proposal was near-identical (cosine ${sim}) to an edit ` +
      `that was ALREADY REJECTED by the validation gate. Do NOT re-propose it with cosmetic ` +
      `rewording. Propose a STRUCTURALLY DIFFERENT edit — a different op, a different target ` +
      `section of the document, or a different hypothesis about why the failing cases score low.`
    );
  }
  return (
    `PRIOR-COLLAPSE: the diff you proposed was near-identical (cosine ${sim}) to the previous ` +
    `attempt's diff, which ALREADY FAILED verification. Do NOT re-propose the same fix with ` +
    `cosmetic changes. Form a DIFFERENT root-cause hypothesis and propose a structurally ` +
    `different minimal diff (different file, different mechanism, or declare cannotFix).`
  );
}

// ─── Safe seam wrappers ──────────────────────────────────────────────────────
// The seams are OPT-IN and injectable (test doubles, future alt trackers).
// A throwing injected implementation must NEVER block the host loop — these
// wrappers force fail-OPEN at the call-site boundary regardless of the
// implementation behind the interface.

export async function safeCollapseCheck(
  tracker: PriorCollapseLike | undefined,
  text: string,
): Promise<CollapseVerdict> {
  if (!tracker) return { collapsed: false, similarity: null };
  try {
    return await tracker.check(text);
  } catch (e) {
    console.warn("[prior-collapse] check() threw — failing OPEN:", (e as any)?.message ?? e);
    return { collapsed: false, similarity: null, degraded: true, degradedReason: `check() threw: ${(e as any)?.message ?? String(e)}` };
  }
}

export async function safeCollapseRemember(
  tracker: PriorCollapseLike | undefined,
  text: string,
): Promise<void> {
  if (!tracker) return;
  try {
    await tracker.remember(text);
  } catch (e) {
    console.warn("[prior-collapse] remember() threw — failing OPEN:", (e as any)?.message ?? e);
  }
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PRIORS = 8;

async function defaultEmbed(text: string): Promise<number[] | null> {
  try {
    const { generateEmbedding } = await import("../embeddings");
    return await generateEmbedding(text);
  } catch {
    return null; // fail OPEN — a quality signal never blocks
  }
}

/**
 * Remembers the embeddings of prior (rejected/failed) proposals and checks each
 * new proposal against them. Both methods NEVER throw: any embedding failure
 * degrades to "not collapsed" / "not remembered".
 */
export class PriorCollapseTracker implements PriorCollapseLike {
  private priors: number[][] = [];
  private readonly threshold: number;
  private readonly maxPriors: number;
  private readonly embedFn: EmbedFn;
  private readonly enabled: boolean;

  constructor(opts: { threshold?: number; maxPriors?: number; embedFn?: EmbedFn; enabled?: boolean } = {}) {
    this.threshold =
      Number.isFinite(opts.threshold as number)
        ? Math.min(0.999, Math.max(0.5, opts.threshold as number))
        : priorCollapseThreshold();
    this.maxPriors = Math.max(1, opts.maxPriors ?? DEFAULT_MAX_PRIORS);
    this.embedFn = opts.embedFn ?? defaultEmbed;
    this.enabled = opts.enabled ?? priorCollapseEnabled();
  }

  get priorCount(): number {
    return this.priors.length;
  }

  async check(text: string): Promise<CollapseVerdict> {
    if (!this.enabled || this.priors.length === 0 || !text.trim()) {
      return { collapsed: false, similarity: null };
    }
    try {
      const emb = await this.embedFn(text);
      // degraded: embedding unavailable ≠ "verified not collapsed" — surface it
      // so callers/telemetry can see collapse detection going dark (2026-07-14).
      if (!emb || emb.length === 0) return { collapsed: false, similarity: null, degraded: true, degradedReason: "embedding unavailable" };
      const { max, index } = maxSimilarityToPriors(emb, this.priors);
      if (index === -1) return { collapsed: false, similarity: null };
      return { collapsed: max >= this.threshold, similarity: max, matchedPrior: index };
    } catch (e) {
      return { collapsed: false, similarity: null, degraded: true, degradedReason: `check threw: ${(e as any)?.message ?? String(e)}` }; // fail OPEN
    }
  }

  async remember(text: string): Promise<void> {
    if (!this.enabled || !text.trim()) return;
    try {
      const emb = await this.embedFn(text);
      if (!emb || emb.length === 0) return;
      this.priors.push(emb);
      if (this.priors.length > this.maxPriors) this.priors.shift();
    } catch (e) {
      // fail OPEN — nothing remembered, nothing blocked
      console.warn("[silent-catch] server/lib/prior-collapse.ts remember():", (e as any)?.message ?? e);
    }
  }
}
