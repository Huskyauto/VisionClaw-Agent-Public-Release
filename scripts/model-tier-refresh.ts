#!/usr/bin/env tsx
/**
 * scripts/model-tier-refresh.ts — weekly autonomous model-tier re-evaluation.
 *
 * Bob's design (2026-06-03): once a week, on autopilot, re-evaluate the LLM
 * library and keep the strongest, freshest models in the "frontier" tier that
 * the 3-LLM jury + all complicated work run on, while routing mundane busy-work
 * to a cheaper "mundane" tier that is still smart enough not to make stupid
 * mistakes. The jury that gates the rest of the self-improvement loop gets
 * sharper as the underlying models improve.
 *
 * Pipeline:
 *   1. LIVE DISCOVERY — fetch the OpenRouter catalog (frontier + open, with live
 *      pricing) and run the watchlist auto-add so the overlay is fresh.
 *   2. Assemble the full gradeable universe (current tiers ∪ MODEL_REGISTRY ∪
 *      overlay ∪ watchlist), then rank it with the EXTERNAL authority (Artificial
 *      Analysis intelligence index) and cap to the probe budget keeping the
 *      highest-ranked challengers (so probe spend goes to real top newcomers).
 *   3. Score each candidate against the deterministic competence battery
 *      (server/model-tier-eval.ts) via the real provider client.
 *   4. Fold in our own moa_responses telemetry (per-model proposer success rate),
 *      live OpenRouter cost, and the Artificial Analysis external quality signal.
 *   5. rankAndAssignTiers (pure, fail-closed) decides the next frontier/mundane.
 *   6. Write data/model-tiers.json (atomic) — server/moa.ts reads it (fail-open).
 *
 * Both external dependencies are FAIL-OPEN: if OpenRouter or Artificial Analysis
 * is unreachable (or no AA key is set), the refresh runs exactly as before on the
 * static registry + neutral external prior. AA only ever DIFFERENTIATES models it
 * can match; it never penalizes an unmatched incumbent.
 *
 * Safety: self-referential (this picks the models behind the jury), so it is
 * deliberately conservative — never ships a frontier below quorum, keeps current
 * tiers on insufficient signal, owner-notifies every change + every failure.
 *
 * Built for a Replit Scheduled Deployment (weekly cron). Single-shot, no TTY,
 * env-configured. Exit codes:
 *   0  ran clean (applied a change, or correctly kept tiers unchanged)
 *   2  bad config
 *   3  fatal / operational failure (also owner-notified)
 *
 * Flags / env:
 *   --dry-run | MODEL_TIER_DRY_RUN=1   evaluate + rank + log, but do NOT write
 *                                      data/model-tiers.json.
 *   MODEL_TIER_FILE=<path>             override the tier-state file location.
 *   MODEL_TIER_MAX_CANDIDATES=<n>      cap the candidate set (default 14).
 *   MODEL_TIER_WATCHLIST=a,b,c         extra model ids to force into the candidate set.
 */

import fs from "node:fs";
import path from "node:path";
import {
  EVAL_BATTERY,
  scoreModel,
  rankAndAssignTiers,
  costRanks,
  buildExternalQualityMap,
  normalizeModelKey,
  type ModelGrades,
  type ModelScore,
  type TierState,
} from "../server/model-tier-eval";

const DEFAULT_TIER_FILE = path.join("data", "model-tiers.json");
const MIN_FRONTIER = 3;
const MAX_FRONTIER = 4;
const MAX_MUNDANE = 6;

// R125+52.1/.2 (Bob 2026-06-09) — OWNER FRONTIER LOCK. Bob declared FOUR top-tier
// models as THE canonical high-end set platform-wide; the weekly autonomous
// refresh must NOT drift the frontier away from them. When the lock is
// active the frontier is written VERBATIM from the lock and frontier re-ranking
// is bypassed; the mundane (cheap busy-work) tier is still re-ranked normally so
// the cost-tier refresh keeps working. REVERSIBLE: set OWNER_LOCKED_FRONTIER=""
// (explicit empty) to restore fully-autonomous frontier ranking, or set it to a
// comma-separated id list to lock a DIFFERENT set. FAIL-OPEN: if fewer than
// MIN_FRONTIER locked ids are present in the registry the lock disables itself
// (logged) so a typo can never shrink the jury below quorum.
const DEFAULT_LOCKED_FRONTIER = ["claude-opus-4-8", "gpt-5.5", "gemini-3.5-flash", "deepseek/deepseek-v4-pro"];
function resolveLockedFrontier(): string[] | null {
  const raw = process.env.OWNER_LOCKED_FRONTIER;
  if (raw !== undefined && raw.trim() === "") return null; // explicit unlock
  const ids =
    raw && raw.trim().length > 0
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_LOCKED_FRONTIER;
  const uniq = [...new Set(ids)];
  if (uniq.length < MIN_FRONTIER) return null;
  return uniq.slice(0, MAX_FRONTIER);
}
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_TOKENS = 200;
const TELEMETRY_LOOKBACK_DAYS = 14;

function die(code: number, msg: string): never {
  process.stderr.write(`[model-tier] ${msg}\n`);
  process.exit(code);
}
function log(msg: string) {
  process.stderr.write(`[model-tier] ${msg}\n`);
}

function loadTierState(file: string): TierState {
  if (!fs.existsSync(file)) {
    die(2, `tier-state file ${file} not found — seed it first (see data/model-tiers.json).`);
  }
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    die(2, `tier-state file is not valid JSON: ${String(e)}`);
  }
  const frontier = Array.isArray(raw?.frontier) ? raw.frontier.filter((x: any) => typeof x === "string") : [];
  const mundane = Array.isArray(raw?.mundane) ? raw.mundane.filter((x: any) => typeof x === "string") : [];
  if (frontier.length < MIN_FRONTIER) {
    die(2, `tier-state frontier has ${frontier.length} models, need >= ${MIN_FRONTIER}.`);
  }
  return {
    frontier,
    mundane,
    probation: raw?.probation && typeof raw.probation === "object" ? raw.probation : {},
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

/** Owner-notification (best-effort), mirrors scripts/skill-optimize-nightly.ts. */
async function notifyOwner(subject: string, body: string) {
  const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
  if (!ownerEmail) {
    log(`notable event but no OWNER_*_EMAIL env — logged for manual review: ${subject}`);
    return;
  }
  try {
    const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
    const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
    const inboxResult = await getOrCreateTenantInbox(ADMIN_TENANT_ID);
    const inboxId =
      typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({ inboxId, to: ownerEmail, subject, text: body });
    log(`emailed ${ownerEmail}: ${subject}`);
  } catch (e) {
    log(`owner email failed (event still logged): ${(e as Error).message}`);
  }
}

/**
 * costClass -> an approximate $/M-output cost, on the SAME scale as the live
 * OpenRouter completion price, so the two can be mixed in costRanks() without a
 * scale-mismatch bug (a "paid" model with no live price must not look cheaper
 * than a live $5/M model just because the buckets used a smaller scale).
 */
function costOf(costClass?: string): number {
  switch (costClass) {
    case "free": return 0;
    case "cheap": return 0.5;
    case "paid": return 10;
    default: return 3;
  }
}

interface UniverseEntry { costClass?: string; tierRank: number; forced: boolean }

/**
 * Live OpenRouter discovery: fetch the catalog (frontier + open, with live
 * pricing) and run the watchlist auto-add so the overlay is fresh BEFORE we read
 * it. Fully fail-open — if OpenRouter is unreachable we fall back to the static
 * registry + overlay-on-disk and return an empty catalog. Returns the raw
 * catalog so the caller can build a live price map.
 */
async function runLiveDiscovery(protectedIds: string[]): Promise<{ raw: any[]; rankingChanges: { promoted: string[]; retired: string[] } }> {
  const rankingChanges = { promoted: [] as string[], retired: [] as string[] };
  try {
    const {
      fetchOpenRouterCatalog, runWatchlistAutoAdd,
      fetchArtificialAnalysisRanked, runRankingDrivenAutoAdd,
    } = await import("../server/model-catalog");
    const raw = await fetchOpenRouterCatalog();
    log(`live OpenRouter catalog: ${raw.length} models fetched.`);

    // (a) hand-maintained watchlist auto-add (legacy, still honored).
    try {
      const added = runWatchlistAutoAdd(raw);
      if (added.length) {
        log(`watchlist auto-add promoted ${added.length} model(s) into the overlay: ${added.map((a: any) => a.id).join(", ")}`);
      }
    } catch (e) {
      log(`watchlist auto-add skipped (${(e as Error).message}) — continuing.`);
    }

    // (b) RANKING-DRIVEN auto-adopt: keep the routable names tracking the live
    //     leaderboard — top closed + top open models that are routable on
    //     OpenRouter get promoted; stale ones (not live-tiered) get retired.
    //     Fully fail-open: no AA key / AA down / OR empty ⇒ no-op.
    try {
      const topK = Number(process.env.RANKING_AUTOADD_TOP_K) || 5;
      const ranked = await fetchArtificialAnalysisRanked();
      if (ranked.length === 0) {
        log(`ranking-driven auto-add skipped — no Artificial Analysis ranking available (neutral / no-op).`);
      } else {
        const closed = ranked.filter((r) => r.openness === "closed").length;
        const res = runRankingDrivenAutoAdd(ranked, raw, { topKPerClass: topK, protectedIds });
        rankingChanges.promoted = res.promoted.map((p) => p.id);
        rankingChanges.retired = res.retired;
        log(`ranking-driven auto-add: AA ranked ${ranked.length} models (${closed} closed / ${ranked.length - closed} open), top-${topK}/class; promoted ${res.promoted.length} [${rankingChanges.promoted.join(", ")}], retired ${res.retired.length} [${res.retired.join(", ")}].`);
      }
    } catch (e) {
      log(`ranking-driven auto-add skipped (${(e as Error).message}) — continuing.`);
    }

    return { raw, rankingChanges };
  } catch (e) {
    log(`live OpenRouter discovery unavailable (static registry only): ${(e as Error).message}`);
    return { raw: [], rankingChanges };
  }
}

/** normalizeModelKey(rawId) -> cheapest live $/M-output seen for that model. */
function buildLivePriceMap(rawCatalog: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of rawCatalog) {
    if (!m?.id) continue;
    const completionPerM = parseFloat(m?.pricing?.completion || "0") * 1_000_000;
    if (!Number.isFinite(completionPerM)) continue;
    const nk = normalizeModelKey(m.id);
    if (!nk) continue;
    if (out[nk] == null || completionPerM < out[nk]) out[nk] = completionPerM;
  }
  return out;
}

/** Pull the Artificial Analysis intelligence index for a model entry, defensively. */
function pickIntelligence(m: any): number | null {
  const cands = [
    m?.evaluations?.artificial_analysis_intelligence_index,
    m?.artificial_analysis_intelligence_index,
    m?.evaluations?.intelligence_index,
    m?.intelligence_index,
    m?.intelligenceIndex,
  ];
  for (const c of cands) if (typeof c === "number" && Number.isFinite(c)) return c;
  return null;
}

/**
 * EXTERNAL ranking authority: Artificial Analysis (free API, covers proprietary
 * + open with a quality index). Returns a candidateId -> 0..1 percentile map.
 * FULLY FAIL-OPEN: no API key, a non-200, a bad shape, or zero matches all
 * resolve to {} so the refresh runs exactly as it did before (neutral prior).
 * Attribution note: AA data is used internally for ranking only, never surfaced.
 */
async function loadExternalRanking(candidateIds: string[]): Promise<Record<string, number>> {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY || process.env.ARTIFICIALANALYSIS_API_KEY;
  if (!key) {
    log(`Artificial Analysis API key not set (ARTIFICIAL_ANALYSIS_API_KEY) — external ranking skipped (neutral prior).`);
    return {};
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch("https://artificialanalysis.ai/api/v2/data/llms/models", {
      headers: { "x-api-key": key, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Artificial Analysis API HTTP ${resp.status}`);
    const json: any = await resp.json();
    const arr: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    const entries: Array<{ key: string; index: number }> = [];
    for (const m of arr) {
      const name = m?.slug || m?.name || m?.id;
      const idx = pickIntelligence(m);
      if (typeof name === "string" && idx != null) entries.push({ key: name, index: idx });
    }
    if (entries.length === 0) {
      log(`Artificial Analysis returned no usable intelligence-index rows — neutral prior.`);
      return {};
    }
    const map = buildExternalQualityMap(candidateIds, entries);
    log(`Artificial Analysis: ${entries.length} ranked models; matched ${Object.keys(map).length}/${candidateIds.length} candidate(s).`);
    return map;
  } catch (e) {
    log(`Artificial Analysis ranking unavailable (neutral prior used): ${(e as Error).message}`);
    return {};
  } finally {
    clearTimeout(t);
  }
}

/**
 * Gather the FULL gradeable universe (no cap): current incumbents + watchlist
 * (forced) plus every registry + overlay model (challengers). Only models that
 * exist in the registry/overlay are gradeable, because getClientForModel() can
 * only route those — live discovery's job is to keep the overlay fresh so new
 * models become gradeable, not to invent un-routable candidates.
 */
async function gatherUniverse(current: TierState): Promise<Map<string, UniverseEntry>> {
  const { MODEL_REGISTRY } = await import("../server/providers");
  const watchlist = (process.env.MODEL_TIER_WATCHLIST || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  let overlay: any[] = [];
  let overlayCorrupt = false;
  try {
    const overlayPath = path.join("data", "model-registry-overlay.json");
    if (fs.existsSync(overlayPath)) overlay = JSON.parse(fs.readFileSync(overlayPath, "utf8")) || [];
  } catch {
    // Fail CLOSED: an unparseable overlay (vs. an absent one) means we cannot
    // tell which overlay-backed models are currently live. Continuing with an
    // empty overlay would silently drop those incumbents from model-tiers.json
    // when the universe is graded. Abort the cycle so a human fixes the file.
    overlayCorrupt = true;
  }
  if (overlayCorrupt) {
    throw new Error("[model-tier-refresh] data/model-registry-overlay.json is present but unparseable — aborting tier refresh (fail-closed) to avoid dropping overlay-backed live models. Fix the JSON or remove the file, then re-run.");
  }

  const tierRankOf = (m: any) =>
    m.tier === "powerful" || m.tier === "reasoning" ? 0 : m.tier === "balanced" ? 1 : 2;

  const registry = [...MODEL_REGISTRY, ...overlay].filter(
    (m: any) => m && typeof m.id === "string" && m.id !== "auto",
  );
  const costById = new Map<string, string | undefined>();
  const rankById = new Map<string, number>();
  const knownIds = new Set<string>();
  for (const m of registry) { costById.set(m.id, m.costClass); rankById.set(m.id, tierRankOf(m)); knownIds.add(m.id); }

  const uni = new Map<string, UniverseEntry>();
  // INVARIANT: only models that exist in the registry/overlay are gradeable —
  // getClientForModel() falls back to a REAL working client (e.g. the Anthropic
  // integration) for an unknown id, so an unvetted incumbent/watchlist id would
  // otherwise be probed AS claude-sonnet and could pollute this self-referential
  // tier file under a fake name. Drop unknown forced ids loudly; never grade them.
  for (const id of [...current.frontier, ...current.mundane, ...watchlist]) {
    if (uni.has(id)) continue;
    if (!knownIds.has(id)) {
      log(`WARNING: forced candidate "${id}" is not in MODEL_REGISTRY/overlay — NOT gradeable (skipped). Add it to the registry/overlay to evaluate it.`);
      continue;
    }
    uni.set(id, { costClass: costById.get(id), tierRank: rankById.get(id) ?? 2, forced: true });
  }
  for (const m of registry) {
    if (!uni.has(m.id)) uni.set(m.id, { costClass: m.costClass, tierRank: tierRankOf(m), forced: false });
  }
  return uni;
}

/**
 * Cap the universe down to the probe-grading budget. Forced models (incumbents
 * + watchlist) are ALWAYS kept (we must re-test them). The remaining budget goes
 * to the challengers with the highest external (Artificial Analysis) score, then
 * by registry tier — so we spend expensive battery probes on the genuinely
 * top-ranked newcomers, not whatever happens to be first in the registry.
 */
function capCandidates(
  universe: Map<string, UniverseEntry>,
  aaMap: Record<string, number>,
  max: number,
): Map<string, { costClass?: string }> {
  const out = new Map<string, { costClass?: string }>();
  for (const [id, m] of universe) if (m.forced) out.set(id, { costClass: m.costClass });

  const challengers = [...universe.entries()]
    .filter(([id, m]) => !m.forced && !out.has(id))
    .sort((a, b) => {
      const ea = aaMap[a[0]] ?? -1;
      const eb = aaMap[b[0]] ?? -1;
      if (eb !== ea) return eb - ea;
      return a[1].tierRank - b[1].tierRank;
    });
  for (const [id, m] of challengers) {
    if (out.size >= max) break;
    out.set(id, { costClass: m.costClass });
  }
  return out;
}

/** Run the competence battery against one model. Returns per-probe grades. */
async function gradeModel(modelId: string): Promise<ModelGrades> {
  const { getClientForModel } = await import("../server/providers");
  const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
  const perProbe: Record<string, number> = {};
  let anyAnswered = false;

  for (const probe of EVAL_BATTERY) {
    try {
      const { client, actualModelId } = await getClientForModel(modelId, ADMIN_TENANT_ID);
      const resp = await Promise.race([
        client.chat.completions.create({
          model: actualModelId,
          messages: [{ role: "user", content: probe.prompt }],
          max_tokens: PROBE_MAX_TOKENS,
          temperature: 0,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("probe timeout")), PROBE_TIMEOUT_MS)),
      ]);
      const out = (resp as any)?.choices?.[0]?.message?.content || "";
      perProbe[probe.id] = probe.grade(out);
      anyAnswered = true;
    } catch (e) {
      perProbe[probe.id] = 0; // a model that errors on a basic probe fails that probe
      log(`  ${modelId} probe "${probe.id}" failed: ${(e as Error).message}`);
    }
  }
  return { modelId, perProbe, evaluated: anyAnswered };
}

/** Best-effort per-model success-rate signal from recent moa_responses. */
async function loadTelemetry(): Promise<Record<string, number>> {
  try {
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - TELEMETRY_LOOKBACK_DAYS * 86_400_000).toISOString();
    const res: any = await db.execute(
      sql`SELECT proposer_details_json FROM moa_responses WHERE created_at >= ${cutoff} LIMIT 2000`,
    );
    const rows = (res as any).rows || res || [];
    const tally = new Map<string, { ok: number; total: number }>();
    for (const row of rows) {
      const detailsRaw = row.proposer_details_json || row.proposerDetailsJson;
      if (!detailsRaw) continue;
      let details: any;
      try { details = JSON.parse(detailsRaw); } catch { continue; }
      const arr = Array.isArray(details) ? details : Array.isArray(details?.proposers) ? details.proposers : [];
      for (const p of arr) {
        const id = p?.modelId || p?.model || p?.id;
        if (typeof id !== "string") continue;
        const ok = p?.ok === true || p?.success === true || p?.succeeded === true || (p?.error == null && p?.answer);
        const t = tally.get(id) || { ok: 0, total: 0 };
        t.total += 1;
        if (ok) t.ok += 1;
        tally.set(id, t);
      }
    }
    const out: Record<string, number> = {};
    for (const [id, t] of tally) if (t.total >= 3) out[id] = t.ok / t.total;
    return out;
  } catch (e) {
    log(`telemetry unavailable (neutral prior used): ${(e as Error).message}`);
    return {};
  }
}

function atomicWriteJson(file: string, obj: unknown) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.env.MODEL_TIER_DRY_RUN === "1";
  const file = process.env.MODEL_TIER_FILE || DEFAULT_TIER_FILE;
  const current = loadTierState(file);
  log(`current frontier=[${current.frontier.join(", ")}] mundane=[${current.mundane.join(", ")}]`);

  // 1. Live discovery: refresh the overlay from OpenRouter + grab live pricing,
  //    AND auto-adopt the top closed/open models from the live AA ranking. The
  //    current live-tier ids are passed as protectedIds so a ranking-driven
  //    entry the jury is actively using is never retired out from under it.
  const protectedIds = [...current.frontier, ...current.mundane];
  const { raw: rawCatalog, rankingChanges } = await runLiveDiscovery(protectedIds);
  const livePrice = buildLivePriceMap(rawCatalog);

  // 2. Gather the full gradeable universe, then rank it with the external
  //    authority so the cap keeps the highest-ranked challengers, not arbitrary ones.
  const universe = await gatherUniverse(current);
  const aaUniverse = await loadExternalRanking([...universe.keys()]);
  const max = Number(process.env.MODEL_TIER_MAX_CANDIDATES) || 14;
  const candidates = capCandidates(universe, aaUniverse, max);
  log(`evaluating ${candidates.size} candidate model(s)${dryRun ? " — DRY RUN (no write)" : ""}`);

  const telemetry = await loadTelemetry();
  const costInputs: Array<{ modelId: string; cost: number }> = [];
  for (const [id, m] of candidates) {
    const liveOutM = livePrice[normalizeModelKey(id)];
    costInputs.push({ modelId: id, cost: liveOutM != null ? liveOutM : costOf(m.costClass) });
  }
  const ranks = costRanks(costInputs);

  const scores: ModelScore[] = [];
  for (const [id] of candidates) {
    log(`--- grading "${id}" ---`);
    const grades = await gradeModel(id);
    const s = scoreModel(grades);
    s.telemetryWin = telemetry[id];
    s.costRank = ranks[id];
    s.externalQuality = aaUniverse[id];
    log(`  battery=${s.batteryScore.toFixed(3)} floorPass=${s.floorPass} telem=${s.telemetryWin ?? "n/a"} ext=${s.externalQuality ?? "n/a"}`);
    scores.push(s);
  }

  const result = rankAndAssignTiers(scores, current, {
    minFrontier: MIN_FRONTIER,
    maxFrontier: MAX_FRONTIER,
    maxMundane: MAX_MUNDANE,
  });

  // R125+52.1 — OWNER FRONTIER LOCK. Pin the frontier to Bob's declared top-tier
  // set so the autonomous ranker can never drift it; still keep the freshly
  // re-ranked mundane tier. Fail-open: a locked set short of quorum-in-registry
  // is ignored (logged) and the ranker's frontier stands.
  const locked = resolveLockedFrontier();
  if (locked) {
    const known = locked.filter((id) => universe.has(id));
    if (known.length < MIN_FRONTIER) {
      log(
        `OWNER LOCK ignored — only ${known.length}/${locked.length} locked frontier ids are in the registry/overlay; using autonomous ranking.`,
      );
    } else {
      const lockedFrontier = known.slice(0, MAX_FRONTIER);
      const lockedSet = new Set(lockedFrontier);
      const rankerWanted = result.next.frontier.join(", ");
      result.next.frontier = [...lockedFrontier];
      result.next.mundane = result.next.mundane.filter((id) => !lockedSet.has(id));
      for (const id of lockedFrontier) delete result.next.probation[id];
      // Recompute change deltas against the actual on-disk state so the email +
      // write decision reflect the LOCKED outcome, not the ranker's proposal.
      result.promotedToFrontier = result.next.frontier.filter((id) => !current.frontier.includes(id));
      result.demotedFromFrontier = current.frontier.filter((id) => !lockedSet.has(id));
      // Include probation in the change check — clearing a locked id from
      // probation is a real on-disk delta that must still trigger a write/email
      // even when frontier+mundane are otherwise unchanged.
      const probaKeys = (p: Record<string, string>) => Object.keys(p).sort().join(",");
      result.changed =
        result.next.frontier.join(",") !== current.frontier.join(",") ||
        result.next.mundane.join(",") !== current.mundane.join(",") ||
        probaKeys(result.next.probation) !== probaKeys(current.probation);
      log(`OWNER FRONTIER LOCK active — frontier pinned to [${lockedFrontier.join(", ")}] (ranker wanted [${rankerWanted}]).`);
    }
  }

  log(`=== RESULT ===`);
  for (const n of result.notes) log(`  note: ${n}`);
  log(`  next frontier=[${result.next.frontier.join(", ")}]`);
  log(`  next mundane=[${result.next.mundane.join(", ")}]`);
  log(`  changed=${result.changed} promotedFrontier=[${result.promotedToFrontier.join(", ")}] demotedFrontier=[${result.demotedFromFrontier.join(", ")}]`);

  const rankingLine =
    rankingChanges.promoted.length || rankingChanges.retired.length
      ? `\nRanking-driven overlay changes this run:\n` +
        (rankingChanges.promoted.length ? `  auto-adopted (top closed/open): ${rankingChanges.promoted.join(", ")}\n` : "") +
        (rankingChanges.retired.length ? `  retired (fell off the leaderboard): ${rankingChanges.retired.join(", ")}\n` : "")
      : "";

  if (!result.changed) {
    log(`tiers unchanged — nothing to write.`);
    // The overlay (routable set) may still have changed via ranking auto-add —
    // that is notable even when the frontier/mundane tiers held steady.
    if (rankingLine && !dryRun) {
      await notifyOwner(
        `MODEL TIER REFRESH: routable models updated (tiers unchanged)`,
        `The weekly refresh kept the frontier/mundane tiers but updated the routable model set from the live ranking.\n${rankingLine}`,
      );
    }
    process.exit(0);
  }

  if (dryRun) {
    log(`DRY RUN — would update ${file} but not writing.`);
    process.exit(0);
  }

  atomicWriteJson(file, result.next);
  log(`wrote ${file}`);

  await notifyOwner(
    `MODEL TIER REFRESH: frontier updated`,
    `The weekly model-tier refresh changed the active tiers.\n\n` +
      `Frontier (jury + complex work): ${result.next.frontier.join(", ")}\n` +
      (result.promotedToFrontier.length ? `  promoted IN: ${result.promotedToFrontier.join(", ")}\n` : "") +
      (result.demotedFromFrontier.length ? `  dropped OUT: ${result.demotedFromFrontier.join(", ")}\n` : "") +
      `\nMundane (busy-work): ${result.next.mundane.join(", ")}\n` +
      (Object.keys(result.next.probation).length
        ? `\nOn probation (newly promoted, being watched): ${Object.keys(result.next.probation).join(", ")}\n`
        : "") +
      (result.notes.length ? `\nNotes:\n${result.notes.map((n) => `- ${n}`).join("\n")}\n` : "") +
      rankingLine,
  );
  process.exit(0);
}

main().catch(async (e) => {
  const msg = String((e as Error)?.stack || e);
  await notifyOwner(`MODEL TIER REFRESH FAILED`, `The weekly model-tier refresh crashed:\n\n${msg}`).catch(() => {});
  die(3, `fatal: ${msg}`);
});
