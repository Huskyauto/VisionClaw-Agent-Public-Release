// RULER-style relative group ranking (OpenPipe ART borrow, 2026-07-12).
//
// Technique imported from OpenPipe's RULER ("Easy Mode for RL Rewards",
// openpipe.ai/blog/ruler-easy-mode-for-rl-rewards; repo github.com/openpipe/art).
// Instead of absolute-scoring ONE output against a rubric (which needs a
// calibrated scale and ceiling-effects near the top), RULER shows the judge a
// GROUP of N candidate outputs for the same task and asks for scores assigned
// RELATIVE to each other in a single call. Relative judgment is the thing LLM
// judges are actually good at — "which of these is better" is far more stable
// than "what absolute number does this deserve" — and it needs no hand-written
// reward function and no golden labels.
//
// Why it lives here: same reason as BINEVAL (server/lib/bineval.ts) — the
// skill-optimizer nightly reward function is the documented bottleneck of the
// self-improvement loop. This module is wired into runEvaluatorAB as a THIRD
// judge measured against the holistic scalar and BINEVAL judges on the SAME
// before/after outputs. Pure MEASUREMENT: it never changes what the optimizer
// ships. Evaluation is a QUALITY signal, not a safety gate, so every LLM path
// FAILS OPEN — any failure yields `null` and the caller records the ruler lane
// as unavailable rather than disturbing the nightly run.
//
// Anti-bias mechanics:
//  - Candidates are presented under ANONYMOUS labels (CANDIDATE 1..N) in a
//    seeded-shuffled order, so the judge can't learn "the second one is the
//    upgraded doc" and position bias is decorrelated across cases.
//  - Parsing FAILS CLOSED to null (not a partial result): every candidate must
//    receive exactly one finite score, or the whole group is discarded —
//    a group where only some candidates were scored is not a relative ranking.
//
// Providers are imported LAZILY inside rulerRankGroup so the pure logic
// (parseRulerGroupScores, seededShuffleIndices, summarizeRulerPairs) is
// import-safe and unit-testable with no LLM and no DB.

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RulerCandidate {
  /** Caller-meaningful id (e.g. "before" / "after"). Never shown to the judge. */
  id: string;
  output: string;
}

export interface RulerScore {
  id: string;
  /** Relative score 0..1 (meaningful only WITHIN the group). */
  score: number;
  rationale?: string;
}

// ─── Pure helpers (deterministic, no I/O — unit-tested) ──────────────────────

/** Deterministic PRNG (mulberry32) so the shuffle is reproducible per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded Fisher–Yates: returns a permutation of [0..n-1]. position[k] = which
 * original candidate index is shown as CANDIDATE k+1.
 */
export function seededShuffleIndices(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rnd = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function extractJsonArray(raw: string): any[] | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse the judge's response for a group of `n` candidates. Returns one entry
 * per presented position (1-based `candidate` label), or `null` when the
 * response is not a complete relative ranking: every label 1..n must appear
 * EXACTLY once with a finite numeric score (clamped to 0..1). Null ≠ empty —
 * the caller fails open on null.
 */
export function parseRulerGroupScores(
  raw: string,
  n: number,
): Array<{ position: number; score: number; rationale?: string }> | null {
  const arr = extractJsonArray(raw);
  if (!arr) return null;
  const byPos = new Map<number, { position: number; score: number; rationale?: string }>();
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const posRaw = (e as any).candidate;
    const pos = typeof posRaw === "number" ? posRaw : typeof posRaw === "string" ? Number(posRaw) : NaN;
    if (!Number.isInteger(pos) || pos < 1 || pos > n) continue;
    if (byPos.has(pos)) return null; // duplicate label → not a clean ranking
    const s = (e as any).score;
    if (typeof s !== "number" || !Number.isFinite(s)) return null;
    byPos.set(pos, {
      position: pos,
      score: Math.max(0, Math.min(1, s)),
      rationale: typeof (e as any).rationale === "string" ? (e as any).rationale : undefined,
    });
  }
  if (byPos.size !== n) return null; // incomplete group → discard whole ranking
  return Array.from({ length: n }, (_, i) => byPos.get(i + 1)!);
}

export interface RulerPairSummary {
  cases: number;
  before: number;
  after: number;
  delta: number;
  /** Fraction of DECISIVE cases where the AFTER doc out-ranked the BEFORE doc: wins/(wins+losses); ties excluded entirely (0 when no decisive cases). */
  winRate: number;
  wins: number;
  ties: number;
  losses: number;
}

/** Aggregate per-case relative before/after scores into a win-rate summary. */
export function summarizeRulerPairs(
  pairs: Array<{ before: number; after: number }>,
): RulerPairSummary {
  let beforeSum = 0;
  let afterSum = 0;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const p of pairs) {
    beforeSum += p.before;
    afterSum += p.after;
    if (p.after > p.before) wins++;
    else if (p.after < p.before) losses++;
    else ties++;
  }
  const n = pairs.length;
  return {
    cases: n,
    before: n > 0 ? beforeSum / n : 0,
    after: n > 0 ? afterSum / n : 0,
    delta: n > 0 ? afterSum / n - beforeSum / n : 0,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    wins,
    ties,
    losses,
  };
}

// ─── LLM-backed group ranking (provider imported lazily; FAILS OPEN → null) ──

const MAX_OUTPUT_CHARS = 6000; // per-candidate cap so a runaway output can't blow the prompt

/**
 * RULER-style relative ranking of a group of candidate outputs for ONE task.
 * A single judge call sees all candidates (anonymized + seeded-shuffled) and
 * assigns scores relative to each other. Returns one RulerScore per candidate
 * (caller ids restored), or `null` on any failure / incomplete ranking.
 */
export async function rulerRankGroup(
  task: string,
  candidates: RulerCandidate[],
  opts: { rubric?: string; reference?: string; model: string; tenantId?: number; seed?: number },
): Promise<RulerScore[] | null> {
  if (candidates.length < 2) return null; // relative ranking needs a group
  const ids = new Set(candidates.map((c) => c.id));
  if (ids.size !== candidates.length) return null; // duplicate ids → ambiguous mapping
  try {
    const { replitOpenai } = await import("../providers");
    const n = candidates.length;
    const seed = Number.isFinite(opts.seed) ? (opts.seed as number) : 1;
    const order = seededShuffleIndices(n, seed);
    const blocks = order
      .map((origIdx, k) => {
        const out = candidates[origIdx].output;
        const clipped = out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + "\n…[truncated]" : out;
        return `### CANDIDATE ${k + 1}\n${clipped}`;
      })
      .join("\n\n");
    const rubric = opts.rubric ? `\nEvaluation rubric:\n${opts.rubric}\n` : "";
    const ref = opts.reference ? `\nReference / gold answer:\n${opts.reference}\n` : "";
    const prompt =
      `You are ranking ${n} candidate answers to the SAME task RELATIVE to each other. ` +
      `Do not grade against an absolute standard — compare the candidates directly and ` +
      `spread your scores to reflect the quality differences you see (the best candidate ` +
      `should score near 1.0; clearly weaker candidates should score meaningfully lower). ` +
      `Identical quality may tie.\n\n` +
      `Task:\n${task}\n${rubric}${ref}\n${blocks}\n\n` +
      `Return ONLY a JSON array with EXACTLY one entry per candidate:\n` +
      `[{"candidate": <1..${n}>, "score": <0..1>, "rationale": "<short>"}]`;
    const comp = await replitOpenai.chat.completions.create({
      model: opts.model,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseRulerGroupScores(comp.choices?.[0]?.message?.content ?? "", n);
    if (!parsed) return null;
    // Map presented positions back to caller ids: position k+1 showed candidates[order[k]].
    return parsed.map((p) => ({
      id: candidates[order[p.position - 1]].id,
      score: p.score,
      rationale: p.rationale,
    }));
  } catch {
    return null;
  }
}
