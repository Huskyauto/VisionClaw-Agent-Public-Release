import { cosineSimilarity, keywordSimilarity } from "./embeddings";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logSilentCatch } from "./lib/silent-catch";

const DAY_MS = 86400000;

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number;
}

export const DEFAULT_TEMPORAL_DECAY: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 30,
};

export interface MMRConfig {
  enabled: boolean;
  lambda: number;
}

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: true,
  lambda: 0.7,
};

// ---------------------------------------------------------------------------
// Cold-start exploration (Stage 1 of SA-CTS — U-Mem arXiv:2602.22406).
//
// Jury FIX verdict 2026-06-28 (3/3, κ=0.796): the deterministic ranker has a
// real cold-start lockout — a newly-written fact that doesn't already score
// high on cosine/importance/recency/frequency never enters top-k, so it never
// earns retrieval feedback, so it can never rise; older facts dominate forever.
// The jury's staged decision: ship a SIMPLE, deterministic exploration bonus
// FIRST (this), and only graduate to full Thompson-sampling (`cts`) once
// offline/shadow metrics beat baseline AND a trustworthy per-memory reward
// signal exists. This Stage-1 bonus is fully deterministic / reproducible
// (NO randomness), self-decays to 0 as a memory accumulates impressions, and
// is ON by default (`mode: "bonus"`; set `MEMORY_EXPLORATION_MODE=off` to
// disable) and trips to `off` automatically if the exploration circuit breaker
// fires — the legacy ranker is the fallback in both cases. `cts` mode is
// reserved for Stage 2 and currently degrades to the
// `bonus` behaviour (with a one-time warning) so the env value is forward-safe.
// ---------------------------------------------------------------------------

export type ExplorationMode = "off" | "bonus" | "cts";

export interface ExplorationConfig {
  mode: ExplorationMode;
  /** Max additive bonus applied to a brand-new (0-impression) memory. */
  bonusWeight: number;
  /** Impression count at/above which a memory is "proven" → bonus 0. */
  impressionThreshold: number;
}

// Bob 2026-06-28: run exploration ON by default (benefit of the doubt). The
// auto-switch circuit breaker below is the safety complement — it turns it OFF
// automatically if it misbehaves, and the jury adjudicates whether that auto-off
// was valid (false alarm ⇒ re-enable on next boot).
export const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  mode: "bonus",
  bonusWeight: 0.1,
  impressionThreshold: 5,
};

// The ONLY values that disable exploration. Anything else (unset / typo /
// unrecognized) falls through to the default-ON mode — the "benefit of the
// doubt" Bob asked for. `cts` is the Stage-2 reservation (degrades to bonus).
const EXPLORATION_OFF_VALUES = new Set(["off", "false", "0", "no", "disable", "disabled"]);

let _ctsWarned = false;

/**
 * Read the exploration config from env. `mode` defaults ON (bonus); only an
 * explicit off-synonym disables it. Numeric knobs still fail safe to defaults
 * on any out-of-range / non-numeric value so a typo can't perturb the weights.
 *   MEMORY_EXPLORATION_MODE                = off | bonus | cts   (default bonus/ON)
 *   MEMORY_EXPLORATION_BONUS_WEIGHT        = [0,1]               (default 0.1)
 *   MEMORY_EXPLORATION_IMPRESSION_THRESHOLD= positive int        (default 5)
 */
export function getExplorationConfigFromEnv(): ExplorationConfig {
  const rawMode = (process.env.MEMORY_EXPLORATION_MODE || "").toLowerCase().trim();
  // Default ON: only an explicit off-synonym disables; cts is reserved; anything
  // else (unset / typo / unrecognized) ⇒ bonus (benefit of the doubt).
  const mode: ExplorationMode = EXPLORATION_OFF_VALUES.has(rawMode)
    ? "off"
    : rawMode === "cts"
      ? "cts"
      : "bonus";
  if (mode === "cts" && !_ctsWarned) {
    _ctsWarned = true;
    console.warn(
      "[memory-ranking] MEMORY_EXPLORATION_MODE=cts requested but Thompson-sampling (Stage 2) is not yet implemented — degrading to deterministic `bonus` mode.",
    );
  }
  const bw = Number(process.env.MEMORY_EXPLORATION_BONUS_WEIGHT);
  const it = Number(process.env.MEMORY_EXPLORATION_IMPRESSION_THRESHOLD);
  return {
    mode,
    bonusWeight: Number.isFinite(bw) && bw >= 0 && bw <= 1 ? bw : DEFAULT_EXPLORATION_CONFIG.bonusWeight,
    impressionThreshold:
      Number.isInteger(it) && it > 0 ? it : DEFAULT_EXPLORATION_CONFIG.impressionThreshold,
  };
}

/**
 * Deterministic cold-start bonus in [0, bonusWeight]. Brand-new memories
 * (0 impressions) get the full weight; the bonus decays linearly to 0 as
 * impressions approach `impressionThreshold`, at which point the memory is
 * "proven" and competes on its own merits. `off` ⇒ always 0.
 */
export function explorationBonus(accessCount: number, cfg: ExplorationConfig): number {
  if (cfg.mode === "off") return 0;
  if (!(cfg.bonusWeight > 0) || !(cfg.impressionThreshold > 0)) return 0;
  const impressions = Number.isFinite(accessCount) && accessCount > 0 ? accessCount : 0;
  if (impressions >= cfg.impressionThreshold) return 0;
  const unproven = 1 - impressions / cfg.impressionThreshold; // (0, 1]
  return cfg.bonusWeight * unproven;
}

// ---------------------------------------------------------------------------
// Exploration circuit breaker (the "auto-switch" — Bob 2026-06-28).
//
// Exploration runs ON by default. If it MISBEHAVES at runtime — a non-finite
// bonus, or an external monitor/operator calling tripExplorationCircuit() —
// this process-local breaker trips and forces the effective mode to "off".
// The trip is persisted to data/exploration-circuit.json so it survives a
// restart, and scripts/exploration-circuit-review.ts runs the 3-model jury to
// adjudicate whether the auto-off was valid:
//   • jury ACCEPT  ⇒ confirmExplorationCircuitOff() — stays off (valid).
//   • jury REJECT  ⇒ resetExplorationCircuit("cleared-by-jury") — re-enables on
//                    next boot (false alarm, benefit of the doubt).
//
// Invariants: the breaker can ONLY ever turn exploration OFF, never on. Every
// persistence call is guarded and never throws into the ranking hot path.
// ---------------------------------------------------------------------------

export type ExplorationCircuitStatus =
  | "ok"
  | "tripped-pending-review"
  | "confirmed-off"
  | "cleared-by-jury";

export interface ExplorationCircuitState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null; // ISO
  status: ExplorationCircuitStatus;
}

const EXPLORATION_CIRCUIT_FILE = join(process.cwd(), "data", "exploration-circuit.json");
const FAULT_WINDOW_MS = 5 * 60_000;
const FAULT_TRIP_THRESHOLD = 5;

function defaultCircuit(): ExplorationCircuitState {
  return { tripped: false, reason: null, trippedAt: null, status: "ok" };
}

function loadCircuitFromDisk(): ExplorationCircuitState {
  try {
    const parsed = JSON.parse(readFileSync(EXPLORATION_CIRCUIT_FILE, "utf8"));
    if (parsed && typeof parsed === "object") {
      // A jury-cleared trip re-enables on boot (benefit of the doubt).
      if (parsed.status === "cleared-by-jury") return defaultCircuit();
      // Fail CLOSED: derive `tripped` STRICTLY from any off-indicating signal
      // (status OR the boolean flag) so a corrupt/hand-edited file that says
      // status:"confirmed-off" but tripped:false can never silently re-enable
      // exploration. The breaker only ever errs toward OFF.
      const offByStatus =
        parsed.status === "confirmed-off" || parsed.status === "tripped-pending-review";
      const offByFlag = parsed.tripped === true;
      if (offByStatus || offByFlag) {
        return {
          tripped: true,
          reason: typeof parsed.reason === "string" ? parsed.reason : null,
          trippedAt: typeof parsed.trippedAt === "string" ? parsed.trippedAt : null,
          status: parsed.status === "confirmed-off" ? "confirmed-off" : "tripped-pending-review",
        };
      }
    }
  } catch (_silentErr) { logSilentCatch("server/memory-ranking.ts", _silentErr); }
  return defaultCircuit();
}

let _circuitPersist = true; // tests disable fs
let _faultTimes: number[] = [];
let _circuit: ExplorationCircuitState = loadCircuitFromDisk();

function persistCircuit(): void {
  if (!_circuitPersist) return;
  try {
    // Atomic write: tmp file + rename so a crash mid-write can never leave a
    // truncated/corrupt circuit file (which loadCircuitFromDisk would then have
    // to fail-closed away). rename(2) is atomic within the same directory.
    const tmp = `${EXPLORATION_CIRCUIT_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(_circuit, null, 2));
    renameSync(tmp, EXPLORATION_CIRCUIT_FILE);
  } catch (_silentErr) { logSilentCatch("server/memory-ranking.ts", _silentErr); }
}

export function getExplorationCircuitState(): ExplorationCircuitState {
  return { ..._circuit };
}

/** Explicit trip (runtime fault threshold, external monitor, or operator). */
export function tripExplorationCircuit(reason: string): void {
  if (_circuit.tripped) return; // already off — keep the original reason/time
  _circuit = {
    tripped: true,
    reason: String(reason).slice(0, 500),
    trippedAt: new Date().toISOString(),
    status: "tripped-pending-review",
  };
  _faultTimes = [];
  console.error(
    `[memory-ranking] EXPLORATION AUTO-DISABLED (circuit tripped): ${_circuit.reason}. Awaiting jury review — run scripts/exploration-circuit-review.ts.`,
  );
  persistCircuit();
}

/** Record a runtime fault; trips the breaker once faults breach the window threshold. */
export function noteExplorationFault(reason: string): void {
  const now = Date.now();
  _faultTimes = _faultTimes.filter((t) => now - t < FAULT_WINDOW_MS);
  _faultTimes.push(now);
  if (_faultTimes.length >= FAULT_TRIP_THRESHOLD) {
    tripExplorationCircuit(
      `${FAULT_TRIP_THRESHOLD} exploration faults within ${FAULT_WINDOW_MS / 60000}min — last: ${reason}`,
    );
  }
}

/** Jury REJECT / operator: false alarm ⇒ re-enable (default-on resumes on next boot). */
export function resetExplorationCircuit(
  reason: string,
  status: Extract<ExplorationCircuitStatus, "ok" | "cleared-by-jury"> = "cleared-by-jury",
): void {
  _circuit = { tripped: false, reason: null, trippedAt: null, status };
  _faultTimes = [];
  console.warn(`[memory-ranking] exploration circuit reset (${status}): ${reason}`);
  persistCircuit();
}

/** Jury ACCEPT: the auto-off was valid ⇒ keep exploration off durably. */
export function confirmExplorationCircuitOff(reason: string): void {
  _circuit = {
    tripped: true,
    reason: String(reason).slice(0, 500),
    trippedAt: _circuit.trippedAt ?? new Date().toISOString(),
    status: "confirmed-off",
  };
  _faultTimes = [];
  persistCircuit();
}

/** Test hook: toggle fs persistence and reset to a clean armed state. */
export function __setExplorationCircuitForTest(persist: boolean): void {
  _circuitPersist = persist;
  _circuit = defaultCircuit();
  _faultTimes = [];
}

/** Apply the breaker as a one-way override: tripped ⇒ force mode "off". */
export function effectiveExplorationConfig(cfg: ExplorationConfig): ExplorationConfig {
  return _circuit.tripped ? { ...cfg, mode: "off" } : cfg;
}

export function calculateTemporalDecay(ageInDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !Number.isFinite(ageInDays)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

export function applyTemporalDecay(
  score: number,
  lastAccessedDate: Date | string,
  config: TemporalDecayConfig = DEFAULT_TEMPORAL_DECAY
): number {
  if (!config.enabled) return score;
  const ageMs = Date.now() - new Date(lastAccessedDate).getTime();
  const ageInDays = ageMs / DAY_MS;
  return score * calculateTemporalDecay(ageInDays, config.halfLifeDays);
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const token of smaller) {
    if (larger.has(token)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b));
}

export interface ScoredMemory {
  id: number;
  fact: string;
  category: string;
  embedding?: number[] | null;
  lastAccessed: Date | string;
  accessCount?: number;
  _score: number;
  [key: string]: any;
}

export function mmrRerank(
  items: ScoredMemory[],
  config: MMRConfig = DEFAULT_MMR_CONFIG,
  maxResults?: number
): ScoredMemory[] {
  if (!config.enabled || items.length <= 1) return items;

  const limit = maxResults || items.length;
  const selected: ScoredMemory[] = [];
  const remaining = [...items];

  const maxScore = Math.max(...remaining.map((i) => i._score), 1);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate._score / maxScore;

      let maxSim = 0;
      for (const sel of selected) {
        const sim = textSimilarity(candidate.fact, sel.fact);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = config.lambda * relevance - (1 - config.lambda) * maxSim;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

export interface RankingOptions {
  temporalDecay?: TemporalDecayConfig;
  mmr?: MMRConfig;
  maxResults?: number;
  /** Cold-start exploration (Stage 1 SA-CTS). Defaults to env config (off unless set). */
  exploration?: ExplorationConfig;
}

export function rankMemories(
  memories: any[],
  queryEmbedding: number[] | null,
  userMessage: string,
  options: RankingOptions = {}
): ScoredMemory[] {
  const tdConfig = options.temporalDecay || DEFAULT_TEMPORAL_DECAY;
  const mmrConfig = options.mmr || DEFAULT_MMR_CONFIG;
  // Resolve exploration, then let the circuit breaker veto it (tripped ⇒ off).
  const expConfig = effectiveExplorationConfig(options.exploration || getExplorationConfigFromEnv());

  const scored: ScoredMemory[] = memories.map((m) => {
    let semanticScore = 0;
    if (queryEmbedding && m.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, m.embedding as number[]);
    } else if (userMessage) {
      semanticScore = keywordSimilarity(userMessage, m.fact);
    }

    // Aligned with vectorSearchMemory hybrid weights (server/embeddings.ts):
    //   0.55 * similarity + 0.20 * importance + 0.15 * recency + 0.10 * frequency
    // R98.19: confidence is folded in MULTIPLICATIVELY (a low-confidence fact
    // should be down-ranked across the board, not just on one axis). Default
    // confidence is 1.0, so legacy rows are unaffected. confidence below
    // ~0.5 effectively halves the score and pushes the fact below near-equal
    // high-confidence neighbors.
    const importance = (m.accessCount || 0) >= 5 ? 1.0 : 0.0;
    const frequency = Math.min(Math.log((m.accessCount || 0) + 1) / Math.log(51), 1.0);
    // R116 — agentmemory N2. Use lastReinforcedAt (resets on every retrieval
    // hit) instead of lastAccessed, and pull per-category half_life_days if
    // present (from the joined memory_categories row). Falls back gracefully:
    // missing reinforcement timestamp → lastAccessed; missing half-life → 14d.
    // 14d default preserves backward compatibility with pre-R116 ranking.
    const reinforcedSrc = m.lastReinforcedAt || m.last_reinforced_at || m.lastAccessed || m.createdAt || Date.now();
    const ageMs = Date.now() - new Date(reinforcedSrc).getTime();
    const ageInSeconds = Math.max(0, ageMs / 1000);
    const halfLifeDays = (typeof m.halfLifeDays === "number" && m.halfLifeDays > 0)
      ? m.halfLifeDays
      : (typeof m.half_life_days === "number" && m.half_life_days > 0)
        ? m.half_life_days
        : 14;
    const recency = Math.exp(-ageInSeconds / (halfLifeDays * 86400));
    const additive =
        semanticScore * 0.55
      + importance    * 0.20
      + recency       * 0.15
      + frequency     * 0.10;
    const conf = typeof m.confidence === "number" && Number.isFinite(m.confidence)
      ? Math.max(0, Math.min(1, m.confidence))
      : 1.0;
    // R116 N7: fold quality_score multiplicatively alongside confidence — a
    // structurally-malformed memory that we happened to be very-confident
    // about still gets down-ranked.
    const qual = typeof m.qualityScore === "number" && Number.isFinite(m.qualityScore)
      ? Math.max(0, Math.min(1, m.qualityScore))
      : (typeof m.quality_score === "number" && Number.isFinite(m.quality_score))
        ? Math.max(0, Math.min(1, m.quality_score))
        : 1.0;
    // Cold-start exploration bonus (Stage 1 SA-CTS). Folded into the additive
    // sum BEFORE the conf*qual multiply so it still respects confidence/quality
    // (an unproven LOW-confidence fact is not blindly boosted). Runs ON by
    // default; the circuit breaker (effectiveExplorationConfig) forces it off if
    // it misbehaves. A non-finite/negative bonus is a fault ⇒ note it (which can
    // trip the breaker) and fall back to explore=0 (legacy scoring).
    let explore = 0;
    if (expConfig.mode !== "off") {
      const b = explorationBonus(m.accessCount || 0, expConfig);
      if (Number.isFinite(b) && b >= 0) {
        explore = b;
      } else {
        noteExplorationFault(`invalid exploration bonus (${b}) for memory ${m.id ?? "?"}`);
      }
    }
    let rawScore = (additive + explore) * conf * qual;
    if (!Number.isFinite(rawScore)) {
      // Only attribute to exploration when it actually contributed.
      if (explore !== 0) noteExplorationFault(`non-finite rawScore for memory ${m.id ?? "?"}`);
      rawScore = additive * conf * qual;
    }

    return { ...m, _score: rawScore };
  });

  scored.sort((a, b) => b._score - a._score);

  return mmrRerank(scored, mmrConfig, options.maxResults);
}

// ---------------------------------------------------------------------------
// System1 / System2 memory-retrieval gate (Hy-Memory-inspired).
//
// System1 = the cheap, no-LLM fast recall above (`rankMemories`: vector cosine
// + importance/recency/frequency arithmetic + MMR). System2 = the expensive
// per-turn `gpt-5-mini` anticipatory pass (`proactiveContextLoad` in
// chat-engine), which feeds ONLY the supplementary "L2 — Anticipated" block.
//
// On a long-running collaborative agent a large share of turns are bare acks
// ("yes", "do it", "thanks", "go ahead") — there is nothing to anticipate, yet
// today every one of them still fires the System2 completion. This gate decides
// whether the deep pass is worth running. It FAILS OPEN: when in any doubt it
// returns `escalate: true`, preserving the legacy always-deep behaviour, so it
// can only ever REMOVE a provably-pointless LLM call, never drop recall.
// ---------------------------------------------------------------------------

// Curated to UNAMBIGUOUS acknowledgements only. Deliberately excludes
// intent-bearing singletons ("more", "next", "go", "again", "please", "good",
// "fine") that can carry a real request in context — keeping them would risk
// skipping the deep pass on a genuine turn (recall loss), which this gate must
// never do. Every phrase here is a whole-message confirmation/reaction with no
// anticipatory content of its own.
const ACK_PHRASES = new Set<string>([
  "yes", "y", "yep", "yeah", "yup", "ya", "ok", "okay", "k", "kk", "sure",
  "thanks", "thank you", "thx", "ty", "tysm", "cheers",
  "got it", "gotcha", "understood", "noted", "makes sense",
  "perfect", "great", "nice", "cool", "awesome", "excellent", "good job",
  "well done", "love it",
  "continue", "go on", "go ahead", "proceed", "keep going", "carry on",
  "do it", "do that", "go for it", "run it", "run that", "ship it", "send it",
  "yes please", "please do", "sounds good", "looks good", "lgtm", "sgtm",
  "ok thanks", "ok thank you", "ok great", "great thanks", "perfect thanks",
  "yes do it", "yes go ahead", "yes please do", "do that again", "run it again",
]);

/**
 * True when the entire normalized message is a bare acknowledgement /
 * confirmation with no informational intent to anticipate. Matches the WHOLE
 * message (not a substring) so "yes, also check the logs" is NOT trivial.
 * A trailing question mark always signals intent (seeking info) ⇒ not trivial.
 */
export function isTrivialAck(message: string): boolean {
  if (!message) return true;
  if (/\?\s*$/.test(message)) return false;
  let m = message.toLowerCase().trim().replace(/\s+/g, " ");
  // Strip surrounding punctuation / symbols / emoji (keep internal apostrophes).
  m = m.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "").trim();
  if (m.length === 0) return true;
  return ACK_PHRASES.has(m);
}

export interface DeepMemoryGateOptions {
  /** Master switch. Default: env `MEMORY_DEEP_GATE !== "0"` (on). */
  enabled?: boolean;
  /** Also skip when fast recall is already very strong. Default: env `MEMORY_DEEP_GATE_AGGRESSIVE === "1"` (off). */
  aggressive?: boolean;
  /** Top `_score` at/above which fast recall counts as "strong" (aggressive only). */
  strongScore?: number;
}

export interface DeepMemoryGateDecision {
  escalate: boolean;
  reason: string;
}

/**
 * Decide whether the expensive System2 anticipatory memory pass is worth
 * running for this turn. Fails OPEN (escalate) on any uncertainty.
 */
export function shouldRunDeepMemoryPass(
  userMessage: string,
  ranked: ScoredMemory[] = [],
  opts: DeepMemoryGateOptions = {}
): DeepMemoryGateDecision {
  const enabled = opts.enabled ?? (process.env.MEMORY_DEEP_GATE !== "0");
  if (!enabled) return { escalate: true, reason: "gate-disabled" };

  // Triviality gate (default, zero recall risk).
  if (isTrivialAck(userMessage)) return { escalate: false, reason: "trivial-ack" };

  // Aggressive (opt-in): a clearly strong cheap top hit ⇒ skip the deep pass.
  // OFF by default because anticipated memories are cross-category and not
  // necessarily covered by the current turn's vector recall.
  const aggressive = opts.aggressive ?? (process.env.MEMORY_DEEP_GATE_AGGRESSIVE === "1");
  if (aggressive && ranked.length > 0) {
    const strongScore = opts.strongScore ?? (Number(process.env.MEMORY_DEEP_GATE_STRONG_SCORE) || 0.85);
    const top = ranked[0]?._score;
    if (typeof top === "number" && Number.isFinite(top) && top >= strongScore) {
      return { escalate: false, reason: `strong-fast-recall(${top.toFixed(2)})` };
    }
  }

  return { escalate: true, reason: "default-escalate" };
}
