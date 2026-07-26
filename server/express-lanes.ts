import { db } from "./db";
import { sql } from "drizzle-orm";
import { getTrustScore, type TrustCategory } from "./trust-engine";
import { getExpressLaneDailyCap } from "./auto-tuner";

import { logSilentCatch } from "./lib/silent-catch";
export interface ExpressLane {
  id: string;
  fromPersonaId: number;
  fromName: string;
  toPersonaId: number;
  toName: string;
  workType: string;
  dailyCap: number;
  suspended: boolean;
  suspendedReason?: string;
}

const APPROVED_LANES: ExpressLane[] = [
  { id: "EL-01", fromPersonaId: 7, fromName: "Scribe", toPersonaId: 8, toName: "Proof", workType: "content_review", dailyCap: 10, suspended: false },
  { id: "EL-02", fromPersonaId: 8, fromName: "Proof", toPersonaId: 7, toName: "Scribe", workType: "revision_feedback", dailyCap: 10, suspended: false },
  { id: "EL-03", fromPersonaId: 9, fromName: "Radar", toPersonaId: 11, toName: "Apollo", workType: "prospect_intelligence", dailyCap: 10, suspended: false },
  { id: "EL-04", fromPersonaId: 9, fromName: "Radar", toPersonaId: 13, toName: "Cassandra", workType: "market_financial_data", dailyCap: 10, suspended: false },
  { id: "EL-05", fromPersonaId: 12, fromName: "Atlas", toPersonaId: 13, toName: "Cassandra", workType: "metrics_for_financial", dailyCap: 10, suspended: false },
  { id: "EL-06", fromPersonaId: 13, fromName: "Cassandra", toPersonaId: 2, toName: "Felix", workType: "financial_alert", dailyCap: 10, suspended: false },
  { id: "EL-07", fromPersonaId: 6, fromName: "Chief of Staff", toPersonaId: 3, toName: "Forge", workType: "technical_incident", dailyCap: 10, suspended: false },
  { id: "EL-08", fromPersonaId: 4, fromName: "Teagan", toPersonaId: 7, toName: "Scribe", workType: "longform_content_request", dailyCap: 10, suspended: false },
  { id: "EL-09", fromPersonaId: 11, fromName: "Apollo", toPersonaId: 7, toName: "Scribe", workType: "proposal_copy_request", dailyCap: 10, suspended: false },
  { id: "EL-10", fromPersonaId: 11, fromName: "Apollo", toPersonaId: 14, toName: "Luna", workType: "contract_review", dailyCap: 10, suspended: false },
  { id: "EL-11", fromPersonaId: 14, fromName: "Luna", toPersonaId: 2, toName: "Felix", workType: "legal_risk_alert", dailyCap: 10, suspended: false },
  { id: "EL-12", fromPersonaId: 10, fromName: "Neptune", toPersonaId: 7, toName: "Scribe", workType: "script_request_media", dailyCap: 10, suspended: false },
];

const laneSuspensions = new Map<string, { reason: string; until: number }>();

function cleanupExpiredSuspensions() {
  const now = Date.now();
  for (const [key, val] of laneSuspensions) {
    if (now > val.until) laneSuspensions.delete(key);
  }
}

export function getApprovedLanes(): ExpressLane[] {
  cleanupExpiredSuspensions();
  return APPROVED_LANES.map(lane => ({
    ...lane,
    suspended: laneSuspensions.has(lane.id),
    suspendedReason: laneSuspensions.get(lane.id)?.reason,
  }));
}

export function findLane(fromPersonaId: number, toPersonaId: number, workType?: string): ExpressLane | null {
  return APPROVED_LANES.find(l =>
    l.fromPersonaId === fromPersonaId &&
    l.toPersonaId === toPersonaId &&
    (!workType || l.workType === workType)
  ) || null;
}

export function findLanesForAgent(personaId: number): { outbound: ExpressLane[]; inbound: ExpressLane[] } {
  return {
    outbound: APPROVED_LANES.filter(l => l.fromPersonaId === personaId),
    inbound: APPROVED_LANES.filter(l => l.toPersonaId === personaId),
  };
}

export async function checkExpressLaneEligibility(
  tenantId: number,
  fromPersonaId: number,
  toPersonaId: number,
  workType?: string
): Promise<{ eligible: boolean; reason?: string; lane?: ExpressLane }> {
  const lane = findLane(fromPersonaId, toPersonaId, workType);
  if (!lane) return { eligible: false, reason: "No approved express lane exists for this agent pair" };

  if (laneSuspensions.has(lane.id)) {
    const suspension = laneSuspensions.get(lane.id)!;
    if (suspension.until && Date.now() > suspension.until) {
      laneSuspensions.delete(lane.id);
    } else {
      return { eligible: false, reason: `Lane ${lane.id} suspended: ${suspension.reason}` };
    }
  }

  const [fromTrust, fromPurpose, toTrust, toPurpose] = await Promise.all([
    getTrustScore(tenantId, fromPersonaId, "tool_compliance"),
    getTrustScore(tenantId, fromPersonaId, "purpose_adherence"),
    getTrustScore(tenantId, toPersonaId, "tool_compliance"),
    getTrustScore(tenantId, toPersonaId, "purpose_adherence"),
  ]);

  if (!fromTrust || fromTrust.score < 60) return { eligible: false, reason: `Source agent tool_compliance score < 60` };
  if (!fromPurpose || fromPurpose.score < 60) return { eligible: false, reason: `Source agent purpose_adherence score < 60` };
  if (!toTrust || toTrust.score < 60) return { eligible: false, reason: `Target agent tool_compliance score < 60` };
  if (!toPurpose || toPurpose.score < 60) return { eligible: false, reason: `Target agent purpose_adherence score < 60` };

  let baseCap = lane.dailyCap;
  try { baseCap = getExpressLaneDailyCap(); } catch (_silentErr) { logSilentCatch("server/express-lanes.ts", _silentErr); }

  const avgTrust = Math.round(
    ((fromTrust?.score ?? 50) + (fromPurpose?.score ?? 50) + (toTrust?.score ?? 50) + (toPurpose?.score ?? 50)) / 4
  );
  let trustMultiplier = 1.0;
  if (avgTrust >= 90) trustMultiplier = 2.0;
  else if (avgTrust >= 80) trustMultiplier = 1.5;
  else if (avgTrust >= 70) trustMultiplier = 1.2;
  else if (avgTrust < 65) trustMultiplier = 0.8;

  const effectiveCap = Math.max(3, Math.round(baseCap * trustMultiplier));
  const todayUsage = await getDailyLaneUsage(tenantId, lane.id);
  if (todayUsage >= effectiveCap) return { eligible: false, reason: `Daily cap reached (${todayUsage}/${effectiveCap}, trust-adjusted from base ${baseCap})` };

  return { eligible: true, lane };
}

export async function recordLaneUsage(
  tenantId: number,
  laneId: string,
  fromPersonaId: number,
  toPersonaId: number,
  workType: string,
  success: boolean,
  description?: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO express_lane_usage (tenant_id, lane_id, from_persona_id, to_persona_id, work_type, success, description)
    VALUES (${tenantId}, ${laneId}, ${fromPersonaId}, ${toPersonaId}, ${workType}, ${success}, ${description || null})
  `);

  if (!success) {
    const recentFailures = await db.execute(sql`
      SELECT COUNT(*) as fail_count FROM express_lane_usage
      WHERE tenant_id = ${tenantId} AND lane_id = ${laneId} AND success = false
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 3
    `);
    const rows = (recentFailures as any).rows || recentFailures;
    const consecutiveResult = await db.execute(sql`
      SELECT success FROM express_lane_usage
      WHERE tenant_id = ${tenantId} AND lane_id = ${laneId}
      ORDER BY created_at DESC LIMIT 3
    `);
    const lastThree = ((consecutiveResult as any).rows || consecutiveResult) as any[];
    if (lastThree.length >= 3 && lastThree.every((r: any) => r.success === false)) {
      suspendLane(laneId, "3 consecutive failures");
      console.log(`[express-lanes] Lane ${laneId} auto-suspended: 3 consecutive failures`);
    }
  }
}

async function getDailyLaneUsage(tenantId: number, laneId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as usage_count FROM express_lane_usage
    WHERE tenant_id = ${tenantId} AND lane_id = ${laneId} AND created_at > CURRENT_DATE
  `);
  const rows = (result as any).rows || result;
  return parseInt(rows[0]?.usage_count || "0");
}

export function suspendLane(laneId: string, reason: string, durationMs?: number) {
  laneSuspensions.set(laneId, { reason, until: Date.now() + (durationMs || 86400000) });
}

export function unsuspendLane(laneId: string) {
  laneSuspensions.delete(laneId);
}

export function getExpressLaneContext(personaId: number): string {
  const lanes = findLanesForAgent(personaId);
  if (lanes.outbound.length === 0) return "";

  const lines = ["EXPRESS LANES AVAILABLE (direct handoff without Felix relay):"];
  for (const lane of lanes.outbound) {
    const suspended = laneSuspensions.has(lane.id) ? " [SUSPENDED]" : "";
    lines.push(`- ${lane.id}: → ${lane.toName} (${lane.workType})${suspended}`);
  }
  lines.push("To use: delegate_task to the target agent. Post to #operations: 'EXPRESS LANE: [You] → [Target], Work: [desc]'");
  return lines.join("\n");
}
