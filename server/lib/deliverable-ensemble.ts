/**
 * Premium deliverable ensemble ("best-of-the-best" drafting).
 *
 * For paid customer deliverables (AI Readiness audit, research reports,
 * executive opportunity reports), each prose section is drafted by THREE
 * cheap-but-frontier-class models IN PARALLEL, then a FOURTH model reads all
 * drafts and produces the final redraft. Wall-clock cost is roughly one
 * draft + one redraft because the three drafts run concurrently.
 *
 * Spend posture (explicit owner directive 2026-08-13): this is a deliberate
 * metered lane — customers are paying for these deliverables, so a
 * sub-dollar-per-report model spend is authorized HERE AND ONLY HERE.
 * Default routing everywhere else stays on the $0 lane.
 *
 * Fail-open contract: ANY failure (config, <2 successful drafts, aggregator
 * failure, guardrail trip) returns null and the caller falls back to its
 * existing single-free-model path. Fulfillment is never blocked or degraded
 * by this layer, and a partial ensemble never changes what ships — it's the
 * full ensemble redraft or the proven legacy path, nothing in between.
 *
 * Blast-radius guardrails:
 *  - every provider call is ABORTED (not just raced) at the deadline
 *  - global in-process concurrency cap on ensemble sections
 *  - daily in-process section budget for the lane
 *  - circuit breaker: repeated full-ensemble failures pause the lane
 *  - override file drafter/aggregator ids validated against a priced allowlist
 *
 * Kill switch: PREMIUM_ENSEMBLE_ENABLED=0 disables the whole lane.
 * Overrides: data/premium-ensemble.json { enabled, drafters[], aggregator }.
 */
import fs from "node:fs";
import path from "node:path";
import { getClientForModel } from "../providers";

// Cheap high-end drafter ALLOWLIST (per-1K USD as of 2026-08, all priced in
// cost-ledger.ts). Override-file drafters outside this set are rejected.
export const DRAFTER_ALLOWLIST = new Set([
  "deepseek/deepseek-v4-pro-0813", // .000435/.00087
  "z-ai/glm-5.2",                  // .00047/.0015 (Profundo flat lane, $0 marginal)
  "google/gemini-3.7-flash",       // .00075/.00375
  "moonshotai/kimi-k2.6",          // .00058/.00244
  "deepseek/deepseek-v3.2",        // .00027/.0004
  "z-ai/glm-5.1",                  // .00095/.003
  "deepseek/deepseek-v4-flash-0731", // .00009/.00018
]);
export const AGGREGATOR_ALLOWLIST = new Set([
  "gpt-5.6-sol",        // MoA fallback aggregator; registry-known
  "gemini-3.5-flash",
  "claude-sonnet-4-5",
]);

const DEFAULT_DRAFTERS = [
  "deepseek/deepseek-v4-pro-0813",
  "z-ai/glm-5.2",
  "google/gemini-3.7-flash",
];
const DEFAULT_AGGREGATOR = "gpt-5.6-sol";

const PER_CALL_TIMEOUT_MS = 60_000;
const OVERRIDE_FILE = path.resolve(process.cwd(), "data/premium-ensemble.json");

// ── In-process guardrails ────────────────────────────────────────────────────
const MAX_CONCURRENT_SECTIONS = Number(process.env.PREMIUM_ENSEMBLE_MAX_CONCURRENT) > 0
  ? Number(process.env.PREMIUM_ENSEMBLE_MAX_CONCURRENT) : 6;
const DAILY_SECTION_BUDGET = Number(process.env.PREMIUM_ENSEMBLE_DAILY_SECTIONS) > 0
  ? Number(process.env.PREMIUM_ENSEMBLE_DAILY_SECTIONS) : 300;
// Circuit breaker: N consecutive full-ensemble failures ⇒ pause the lane.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

let inFlight = 0;
let dayKey = "";
let sectionsToday = 0;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function guardrailsAllow(label: string): boolean {
  const now = Date.now();
  if (now < breakerOpenUntil) {
    console.warn(`[deliverable-ensemble] ${label}: circuit breaker open (${Math.round((breakerOpenUntil - now) / 1000)}s left) — using free path`);
    return false;
  }
  if (inFlight >= MAX_CONCURRENT_SECTIONS) {
    console.warn(`[deliverable-ensemble] ${label}: concurrency cap ${MAX_CONCURRENT_SECTIONS} reached — using free path`);
    return false;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; sectionsToday = 0; }
  if (sectionsToday >= DAILY_SECTION_BUDGET) {
    console.warn(`[deliverable-ensemble] ${label}: daily section budget ${DAILY_SECTION_BUDGET} exhausted — using free path`);
    return false;
  }
  return true;
}

function recordOutcome(success: boolean): void {
  if (success) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      consecutiveFailures = 0;
      console.warn(`[deliverable-ensemble] ${BREAKER_THRESHOLD} consecutive ensemble failures — pausing lane for ${BREAKER_COOLDOWN_MS / 60000} min`);
    }
  }
}

/** Test-only: reset guardrail state. */
export function _resetGuardrailsForTest(): void {
  inFlight = 0; dayKey = ""; sectionsToday = 0; consecutiveFailures = 0; breakerOpenUntil = 0;
}

// ── Config ───────────────────────────────────────────────────────────────────
export interface EnsembleConfig { enabled: boolean; drafters: string[]; aggregator: string }

export function loadEnsembleConfig(overridePath: string = OVERRIDE_FILE): EnsembleConfig {
  const cfg: EnsembleConfig = { enabled: true, drafters: [...DEFAULT_DRAFTERS], aggregator: DEFAULT_AGGREGATOR };
  if (process.env.PREMIUM_ENSEMBLE_ENABLED === "0") cfg.enabled = false;
  try {
    if (fs.existsSync(overridePath)) {
      const raw = JSON.parse(fs.readFileSync(overridePath, "utf8"));
      if (raw && typeof raw === "object") {
        if (raw.enabled === false) cfg.enabled = false;
        if (Array.isArray(raw.drafters)) {
          const ids: string[] = raw.drafters
            .filter((d: unknown): d is string => typeof d === "string" && d.trim().length > 0)
            .map((d: string) => d.trim());
          const unique: string[] = [...new Set(ids)];
          const allowed = unique.filter((d) => DRAFTER_ALLOWLIST.has(d));
          const rejected = unique.filter((d) => !DRAFTER_ALLOWLIST.has(d));
          if (rejected.length) console.warn(`[deliverable-ensemble] override drafters rejected (not in priced allowlist): ${rejected.join(", ")}`);
          if (allowed.length >= 2) cfg.drafters = allowed.slice(0, 4);
        }
        if (typeof raw.aggregator === "string" && AGGREGATOR_ALLOWLIST.has(raw.aggregator.trim())) {
          cfg.aggregator = raw.aggregator.trim();
        } else if (typeof raw.aggregator === "string" && raw.aggregator.trim()) {
          console.warn(`[deliverable-ensemble] override aggregator "${raw.aggregator.trim()}" not in allowlist — keeping ${cfg.aggregator}`);
        }
      }
    }
  } catch (e: any) {
    console.warn(`[deliverable-ensemble] override file unreadable, using defaults: ${e?.message || e}`);
  }
  return cfg;
}

// ── Completion (abortable) ───────────────────────────────────────────────────
export type CompletionFn = (modelId: string, tenantId: number, system: string, user: string, temperature: number, maxTokens: number) => Promise<string>;

async function realCompletion(modelId: string, tenantId: number, system: string, user: string, temperature: number, maxTokens: number): Promise<string> {
  // meteredOverride: this lane is the explicit, owner-authorized metered
  // exception (paying customer deliverables). Without it the $0 policy would
  // silently substitute every drafter with the same free model, collapsing
  // the ensemble's whole point (three genuinely different frontier drafts).
  const { client, actualModelId } = await getClientForModel(modelId, tenantId, { meteredOverride: true });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    } as any, { signal: ac.signal } as any);
    return (result as any)?.choices?.[0]?.message?.content?.toString().trim() || "";
  } finally {
    clearTimeout(timer);
  }
}

function buildRedraftPrompt(user: string, drafts: { model: string; text: string }[]): string {
  return [
    "You are the final editor. Below is the original writing brief, followed by",
    `${drafts.length} independent candidate drafts of the same section written by different expert authors.`,
    "Produce the single BEST final version: keep the strongest insights, structure,",
    "and specifics from across the drafts, drop anything weak, repetitive, or generic,",
    "and resolve any disagreements in favor of the most concrete, defensible claim.",
    "Match the brief's format rules exactly. Output ONLY the final section text —",
    "no preamble, no commentary about the drafts, no headings unless the brief asks for them.",
    "",
    "=== ORIGINAL BRIEF ===",
    user,
    "",
    ...drafts.map((d, i) => `=== CANDIDATE DRAFT ${i + 1} ===\n${d.text}`),
  ].join("\n");
}

export interface EnsembleDraftArgs {
  tenantId: number;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** For logs, e.g. "audit:Quick Wins" */
  label?: string;
  /** Test seam — injected completion function. Production callers omit it. */
  _completionFn?: CompletionFn;
}

export interface EnsembleDraftResult {
  text: string;
  mode: "ensemble";
  drafters: string[];
  aggregator: string;
}

/**
 * Run the 3-parallel-drafts + final-redraft ensemble for one prose section.
 * Returns null on ANY failure or guardrail trip — the caller MUST fall back
 * to its existing single-model path in that case.
 */
export async function draftWithEnsemble(args: EnsembleDraftArgs): Promise<EnsembleDraftResult | null> {
  const cfg = loadEnsembleConfig();
  if (!cfg.enabled) return null;
  if (!Number.isInteger(args.tenantId) || args.tenantId <= 0) return null;
  const label = args.label || "section";
  if (!guardrailsAllow(label)) return null;
  const temperature = typeof args.temperature === "number" ? args.temperature : 0.4;
  const maxTokens = typeof args.maxTokens === "number" && args.maxTokens > 0 ? args.maxTokens : 1200;
  const complete: CompletionFn = args._completionFn || realCompletion;

  inFlight++;
  sectionsToday++;
  try {
    // Drafters get 2× the caller's token budget (capped): several of the cheap
    // frontier models are reasoning models whose thinking tokens count against
    // max_tokens — a tight budget yields empty completions, not shorter ones.
    const drafterBudget = Math.min(maxTokens * 2, 4000);
    const settled = await Promise.allSettled(
      cfg.drafters.map((m) => complete(m, args.tenantId, args.system, args.user, temperature, drafterBudget)),
    );
    const drafts: { model: string; text: string }[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value && r.value.length >= 150) {
        drafts.push({ model: cfg.drafters[i], text: r.value });
      } else {
        const why = r.status === "rejected" ? ((r.reason as any)?.message || String(r.reason)) : "empty/too-short output";
        console.warn(`[deliverable-ensemble] drafter ${cfg.drafters[i]} failed for ${label}: ${why}`);
      }
    });
    if (drafts.length < 2) {
      console.warn(`[deliverable-ensemble] only ${drafts.length}/${cfg.drafters.length} drafts succeeded for ${label} — falling back to free single-model path`);
      recordOutcome(false);
      return null;
    }

    try {
      const finalText = await complete(
        cfg.aggregator, args.tenantId, args.system, buildRedraftPrompt(args.user, drafts), 0.3,
        Math.min(Math.round(maxTokens * 1.25), 4000),
      );
      if (finalText && finalText.length >= 150) {
        console.log(`[deliverable-ensemble] ${label}: ${drafts.length} drafts merged by ${cfg.aggregator}`);
        recordOutcome(true);
        return { text: finalText, mode: "ensemble", drafters: drafts.map((d) => d.model), aggregator: cfg.aggregator };
      }
      console.warn(`[deliverable-ensemble] aggregator ${cfg.aggregator} returned empty/too-short for ${label} — falling back to free single-model path`);
    } catch (e: any) {
      console.warn(`[deliverable-ensemble] aggregator ${cfg.aggregator} failed for ${label}: ${e?.message || e} — falling back to free single-model path`);
    }
    // Contract: partial ensemble NEVER ships. Full redraft or the legacy path.
    recordOutcome(false);
    return null;
  } finally {
    inFlight--;
  }
}
