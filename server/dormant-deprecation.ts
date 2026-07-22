/**
 * R65 Dormant-Tool Auto-Deprecation
 *
 * Closes the gap between the dormant-tools wiring invariant (which detects but
 * does not act) and the curator's SOFT_DEPRECATED_TOOLS set (which acts but
 * was hand-curated and stayed empty).
 *
 * SAFETY MODEL — three independent locks before any tool can be auto-deprecated:
 *
 *   1. Traffic gate: requires meaningful chat + tool-invocation volume in the
 *      window. With low traffic, ALL tools look dormant — that's a signal
 *      problem, not a tool problem. Refuses to act until signal exists.
 *
 *   2. Protected list: voice-safe Glasses Gateway tools, all hint-curated
 *      tools (the ~60 we deemed important enough to write hints for), all
 *      check_, admin_, system_, health_, emergency_ name patterns, plus
 *      an explicit hardcoded ALWAYS_KEEP set. These are NEVER auto-deprecated.
 *
 *   3. Per-cycle cap: max 50 auto-deprecations per refresh cycle. Limits
 *      blast radius of any future signal misread.
 *
 * Soft-deprecated tools are HIDDEN from the LLM's tool menu by default but
 * remain fully callable when explicitly named via forceCategories or
 * toolFilter (preserves the manual-override path).
 *
 * Rollback: clear via the admin endpoint, restart the server, or just delete
 * the row from .cache/dormant-deprecations.json. No DB writes, no schema
 * changes, no destructive operations.
 */

import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import {
  SOFT_DEPRECATED_TOOLS,
  setSoftDeprecated,
  clearAutoDeprecations,
} from "./tool-curator";
import { TOOL_USAGE_HINTS } from "./tool-usage-hints";

const CACHE_DIR = ".cache";
const STATE_FILE = path.join(CACHE_DIR, "dormant-deprecations.json");

// ─── Safety thresholds ─────────────────────────────────────────────────
// R65 architect-feedback fix: gate on USER messages (not all messages — assistant
// + tool rows would inflate the count) and on DISTINCT TOOLS exercised in the
// 14d window (not SUM(success_count), which is lifetime-cumulative and would
// open the gate on a single recent invocation of a historically hot tool).
const TRAFFIC_GATE_MIN_USER_MESSAGES_14D = 200;
const TRAFFIC_GATE_MIN_DISTINCT_TOOLS_14D = 15;
const MAX_AUTO_DEPRECATIONS_PER_CYCLE = 50;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// ─── Protected (never auto-deprecated) ─────────────────────────────────
// Voice-safe Glasses Gateway allowlist — kept in sync with glasses-gateway.ts.
// Duplicating rather than importing avoids a circular boot dependency.
const VOICE_SAFE_TOOLS = new Set<string>([
  "search_memory", "create_memory", "recall_context", "query_triples", "store_triple",
  "web_search", "web_fetch", "deep_research", "research_digest",
  "send_email", "check_inbox", "whatsapp",
  "calendar_sync", "google_drive", "google_workspace",
  "create_pdf", "create_document",
  "check_system_status",
  "forecast_ticker",
  "scan_file",
]);

// Hardcoded keep-list: tools that may not register any chat invocations because
// they're called by background jobs, schedules, or system flows but are
// nonetheless load-bearing. Add to this list whenever you ship a tool whose
// primary call site is non-chat.
const ALWAYS_KEEP = new Set<string>([
  // System / health probes
  "check_system_status", "ping_system", "system_health",
  // Background research / autonomous flows
  "ensemble_query", "orchestrate", "lobster",
  // Stripe + delivery rails (called from non-chat routes)
  "create_checkout_session", "verify_stripe_payment", "deliver_to_customer",
  // Memory + knowledge writes (often invoked by scheduled jobs)
  "create_memory", "search_memory", "store_triple", "query_triples",
  // Self-healing / governance
  "propose_code_change", "self_critique", "skill_evolution",
  // Comprehensive features pipeline
  "generate_features_pdf", "comprehensive_features_pipeline",
]);

// Name patterns: any tool whose name matches these is auto-protected.
const PROTECTED_PREFIXES = ["check_", "admin_", "system_", "health_", "emergency_"];
const PROTECTED_SUFFIXES = ["_status", "_health", "_check"];

function isNamePatternProtected(name: string): boolean {
  for (const p of PROTECTED_PREFIXES) if (name.startsWith(p)) return true;
  for (const s of PROTECTED_SUFFIXES) if (name.endsWith(s)) return true;
  return false;
}

export function isToolProtected(toolName: string): boolean {
  if (VOICE_SAFE_TOOLS.has(toolName)) return true;
  if (ALWAYS_KEEP.has(toolName)) return true;
  if (isNamePatternProtected(toolName)) return true;
  if (TOOL_USAGE_HINTS[toolName]) return true; // hand-curated as important
  return false;
}

// ─── State persistence ────────────────────────────────────────────────
interface DeprecationStateFile {
  version: number;
  lastRunAt: string;
  lastRunOutcome: "applied" | "skipped_traffic_gate" | "no_candidates" | "error";
  trafficSnapshot: TrafficSnapshot;
  autoDeprecated: string[];      // currently active auto-deprecations
  lastRefusalReason?: string;
}

function loadState(): DeprecationStateFile | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

// Atomic write: tmp file + rename. Prevents half-written JSON if process dies
// mid-write or two writers race. (R65 architect-feedback fix #3.)
function saveState(state: DeprecationStateFile): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    // R98.16 #6 — fsync before rename for true durability.
    try {
      const fd = fs.openSync(tmp, "r+");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch (_silentErr) { logSilentCatch("server/dormant-deprecation.ts", _silentErr); }
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.warn("[dormant-deprecation] Failed to persist state:", (err as Error).message);
  }
}

// ─── In-flight mutex ──────────────────────────────────────────────────
// Serialize apply/clear/scheduler refreshes so an admin "clear" can never
// race with a periodic apply (last-writer-wins would silently undo operator
// intent). (R65 architect-feedback fix #3.)
let _mutationLock: Promise<unknown> = Promise.resolve();
function withMutationLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = _mutationLock.then(fn, fn).catch(err => {
    console.warn(`[dormant-deprecation] ${label} threw under lock:`, (err as Error).message);
    throw err;
  });
  // Swallow the result on the chain so a single failure doesn't poison the lock
  _mutationLock = next.then(() => undefined, () => undefined);
  return next;
}

// ─── Traffic gate ─────────────────────────────────────────────────────
interface TrafficSnapshot {
  userMessages14d: number;
  distinctToolsActive14d: number;
}

async function getTrafficSnapshot(): Promise<TrafficSnapshot> {
  let userMessages14d = 0;
  let distinctToolsActive14d = 0;
  try {
    const r1: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM messages
      WHERE created_at > NOW() - INTERVAL '14 days'
        AND role = 'user'
    `);
    userMessages14d = (r1.rows || r1)[0]?.n ?? 0;
  } catch (err) {
    console.warn("[dormant-deprecation] user messages count failed:", (err as Error).message);
  }
  try {
    const r2: any = await db.execute(sql`
      SELECT COUNT(DISTINCT tool_name)::int AS n
      FROM tool_performance
      WHERE last_success_at > NOW() - INTERVAL '14 days'
    `);
    distinctToolsActive14d = (r2.rows || r2)[0]?.n ?? 0;
  } catch (err) {
    console.warn("[dormant-deprecation] distinct tools count failed:", (err as Error).message);
  }
  return { userMessages14d, distinctToolsActive14d };
}

function trafficSufficient(snap: TrafficSnapshot): boolean {
  return snap.userMessages14d >= TRAFFIC_GATE_MIN_USER_MESSAGES_14D
    && snap.distinctToolsActive14d >= TRAFFIC_GATE_MIN_DISTINCT_TOOLS_14D;
}

// ─── Candidate computation ────────────────────────────────────────────
// Only tools that have actually been exercised at some point are eligible
// for auto-deprecation. Scaffolded-but-never-called tools (R44 mode) are a
// different problem class — they may be brand-new and just haven't had an
// opportunity to fire. Auto-hiding them would be wrong. (R65 architect-
// feedback fix #2.)
async function getEverInvokedTools(): Promise<Set<string>> {
  try {
    const r: any = await db.execute(sql`SELECT DISTINCT tool_name FROM tool_performance`);
    const rows = (r.rows || r) as { tool_name: string }[];
    return new Set(rows.map(x => x.tool_name));
  } catch (err) {
    console.warn("[dormant-deprecation] ever-invoked query failed:", (err as Error).message);
    return new Set();
  }
}

async function getActiveTools14d(): Promise<Set<string>> {
  const r: any = await db.execute(sql`
    SELECT DISTINCT tool_name FROM tool_performance
    WHERE last_success_at > NOW() - INTERVAL '14 days'
  `);
  const rows = (r.rows || r) as { tool_name: string }[];
  return new Set(rows.map(x => x.tool_name));
}

interface PreviewResult {
  totalRegistered: number;
  protectedCount: number;
  active14d: number;
  neverInvokedSkipped: number;    // dormant + non-protected but never called → not candidates
  candidates: string[];           // would be auto-deprecated
  protectedDormant: string[];     // dormant but protected (sample)
  trafficSnapshot: TrafficSnapshot;
  trafficGateOpen: boolean;
  trafficGateThreshold: { userMessages: number; distinctTools: number };
  capApplied: boolean;
  currentAutoDeprecations: string[];
  handCuratedCount: number;
  lastRunAt: string | null;
  lastRunOutcome: string | null;
}

export async function previewDormantDeprecations(): Promise<PreviewResult> {
  const { getAllToolDefinitions } = await import("./tools");
  const { getHandCuratedDeprecations } = await import("./tool-curator");
  const defs = await getAllToolDefinitions();
  const allNames = defs.map(d => d.function.name);
  const active = await getActiveTools14d();
  const everInvoked = await getEverInvokedTools();
  const trafficSnapshot = await getTrafficSnapshot();
  const state = loadState();

  const dormant = allNames.filter(n => !active.has(n));
  const candidatesUnfiltered: string[] = [];
  const protectedDormant: string[] = [];
  let protectedCount = 0;
  let neverInvokedSkipped = 0;

  for (const name of dormant) {
    if (isToolProtected(name)) {
      protectedCount++;
      protectedDormant.push(name);
      continue;
    }
    // Skip never-invoked tools — they're scaffolded-but-untested, not dead.
    if (!everInvoked.has(name)) {
      neverInvokedSkipped++;
      continue;
    }
    candidatesUnfiltered.push(name);
  }

  const capApplied = candidatesUnfiltered.length > MAX_AUTO_DEPRECATIONS_PER_CYCLE;
  const candidates = candidatesUnfiltered.sort().slice(0, MAX_AUTO_DEPRECATIONS_PER_CYCLE);

  return {
    totalRegistered: allNames.length,
    protectedCount,
    active14d: active.size,
    neverInvokedSkipped,
    candidates,
    protectedDormant: protectedDormant.sort().slice(0, 20),
    trafficSnapshot,
    trafficGateOpen: trafficSufficient(trafficSnapshot),
    trafficGateThreshold: {
      userMessages: TRAFFIC_GATE_MIN_USER_MESSAGES_14D,
      distinctTools: TRAFFIC_GATE_MIN_DISTINCT_TOOLS_14D,
    },
    capApplied,
    currentAutoDeprecations: state?.autoDeprecated ?? [],
    handCuratedCount: getHandCuratedDeprecations().length,
    lastRunAt: state?.lastRunAt ?? null,
    lastRunOutcome: state?.lastRunOutcome ?? null,
  };
}

interface ApplyResult {
  applied: boolean;
  reason: string;
  added: string[];
  removed: string[];
  totalActive: number;
  trafficSnapshot: TrafficSnapshot;
}

/**
 * Mutates SOFT_DEPRECATED_TOOLS in-process. Pass `force: true` to bypass
 * the traffic gate (ONLY for the manual admin "apply" endpoint after a
 * human reviews the preview). Periodic auto-refresh always passes
 * force: false — it MUST refuse when signal is insufficient.
 */
export function applyDormantDeprecations(
  opts: { force?: boolean } = {}
): Promise<ApplyResult> {
  return withMutationLock("applyDormantDeprecations", () => _applyImpl(opts));
}

async function _applyImpl(opts: { force?: boolean }): Promise<ApplyResult> {
  const preview = await previewDormantDeprecations();

  if (!opts.force && !preview.trafficGateOpen) {
    const reason = `Traffic gate closed: ${preview.trafficSnapshot.userMessages14d}/${TRAFFIC_GATE_MIN_USER_MESSAGES_14D} user-messages, ${preview.trafficSnapshot.distinctToolsActive14d}/${TRAFFIC_GATE_MIN_DISTINCT_TOOLS_14D} distinct tools active in 14d. Refusing to act on insufficient signal.`;
    saveState({
      version: 1,
      lastRunAt: new Date().toISOString(),
      lastRunOutcome: "skipped_traffic_gate",
      trafficSnapshot: preview.trafficSnapshot,
      autoDeprecated: preview.currentAutoDeprecations,
      lastRefusalReason: reason,
    });
    return {
      applied: false,
      reason,
      added: [],
      removed: [],
      totalActive: preview.currentAutoDeprecations.length,
      trafficSnapshot: preview.trafficSnapshot,
    };
  }

  if (preview.candidates.length === 0) {
    saveState({
      version: 1,
      lastRunAt: new Date().toISOString(),
      lastRunOutcome: "no_candidates",
      trafficSnapshot: preview.trafficSnapshot,
      autoDeprecated: preview.currentAutoDeprecations,
    });
    return {
      applied: false,
      reason: "No candidates after applying protected list. System is healthy.",
      added: [],
      removed: [],
      totalActive: preview.currentAutoDeprecations.length,
      trafficSnapshot: preview.trafficSnapshot,
    };
  }

  // Compute diff against currently-active auto-deprecations
  const currentAuto = new Set(preview.currentAutoDeprecations);
  const newAuto = new Set(preview.candidates);
  const added: string[] = [...newAuto].filter(n => !currentAuto.has(n));
  const removed: string[] = [...currentAuto].filter(n => !newAuto.has(n));

  // Apply: clear prior auto-deprecations from the curator set, then add new
  clearAutoDeprecations();
  for (const name of newAuto) setSoftDeprecated(name, true);

  saveState({
    version: 1,
    lastRunAt: new Date().toISOString(),
    lastRunOutcome: "applied",
    trafficSnapshot: preview.trafficSnapshot,
    autoDeprecated: [...newAuto].sort(),
  });

  console.log(`[dormant-deprecation] Applied: ${added.length} added, ${removed.length} removed, ${newAuto.size} total active. Curator now hides ${SOFT_DEPRECATED_TOOLS.size} tool(s) from default routing.`);

  return {
    applied: true,
    reason: `Force-applied: ${preview.trafficGateOpen ? "traffic gate open" : "manual override"}. ${preview.capApplied ? `Capped at ${MAX_AUTO_DEPRECATIONS_PER_CYCLE} (more candidates exist).` : "All candidates included."}`,
    added,
    removed,
    totalActive: newAuto.size,
    trafficSnapshot: preview.trafficSnapshot,
  };
}

export function clearAllAutoDeprecations(): Promise<{ cleared: number }> {
  return withMutationLock("clearAllAutoDeprecations", async () => {
    const { getAutoDeprecatedNames } = await import("./tool-curator");
    const previousSize = getAutoDeprecatedNames().length;
    clearAutoDeprecations();
    saveState({
      version: 1,
      lastRunAt: new Date().toISOString(),
      lastRunOutcome: "applied",
      trafficSnapshot: await getTrafficSnapshot(),
      autoDeprecated: [],
    });
    console.log(`[dormant-deprecation] Cleared ${previousSize} auto-deprecation(s) by admin request. Hand-curated entries preserved.`);
    return { cleared: previousSize };
  });
}

// ─── Boot rehydration + scheduling ────────────────────────────────────
/**
 * On boot: rehydrate prior auto-deprecations from disk so the soft-deprecated
 * set survives restarts without requiring another traffic-gated refresh.
 */
export function rehydrateAutoDeprecationsFromDisk(): { restored: number } {
  const state = loadState();
  if (!state || !state.autoDeprecated || state.autoDeprecated.length === 0) {
    return { restored: 0 };
  }
  for (const name of state.autoDeprecated) {
    setSoftDeprecated(name, true);
  }
  console.log(`[dormant-deprecation] Restored ${state.autoDeprecated.length} prior auto-deprecation(s) from disk (last applied ${state.lastRunAt}).`);
  return { restored: state.autoDeprecated.length };
}

let _refreshTimer: NodeJS.Timeout | null = null;

export function startAutoDeprecationScheduler(): void {
  if (_refreshTimer) return;
  // First run after 60s to let the boot settle, then every 6h.
  setTimeout(() => {
    applyDormantDeprecations({ force: false }).catch(err => {
      console.warn("[dormant-deprecation] First refresh failed:", (err as Error).message);
    });
    _refreshTimer = setInterval(() => {
      applyDormantDeprecations({ force: false }).catch(err => {
        console.warn("[dormant-deprecation] Periodic refresh failed:", (err as Error).message);
      });
    }, REFRESH_INTERVAL_MS);
  }, 60_000);
  console.log(`[dormant-deprecation] Scheduler armed. First check in 60s, then every ${REFRESH_INTERVAL_MS / 3600000}h. Traffic gate: ${TRAFFIC_GATE_MIN_USER_MESSAGES_14D} user-msgs + ${TRAFFIC_GATE_MIN_DISTINCT_TOOLS_14D} distinct active tools / 14d.`);
}

export function stopAutoDeprecationScheduler(): void {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}
