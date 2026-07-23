// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S6c — background opportunity scanner.
// Feature contract: data/feature-contracts/revenue-missions.
//
// DETERMINISTIC, $0, no LLM: the scanner does not invent ideas — it promotes
// the single best ALREADY-SCORED IdeaBrowser project (the Isenberg pipeline
// sets metadata.priority + a tier:S / tier:A tag) into a PROPOSAL-ONLY
// revenue mission at stage 'hypothesis'. Proposal-only is inherent to the
// mission spine: nothing sends without a drafted experiment PLUS explicit
// owner approval (approved_by_owner_at fail-closed gate in S3).
//
// Guards (all fail toward NOT proposing):
//  - portfolio capacity: skip when active unproven missions ≥ the allocator's
//    max (PORTFOLIO_RULES.maxActiveUnproven) — discipline before novelty;
//  - one pending proposal at a time: skip while an auto-proposed mission is
//    still sitting at stage 'hypothesis' awaiting the owner;
//  - never re-propose: candidate projects already linked to ANY mission
//    (revenue_missions.project_id) are excluded;
//  - S/A tier only, and the packet is built ONLY from evidence fields the
//    scorer persisted (buyer_hypothesis, rationale, name/description).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-opportunity-scanner: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Marker written into notes so the pending-proposal guard can find its own output. */
export const AUTO_PROPOSED_MARKER = "[auto-proposed:mission_opportunity_scan]";

export interface MissionPacket {
  name: string;
  hypothesis: string;
  idealCustomer: string;
  offer: string;
  priceUsd?: number;
  notes: string;
  projectId: number;
}

/**
 * Build a mission packet from a scored idea project row. Pure — exported for
 * query-free tests. Returns null when the scorer's evidence fields are too
 * thin to form an honest packet (fail toward NOT proposing).
 */
export function buildMissionPacket(project: {
  id: number;
  name: string;
  description?: string | null;
  metadata?: any;
}): MissionPacket | null {
  const meta = project?.metadata && typeof project.metadata === "object" ? project.metadata : {};
  const tier = typeof meta.tier === "string" ? meta.tier : "";
  if (tier !== "S" && tier !== "A") return null;
  const buyer = typeof meta.buyer_hypothesis === "string" ? meta.buyer_hypothesis.trim() : "";
  const rationale = typeof meta.rationale === "string" ? meta.rationale.trim() : "";
  const name = typeof project.name === "string" ? project.name.trim() : "";
  if (!name || !buyer || !rationale) return null;
  // Deterministic price extraction: first "$N" figure in the buyer hypothesis,
  // if any (whole dollars). Absent/odd figures leave priceUsd unset (0).
  const priceMatch = buyer.match(/\$(\d{1,6})(?:[^\d]|$)/);
  const priceUsd = priceMatch ? Number(priceMatch[1]) : undefined;
  return {
    name: `${name} — validation mission`,
    hypothesis: `Scored tier-${tier} idea (composite ${Number(meta.composite) || "?"}): ${rationale}`,
    idealCustomer: buyer,
    offer: `Smallest sellable slice of "${name}"${project.description ? ` — ${String(project.description).slice(0, 200)}` : ""}`,
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
    notes: `${AUTO_PROPOSED_MARKER} from project #${project.id} (tier ${tier}). PROPOSAL ONLY — owner must draft + approve an experiment before anything sends.`,
    projectId: project.id,
  };
}

export interface ScanResult {
  proposed: boolean;
  missionId?: number;
  reason: string;
}

/**
 * One scan pass: capacity check → pending-proposal check → top unlinked S/A
 * idea project → createMission (proposal-only). DB + in-process only (prod-safe).
 */
export async function scanAndProposeMission(tenantId: number): Promise<ScanResult> {
  assertTenant(tenantId);

  const { reviewPortfolio } = await import("./mission-capital-allocator");
  const review = await reviewPortfolio(tenantId);
  if (review.portfolio.activeUnproven >= review.portfolio.maxActiveUnproven) {
    return { proposed: false, reason: `portfolio at capacity (${review.portfolio.activeUnproven}/${review.portfolio.maxActiveUnproven} active unproven) — kill or prove before proposing` };
  }

  const pending = await db.execute(sql`
    SELECT id FROM revenue_missions
    WHERE tenant_id = ${tenantId} AND stage = 'hypothesis'
      AND notes LIKE ${"%" + AUTO_PROPOSED_MARKER + "%"}
    LIMIT 1
  `);
  if (rows(pending).length > 0) {
    return { proposed: false, reason: `auto-proposed mission #${rows(pending)[0].id} still awaiting owner action` };
  }

  // Top-scored S/A-tier idea project not already linked to any mission.
  const candidates = await db.execute(sql`
    SELECT p.id, p.name, p.description, p.metadata
    FROM projects p
    WHERE p.tenant_id = ${tenantId}
      AND (p.metadata->>'tier') IN ('S', 'A')
      AND (p.metadata->>'composite') ~ '^[0-9]+$'
      AND 'idea-stage' = ANY(p.tags)
      AND NOT EXISTS (
        SELECT 1 FROM revenue_missions m
        WHERE m.tenant_id = ${tenantId} AND m.project_id = p.id
      )
    ORDER BY (p.metadata->>'composite')::int DESC, p.id DESC
    LIMIT 5
  `);
  for (const project of rows(candidates)) {
    const packet = buildMissionPacket(project);
    if (!packet) continue; // thin evidence — fail toward not proposing
    const { createMission } = await import("./revenue-missions");
    const mission = await createMission({ tenantId, ...packet });
    return { proposed: true, missionId: Number(mission.id), reason: `proposed mission from project #${project.id} "${project.name}"` };
  }
  return { proposed: false, reason: "no eligible S/A-tier unlinked idea projects with sufficient scorer evidence" };
}
