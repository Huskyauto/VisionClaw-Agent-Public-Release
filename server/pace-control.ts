import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * PaceController — rolling-window task cap (inspired by OpenSwarm).
 *
 * The existing `MAX_TASKS_PER_PERSONA_PER_HOUR` cap in heartbeat.ts is a
 * fixed-window counter (resets on the hour boundary). That lets a persona
 * burst 10 tasks at 12:59 and another 10 at 13:00 — 20 in two minutes.
 *
 * This module enforces a true sliding window backed by `heartbeat_logs`
 * timestamps. Cheap query (covered by created_at index) and accurate.
 */

export interface PaceCheckResult {
  allowed: boolean;
  used: number;
  cap: number;
  windowHours: number;
  reason?: string;
}

/** Pace lane. Interactive (user/chat-driven) delegations get their own protected
 * budget so a saturated autonomous background window can never lock them out. */
export type PaceLane = "interactive" | "autonomous";

export interface PaceConfig {
  windowHours: number;
  /** Cap for the AUTONOMOUS lane (background scheduled-task completions + CEO /
   * heartbeat delegations). This is what the original single global cap was. */
  maxRunsPerWindow: number;
  perPersonaCap?: number;
  /** Cap for the INTERACTIVE lane (user/chat-driven delegate_task). Independent
   * of the autonomous lane — background activity cannot consume it. */
  interactiveCap: number;
  interactivePerPersonaCap?: number;
}

const DEFAULT_CONFIG: PaceConfig = {
  windowHours: 5,
  // Bumped 60 → 100 for monetization throughput: a 16-persona autonomous corp
  // doing real work needs more headroom than 12 runs/hr. The interactive lane
  // below is what actually protects user-initiated work; this cap only bounds
  // background runaway. Override via configurePace / env if spend is a concern.
  maxRunsPerWindow: 100,
  perPersonaCap: 25,
  // Protected budget for user/chat-driven delegations. Generous on purpose —
  // a person actively delegating in chat should effectively never hit this.
  interactiveCap: 40,
  interactivePerPersonaCap: 20,
};

let _config: PaceConfig = { ...DEFAULT_CONFIG };

export function configurePace(cfg: Partial<PaceConfig>) {
  _config = { ..._config, ...cfg };
}

export function getPaceConfig(): PaceConfig {
  return { ..._config };
}

/**
 * Check whether a new run for `personaName` would exceed pace caps.
 * Returns `{ allowed: false }` if either the global window or per-persona
 * cap is hit.
 */
export async function checkPace(
  personaName?: string,
  opts?: { lane?: PaceLane },
): Promise<PaceCheckResult> {
  const { windowHours, maxRunsPerWindow, perPersonaCap, interactiveCap, interactivePerPersonaCap } = _config;
  const lane: PaceLane = opts?.lane ?? "autonomous";
  const globalCap = lane === "interactive" ? interactiveCap : maxRunsPerWindow;
  const personaCap = lane === "interactive" ? interactivePerPersonaCap : perPersonaCap;
  try {
    // Lane partitioning: the interactive lane counts ONLY rows tagged
    // source='interactive'; the autonomous lane counts everything else
    // (source IS NULL OR source <> 'interactive'). So a flood of background
    // scheduled-task completions can never consume the interactive budget, and
    // vice-versa.
    const laneFilter = lane === "interactive"
      ? sql`source = 'interactive'`
      : sql`(source IS NULL OR source <> 'interactive')`;
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE persona_name = ${personaName ?? null})::int AS persona
      FROM heartbeat_logs
      WHERE created_at > NOW() - (${windowHours} || ' hours')::interval
        AND ${laneFilter}
    `);
    const row: any = result.rows?.[0] || { total: 0, persona: 0 };
    const total = Number(row.total || 0);
    const persona = Number(row.persona || 0);

    if (total >= globalCap) {
      return {
        allowed: false,
        used: total,
        cap: globalCap,
        windowHours,
        reason: `${lane} pace cap hit: ${total}/${globalCap} runs in last ${windowHours}h`,
      };
    }
    if (personaName && personaCap && persona >= personaCap) {
      return {
        allowed: false,
        used: persona,
        cap: personaCap,
        windowHours,
        reason: `Per-persona ${lane} pace cap hit for ${personaName}: ${persona}/${personaCap} in last ${windowHours}h`,
      };
    }
    return {
      allowed: true,
      used: personaName ? persona : total,
      cap: personaName ? (personaCap ?? globalCap) : globalCap,
      windowHours,
    };
  } catch (err: any) {
    console.warn(`[pace-control] check failed, allowing through:`, err?.message || err);
    return { allowed: true, used: 0, cap: globalCap, windowHours };
  }
}

/** For dashboard / debugging — current usage snapshot. */
export async function getPaceSnapshot(): Promise<{
  windowHours: number;
  totalRuns: number;
  byPersona: { personaName: string; runs: number }[];
  cap: number;
  perPersonaCap?: number;
  /** Per-lane breakdown so an operator can SEE what is burning the window —
   * interactive (user work) vs autonomous (background tasks). */
  byLane: { interactive: number; autonomous: number };
  interactiveCap: number;
}> {
  const { windowHours, maxRunsPerWindow, perPersonaCap, interactiveCap } = _config;
  try {
    const totalRow: any = (await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE source = 'interactive')::int AS interactive,
             COUNT(*) FILTER (WHERE source IS NULL OR source <> 'interactive')::int AS autonomous
      FROM heartbeat_logs
      WHERE created_at > NOW() - (${windowHours} || ' hours')::interval
    `)).rows?.[0];
    const personaRows: any[] = (await db.execute(sql`
      SELECT COALESCE(persona_name, 'unknown') AS persona_name, COUNT(*)::int AS n
      FROM heartbeat_logs
      WHERE created_at > NOW() - (${windowHours} || ' hours')::interval
      GROUP BY persona_name
      ORDER BY n DESC
    `)).rows;
    return {
      windowHours,
      totalRuns: Number(totalRow?.n || 0),
      byPersona: personaRows.map(r => ({ personaName: r.persona_name, runs: Number(r.n) })),
      cap: maxRunsPerWindow,
      perPersonaCap,
      byLane: {
        interactive: Number(totalRow?.interactive || 0),
        autonomous: Number(totalRow?.autonomous || 0),
      },
      interactiveCap,
    };
  } catch {
    return { windowHours, totalRuns: 0, byPersona: [], cap: maxRunsPerWindow, perPersonaCap, byLane: { interactive: 0, autonomous: 0 }, interactiveCap };
  }
}
