import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

const NUDGE_COOLDOWN_MS = 30_000;
const MAX_NUDGES_PER_HOUR = 12;
const MIN_MESSAGE_LENGTH = 40;
const SCORE_THRESHOLD = 0.6;

const tenantNudgeCounts = new Map<number, { count: number; resetAt: number }>();
const recentNudgeHashes = new Map<string, number>();

function getTenantHourly(tenantId: number): { count: number; resetAt: number } {
  let entry = tenantNudgeCounts.get(tenantId);
  if (!entry || Date.now() > entry.resetAt) {
    entry = { count: 0, resetAt: Date.now() + 3_600_000 };
    tenantNudgeCounts.set(tenantId, entry);
  }
  return entry;
}

function simpleHash(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).sort().slice(0, 8);
  return words.join("-");
}

const HIGH_VALUE_PATTERNS: Array<{
  name: string;
  weight: number;
  test: (text: string) => boolean;
}> = [
  {
    name: "specific_numbers",
    weight: 0.25,
    test: (t) => /\$[\d,]+|\d+%|\d{4,}|\d+\.\d+/.test(t),
  },
  {
    name: "deadlines_dates",
    weight: 0.3,
    test: (t) => /\b(deadline|due|by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}))\b/i.test(t),
  },
  {
    name: "decisions",
    weight: 0.25,
    test: (t) => /\b(decided|decision|we('re| are) going (to|with)|approved|confirmed|chose|selected|agreed)\b/i.test(t),
  },
  {
    name: "preferences",
    weight: 0.2,
    test: (t) => /\b(prefer|always|never|make sure|important|must|requirement|needs to be)\b/i.test(t),
  },
  {
    name: "contact_info",
    weight: 0.3,
    test: (t) => /\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(t) || /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(t),
  },
  {
    name: "project_context",
    weight: 0.2,
    test: (t) => /\b(project|client|customer|account|contract|deal|partnership|vendor)\b/i.test(t),
  },
  {
    name: "names_entities",
    weight: 0.15,
    test: (t) => /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(t),
  },
  {
    name: "goals_targets",
    weight: 0.25,
    test: (t) => /\b(goal|target|objective|milestone|kpi|metric|quota|budget)\b/i.test(t),
  },
  {
    name: "instructions",
    weight: 0.2,
    test: (t) => /\b(remember|don't forget|keep in mind|note that|fyi|heads up)\b/i.test(t),
  },
  {
    name: "credentials_keys",
    weight: -1,
    test: (t) => /\b(api.?key|password|token|secret|credential|login)\b/i.test(t),
  },
];

export function scoreMessageValue(message: string): { score: number; reasons: string[] } {
  if (message.length < MIN_MESSAGE_LENGTH) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  const lengthBonus = Math.min(0.15, (message.length - MIN_MESSAGE_LENGTH) / 1000);
  score += lengthBonus;

  for (const pattern of HIGH_VALUE_PATTERNS) {
    if (pattern.test(message)) {
      score += pattern.weight;
      reasons.push(pattern.name);
    }
  }

  const sentenceCount = message.split(/[.!?]+/).filter(s => s.trim().length > 10).length;
  if (sentenceCount >= 3) score += 0.1;

  return { score: Math.min(1, score), reasons };
}

export function extractNudgeFact(message: string, reasons: string[]): string {
  const sentences = message
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15);

  if (sentences.length === 0) return message.slice(0, 300);

  const scored = sentences.map(s => {
    let points = 0;
    for (const pattern of HIGH_VALUE_PATTERNS) {
      if (pattern.test(s)) points += pattern.weight;
    }
    return { sentence: s, points };
  });

  scored.sort((a, b) => b.points - a.points);
  const topSentences = scored.slice(0, 3).map(s => s.sentence);
  return topSentences.join(". ").slice(0, 500);
}

export async function processNudge(
  tenantId: number,
  message: string,
  conversationId?: number
): Promise<boolean> {
  const hourly = getTenantHourly(tenantId);
  if (hourly.count >= MAX_NUDGES_PER_HOUR) return false;

  const { score, reasons } = scoreMessageValue(message);
  if (score < SCORE_THRESHOLD) return false;

  if (reasons.includes("credentials_keys")) return false;

  const hash = `${tenantId}:${simpleHash(message)}`;
  const lastSeen = recentNudgeHashes.get(hash);
  if (lastSeen && Date.now() - lastSeen < NUDGE_COOLDOWN_MS) return false;
  recentNudgeHashes.set(hash, Date.now());

  if (recentNudgeHashes.size > 500) {
    const entries = [...recentNudgeHashes.entries()];
    entries.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < 250; i++) recentNudgeHashes.delete(entries[i][0]);
  }

  const fact = extractNudgeFact(message, reasons);

  try {
    await db.execute(sql`
      INSERT INTO knowledge_nudges (tenant_id, fact, category, source, score, conversation_id)
      VALUES (${tenantId}, ${fact}, 'nudge', 'proactive', ${score}, ${conversationId || null})
    `);

    try {
      await storage.createMemoryEntry({
        tenantId,
        fact,
        category: "nudge",
        source: "proactive-nudge",
        status: "active",
        personaId: null,
      });
    } catch {}

    hourly.count++;
    console.log(`[nudge] Auto-saved for tenant ${tenantId} (score: ${score.toFixed(2)}, reasons: ${reasons.join(",")})`);
    return true;
  } catch (err: any) {
    console.warn(`[nudge] Save failed:`, err.message);
    return false;
  }
}

export async function getNudgeStats(tenantId: number): Promise<{
  totalNudges: number;
  last24h: number;
  topCategories: string[];
}> {
  try {
    const total = await db.execute(sql`
      SELECT COUNT(*) as count FROM knowledge_nudges WHERE tenant_id = ${tenantId}
    `);
    const recent = await db.execute(sql`
      SELECT COUNT(*) as count FROM knowledge_nudges
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
    `);
    return {
      totalNudges: parseInt(((total as any).rows?.[0]?.count) || "0"),
      last24h: parseInt(((recent as any).rows?.[0]?.count) || "0"),
      topCategories: ["nudge"],
    };
  } catch {
    return { totalNudges: 0, last24h: 0, topCategories: [] };
  }
}
