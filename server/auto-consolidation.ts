import { db, isOffHours } from "./db";
import { sql } from "drizzle-orm";
import { runDreamConsolidation, type DreamConsolidationResult } from "./dream-consolidation";
import { getClientForModel } from "./providers";

import { logSilentCatch } from "./lib/silent-catch";
export interface ConsolidationState {
  lastConsolidatedAt: Date | null;
  sessionsSinceLastRun: number;
  isRunning: boolean;
  lastResult: DreamConsolidationResult | null;
  nextEligibleAt: Date | null;
  totalRuns: number;
  remRunsCompleted: number;
  lastRemAt: Date | null;
  lastRemError: string | null;
}

interface TenantConsolidationTracker {
  lastConsolidatedAt: Date | null;
  sessionCount: number;
  seenConversations: Set<number>;
  isRunning: boolean;
  lastResult: DreamConsolidationResult | null;
  totalRuns: number;
  lastActivityAt: Date;
  remRunsCompleted: number;
  lastRemAt: Date | null;
  lastRemError: string | null;
}

const tenantTrackers = new Map<number, TenantConsolidationTracker>();

const MIN_HOURS_BETWEEN_RUNS = 6;
const MIN_SESSIONS_BEFORE_RUN = 5;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_TRACKER_AGE_HOURS = 72;
// Round 18: 3-phase Dreaming (Light/Deep/REM)
// REM cadence is DB-backed (queries MAX(created_at) of dream_diary entries) rather than
// in-memory counter, so it survives restarts and stays consistent across replicas.
const REM_MIN_MEMORIES = 8;
const REM_DIARY_MAX_KEEP = 20;
const REM_MIN_HOURS_SINCE_LAST = MIN_HOURS_BETWEEN_RUNS * 3; // ~18h ≈ every 3rd deep pass in steady state

function getTracker(tenantId: number): TenantConsolidationTracker {
  let tracker = tenantTrackers.get(tenantId);
  if (!tracker) {
    tracker = {
      lastConsolidatedAt: null,
      sessionCount: 0,
      seenConversations: new Set(),
      isRunning: false,
      lastResult: null,
      totalRuns: 0,
      lastActivityAt: new Date(),
      remRunsCompleted: 0,
      lastRemAt: null,
      lastRemError: null,
    };
    tenantTrackers.set(tenantId, tracker);
  }
  return tracker;
}

export function trackConversationActivity(tenantId: number, conversationId: number): void {
  const tracker = getTracker(tenantId);
  tracker.lastActivityAt = new Date();
  if (!tracker.seenConversations.has(conversationId)) {
    tracker.seenConversations.add(conversationId);
    tracker.sessionCount++;
  }
}

function evictStaleTenants(): void {
  const now = Date.now();
  for (const [tenantId, tracker] of tenantTrackers) {
    if (tracker.isRunning) continue;
    const ageHours = (now - tracker.lastActivityAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > MAX_TRACKER_AGE_HOURS) {
      tenantTrackers.delete(tenantId);
    }
  }
}

function hoursElapsed(since: Date | null): number {
  if (!since) return Infinity;
  return (Date.now() - since.getTime()) / (1000 * 60 * 60);
}

async function shouldConsolidate(tenantId: number): Promise<boolean> {
  const tracker = getTracker(tenantId);

  if (tracker.isRunning) return false;

  if (hoursElapsed(tracker.lastConsolidatedAt) < MIN_HOURS_BETWEEN_RUNS) return false;

  if (tracker.sessionCount < MIN_SESSIONS_BEFORE_RUN) return false;

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM memory_entries 
      WHERE tenant_id = ${tenantId} AND status = 'active'
    `);
    const rows = result as any;
    const count = Number(rows?.rows?.[0]?.cnt || rows?.[0]?.cnt || 0);
    if (count < 5) return false;
  } catch {
    return false;
  }

  return true;
}

// ─── PHASE 3 — REM (rare, narrative): theme synthesis + dream diary entry ────
// Pulls recently-active non-diary memories, asks an LLM to synthesize a short
// narrative summary capturing dominant themes, and writes it back as a
// memory_entry with category='dream_diary'. This is the OpenClaw "DREAMS.md"
// equivalent — narrative reinforcement that the agent can recall during chat.
async function runREMPhase(tenantId: number, deepResult: DreamConsolidationResult): Promise<{ wrote: boolean; diary?: string; error?: string }> {
  try {
    const memResult = await db.execute(sql`
      SELECT fact, category FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
        AND category != 'dream_diary'
      ORDER BY last_accessed DESC NULLS LAST
      LIMIT 30
    `);
    const rows = (((memResult as any)?.rows) || []) as { fact: string; category: string }[];
    if (rows.length < REM_MIN_MEMORIES) {
      console.log(`[dreaming:REM] Skipped tenant ${tenantId}: only ${rows.length} memories (need ${REM_MIN_MEMORIES})`);
      return { wrote: false };
    }

    const memText = rows.map(r => `- [${r.category}] ${r.fact}`).join("\n");
    const consolidationStat = `(deep pass: reviewed ${deepResult.reviewed}, merged ${deepResult.merged}, promoted ${deepResult.promoted}, archived ${deepResult.archived})`;

    // Use the RETURNED actualModelId: the $0 policy may swap the client to the free
    // modelfarm lane, and sending the original id to that endpoint 400s.
    const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId, {});
    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        {
          role: "system",
          content: `You are the REM-phase memory synthesizer for an autonomous AI corporation's Dream Diary. Read the agent's recent active memories and write a SHORT (2-4 sentence) narrative diary entry that captures dominant themes, recurring patterns, or emerging priorities. Write in second person to the agent ("You have been..."). Be specific and concrete — name actual subjects, tasks, or people from the memories. No fluff, no preamble, no meta-commentary about the synthesis itself.`,
        },
        {
          role: "user",
          content: `Recent active memories (${rows.length}) ${consolidationStat}:\n\n${memText}\n\nWrite the diary entry:`,
        },
      ],
      max_completion_tokens: 250,
      temperature: 0.7,
    });

    const diary = resp.choices?.[0]?.message?.content?.trim();
    if (!diary || diary.length < 20) {
      console.log(`[dreaming:REM] Empty or too-short diary for tenant ${tenantId}, skipping write`);
      return { wrote: false };
    }

    await db.execute(sql`
      INSERT INTO memory_entries (tenant_id, fact, category, source, status)
      VALUES (${tenantId}, ${diary}, 'dream_diary', 'rem-consolidation', 'active')
    `);

    // Soft retention: archive oldest diary entries beyond REM_DIARY_MAX_KEEP
    try {
      await db.execute(sql`
        UPDATE memory_entries
        SET status = 'archived'
        WHERE id IN (
          SELECT id FROM memory_entries
          WHERE tenant_id = ${tenantId}
            AND category = 'dream_diary'
            AND status = 'active'
          ORDER BY created_at DESC
          OFFSET ${REM_DIARY_MAX_KEEP}
        )
      `);
    } catch (_silentErr) { logSilentCatch("server/auto-consolidation.ts", _silentErr); }

    // Round 19.2: do NOT log diary content (it's synthesized from tenant memories
    // and may contain sensitive personal/business info). Length-only is enough
    // for ops visibility.
    console.log(`[dreaming:REM] Tenant ${tenantId} diary entry written (${diary.length} chars)`);
    return { wrote: true, diary };
  } catch (err) {
    const errMsg = (err as Error).message?.slice(0, 200) || "unknown";
    console.warn(`[dreaming:REM] Tenant ${tenantId} failed: ${errMsg}`);
    return { wrote: false, error: errMsg };
  }
}

// Round 19.2: stable namespace key for dreaming advisory locks. Keeps us out
// of the way of any other code that might use Postgres advisory locks on the
// same connection pool. 0x44524d31 = "DRM1" (DReaMing v1).
const DREAMING_LOCK_NAMESPACE = 0x44524d31;

// 3-PHASE DREAMING: Light (cheap signals) → Deep (existing consolidation) → REM (narrative synthesis)
async function runForTenant(tenantId: number): Promise<DreamConsolidationResult | null> {
  const tracker = getTracker(tenantId);

  // Round 19.2: cross-process / cross-replica mutual exclusion. The in-process
  // `tenantTrackers` map alone can't prevent two app instances from running
  // Deep+REM concurrently for the same tenant — that would create duplicate
  // dream_diary entries and race on archive pruning. pg_try_advisory_lock is
  // session-scoped (auto-released on disconnect) and non-blocking.
  let gotLock = false;
  try {
    const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(${DREAMING_LOCK_NAMESPACE}::int, ${tenantId}::int) AS got`);
    gotLock = !!((lockRes as any)?.rows?.[0]?.got);
  } catch (lockErr) {
    console.warn(`[dreaming] Tenant ${tenantId}: advisory lock acquisition failed, skipping run:`, (lockErr as Error).message?.slice(0, 120));
    return null;
  }
  if (!gotLock) {
    console.log(`[dreaming] Tenant ${tenantId}: another replica/process holds the lock, skipping`);
    return null;
  }

  tracker.isRunning = true;

  // PHASE 1 — LIGHT (always, cheap): logging + readiness signal
  console.log(`[dreaming:Light] Tenant ${tenantId}: ${tracker.sessionCount} sessions since last run, totalRuns=${tracker.totalRuns}`);

  try {
    // PHASE 2 — DEEP (always, expensive): dedupe + LLM-scored merge/promote/archive
    console.log(`[dreaming:Deep] Tenant ${tenantId}: starting consolidation...`);
    const result = await runDreamConsolidation(tenantId, 10);
    tracker.lastConsolidatedAt = new Date();
    tracker.sessionCount = 0;
    tracker.seenConversations.clear();
    tracker.lastResult = result;
    tracker.totalRuns++;

    console.log(`[dreaming:Deep] Tenant ${tenantId} completed: ${result.summary}`);

    try {
      await db.execute(sql`
        INSERT INTO consolidation_log (tenant_id, reviewed, merged, archived, promoted, created, errors, summary, duration_ms, created_at)
        VALUES (${tenantId}, ${result.reviewed}, ${result.merged}, ${result.archived}, ${result.promoted}, ${result.created}, ${result.errors}, ${result.summary}, ${result.durationMs}, NOW())
      `);
    } catch (logErr) {
      console.log("[dreaming:Deep] Log table not available:", (logErr as Error).message?.slice(0, 80));
    }

    // R75 — GraphRAG Five hooks. Run AFTER Deep so freshly merged/promoted
    // memories are reflected in graph_memory before we score them.
    // (a) PageRank importance — cheap, every cycle.
    try {
      const { scoreImportanceForTenant } = await import("./graph-importance");
      const imp = await scoreImportanceForTenant(tenantId);
      console.log(`[graphrag:importance] tenant=${tenantId} nodes=${imp.nodes} edges=${imp.edges} updated=${imp.updated}`);
    } catch (impErr) {
      console.warn(`[graphrag:importance] tenant=${tenantId} failed: ${(impErr as Error).message?.slice(0, 200)}`);
    }
    // (b) Community detection — gated internally by ≥6 nodes & ≥6h since last refresh.
    try {
      const { buildCommunitiesForTenant } = await import("./graph-communities");
      const com = await buildCommunitiesForTenant(tenantId);
      if (com.skippedReason) {
        console.log(`[graphrag:communities] tenant=${tenantId} skipped (${com.skippedReason})`);
      } else {
        console.log(`[graphrag:communities] tenant=${tenantId} nodes=${com.nodes} edges=${com.edges} written=${com.written}/${com.communities}`);
      }
    } catch (comErr) {
      console.warn(`[graphrag:communities] tenant=${tenantId} failed: ${(comErr as Error).message?.slice(0, 200)}`);
    }

    // PHASE 3 — REM (rare, narrative): triggered by DB query — survives restarts and replicas.
    // Runs only if the most recent dream_diary entry is older than REM_MIN_HOURS_SINCE_LAST,
    // OR if no diary entry exists at all for this tenant.
    try {
      const lastDiaryRes = await db.execute(sql`
        SELECT MAX(created_at) as last_at FROM memory_entries
        WHERE tenant_id = ${tenantId} AND category = 'dream_diary' AND status = 'active'
      `);
      const lastDiaryAt = ((lastDiaryRes as any)?.rows?.[0]?.last_at) ?? null;
      const hoursSince = lastDiaryAt ? hoursElapsed(new Date(lastDiaryAt)) : Infinity;
      if (hoursSince >= REM_MIN_HOURS_SINCE_LAST) {
        console.log(`[dreaming:REM] Tenant ${tenantId} eligible (${hoursSince === Infinity ? "no prior diary" : `${hoursSince.toFixed(1)}h since last`} ≥ ${REM_MIN_HOURS_SINCE_LAST}h threshold)`);
        const rem = await runREMPhase(tenantId, result);
        if (rem.wrote) {
          tracker.remRunsCompleted++;
          tracker.lastRemAt = new Date();
          tracker.lastRemError = null;
        } else if (rem.error) {
          tracker.lastRemError = rem.error;
        }
        // R75 — causal chain extraction is REM-only (rare, narrative, LLM-bound).
        try {
          const { extractCausalChainsForTenant } = await import("./causal-extractor");
          const cc = await extractCausalChainsForTenant(tenantId, { limit: 12, sinceHours: 72 });
          if (cc.skippedReason) {
            console.log(`[graphrag:causal] tenant=${tenantId} skipped (${cc.skippedReason})`);
          } else {
            console.log(`[graphrag:causal] tenant=${tenantId} scanned=${cc.scanned} chains=${cc.chains} inserted=${cc.inserted}`);
          }
        } catch (ccErr) {
          console.warn(`[graphrag:causal] tenant=${tenantId} failed: ${(ccErr as Error).message?.slice(0, 200)}`);
        }
      } else {
        console.log(`[dreaming:REM] Tenant ${tenantId} skipped (only ${hoursSince.toFixed(1)}h since last diary, < ${REM_MIN_HOURS_SINCE_LAST}h threshold)`);
      }
    } catch (remErr) {
      tracker.lastRemError = (remErr as Error).message?.slice(0, 200) || "unknown";
      console.warn(`[dreaming:REM] Eligibility check failed for tenant ${tenantId}: ${tracker.lastRemError}`);
    }

    return result;
  } catch (err) {
    console.error(`[dreaming] Tenant ${tenantId} failed:`, (err as Error).message);
    return null;
  } finally {
    // Round 19.2: advisory locks are session-scoped on pooled connections —
    // without an explicit unlock the lock can outlive this run and starve
    // future consolidation for the tenant until the pg session recycles.
    if (gotLock) {
      try {
        await db.execute(sql`SELECT pg_advisory_unlock(${DREAMING_LOCK_NAMESPACE}::int, ${tenantId}::int)`);
      } catch (unlockErr) {
        console.warn(`[dreaming] Tenant ${tenantId}: advisory unlock failed:`, (unlockErr as Error).message?.slice(0, 120));
      }
    }
    tracker.isRunning = false;
  }
}

async function checkAllTenants(): Promise<void> {
  evictStaleTenants();

  try {
    const result = await db.execute(sql`
      SELECT DISTINCT tenant_id FROM memory_entries WHERE status = 'active' AND tenant_id IS NOT NULL
    `);
    const rows = (result as any)?.rows || result;
    if (!Array.isArray(rows)) return;

    for (const row of rows) {
      const tenantId = Number((row as any).tenant_id);
      if (!tenantId || isNaN(tenantId)) continue;

      const eligible = await shouldConsolidate(tenantId);
      if (eligible) {
        await runForTenant(tenantId);
      }
    }
  } catch (err) {
    console.error("[dreaming] Tenant scan failed:", (err as Error).message);
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

export function startAutoConsolidation(): void {
  if (schedulerInterval) return;

  console.log(`[dreaming] 3-phase scheduler started (Light + Deep every cycle; REM when ≥${REM_MIN_HOURS_SINCE_LAST}h since last diary; check ${CHECK_INTERVAL_MS / 60000}min, min ${MIN_HOURS_BETWEEN_RUNS}h between deep runs, min ${MIN_SESSIONS_BEFORE_RUN} sessions)`);

  initialTimeout = setTimeout(() => {
    initialTimeout = null;
    checkAllTenants().catch(err => {
      console.error("[dreaming] Initial check failed:", (err as Error).message);
    });
  }, 60_000);

  schedulerInterval = setInterval(() => {
    if (isOffHours()) return;
    checkAllTenants().catch(err => {
      console.error("[dreaming] Scheduled check failed:", (err as Error).message);
    });
  }, CHECK_INTERVAL_MS);
}

export function stopAutoConsolidation(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[dreaming] Scheduler stopped");
  }
}

export function getConsolidationState(tenantId: number): ConsolidationState {
  const tracker = getTracker(tenantId);
  let nextEligibleAt: Date | null = null;

  if (tracker.lastConsolidatedAt) {
    const nextTime = new Date(tracker.lastConsolidatedAt.getTime() + MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000);
    if (nextTime > new Date()) {
      nextEligibleAt = nextTime;
    }
  }

  return {
    lastConsolidatedAt: tracker.lastConsolidatedAt,
    sessionsSinceLastRun: tracker.sessionCount,
    isRunning: tracker.isRunning,
    lastResult: tracker.lastResult,
    nextEligibleAt,
    totalRuns: tracker.totalRuns,
    remRunsCompleted: tracker.remRunsCompleted,
    lastRemAt: tracker.lastRemAt,
    lastRemError: tracker.lastRemError,
  };
}

export async function triggerManualConsolidation(tenantId: number): Promise<DreamConsolidationResult | null> {
  const tracker = getTracker(tenantId);
  if (tracker.isRunning) {
    return null;
  }
  return runForTenant(tenantId);
}
