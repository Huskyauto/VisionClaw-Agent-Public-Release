/**
 * Chronicle precision — "of the skills the platform admitted into its durable
 * Chronicle (promoted from `proposed_skills` into `skills`), what fraction
 * later proved out in reuse?" (PROOF_LOOPS §10 evaluation metric, Boucher,
 * Montreal.AI 2026 — adopted as telemetry 2026-07-11.)
 *
 * A promoted skill "proves out" when BOTH:
 *   1. it SURVIVED — the promoted row still exists, is enabled, and its
 *      lifecycle status is 'active' (not superseded/phantom/deleted); and
 *   2. it was REUSED — the skill-RAG lane actually selected it for at least
 *      one real question after promotion (`skill_rag_decisions.skill_used`).
 *
 * precision = (survived ∧ reused) / promoted.
 *
 * Design: pure aggregation (`computeChroniclePrecision`) is DB-free and
 * unit-testable; the gatherer (`summarizeChroniclePrecision`) dynamic-imports
 * the db so importing this module never opens a pg pool (see memory:
 * node-test-db-pool-hang). Telemetry only — advisory, never gates promotion.
 * Tenant isolation: both queries filter tenant_id to the caller's tenant.
 */

export interface PromotedSkillEvidence {
  proposedId: number;
  name: string;
  /** Promoted skills row still exists. */
  exists: boolean;
  /** skills.enabled */
  enabled: boolean;
  /** skills.status === 'active' (not superseded / phantom) */
  active: boolean;
  /** # of skill_rag_decisions rows that selected this skill after promotion. */
  reuseCount: number;
}

export interface ChroniclePrecisionSummary {
  /** proposed_skills accepted AND promoted (denominator). */
  promotedCount: number;
  /** Promoted skills whose row survived (exists ∧ enabled ∧ active). */
  survivedCount: number;
  /** Promoted skills with ≥1 post-promotion skill-RAG selection. */
  reusedCount: number;
  /** survived ∧ reused (numerator). */
  provenCount: number;
  /** provenCount / promotedCount; null when nothing has been promoted yet. */
  precision: number | null;
  /** Pending queue depth — context for how much is awaiting review. */
  pendingCount: number;
  /** Advisory alert floor; breached only when there IS data and precision < threshold. */
  threshold: number;
  breached: boolean;
}

const PRECISION_THRESHOLD = 0.5;

/** PURE aggregation over per-skill evidence rows. */
export function computeChroniclePrecision(
  rows: PromotedSkillEvidence[],
  pendingCount = 0,
  threshold = PRECISION_THRESHOLD,
): ChroniclePrecisionSummary {
  const promotedCount = rows.length;
  const survivedCount = rows.filter((r) => r.exists && r.enabled && r.active).length;
  const reusedCount = rows.filter((r) => r.reuseCount > 0).length;
  const provenCount = rows.filter((r) => r.exists && r.enabled && r.active && r.reuseCount > 0).length;
  const precision = promotedCount > 0 ? provenCount / promotedCount : null;
  return {
    promotedCount,
    survivedCount,
    reusedCount,
    provenCount,
    precision: precision == null ? null : Math.round(precision * 1000) / 1000,
    pendingCount,
    threshold,
    breached: precision != null && precision < threshold,
  };
}

/**
 * Gather evidence rows for one tenant and aggregate. Every query is
 * tenant-scoped and parameterized. Fail-soft is the CALLER's job
 * (ecosystem-health wraps probes in try/catch + timeout).
 */
export async function summarizeChroniclePrecision(tenantId: number): Promise<ChroniclePrecisionSummary> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");

  // One pass: promoted proposals joined to their skills row + post-promotion
  // reuse count from skill_rag_decisions (matched on skill name, which is what
  // the RAG lane records in skill_used).
  const res = await db.execute(sql`
    SELECT ps.id            AS proposed_id,
           ps.name          AS name,
           (s.id IS NOT NULL)                    AS skill_exists,
           COALESCE(s.enabled, false)            AS enabled,
           (COALESCE(s.status, '') = 'active')   AS active,
           COALESCE(r.reuse_count, 0)            AS reuse_count
    FROM proposed_skills ps
    LEFT JOIN skills s ON s.id = ps.promoted_skill_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS reuse_count
      FROM skill_rag_decisions d
      WHERE d.tenant_id = ${tenantId}
        AND lower(d.skill_used) = lower(ps.name)
        AND d.created_at >= COALESCE(ps.reviewed_at, ps.created_at)
    ) r ON true
    WHERE ps.tenant_id = ${tenantId}
      AND ps.status = 'accepted'
      AND ps.promoted_skill_id IS NOT NULL
  `);
  const rows = (((res as any).rows || res || []) as any[]).map((r): PromotedSkillEvidence => ({
    proposedId: Number(r.proposed_id),
    name: String(r.name ?? ""),
    exists: r.skill_exists === true,
    enabled: r.enabled === true,
    active: r.active === true,
    reuseCount: Number(r.reuse_count) || 0,
  }));

  const pendingRes = await db.execute(sql`
    SELECT count(*)::int AS n FROM proposed_skills
    WHERE tenant_id = ${tenantId} AND status = 'pending'
  `);
  const pendingCount = Number((((pendingRes as any).rows || pendingRes || [])[0] as any)?.n) || 0;

  return computeChroniclePrecision(rows, pendingCount);
}
