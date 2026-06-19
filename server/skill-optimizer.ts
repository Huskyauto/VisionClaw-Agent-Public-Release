// SkillOpt-style validation-gated skill optimizer.
//
// Concept imported from Microsoft's SkillOpt (arXiv:2605.23904, MIT). The skill
// DOCUMENT is treated as the trainable state of a frozen agent: an optimizer model
// proposes ONE bounded add/delete/replace edit per epoch; a candidate edit is
// accepted ONLY when it STRICTLY improves a held-out validation score; rejected
// edits go into a buffer so the optimizer never re-proposes the same losing edit.
// The output is just an improved skill document — zero inference-time cost at
// deployment (the doc is prepended to the unchanged target model).
//
// Faithful to VisionClaw's existing infra: optimizer/target/grader models go
// through server/providers.ts (cost-tracked), and the loop is fully injectable so
// the pure logic can be unit-tested with no real LLM calls. Providers are imported
// LAZILY inside the default LLM functions so this module is import-safe for tests.

export interface EvalCase {
  /** The task/prompt handed to the target (frozen) model. */
  input: string;
  /** Optional gold answer used by the grader. */
  reference?: string;
  /** Optional free-text grading rubric. */
  rubric?: string;
}

export type EditOp = "add" | "delete" | "replace";

export interface SkillEdit {
  op: EditOp;
  /** For delete/replace: substring to locate. For add: optional anchor to insert after. */
  target?: string;
  /** For add: text appended/inserted. For replace: replacement text. */
  text?: string;
  rationale?: string;
}

export interface ScoredRollout {
  input: string;
  output: string;
  /** 0..1 */
  score: number;
  notes?: string;
}

export interface OptimizeConfig {
  epochs?: number;
  /** Train cases sampled per epoch to surface failures for the optimizer. */
  minibatchSize?: number;
  /** Fraction of cases held out for the accept/reject gate. */
  valSplit?: number;
  optimizerModel?: string;
  targetModel?: string;
  graderModel?: string;
  /** Strict-improvement epsilon: accept only if candidateScore > bestScore + this. */
  minImprovement?: number;
  tenantId?: number;
  seed?: number;
  /** Injection seam (tests / custom harnesses): score one rollout for a doc. */
  rolloutFn?: (skillDoc: string, c: EvalCase) => Promise<ScoredRollout>;
  /** Injection seam: propose one bounded edit (or null to skip the epoch). */
  proposeFn?: (
    skillDoc: string,
    failures: ScoredRollout[],
    rejected: string[],
  ) => Promise<SkillEdit | null>;
}

export interface EpochRecord {
  epoch: number;
  candidateScore: number | null;
  bestScore: number;
  accepted: boolean;
  edit: SkillEdit | null;
  reason: string;
}

export interface OptimizeResult {
  baselineScore: number;
  bestScore: number;
  bestSkill: string;
  improved: boolean;
  epochs: EpochRecord[];
  acceptedEdits: SkillEdit[];
  rejectedCount: number;
}

// ─── Pure helpers (deterministic, no I/O) ──────────────────────────────────

/** Small deterministic PRNG so train/val split + minibatch sampling are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Stable signature for the rejected-edit buffer (semantically-equal edits collapse). */
export function editSignature(edit: SkillEdit): string {
  return `${edit.op}::${normalize(edit.target)}::${normalize(edit.text)}`;
}

/** Apply one bounded edit to a skill doc. Returns the doc UNCHANGED on a no-op. */
export function applyEdit(doc: string, edit: SkillEdit): string {
  const text = edit.text ?? "";
  const target = edit.target ?? "";
  switch (edit.op) {
    case "add": {
      if (!text.trim()) return doc;
      if (target && doc.includes(target)) {
        const idx = doc.indexOf(target) + target.length;
        return doc.slice(0, idx) + "\n" + text + doc.slice(idx);
      }
      return doc.endsWith("\n") ? doc + text : doc + "\n" + text;
    }
    case "delete": {
      if (!target || !doc.includes(target)) return doc;
      return doc.replace(target, "");
    }
    case "replace": {
      if (!target || !doc.includes(target) || text === target) return doc;
      return doc.replace(target, text);
    }
    default:
      return doc;
  }
}

export function isStrictImprovement(candidate: number, best: number, eps = 0): boolean {
  // eps is clamped to >= 0 so a caller can never weaken the gate below "strictly
  // greater than best" (e.g. a negative epsilon that would accept worse candidates).
  return candidate > best + Math.max(0, eps);
}

function reqInt(v: number | undefined, def: number, min: number, name: string): number {
  if (v === undefined) return def;
  if (!Number.isFinite(v) || v < min) {
    throw new Error(`optimizeSkill: ${name} must be a finite number >= ${min} (got ${v}).`);
  }
  return Math.floor(v);
}

function reqFrac(v: number | undefined, def: number, name: string): number {
  if (v === undefined) return def;
  if (!Number.isFinite(v) || v <= 0 || v >= 1) {
    throw new Error(`optimizeSkill: ${name} must be a finite number in (0,1) (got ${v}).`);
  }
  return v;
}

export function aggregate(scored: ScoredRollout[]): number {
  if (scored.length === 0) return 0;
  return scored.reduce((s, r) => s + r.score, 0) / scored.length;
}

/** Deterministic shuffle + train/val split. */
export function splitTrainVal(
  cases: EvalCase[],
  valSplit: number,
  seed: number,
): { train: EvalCase[]; val: EvalCase[] } {
  const rng = mulberry32(seed);
  const idx = cases.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const shuffled = idx.map((i) => cases[i]);
  const clamped = Math.min(0.9, Math.max(0.1, valSplit));
  let nVal = Math.round(shuffled.length * clamped);
  nVal = Math.min(shuffled.length - 1, Math.max(1, nVal));
  return { val: shuffled.slice(0, nVal), train: shuffled.slice(nVal) };
}

function sampleMinibatch(cases: EvalCase[], n: number, rng: () => number): EvalCase[] {
  if (cases.length <= n) return cases.slice();
  const pool = cases.slice();
  const out: EvalCase[] = [];
  for (let k = 0; k < n && pool.length; k++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── Default LLM-backed harness (providers imported lazily) ─────────────────

async function defaultRollout(
  skillDoc: string,
  c: EvalCase,
  cfg: { targetModel: string; graderModel: string; tenantId?: number },
): Promise<ScoredRollout> {
  const { getClientForModel, replitOpenai } = await import("./providers");
  const { client, actualModelId } = await getClientForModel(cfg.targetModel, cfg.tenantId);
  const comp = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: skillDoc },
      { role: "user", content: c.input },
    ],
  });
  const output = comp.choices?.[0]?.message?.content?.trim() ?? "";

  const rubric = c.rubric
    ? `Rubric:\n${c.rubric}`
    : "Rubric: correctness, completeness, and concision.";
  const ref = c.reference ? `\nReference answer:\n${c.reference}` : "";
  const gradePrompt =
    `Grade the candidate answer from 0.0 to 1.0.\n\nTask:\n${c.input}\n\n${rubric}${ref}\n\n` +
    `Candidate answer:\n${output}\n\nReturn ONLY JSON: {"score": <0..1>, "notes": "<short>"}`;
  const grade = await replitOpenai.chat.completions.create({
    model: cfg.graderModel,
    messages: [{ role: "user", content: gradePrompt }],
  });
  const parsed = extractJson(grade.choices?.[0]?.message?.content ?? "");
  let score = typeof parsed?.score === "number" ? parsed.score : 0;
  score = Math.max(0, Math.min(1, score));
  return { input: c.input, output, score, notes: parsed?.notes };
}

async function defaultPropose(
  skillDoc: string,
  failures: ScoredRollout[],
  rejected: string[],
  cfg: { optimizerModel: string; tenantId?: number },
): Promise<SkillEdit | null> {
  const { getClientForModel } = await import("./providers");
  const { client, actualModelId } = await getClientForModel(cfg.optimizerModel, cfg.tenantId);
  const failBlock = failures
    .slice(0, 4)
    .map(
      (f, i) =>
        `#${i + 1} (score ${f.score.toFixed(2)})\nINPUT: ${f.input}\nOUTPUT: ${f.output}` +
        (f.notes ? `\nGRADER: ${f.notes}` : ""),
    )
    .join("\n\n");
  const rejBlock = rejected.length
    ? `\n\nDo NOT propose any of these previously-rejected edits again:\n- ${rejected.join("\n- ")}`
    : "";
  const prompt =
    `You are optimizing a SKILL DOCUMENT that is prepended to a frozen LLM. Improve it so the ` +
    `failing cases below would score higher, WITHOUT overfitting. Propose exactly ONE small, ` +
    `bounded edit.\n\nCURRENT SKILL DOCUMENT:\n"""\n${skillDoc}\n"""\n\nFAILING ROLLOUTS:\n${failBlock}${rejBlock}\n\n` +
    `Return ONLY JSON: {"op":"add"|"delete"|"replace","target":"<exact substring for delete/replace, or anchor for add, may be empty>","text":"<new/replacement text, empty for delete>","rationale":"<why>"}`;
  const comp = await client.chat.completions.create({
    model: actualModelId,
    messages: [{ role: "user", content: prompt }],
  });
  const parsed = extractJson(comp.choices?.[0]?.message?.content ?? "");
  if (!parsed || (parsed.op !== "add" && parsed.op !== "delete" && parsed.op !== "replace")) {
    return null;
  }
  return {
    op: parsed.op,
    target: typeof parsed.target === "string" ? parsed.target : "",
    text: typeof parsed.text === "string" ? parsed.text : "",
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
  };
}

// ─── Main loop ──────────────────────────────────────────────────────────────

export async function optimizeSkill(
  skillDoc: string,
  cases: EvalCase[],
  config: OptimizeConfig = {},
): Promise<OptimizeResult> {
  const epochs = reqInt(config.epochs, 6, 1, "epochs");
  const minibatchSize = reqInt(config.minibatchSize, 4, 1, "minibatchSize");
  const valSplit = reqFrac(config.valSplit, 0.4, "valSplit");
  const eps = Math.max(0, Number.isFinite(config.minImprovement as number) ? (config.minImprovement as number) : 0);
  const seed = Number.isFinite(config.seed as number) ? (config.seed as number) : 1234;
  const optimizerModel = config.optimizerModel ?? "gpt-5.5";
  const targetModel = config.targetModel ?? "gpt-5-mini";
  const graderModel = config.graderModel ?? "gpt-4.1-mini";

  if (cases.length < 2) {
    throw new Error("optimizeSkill needs at least 2 eval cases (one train, one validation).");
  }

  const rollout =
    config.rolloutFn ??
    ((doc: string, c: EvalCase) =>
      defaultRollout(doc, c, { targetModel, graderModel, tenantId: config.tenantId }));
  const propose =
    config.proposeFn ??
    ((doc: string, fails: ScoredRollout[], rej: string[]) =>
      defaultPropose(doc, fails, rej, { optimizerModel, tenantId: config.tenantId }));

  const { train, val } = splitTrainVal(cases, valSplit, seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);

  const scoreOn = async (doc: string, set: EvalCase[]): Promise<ScoredRollout[]> =>
    Promise.all(set.map((c) => rollout(doc, c)));

  const baselineScore = aggregate(await scoreOn(skillDoc, val));

  let bestSkill = skillDoc;
  let bestScore = baselineScore;
  const rejected: string[] = [];
  const rejectedSet = new Set<string>();
  const acceptedEdits: SkillEdit[] = [];
  const records: EpochRecord[] = [];

  for (let e = 1; e <= epochs; e++) {
    const batch = sampleMinibatch(train, minibatchSize, rng);
    const rollouts = await scoreOn(bestSkill, batch);
    const failures = rollouts.slice().sort((a, b) => a.score - b.score);

    const edit = await propose(bestSkill, failures, rejected);
    if (!edit) {
      records.push({ epoch: e, candidateScore: null, bestScore, accepted: false, edit: null, reason: "no-edit-proposed" });
      continue;
    }

    const sig = editSignature(edit);
    if (rejectedSet.has(sig)) {
      records.push({ epoch: e, candidateScore: null, bestScore, accepted: false, edit, reason: "duplicate-rejected-edit" });
      continue;
    }

    const candidate = applyEdit(bestSkill, edit);
    if (candidate === bestSkill) {
      rejectedSet.add(sig);
      rejected.push(sig);
      records.push({ epoch: e, candidateScore: null, bestScore, accepted: false, edit, reason: "no-op-edit" });
      continue;
    }

    const candidateScore = aggregate(await scoreOn(candidate, val));
    if (isStrictImprovement(candidateScore, bestScore, eps)) {
      bestScore = candidateScore;
      bestSkill = candidate;
      acceptedEdits.push(edit);
      records.push({ epoch: e, candidateScore, bestScore, accepted: true, edit, reason: "strict-improvement" });
    } else {
      rejectedSet.add(sig);
      rejected.push(sig);
      records.push({ epoch: e, candidateScore, bestScore, accepted: false, edit, reason: "no-improvement" });
    }
  }

  return {
    baselineScore,
    bestScore,
    bestSkill,
    improved: bestScore > baselineScore,
    epochs: records,
    acceptedEdits,
    rejectedCount: rejectedSet.size,
  };
}
