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

export interface PaceConfig {
  windowHours: number;
  maxRunsPerWindow: number;
  perPersonaCap?: number;
}

const DEFAULT_CONFIG: PaceConfig = {
  windowHours: 5,
  maxRunsPerWindow: 60,
  perPersonaCap: 25,
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
export async function checkPace(personaName?: string): Promise<PaceCheckResult> {
  const { windowHours, maxRunsPerWindow, perPersonaCap } = _config;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE persona_name = ${personaName ?? null})::int AS persona
      FROM heartbeat_logs
      WHERE created_at > NOW() - (${windowHours} || ' hours')::interval
    `);
    const row: any = result.rows?.[0] || { total: 0, persona: 0 };
    const total = Number(row.total || 0);
    const persona = Number(row.persona || 0);

    if (total >= maxRunsPerWindow) {
      return {
        allowed: false,
        used: total,
        cap: maxRunsPerWindow,
        windowHours,
        reason: `Global pace cap hit: ${total}/${maxRunsPerWindow} runs in last ${windowHours}h`,
      };
    }
    if (personaName && perPersonaCap && persona >= perPersonaCap) {
      return {
        allowed: false,
        used: persona,
        cap: perPersonaCap,
        windowHours,
        reason: `Per-persona pace cap hit for ${personaName}: ${persona}/${perPersonaCap} in last ${windowHours}h`,
      };
    }
    return {
      allowed: true,
      used: personaName ? persona : total,
      cap: personaName ? (perPersonaCap ?? maxRunsPerWindow) : maxRunsPerWindow,
      windowHours,
    };
  } catch (err: any) {
    console.warn(`[pace-control] check failed, allowing through:`, err?.message || err);
    return { allowed: true, used: 0, cap: maxRunsPerWindow, windowHours };
  }
}

/** For dashboard / debugging — current usage snapshot. */
export async function getPaceSnapshot(): Promise<{
  windowHours: number;
  totalRuns: number;
  byPersona: { personaName: string; runs: number }[];
  cap: number;
  perPersonaCap?: number;
}> {
  const { windowHours, maxRunsPerWindow, perPersonaCap } = _config;
  try {
    const totalRow: any = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
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
    };
  } catch {
    return { windowHours, totalRuns: 0, byPersona: [], cap: maxRunsPerWindow, perPersonaCap };
  }
}
