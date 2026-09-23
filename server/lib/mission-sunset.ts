// ─────────────────────────────────────────────────────────────────────────────
// Revenue Missions — automatic sunset guard (Grok 4.5 review, 2026-07-25).
//
// Closes the "detector with no dispatch" gap: the capital allocator emits
// kill_recommended verdicts but nothing ACTS on them, so a dead mission keeps
// its enrollments sending until the owner happens to look. This guard runs a
// deterministic, $0/no-LLM sweep that auto-PAUSES (never kills — kill remains
// a HITL owner decision) live missions when:
//   1. the allocator's kill signal fires (no demand / interest never converts),
//   2. the mission has gone stale (no evidence or rollup activity for
//      STALE_ACTIVITY_DAYS), or
//   3. an unproven mission exceeds MAX_UNPROVEN_LIFETIME_DAYS with no
//      positive realized margin.
//
// Pause is the fail-safe direction: reversible, stops spend, and the owner is
// notified (best-effort email — a notify failure never blocks the pause).
// Idempotence: a sunset stamps a notes marker; marked missions are skipped so
// the sweep never re-pauses or re-notifies.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import { assessMission, type MissionAssessment } from "./mission-capital-allocator";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-sunset: invalid tenantId ${tenantId} (fail closed)`);
  }
}

export const SUNSET_RULES = {
  // No evidence AND no rollup activity for this many days ⇒ stale.
  staleActivityDays: 21,
  // Unproven (realized margin <= 0) missions older than this ⇒ sunset.
  maxUnprovenLifetimeDays: 45,
} as const;

/** Stages where enrollments can still be sending / spend can still accrue. */
export const SUNSET_ELIGIBLE_STAGES = ["experiment_live", "evaluating"] as const;

/** Notes marker stamped on sunset — presence means "already sunset, skip". */
export const SUNSET_MARKER = "[auto-sunset";

export interface SunsetInput {
  stage: string;
  notes: string | null;
  createdAt: Date | null;
  /** Latest of mission updated_at and newest mission_evidence created_at. */
  lastActivityAt: Date | null;
  assessment: MissionAssessment;
}

export interface SunsetDecision {
  action: "pause" | "none";
  reasons: string[];
}

const DAY_MS = 86_400_000;

/** Pure sunset decision — exported for query-free tests. */
export function decideSunset(input: SunsetInput, now: Date = new Date()): SunsetDecision {
  const reasons: string[] = [];

  if (!SUNSET_ELIGIBLE_STAGES.includes(input.stage as any)) {
    return { action: "none", reasons: [`stage '${input.stage}' not sunset-eligible`] };
  }
  if ((input.notes || "").includes(SUNSET_MARKER)) {
    return { action: "none", reasons: ["already sunset (marker present) — owner decision pending"] };
  }

  // Rule 1: allocator kill signal → act on it (pause, not kill).
  if (input.assessment.verdict === "kill_recommended") {
    reasons.push(`allocator kill signal: ${input.assessment.reasons.join("; ")}`);
  }

  // Rule 2: staleness — no evidence/rollup activity for N days.
  const lastActivity = input.lastActivityAt ?? input.createdAt;
  if (lastActivity instanceof Date && !Number.isNaN(lastActivity.getTime())) {
    const idleDays = (now.getTime() - lastActivity.getTime()) / DAY_MS;
    if (idleDays >= SUNSET_RULES.staleActivityDays) {
      reasons.push(`stale: no evidence or rollup activity for ${Math.floor(idleDays)} days (limit ${SUNSET_RULES.staleActivityDays})`);
    }
  }

  // Rule 3: unproven lifetime cap — margin never went positive.
  if (
    input.createdAt instanceof Date &&
    !Number.isNaN(input.createdAt.getTime()) &&
    input.assessment.realizedMarginUsdCents <= 0
  ) {
    const ageDays = (now.getTime() - input.createdAt.getTime()) / DAY_MS;
    if (ageDays >= SUNSET_RULES.maxUnprovenLifetimeDays) {
      reasons.push(`lifetime: unproven for ${Math.floor(ageDays)} days with no positive margin (limit ${SUNSET_RULES.maxUnprovenLifetimeDays})`);
    }
  }

  return reasons.length > 0 ? { action: "pause", reasons } : { action: "none", reasons: ["no sunset condition met"] };
}

export interface SunsetSweepResult {
  checked: number;
  paused: Array<{ missionId: number; name: string; reasons: string[]; stoppedEnrollments: number; cancelledExperiments: number }>;
  errors: string[];
}

/**
 * One sweep pass over a tenant's live missions. Per-mission failures are
 * isolated (one broken mission never blocks the rest); the pause itself is
 * the safe direction, notification is best-effort.
 */
export async function sweepMissionSunset(tenantId: number, now: Date = new Date()): Promise<SunsetSweepResult> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT m.*,
      COALESCE(
        GREATEST(
          m.updated_at,
          (SELECT MAX(e.created_at) FROM mission_evidence e
           WHERE e.tenant_id = ${tenantId} AND e.mission_id = m.id)
        ),
        m.updated_at,
        m.created_at
      ) AS last_activity_at
    FROM revenue_missions m
    WHERE m.tenant_id = ${tenantId}
      AND m.stage IN ('experiment_live', 'evaluating')
  `);
  const missions = rows(res);
  const result: SunsetSweepResult = { checked: missions.length, paused: [], errors: [] };

  for (const m of missions) {
    try {
      const decision = decideSunset(
        {
          stage: String(m.stage ?? ""),
          notes: m.notes == null ? null : String(m.notes),
          createdAt: m.created_at ? new Date(m.created_at) : null,
          lastActivityAt: m.last_activity_at ? new Date(m.last_activity_at) : null,
          assessment: assessMission(m),
        },
        now,
      );
      if (decision.action !== "pause") continue;

      const missionId = Number(m.id);
      const { pauseMissionEnrollments } = await import("./mission-experiment-run");
      const paused = await pauseMissionEnrollments(tenantId, missionId);

      // Stamp the marker ATOMICALLY only if not already stamped (idempotence
      // under concurrent sweeps); if another sweep won the race, skip notify.
      const stampNote = `${SUNSET_MARKER} ${now.toISOString().slice(0, 10)}: paused — ${decision.reasons.join(" | ")}. Kill/resume is the owner's call.]`;
      const stamped = await db.execute(sql`
        UPDATE revenue_missions
        SET notes = COALESCE(notes || E'\n', '') || ${stampNote}, updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND id = ${missionId}
          AND COALESCE(notes, '') NOT LIKE ${"%" + SUNSET_MARKER + "%"}
        RETURNING id
      `);
      if (rows(stamped).length === 0) continue; // lost the race — already handled

      result.paused.push({
        missionId,
        name: String(m.name ?? ""),
        reasons: decision.reasons,
        stoppedEnrollments: paused.stoppedEnrollments,
        cancelledExperiments: paused.cancelledExperiments,
      });

      // Best-effort owner notification — never blocks the pause.
      try {
        const { resolveOwnerEmail } = await import("./owner-email");
        const to = resolveOwnerEmail();
        if (to) {
          const { sendEmailDirect } = await import("../email");
          await sendEmailDirect({
            to,
            subject: `[VisionClaw] Revenue Mission #${missionId} auto-paused (sunset guard)`,
            text: [
              `Mission #${missionId} "${m.name}" was automatically PAUSED (not killed) by the sunset guard.`,
              ``,
              `Why:`,
              ...decision.reasons.map((r) => `  - ${r}`),
              ``,
              `Stopped ${paused.stoppedEnrollments} enrollment(s), cancelled ${paused.cancelledExperiments} live experiment(s).`,
              `Kill or resume is your decision in the admin UI (/admin — Revenue Missions).`,
            ].join("\n"),
          });
        }
      } catch (e) {
        console.warn("[mission-sunset] owner notify failed (pause already applied):", (e as any)?.message ?? e);
      }
    } catch (e) {
      const msg = `mission #${m?.id}: ${(e as any)?.message ?? e}`;
      console.error("[mission-sunset] sweep error —", msg);
      result.errors.push(msg);
    }
  }
  return result;
}
