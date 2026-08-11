import { db } from "./db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "./tenant-constants";

import { logSilentCatch } from "./lib/silent-catch";
export type SignalLevel = "NOISE" | "WATCH" | "ALERT" | "URGENT" | "CRITICAL";

export interface EnvironmentalScan {
  id: string;
  name: string;
  frequency: string;
  cronExpression: string;
  ownerPersonaId: number;
  ownerName: string;
  monitors: string;
}

export interface EnvironmentalSignal {
  scanId: string;
  level: SignalLevel;
  category: string;
  summary: string;
  primaryConsumer: number;
  secondaryConsumer?: number;
  channel: string;
  timestamp: number;
}

const SCAN_SCHEDULE: EnvironmentalScan[] = [
  { id: "ENV-01", name: "Competitive Pulse", frequency: "Daily 7 AM", cronExpression: "0 7 * * *", ownerPersonaId: 9, ownerName: "Radar", monitors: "Competitor websites, news, social mentions" },
  { id: "ENV-02", name: "Market Sentiment", frequency: "Daily 7 AM", cronExpression: "0 7 * * *", ownerPersonaId: 9, ownerName: "Radar", monitors: "Industry news, analyst opinions, trend signals" },
  { id: "ENV-03", name: "Regulatory Watch", frequency: "Weekly Mon 8 AM", cronExpression: "0 8 * * 1", ownerPersonaId: 14, ownerName: "Luna", monitors: "AI regulations, business law changes" },
  { id: "ENV-04", name: "Financial Environment", frequency: "Daily 8 AM", cronExpression: "0 8 * * *", ownerPersonaId: 13, ownerName: "Cassandra", monitors: "Interest rates, market conditions, economic indicators" },
  { id: "ENV-05", name: "Technology Watch", frequency: "Weekly Tue 8 AM", cronExpression: "0 8 * * 2", ownerPersonaId: 3, ownerName: "Forge", monitors: "Dependency updates, security advisories, new tools" },
  { id: "ENV-06", name: "Customer Signals", frequency: "Daily 9 AM", cronExpression: "0 9 * * *", ownerPersonaId: 6, ownerName: "Chief of Staff", monitors: "Inbox analysis, support patterns, feedback themes" },
  { id: "ENV-07", name: "Content Landscape", frequency: "Weekly Mon 9 AM", cronExpression: "0 9 * * 1", ownerPersonaId: 4, ownerName: "Teagan", monitors: "Trending topics, content performance, platform changes" },
  { id: "ENV-08", name: "Pipeline Health", frequency: "Daily 9 AM", cronExpression: "0 9 * * *", ownerPersonaId: 11, ownerName: "Apollo", monitors: "Deal aging, response rates, pipeline velocity" },
];

const SIGNAL_ROUTING: Record<string, { primary: number; secondary?: number; channel: string }> = {
  "competitor_pricing_change": { primary: 11, secondary: 13, channel: "#intelligence" },
  "new_competitor": { primary: 9, secondary: 2, channel: "#intelligence" },
  "regulatory_change": { primary: 14, secondary: 2, channel: "#general" },
  "tech_vulnerability": { primary: 3, secondary: 6, channel: "#engineering" },
  "complaint_pattern": { primary: 6, secondary: 7, channel: "#general" },
  "content_viral": { primary: 4, secondary: 11, channel: "#content-pipeline" },
  "revenue_anomaly": { primary: 13, secondary: 2, channel: "#revenue-alerts" },
  "market_downturn": { primary: 13, secondary: 9, channel: "#intelligence" },
  "partnership_opportunity": { primary: 11, secondary: 2, channel: "#revenue-alerts" },
  "prospect_trigger_event": { primary: 11, secondary: 7, channel: "#revenue-alerts" },
};

const recentSignals: EnvironmentalSignal[] = [];
const MAX_SIGNALS = 200;

export function getScanSchedule(): EnvironmentalScan[] {
  return SCAN_SCHEDULE;
}

export function getScansForPersona(personaId: number): EnvironmentalScan[] {
  return SCAN_SCHEDULE.filter(s => s.ownerPersonaId === personaId);
}

export function classifySignal(category: string, severity: number): SignalLevel {
  if (severity >= 90) return "CRITICAL";
  if (severity >= 70) return "URGENT";
  if (severity >= 50) return "ALERT";
  if (severity >= 30) return "WATCH";
  return "NOISE";
}

export function routeSignal(category: string): { primary: number; secondary?: number; channel: string } {
  return SIGNAL_ROUTING[category] || { primary: 2, channel: "#general" };
}

export async function recordSignal(signal: EnvironmentalSignal): Promise<void> {
  recentSignals.push(signal);
  while (recentSignals.length > MAX_SIGNALS) recentSignals.shift();

  try {
    // Environmental signals are platform-wide system scans (not owned by any one
    // customer tenant). Bind the explicit ADMIN_TENANT_ID constant rather than a
    // magic `1` so the global ownership is intentional and self-documenting — a
    // hardcoded literal tenant_id is exactly what the isolation audit flags.
    await db.execute(sql`
      INSERT INTO evaluator_snapshots (tenant_id, evaluator_name, metrics)
      VALUES (${ADMIN_TENANT_ID}, 'environmental_signal', ${JSON.stringify(signal)}::jsonb)
    `);
  } catch (_silentErr) { logSilentCatch("server/environmental-awareness.ts", _silentErr); }

  if (signal.level === "URGENT" || signal.level === "CRITICAL") {
    console.log(`[env-awareness] ${signal.level}: ${signal.summary} → persona ${signal.primaryConsumer} via ${signal.channel}`);
  }
}

export function getRecentSignals(level?: SignalLevel): EnvironmentalSignal[] {
  if (level) return recentSignals.filter(s => s.level === level);
  return [...recentSignals];
}

export function getSignalsSince(since: number, level?: SignalLevel): EnvironmentalSignal[] {
  return recentSignals.filter(s => s.timestamp >= since && (!level || s.level === level));
}

export function getEnvironmentalContext(personaId: number): string {
  const scans = getScansForPersona(personaId);
  if (scans.length === 0) return "";

  const lines = ["ENVIRONMENTAL AWARENESS — Your monitoring responsibilities:"];
  for (const scan of scans) {
    lines.push(`- ${scan.name} (${scan.frequency}): ${scan.monitors}`);
  }
  lines.push("Classify findings: NOISE (log only) | WATCH (watchlist) | ALERT (channel post) | URGENT (notify Felix) | CRITICAL (notify Felix + human)");
  return lines.join("\n");
}
