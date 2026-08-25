// BINEVAL — training-free binary-question evaluator.
//
// Technique imported from "Ask, Don't Judge: Binary Questions for Interpretable
// LLM Evaluation and Self-Improvement" (arXiv:2606.27226). Instead of asking an
// LLM judge for a single opaque holistic score (which ceiling-effects around
// ~0.85 and can't discriminate borderline-vs-clearly-flawed outputs), BINEVAL
// decomposes a task's rubric into ATOMIC yes/no questions, answers each one
// independently against the candidate output, and aggregates the verdicts into
// an interpretable, multi-dimensional score PLUS question-level feedback that is
// directly usable for prompt optimization.
//
// Why it lives here: VisionClaw's skill-optimizer nightly reward function is the
// documented bottleneck of that whole self-improvement loop. This module is
// wired into that loop as a NON-BLOCKING A/B against the current scalar judge
// (see runEvaluatorAB + scripts/skill-optimize-nightly.ts) so we can MEASURE
// whether the binary decomposition discriminates better before it ever changes
// what ships. Evaluation is a QUALITY signal, not a safety gate, so every LLM
// path here FAILS OPEN — a generation/answer failure yields `null` and the
// caller falls back to the existing holistic grade rather than hard-failing the
// nightly run.
//
// Providers are imported LAZILY inside the LLM functions so the pure aggregation
// logic (aggregateBinVerdicts) is import-safe and unit-testable with no LLM.

import { logSilentCatch } from "./silent-catch";

// ─── Types ──────────────────────────────────────────────────────────────────

/** One atomic, independently-answerable yes/no evaluation question. */
export interface BinQuestion {
  id: string;
  /** Human-readable dimension this question probes (e.g. "factual consistency"). */
  dimension: string;
  /** The yes/no question. "Yes" MUST mean the output is good on this point. */
  question: string;
  /** Optional relative weight (default 1). */
  weight?: number;
}

/** One independent verdict for a question against a candidate output. */
export interface BinVerdict {
  id: string;
  /** true = the output satisfies the question ("yes" = good). */
  verdict: boolean;
  /** Short evidence/justification for the verdict. */
  evidence?: string;
}

export interface BinevalResult {
  /** Weighted fraction of "yes" verdicts across ANSWERED questions, 0..1. */
  score: number;
  /** Number of questions that received a parseable verdict. */
  answered: number;
  /** Per-dimension weighted yes-fraction, 0..1. */
  dimensions: Record<string, number>;
  /** The questions used. */
  questions: BinQuestion[];
  /** The verdicts collected. */
  verdicts: BinVerdict[];
  /** Failed-question feedback ("[dimension] question — evidence"), for prompt optimization. */
  failed: string[];
}

// ─── Pure aggregation (deterministic, no I/O — unit-tested) ──────────────────

function qWeight(q: BinQuestion): number {
  const w = q.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

/**
 * Aggregate independent binary verdicts into an interpretable multi-dimensional
 * score. Only ANSWERED questions count toward the denominator (a missing verdict
 * is neither a pass nor a penalty — the caller decides fallback when
 * `answered === 0`). "Yes" = good, so score is the weighted yes-fraction.
 */
export function aggregateBinVerdicts(
  questions: BinQuestion[],
  verdicts: BinVerdict[],
): BinevalResult {
  const byId = new Map<string, BinVerdict>();
  for (const v of verdicts) if (v && typeof v.id === "string") byId.set(v.id, v);

  let num = 0;
  let den = 0;
  let answered = 0;
  const dimNum = new Map<string, number>();
  const dimDen = new Map<string, number>();
  const failed: string[] = [];

  for (const q of questions) {
    const v = byId.get(q.id);
    if (!v || typeof v.verdict !== "boolean") continue; // unanswered → excluded
    answered++;
    const w = qWeight(q);
    den += w;
    dimDen.set(q.dimension, (dimDen.get(q.dimension) ?? 0) + w);
    if (v.verdict) {
      num += w;
      dimNum.set(q.dimension, (dimNum.get(q.dimension) ?? 0) + w);
    } else {
      failed.push(
        `[${q.dimension}] ${q.question}${v.evidence ? ` — ${v.evidence}` : ""}`,
      );
    }
  }

  const dimensions: Record<string, number> = {};
  for (const [dim, d] of dimDen) dimensions[dim] = d > 0 ? (dimNum.get(dim) ?? 0) / d : 0;

  return {
    score: den > 0 ? num / den : 0,
    answered,
    dimensions,
    questions,
    verdicts,
    failed,
  };
}

// ─── JSON extraction (tolerant of prose / code fences) ───────────────────────

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

// ─── LLM-backed steps (providers imported lazily; FAIL OPEN → null/[]) ───────

const MAX_QUESTIONS = 12;

/**
 * Meta-prompt: decompose a task + rubric into atomic yes/no questions. Depends
 * ONLY on the task/rubric/reference (NOT the candidate output), so callers
 * should generate ONCE per case and reuse the questions across every output
 * being compared — same yardstick = fair, stable, cheaper.
 */
export async function generateBinaryQuestions(
  task: string,
  opts: { rubric?: string; reference?: string; model: string; tenantId?: number; maxQuestions?: number },
): Promise<BinQuestion[]> {
  const cap = Math.max(3, Math.min(opts.maxQuestions ?? MAX_QUESTIONS, MAX_QUESTIONS));
  try {
    const { replitOpenai } = await import("../providers");
    const rubric = opts.rubric
      ? `Evaluation rubric:\n${opts.rubric}`
      : "Evaluation rubric: correctness, completeness, factual consistency, and concision.";
    const ref = opts.reference ? `\n\nReference / gold answer:\n${opts.reference}` : "";
    const prompt =
      `You design EVALUATION QUESTIONS for grading answers to a task. Decompose the ` +
      `rubric into ${cap} or fewer ATOMIC, independently-checkable YES/NO questions. ` +
      `Each question MUST be phrased so that "yes" means the answer is GOOD on that point ` +
      `(never ambiguous, never compound — split "accurate and concise" into two). Group ` +
      `each under a short dimension label.\n\n` +
      `Task:\n${task}\n\n${rubric}${ref}\n\n` +
      `Return ONLY a JSON array: [{"dimension":"<short label>","question":"<yes/no question>","weight":<optional number>}]`;
    const comp = await replitOpenai.chat.completions.create({
      model: opts.model,
      messages: [{ role: "user", content: prompt }],
    });
    const arr = extractJsonArray(comp.choices?.[0]?.message?.content ?? "");
    if (!arr) return [];
    const out: BinQuestion[] = [];
    for (let i = 0; i < arr.length && out.length < cap; i++) {
      const e = arr[i];
      if (!e || typeof e.question !== "string" || !e.question.trim()) continue;
      out.push({
        id: `q${out.length + 1}`,
        dimension: typeof e.dimension === "string" && e.dimension.trim() ? e.dimension.trim() : "general",
        question: e.question.trim(),
        weight: typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight > 0 ? e.weight : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Answer each question against ONE candidate output. Batched into a single
 * grader call (each question still gets its OWN verdict + evidence — the paper's
 * "independent per-question judgment" is preserved at the verdict grain) to keep
 * the loop affordable on the $0 modelfarm lane. FAILS OPEN → [].
 */
export async function answerBinaryQuestions(
  task: string,
  output: string,
  questions: BinQuestion[],
  opts: { model: string; tenantId?: number },
): Promise<BinVerdict[]> {
  if (questions.length === 0) return [];
  try {
    const { replitOpenai } = await import("../providers");
    const qBlock = questions.map((q) => `${q.id}: ${q.question}`).join("\n");
    const prompt =
      `Judge a candidate answer against a checklist of YES/NO questions. Answer EACH ` +
      `question INDEPENDENTLY based ONLY on the candidate answer and task. "yes" = the ` +
      `answer satisfies the question. Give one short evidence phrase per verdict.\n\n` +
      `Task:\n${task}\n\nCandidate answer:\n${output}\n\nQuestions:\n${qBlock}\n\n` +
      `Return ONLY a JSON array: [{"id":"<id>","verdict":true|false,"evidence":"<short>"}]`;
    const comp = await replitOpenai.chat.completions.create({
      model: opts.model,
      messages: [{ role: "user", content: prompt }],
    });
    const arr = extractJsonArray(comp.choices?.[0]?.message?.content ?? "");
    if (!arr) return [];
    const out: BinVerdict[] = [];
    for (const e of arr) {
      if (!e || typeof e.id !== "string") continue;
      if (typeof e.verdict !== "boolean") continue;
      out.push({ id: e.id, verdict: e.verdict, evidence: typeof e.evidence === "string" ? e.evidence : undefined });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Full BINEVAL score for ONE output. Pass pre-generated `questions` to reuse the
 * same yardstick across outputs (recommended); otherwise they are generated
 * here. Returns `null` when questions could not be generated OR nothing was
 * answered (caller FAILS OPEN to the holistic grade).
 */
export async function binevalScoreOutput(args: {
  task: string;
  output: string;
  rubric?: string;
  reference?: string;
  questions?: BinQuestion[];
  model: string;
  tenantId?: number;
  maxQuestions?: number;
}): Promise<BinevalResult | null> {
  const questions =
    args.questions && args.questions.length > 0
      ? args.questions
      : await generateBinaryQuestions(args.task, {
          rubric: args.rubric,
          reference: args.reference,
          model: args.model,
          tenantId: args.tenantId,
          maxQuestions: args.maxQuestions,
        });
  if (questions.length === 0) return null;
  const verdicts = await answerBinaryQuestions(args.task, args.output, questions, {
    model: args.model,
    tenantId: args.tenantId,
  });
  const agg = aggregateBinVerdicts(questions, verdicts);
  if (agg.answered === 0) return null;
  return agg;
}

// ─── A/B: BINEVAL vs the existing holistic scalar judge ──────────────────────

export interface EvaluatorABConfig {
  targetModel: string;
  graderModel: string;
  /** Model for BINEVAL question gen + answering (defaults to graderModel). $0 modelfarm lane. */
  binevalModel?: string;
  tenantId?: number;
  /** Cap the number of eval cases used for the A/B (cost bound). Default 8. */
  maxCases?: number;
  maxQuestions?: number;
  /**
   * Measure the RULER-style relative group-ranking judge (server/lib/ruler-rank.ts)
   * on the same outputs as a third lane. Default true; fully fail-open.
   */
  rulerEnabled?: boolean;
}

export interface EvaluatorABResult {
  cases: number;
  /** Holistic scalar judge (the current reward fn) before vs after the upgrade. */
  holistic: { before: number; after: number; delta: number };
  /** BINEVAL binary-question judge before vs after. */
  bineval: {
    available: boolean;
    before: number;
    after: number;
    delta: number;
    dimensionsAfter: Record<string, number>;
    /** Sample of still-failing questions on the AFTER doc (prompt-optimization signal). */
    failedAfter: string[];
  };
  /**
   * RULER-style relative group ranking (OpenPipe ART borrow): per case, the
   * judge sees BOTH outputs anonymized + shuffled and scores them RELATIVE to
   * each other — no absolute scale, no hand-written reward fn. `winRate` is the
   * fraction of cases where the AFTER doc out-ranked the BEFORE doc.
   */
  ruler: {
    available: boolean;
    before: number;
    after: number;
    delta: number;
    winRate: number;
    wins: number;
    ties: number;
    losses: number;
  };
  /**
   * Discrimination: how far each judge SEPARATES the two docs. BINEVAL's central
   * claim is wider separation (no ceiling effect); RULER's is that relative
   * judgment separates even when absolute scales ceiling out. Positive
   * `advantage` = BINEVAL discriminated the change more sharply than the
   * holistic judge; `rulerSpread` is RULER's separation on the same outputs.
   */
  discrimination: {
    holisticSpread: number;
    binevalSpread: number;
    rulerSpread: number;
    advantage: number;
  };
  notes: string;
}

interface ABCase {
  input: string;
  rubric?: string;
  reference?: string;
}

/**
 * Run BOTH evaluators over the SAME freshly-generated outputs for the before
 * (seed) and after (best) skill docs, and report how each judge scores them.
 * Questions are generated ONCE per case and shared across before/after so the
 * two docs are measured with an identical yardstick.
 *
 * This is a pure MEASUREMENT: it never changes what the optimizer ships. Fully
 * FAIL-OPEN — any per-case failure is skipped; a total BINEVAL failure yields
 * `available:false` with the holistic numbers still populated.
 */
export async function runEvaluatorAB(args: {
  docBefore: string;
  docAfter: string;
  cases: ABCase[];
  cfg: EvaluatorABConfig;
}): Promise<EvaluatorABResult> {
  const { docBefore, docAfter, cfg } = args;
  const binModel = cfg.binevalModel || cfg.graderModel;
  const maxCases = Math.max(1, cfg.maxCases ?? 8);
  const cases = args.cases.slice(0, maxCases);

  const { getClientForModel } = await import("../providers");
  const { holisticGrade } = await import("../skill-optimizer");
  const { rulerRankGroup, summarizeRulerPairs } = await import("./ruler-rank");
  const rulerOn = cfg.rulerEnabled !== false;

  const runTarget = async (doc: string, input: string): Promise<string> => {
    const { client, actualModelId } = await getClientForModel(cfg.targetModel, cfg.tenantId);
    const comp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: doc },
        { role: "user", content: input },
      ],
    });
    return comp.choices?.[0]?.message?.content?.trim() ?? "";
  };

  let hBeforeSum = 0;
  let hAfterSum = 0;
  let hN = 0;
  let bBeforeSum = 0;
  let bAfterSum = 0;
  let bN = 0;
  let dimsAfter: Record<string, number> = {};
  const failedAfter: string[] = [];
  const rulerPairs: Array<{ before: number; after: number }> = [];
  let caseIdx = 0;

  for (const c of cases) {
    caseIdx++;
    try {
      const outBefore = await runTarget(docBefore, c.input);
      const outAfter = await runTarget(docAfter, c.input);

      // Holistic judge (the current reward fn) on both outputs.
      const [hb, ha] = await Promise.all([
        holisticGrade(c.input, outBefore, c.rubric, c.reference, { graderModel: cfg.graderModel }),
        holisticGrade(c.input, outAfter, c.rubric, c.reference, { graderModel: cfg.graderModel }),
      ]);
      hBeforeSum += hb.score;
      hAfterSum += ha.score;
      hN++;

      // BINEVAL — same questions for both outputs (fair yardstick).
      const questions = await generateBinaryQuestions(c.input, {
        rubric: c.rubric,
        reference: c.reference,
        model: binModel,
        tenantId: cfg.tenantId,
        maxQuestions: cfg.maxQuestions,
      });
      if (questions.length > 0) {
        const [rb, ra] = await Promise.all([
          binevalScoreOutput({ task: c.input, output: outBefore, questions, model: binModel, tenantId: cfg.tenantId }),
          binevalScoreOutput({ task: c.input, output: outAfter, questions, model: binModel, tenantId: cfg.tenantId }),
        ]);
        if (rb && ra) {
          bBeforeSum += rb.score;
          bAfterSum += ra.score;
          bN++;
          dimsAfter = ra.dimensions;
          for (const f of ra.failed) if (failedAfter.length < 12) failedAfter.push(f);
        }
      }

      // RULER — relative group ranking on the SAME two outputs (one judge call
      // sees both, anonymized + seed-shuffled per case). Fail-open: null skips
      // the case for the ruler lane only.
      if (rulerOn) {
        const ranked = await rulerRankGroup(
          c.input,
          [
            { id: "before", output: outBefore },
            { id: "after", output: outAfter },
          ],
          { rubric: c.rubric, reference: c.reference, model: binModel, tenantId: cfg.tenantId, seed: caseIdx },
        );
        if (ranked) {
          const rb2 = ranked.find((r) => r.id === "before");
          const ra2 = ranked.find((r) => r.id === "after");
          if (rb2 && ra2) rulerPairs.push({ before: rb2.score, after: ra2.score });
        }
      }
    } catch (_silentErr) { logSilentCatch("server/lib/bineval.ts", _silentErr); }
  }

  const hBefore = hN > 0 ? hBeforeSum / hN : 0;
  const hAfter = hN > 0 ? hAfterSum / hN : 0;
  const bBefore = bN > 0 ? bBeforeSum / bN : 0;
  const bAfter = bN > 0 ? bAfterSum / bN : 0;
  const holisticSpread = Math.abs(hAfter - hBefore);
  const binevalSpread = Math.abs(bAfter - bBefore);
  const ruler = summarizeRulerPairs(rulerPairs);
  const rulerSpread = Math.abs(ruler.delta);

  const noteParts: string[] = [];
  noteParts.push(
    bN > 0
      ? `holistic ${hBefore.toFixed(3)}→${hAfter.toFixed(3)} (Δ${(hAfter - hBefore).toFixed(3)}); ` +
          `bineval ${bBefore.toFixed(3)}→${bAfter.toFixed(3)} (Δ${(bAfter - bBefore).toFixed(3)}); ` +
          `discrimination advantage ${(binevalSpread - holisticSpread >= 0 ? "+" : "")}${(binevalSpread - holisticSpread).toFixed(3)}`
      : `bineval unavailable (question generation/answering failed for all ${hN} case(s)); holistic ${hBefore.toFixed(3)}→${hAfter.toFixed(3)}`,
  );
  noteParts.push(
    ruler.cases > 0
      ? `ruler ${ruler.before.toFixed(3)}→${ruler.after.toFixed(3)} (Δ${ruler.delta.toFixed(3)}, ` +
          `win-rate ${(ruler.winRate * 100).toFixed(0)}% = ${ruler.wins}W/${ruler.ties}T/${ruler.losses}L)`
      : rulerOn
        ? `ruler unavailable (group ranking failed for all ${hN} case(s))`
        : `ruler disabled`,
  );

  return {
    cases: hN,
    holistic: { before: hBefore, after: hAfter, delta: hAfter - hBefore },
    bineval: {
      available: bN > 0,
      before: bBefore,
      after: bAfter,
      delta: bAfter - bBefore,
      dimensionsAfter: dimsAfter,
      failedAfter,
    },
    ruler: {
      available: ruler.cases > 0,
      before: ruler.before,
      after: ruler.after,
      delta: ruler.delta,
      winRate: ruler.winRate,
      wins: ruler.wins,
      ties: ruler.ties,
      losses: ruler.losses,
    },
    discrimination: {
      holisticSpread,
      binevalSpread,
      rulerSpread,
      advantage: binevalSpread - holisticSpread,
    },
    notes: noteParts.join("; "),
  };
}
