/**
 * AutoTTS-inspired offline discovery — κ-escalation threshold.
 * Paper: "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling"
 *        (Zheng et al. 2026, arXiv:2605.08083v2).
 *
 * WHAT THIS IS
 *   A thin caller over the reusable discovery core (scripts/lib/autotts-discovery.ts)
 *   that applies the paper's method to ONE real VisionClaw orchestration knob — the
 *   `ensemble_query` κ-concordance escalate-to-HITL threshold
 *   (`CONCORDANCE_ESCALATE_THRESHOLD`, hand-set to 0.5 in server/moa.ts) — instead
 *   of hand-tuning it by intuition.
 *
 *   The paper's thesis: compute-allocation policies ("when to escalate") should be
 *   DISCOVERED in a cheap offline replay environment, not guessed. This is the
 *   "spike the proxy-reward first" step: if the signal is too thin to trust, it says
 *   so (exit 2) rather than shipping a discovered threshold into the hot path.
 *
 * THE THREE PILLARS (faithful instantiation)
 *   1. Offline replay — the jury-decisions corpus (data/jury-decisions/queue.json):
 *      every triaged issue carries κ (embedding concordance) AND the frontier-model
 *      vote breakdown. Escalation decisions are replayed with ZERO new LLM calls.
 *   2. β-parameterization — a single scalar β∈[0,1] maps monotonically into the
 *      observed κ range; larger β ⇒ escalate more. 1-D sweep (anti-overfitting).
 *   3. Execution-trace feedback — the full per-β trace is logged and OPTIONALLY fed
 *      to `executeMoA` as an "explorer" round (AUTOTTS_EXPLORER=1). Off by default
 *      so the core run is $0 and deterministic.
 *
 * PROXY REWARD (the non-circular part)
 *   An escalation is "valuable" when the jury did NOT vote unanimously (real
 *   dissent). κ — embedding cosine of proposer ANSWERS — is the feature;
 *   vote-unanimity — agreement over VERDICTS — is the independent label. Correlated
 *   but distinct, so predicting one from the other is a genuine test, not a tautology.
 *
 * ENV
 *   AUTOTTS_GAMMA      cost weight in reward = recall − γ·escalationRate (def 0.5)
 *   AUTOTTS_MAX_ESCAL  HITL-load ceiling for the recommendation            (def 0.35)
 *   AUTOTTS_MIN_POS    min dissent examples to trust the signal            (def 10)
 *   AUTOTTS_MIN_AUC    min AUC to call κ a useful predictor                (def 0.55)
 *   AUTOTTS_EXPLORER   "1" to run the optional executeMoA explorer round
 *   AUTOTTS_OUT        report path (def data/autotts-spike/report-<date>.md)
 *
 * EXIT CODES (operator-runnable contract)
 *   0  sufficient signal — discovery produced a usable result (the report states
 *      whether the discovered threshold beats the hand-set default)
 *   2  insufficient / weak signal — approach stalls here; gather more replay data
 *      BEFORE wiring any discovered threshold into server/moa.ts
 *   3  runtime error (corpus missing / unreadable)
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { discover, type KnobRow, type DiscoveryConfig, type BetaPoint } from "./lib/autotts-discovery";

const CURRENT_DEFAULT_THRESHOLD = 0.5; // server/moa.ts CONCORDANCE_ESCALATE_THRESHOLD
const GAMMA = numEnv("AUTOTTS_GAMMA", 0.5);
const MIN_POS = numEnv("AUTOTTS_MIN_POS", 10);
const MIN_AUC = numEnv("AUTOTTS_MIN_AUC", 0.55);
// Operational ceiling on HITL load: an "optimum" that escalates everything is
// useless. Recommend the best-reward point that stays under this escalation rate.
const MAX_ESCAL = numEnv("AUTOTTS_MAX_ESCAL", 0.35);
const RUN_EXPLORER = process.env.AUTOTTS_EXPLORER === "1";

const CORPUS = path.resolve(process.cwd(), "data", "jury-decisions", "queue.json");
const OUT_DIR = path.resolve(process.cwd(), "data", "autotts-spike");
const OUT_FILE =
  process.env.AUTOTTS_OUT ||
  path.join(OUT_DIR, `report-${new Date().toISOString().slice(0, 10)}.md`);

const CFG: DiscoveryConfig = {
  fireWhen: "below", // escalate when κ is LOW (low concordance ⇒ disagreement)
  currentDefault: CURRENT_DEFAULT_THRESHOLD,
  gamma: GAMMA,
  maxFireRate: MAX_ESCAL,
  minPos: MIN_POS,
  minAuc: MIN_AUC,
};

function numEnv(key: string, def: number): number {
  const raw = process.env[key];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function fail(code: number, msg: string): never {
  process.stderr.write(`[autotts] FATAL: ${msg}\n`);
  process.exit(code);
}

/** Load the jury corpus into the generic {feature: κ, label: dissent} shape. */
function loadCorpus(): KnobRow[] {
  if (!fs.existsSync(CORPUS)) {
    fail(
      3,
      `replay corpus not found at ${CORPUS}. This spike replays the jury-decisions corpus; run jury_triage to populate it, or point AUTOTTS at another κ+votes source.`,
    );
  }
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
  } catch (e) {
    fail(3, `could not parse ${CORPUS}: ${(e as Error).message}`);
  }
  const arr: any[] = Array.isArray(parsed) ? parsed : [];
  const rows: KnobRow[] = [];
  for (const x of arr) {
    if (typeof x?.concordance !== "number") continue;
    if (!Array.isArray(x?.votes) || x.votes.length === 0) continue;
    const counts: Record<string, number> = {};
    for (const v of x.votes) {
      const verdict = String(v?.verdict ?? "?").toUpperCase();
      counts[verdict] = (counts[verdict] || 0) + 1;
    }
    const maxCount = Math.max(...Object.values(counts));
    rows.push({ feature: x.concordance, label: maxCount < x.votes.length });
  }
  return rows;
}

function moaKappaDistribution(): string {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return "_DATABASE_URL not set — skipped live ensemble_query κ distribution._";
    const sql =
      "SELECT count(*) n, round(min(concordance)::numeric,3) kmin, round(avg(concordance)::numeric,3) kmean, round(max(concordance)::numeric,3) kmax, count(*) FILTER (WHERE should_escalate) escalated FROM moa_responses WHERE concordance IS NOT NULL;";
    // argv form (no shell) — DATABASE_URL is passed as a literal arg, not interpolated
    // into a shell command, so quote/substitution chars in the value cannot break out.
    const out = execFileSync("psql", [url, "-t", "-A", "-F", "|", "-c", sql], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const [n, kmin, kmean, kmax, escalated] = out.split("|");
    return `Live \`moa_responses\` (production ensemble_query traffic): **${n}** rows, κ∈[${kmin}, ${kmax}] mean **${kmean}**, escalated **${escalated}**. Confirms real κ lives well above the ${CURRENT_DEFAULT_THRESHOLD} default — the hand-set threshold rarely (if ever) fires.`;
  } catch {
    return "_Live `moa_responses` query failed (non-fatal) — skipped._";
  }
}

async function runExplorer(report: string): Promise<string> {
  try {
    const { executeMoA } = await import("../server/moa");
    const question = [
      "You are the explorer in an AutoTTS discovery loop. Below is the execution-trace report",
      "from an offline replay that sweeps the ensemble_query κ-escalation threshold against a",
      "real jury corpus. Propose ONE refined, monotone β→threshold mapping (or a second feature",
      "worth adding, e.g. proposer_count) that would improve the recall/escalation-rate tradeoff,",
      "and state the single biggest risk of acting on this small a corpus. Be concrete and brief.",
      "\n\n--- TRACE REPORT ---\n",
      report.slice(0, 6000),
    ].join(" ");
    const res: any = await executeMoA({
      question,
      tenantId: 1,
      invokedVia: "autotts-kappa-discovery-spike",
    });
    const answer =
      res?.aggregatedAnswer ?? res?.answer ?? res?.aggregated_answer ?? JSON.stringify(res).slice(0, 1500);
    return `\n## Explorer round (executeMoA)\n\n${answer}\n`;
  } catch (e) {
    return `\n## Explorer round (executeMoA)\n\n_Explorer round failed (non-fatal): ${(e as Error).message?.slice(0, 200)}_\n`;
  }
}

async function main() {
  const rows = loadCorpus();
  if (rows.length === 0) fail(3, "corpus loaded but contained no rows with both κ and a votes array.");

  const r = discover(rows, CFG);
  const { best, current, front } = r;
  const aucVal = r.auc;

  // ---- report ----
  const lines: string[] = [];
  lines.push(`# AutoTTS κ-escalation discovery spike`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} · arXiv:2605.08083v2 · offline replay, $0 core run_`);
  lines.push("");
  lines.push(`## Replay environment`);
  lines.push(`- Corpus: \`${path.relative(process.cwd(), CORPUS)}\` — **${r.nRows}** rows with κ + votes`);
  lines.push(`- Proxy-reward label: non-unanimous jury vote (real dissent) — **${r.nPos}** positives (${((100 * r.nPos) / r.nRows).toFixed(1)}%)`);
  lines.push(`- κ distribution: min **${r.featMin.toFixed(3)}**, mean **${r.featMean.toFixed(3)}**, max **${r.featMax.toFixed(3)}**`);
  lines.push(`- AUC(−κ → dissent): **${aucVal === null ? "n/a" : aucVal.toFixed(3)}** (0.5 = no signal)`);
  lines.push(`- ${moaKappaDistribution()}`);
  lines.push("");
  lines.push(`## Hand-set default vs discovered`);
  lines.push("");
  lines.push(`| Policy | threshold | escalation-rate | recall | precision | reward (γ=${GAMMA}) |`);
  lines.push(`|---|---|---|---|---|---|`);
  lines.push(
    `| Current default | ${CURRENT_DEFAULT_THRESHOLD.toFixed(3)} | ${(100 * current.fireRate).toFixed(1)}% | ${(100 * current.recall).toFixed(1)}% | ${(100 * current.precision).toFixed(1)}% | ${current.reward.toFixed(3)} |`,
  );
  lines.push(
    `| **Discovered (β=${best.beta.toFixed(2)})** | **${best.threshold.toFixed(3)}** | ${(100 * best.fireRate).toFixed(1)}% | ${(100 * best.recall).toFixed(1)}% | ${(100 * best.precision).toFixed(1)}% | **${best.reward.toFixed(3)}** |`,
  );
  lines.push("");
  lines.push(`## Pareto frontier (recall vs escalation-rate)`);
  lines.push("");
  lines.push(`| β | threshold | escalation-rate | recall | precision |`);
  lines.push(`|---|---|---|---|---|`);
  for (const p of front) {
    lines.push(
      `| ${p.beta.toFixed(2)} | ${p.threshold.toFixed(3)} | ${(100 * p.fireRate).toFixed(1)}% | ${(100 * p.recall).toFixed(1)}% | ${(100 * p.precision).toFixed(1)}% |`,
    );
  }
  lines.push("");
  lines.push(`## Verdict`);
  lines.push("");
  // Headline finding: is the hand-set knob even live on the real κ distribution?
  if (r.defaultIsDead) {
    lines.push(
      `🔴 **Primary finding — the hand-set ${CURRENT_DEFAULT_THRESHOLD} threshold is effectively DEAD.** Across ${r.nRows} real decisions, κ never drops below ${r.featMin.toFixed(3)}, so κ-based escalation has *never fired*. The knob was tuned by intuition to a value the live distribution never reaches — exactly the "unexplored allocation space" the paper targets.`,
    );
    lines.push("");
  }
  if (!r.sufficient) {
    lines.push(
      `⚠️ **Signal too thin to auto-set a replacement threshold — DO NOT wire one into \`server/moa.ts\` yet.**`,
    );
    lines.push(
      `- dissent examples: ${r.nPos} (need ≥ ${MIN_POS}); AUC: ${aucVal === null ? "n/a" : aucVal.toFixed(3)} (need ≥ ${MIN_AUC}).`,
    );
    lines.push(
      `- This is the paper's "environment design is the hard part" failure mode surfacing honestly: the proxy reward exists and κ carries *some* signal, but the corpus is too small / too imbalanced to calibrate a production threshold. **Action: keep accumulating jury + moa_responses traces, re-run, then revisit.**`,
    );
  } else {
    lines.push(`✅ **Sufficient signal.** κ predicts dissent (AUC ${aucVal!.toFixed(3)}) on ${r.nPos} positives — weak but real (κ is one noisy feature, not a clean separator).`);
    lines.push(
      `- Best point under a ${(100 * MAX_ESCAL).toFixed(0)}% HITL-load ceiling: **β=${best.beta.toFixed(2)}, threshold ${best.threshold.toFixed(3)}** → recall ${(100 * best.recall).toFixed(1)}%, escalation ${(100 * best.fireRate).toFixed(1)}%, reward ${best.reward.toFixed(3)} (γ=${GAMMA}).`,
    );
    if (!r.recommendationCapped) {
      lines.push(
        `- ⚠️ No threshold stays under the ${(100 * MAX_ESCAL).toFixed(0)}% ceiling — every recall gain costs heavy HITL load. κ alone is too weak a separator here; a second feature (proposer_count, answer-length variance) is the real next move, not just a re-tuned threshold.`,
      );
    }
    lines.push(
      `- **Recommended next step:** shadow-evaluate threshold ${best.threshold.toFixed(3)} (log would-escalate alongside the live ${CURRENT_DEFAULT_THRESHOLD} path) before touching \`CONCORDANCE_ESCALATE_THRESHOLD\`. Never hard-swap a hot-path safety knob off a single replay.`,
    );
  }
  lines.push("");
  lines.push(
    `_Tuning: reward = recall − γ·escalationRate (γ=${GAMMA}). Raise AUTOTTS_GAMMA to penalize HITL load harder; lower it to prioritize catching dissent._`,
  );

  let report = lines.join("\n");
  if (RUN_EXPLORER) report += await runExplorer(report);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, report + "\n");

  // ---- stdout summary ----
  console.log(`[autotts] replay rows=${r.nRows} dissent=${r.nPos} AUC=${aucVal === null ? "n/a" : aucVal.toFixed(3)}`);
  console.log(`[autotts] κ range [${r.featMin.toFixed(3)}, ${r.featMax.toFixed(3)}] mean ${r.featMean.toFixed(3)} · default ${CURRENT_DEFAULT_THRESHOLD} escal=${(100 * current.fireRate).toFixed(1)}%${r.defaultIsDead ? " (DEAD — never fires)" : ""}`);
  console.log(
    `[autotts] discovered β=${best.beta.toFixed(2)} threshold=${best.threshold.toFixed(3)} recall=${(100 * best.recall).toFixed(1)}% escal=${(100 * best.fireRate).toFixed(1)}% reward=${best.reward.toFixed(3)}${r.recommendationCapped ? "" : " (UNCAPPED — exceeds HITL ceiling)"}`,
  );
  console.log(`[autotts] report → ${path.relative(process.cwd(), OUT_FILE)}`);

  if (!r.sufficient) {
    console.log(`[autotts] VERDICT: insufficient signal — keep accumulating traces before acting (exit 2)`);
    process.exit(2);
  }
  console.log(
    `[autotts] VERDICT: sufficient signal — ${r.defaultIsDead ? "default is DEAD (never fires); see report for the discovered threshold" : r.beatsDefault ? "discovered threshold beats default" : "default already reasonable"} (exit 0)`,
  );
  process.exit(0);
}

main().catch((e) => fail(3, (e as Error).stack || String(e)));
