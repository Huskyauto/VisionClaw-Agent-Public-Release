/**
 * Flagship regression gate — a reusable canary for any flagship model swap.
 *
 * Operationalizes the lesson from Anthropic's April-23 Claude Code postmortem:
 * tiny harness changes (a default-param flip, a new flagship) silently compound
 * into quality regressions unless you measure before/after on a FROZEN set.
 *
 * Consolidates the two one-off Opus benchmark scripts (bench-opus-48-vs-47.ts +
 * run-benchmark-opus.ts) into one parameterized gate that:
 *   - defaults the CHALLENGER to the live MoA flagship (moa.DEFAULT_AGGREGATOR) so it
 *     stays in sync automatically — no hardcoded model id to forget to update.
 *     (Note: that is MoA's aggregator, a proxy for "the flagship"; override via
 *     GATE_CHALLENGER to gate a router/CEO-chain swap that differs.)
 *   - runs a frozen, surface-spanning prompt set head-to-head vs a BASELINE;
 *   - aggregates over N rounds (a single round is judge-noisy — proven in Task #40
 *     where run 1 alone flipped the verdict; runs 2-3 corrected it);
 *   - blind A/B judges each pair (labels randomized per prompt to kill position bias);
 *   - SKIPS any pair where either model call errored (a transient provider failure is
 *     not a quality signal) and goes INCONCLUSIVE if judged coverage is too thin;
 *   - emits a verdict + a meaningful EXIT CODE so a workflow can BLOCK on regression.
 *
 * Exit codes:
 *   0 = KEEP        (challenger within noise of, or better than, baseline)
 *   2 = REGRESS     (challenger materially worse — revert the swap)
 *   3 = INCONCLUSIVE (no/too-few judged scores)
 *
 * Env knobs (all optional):
 *   GATE_CHALLENGER  model under test           (default: moa.DEFAULT_AGGREGATOR)
 *   GATE_BASELINE    prior flagship to beat     (default: claude-opus-4-7)
 *   GATE_ROUNDS      aggregation rounds          (default: 3)
 *   GATE_JUDGE       neutral judge model         (default: gpt-4.1 — honors strict JSON)
 *   GATE_THRESHOLD   regression margin (points)  (default: 0.3; 0 = any drop regresses)
 *   GATE_MIN_COVERAGE minimum judged fraction    (default: 0.5)
 *
 * NOTE: makes real billable calls (~$0.30 per 3-round run). Manual / CI gate before
 * a flagship swap — NOT an every-commit hook.
 *
 * Run: npx tsx scripts/flagship-regression-gate.ts
 */
import * as fs from "fs";
import { getClientForModel } from "../server/providers";
import { DEFAULT_AGGREGATOR } from "../server/moa";
import { MODEL_COST_PER_MILLION } from "../server/resource-predictor";

const TENANT_ID = 1;
const CHALLENGER = process.env.GATE_CHALLENGER || DEFAULT_AGGREGATOR;
const BASELINE = process.env.GATE_BASELINE || "claude-opus-4-7";

function numEnv(name: string, fallback: number, min?: number): number {
  const v = Number(process.env[name]);
  let n = Number.isFinite(v) ? v : fallback;
  if (min !== undefined) n = Math.max(min, n);
  return n;
}
const ROUNDS = Math.round(numEnv("GATE_ROUNDS", 3, 1));
const JUDGE = process.env.GATE_JUDGE || "gpt-4.1";
const THRESHOLD = numEnv("GATE_THRESHOLD", 0.3, 0);
const MIN_COVERAGE = numEnv("GATE_MIN_COVERAGE", 0.5, 0);
const OUT_DIR = "stress-test-output";

// Real pricing from server/resource-predictor (single source of truth). Unknown
// models return null → cost is reported as partial/advisory rather than wrong.
const rate = (m: string) => MODEL_COST_PER_MILLION[m] || null;

// Frozen prompt set — spans the surfaces a flagship actually serves. Merged from the
// two prior one-off scripts. Edit deliberately (and re-baseline) if you change these.
interface Prompt { id: string; kind: string; prompt: string; maxOut: number }
const PROMPTS: Prompt[] = [
  {
    id: "reasoning", kind: "reasoning", maxOut: 700,
    prompt: "A train leaves city A at 9:00am going 60mph toward city B, 240 miles away. Another train leaves B at 10:00am going 80mph toward A. At what clock time do they meet, and how far from A? Show the reasoning compactly, then give the final answer on one line.",
  },
  {
    id: "coding", kind: "coding", maxOut: 900,
    prompt: "Write a TypeScript function `mergeIntervals(intervals: [number, number][]): [number, number][]` that merges overlapping intervals and returns them sorted by start. Handle empty input and touching intervals (e.g. [1,2],[2,3] -> [1,3]). Include 3 inline assertions demonstrating correctness. Code only.",
  },
  {
    id: "writing", kind: "writing", maxOut: 600,
    prompt: "Write a 90-110 word cold email from a solo founder selling an AI 'autonomous corporate team' to a busy small-business owner. Concrete, specific, no hype words ('revolutionary', 'game-changing'), one clear CTA. Plain text.",
  },
  {
    id: "analysis", kind: "analysis", maxOut: 700,
    prompt: "A SaaS has 1000 customers, $50/mo each, 4% monthly churn, $400 blended CAC. In 3-4 tight bullets: compute current MRR, the approx LTV (gross, ignoring margin), the LTV:CAC ratio, and state whether the unit economics are healthy and why.",
  },
  {
    id: "instruction", kind: "instruction-following", maxOut: 500,
    prompt: "Output EXACTLY a JSON object with keys \"summary\" (one sentence, <=20 words) and \"keywords\" (array of exactly 5 lowercase single words) describing the benefits of unit testing. No prose, no markdown fences, no extra keys.",
  },
  {
    id: "factual-trap", kind: "factual", maxOut: 600,
    prompt: "Is it safe to mix household bleach and ammonia to make a stronger cleaner? Answer the actual question first, then explain why in 2-3 sentences. Do not refuse to answer.",
  },
];

interface Run { text: string; ms: number; usd: number; costKnown: boolean; error?: string }

async function callModel(model: string, prompt: string, maxOut: number): Promise<Run> {
  const start = Date.now();
  try {
    const { client, actualModelId } = await getClientForModel(model, TENANT_ID);
    // Opus 4.7+/some reasoning models reject non-default temperature — omit it.
    const r: any = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: maxOut,
    } as any);
    const ms = Date.now() - start;
    const inTok = r.usage?.prompt_tokens ?? 0;
    const outTok = r.usage?.completion_tokens ?? 0;
    const pr = rate(model);
    const usd = pr ? (inTok / 1e6) * pr.input + (outTok / 1e6) * pr.output : 0;
    return { text: r.choices?.[0]?.message?.content || "", ms, usd, costKnown: !!pr };
  } catch (e: any) {
    return { text: "", ms: Date.now() - start, usd: 0, costKnown: true, error: e?.message?.slice(0, 200) || String(e) };
  }
}

function validScore(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

async function judge(prompt: string, a: string, b: string): Promise<{ a: number; b: number; note: string } | null> {
  try {
    const { client, actualModelId } = await getClientForModel(JUDGE, TENANT_ID);
    const jPrompt = `You are a strict, impartial evaluator. Given a TASK and two anonymous answers (A and B), score each 0-10 on correctness, completeness, and adherence to the task's formatting/constraints. Do NOT favor length. Respond with ONLY compact JSON: {"a":<0-10>,"b":<0-10>,"note":"<=15 words why"}.

TASK:
${prompt}

ANSWER A:
${a || "(empty)"}

ANSWER B:
${b || "(empty)"}`;
    const r: any = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "user", content: jPrompt }],
      max_completion_tokens: 600,
      temperature: 0,
      response_format: { type: "json_object" },
    } as any);
    const raw = r.choices?.[0]?.message?.content || "";
    const m = raw.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!m) { console.error(`  [judge] no JSON in: ${raw.slice(0, 80)}`); return null; }
    const p = JSON.parse(m[0]);
    const aS = validScore(p.a), bS = validScore(p.b);
    if (aS === null || bS === null) { console.error(`  [judge] out-of-range scores: a=${p.a} b=${p.b}`); return null; }
    return { a: aS, b: bS, note: String(p.note || "") };
  } catch (e: any) {
    console.error(`  [judge] failed: ${e?.message?.slice(0, 120)}`);
    return null;
  }
}

(async () => {
  if (CHALLENGER === BASELINE) {
    console.error(`[gate] CHALLENGER and BASELINE are both "${CHALLENGER}" — nothing to compare. Set GATE_BASELINE.`);
    process.exit(3);
  }
  console.log(`\n=== Flagship regression gate ===`);
  console.log(`challenger=${CHALLENGER}  baseline=${BASELINE}  rounds=${ROUNDS}  judge=${JUDGE}  threshold=${THRESHOLD}\n`);

  const agg = {
    [CHALLENGER]: { score: 0, ms: 0, usd: 0, wins: 0, costKnown: true },
    [BASELINE]: { score: 0, ms: 0, usd: 0, wins: 0, costKnown: true },
  };
  let judged = 0, skipped = 0;
  const attempts = PROMPTS.length * ROUNDS;

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`--- round ${round}/${ROUNDS} ---`);
    for (const p of PROMPTS) {
      process.stdout.write(`• ${p.id} ... `);
      const [rC, rB] = await Promise.all([
        callModel(CHALLENGER, p.prompt, p.maxOut),
        callModel(BASELINE, p.prompt, p.maxOut),
      ]);
      // Always accrue latency/cost telemetry.
      agg[CHALLENGER].ms += rC.ms; agg[BASELINE].ms += rB.ms;
      agg[CHALLENGER].usd += rC.usd; agg[BASELINE].usd += rB.usd;
      if (!rC.costKnown) agg[CHALLENGER].costKnown = false;
      if (!rB.costKnown) agg[BASELINE].costKnown = false;

      // A model-call failure is not a quality signal — skip the pair entirely.
      if (rC.error || rB.error) {
        skipped++;
        console.log(`SKIP (${rC.error ? CHALLENGER + " err" : ""}${rC.error && rB.error ? " + " : ""}${rB.error ? BASELINE + " err" : ""})`);
        continue;
      }

      const cIsA = Math.random() < 0.5;
      const j = await judge(p.prompt, cIsA ? rC.text : rB.text, cIsA ? rB.text : rC.text);
      if (!j) { skipped++; console.log(`SKIP (judge inconclusive)`); continue; }

      const cScore = cIsA ? j.a : j.b;
      const bScore = cIsA ? j.b : j.a;
      agg[CHALLENGER].score += cScore; agg[BASELINE].score += bScore;
      judged++;
      if (cScore > bScore) agg[CHALLENGER].wins++;
      else if (bScore > cScore) agg[BASELINE].wins++;
      console.log(`C=${cScore}/10 (${rC.ms}ms)  B=${bScore}/10 (${rB.ms}ms)  — ${j.note}`);
    }
  }

  const summarize = (m: string) => {
    const x = agg[m];
    return {
      model: m,
      avgScore: judged ? +(x.score / judged).toFixed(3) : null,
      wins: x.wins,
      avgMs: Math.round(x.ms / attempts),
      usdPerQuery: x.costKnown ? +(x.usd / attempts).toFixed(5) : null,
    };
  };
  const cS = summarize(CHALLENGER);
  const bS = summarize(BASELINE);
  const cost = (s: any) => (s.usdPerQuery === null ? "$? (unknown pricing)" : `$${s.usdPerQuery}/q`);
  console.log(`\n--- SUMMARY (${judged} judged / ${attempts} attempted, ${skipped} skipped) ---`);
  console.log(`challenger ${CHALLENGER}: avg ${cS.avgScore}/10 | wins ${cS.wins} | ${cS.avgMs}ms | ${cost(cS)}`);
  console.log(`baseline   ${BASELINE}: avg ${bS.avgScore}/10 | wins ${bS.wins} | ${bS.avgMs}ms | ${cost(bS)}`);

  let verdict: string, code: number;
  const coverage = attempts ? judged / attempts : 0;
  if (cS.avgScore === null || bS.avgScore === null || coverage < MIN_COVERAGE) {
    verdict = `INCONCLUSIVE — judged coverage ${(coverage * 100).toFixed(0)}% < ${(MIN_COVERAGE * 100).toFixed(0)}% (need more clean judged pairs).`;
    code = 3;
  } else {
    const delta = cS.avgScore - bS.avgScore;
    if (delta <= -THRESHOLD) {
      verdict = `REGRESS — challenger ${(-delta).toFixed(2)} below baseline (threshold ${THRESHOLD}, wins ${cS.wins}-${bS.wins}). Revert the swap.`;
      code = 2;
    } else {
      verdict = `KEEP — challenger ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs baseline (wins ${cS.wins}-${bS.wins}). No regression beyond threshold ${THRESHOLD}.`;
      code = 0;
    }
  }
  console.log(`\nVERDICT: ${verdict}\n`);

  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      `${OUT_DIR}/flagship-regression-gate.json`,
      JSON.stringify({ at: new Date().toISOString(), challenger: cS, baseline: bS, rounds: ROUNDS, judged, skipped, attempts, verdict, code }, null, 2),
    );
  } catch { /* advisory artifact only */ }

  process.exit(code);
})();
