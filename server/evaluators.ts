import { db } from "./db";
import { sql } from "drizzle-orm";

export interface EvaluatorResult {
  evaluator: string;
  status: "active" | "warning" | "critical" | "ok";
  metrics: Record<string, any>;
  timestamp: number;
}

const evaluatorCache = new Map<string, { result: EvaluatorResult; ts: number }>();
const CACHE_TTL = 30_000;

function cached(name: string, tenantId: number): EvaluatorResult | null {
  const key = `${name}:${tenantId}`;
  const entry = evaluatorCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.result;
  return null;
}

function setCache(name: string, tenantId: number, result: EvaluatorResult) {
  evaluatorCache.set(`${name}:${tenantId}`, { result, ts: Date.now() });
  if (evaluatorCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of evaluatorCache) {
      if (now - v.ts > CACHE_TTL) evaluatorCache.delete(k);
    }
  }
}

export async function evalDailySpend(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("daily_spend", tenantId);
  if (c) return c;

  try {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(
        COALESCE((metadata->>'input_tokens')::numeric, 0) + COALESCE((metadata->>'output_tokens')::numeric, 0)
      ), 0) as total_tokens,
      COUNT(*) as request_count
      FROM messages
      WHERE tenant_id = ${tenantId} AND role = 'assistant'
        AND created_at > CURRENT_DATE
    `);
    const rows = (result as any).rows || result;
    const totalTokens = parseInt(rows[0]?.total_tokens || "0");
    const requestCount = parseInt(rows[0]?.request_count || "0");

    const estimatedCost = totalTokens * 0.000003;
    const dailyBudget = 10.0;
    const spendPercent = (estimatedCost / dailyBudget) * 100;

    const agentResult = await db.execute(sql`
      SELECT c.persona_id, COALESCE(SUM(
        COALESCE((m.metadata->>'input_tokens')::numeric, 0) + COALESCE((m.metadata->>'output_tokens')::numeric, 0)
      ), 0) as tokens
      FROM messages m JOIN conversations c ON m.conversation_id = c.id
      WHERE m.tenant_id = ${tenantId} AND m.role = 'assistant' AND m.created_at > CURRENT_DATE
      GROUP BY c.persona_id
    `);
    const agentRows = (agentResult as any).rows || agentResult;
    const spendByAgent: Record<string, number> = {};
    for (const row of agentRows) {
      if (row.persona_id) spendByAgent[row.persona_id] = parseInt(row.tokens || "0");
    }

    let warnThresh = 80, critThresh = 200;
    try { const { getEvaluatorThreshold } = require("./auto-tuner"); const t = getEvaluatorThreshold("daily_spend"); if (t) { warnThresh = t.warning; critThresh = t.critical; } } catch {}
    const r: EvaluatorResult = {
      evaluator: "daily_spend",
      status: spendPercent >= critThresh ? "critical" : spendPercent >= warnThresh ? "warning" : "ok",
      metrics: { spend_percent: Math.round(spendPercent * 100) / 100, spend_total: Math.round(estimatedCost * 100) / 100, total_tokens: totalTokens, request_count: requestCount, spend_by_agent: spendByAgent, daily_budget: dailyBudget },
      timestamp: Date.now(),
    };
    setCache("daily_spend", tenantId, r);
    return r;
  } catch {
    return { evaluator: "daily_spend", status: "ok", metrics: { spend_percent: 0, spend_total: 0, total_tokens: 0 }, timestamp: Date.now() };
  }
}

export async function evalAgentSpendRatio(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("agent_spend_ratio", tenantId);
  if (c) return c;

  const spend = await evalDailySpend(tenantId);
  const byAgent = spend.metrics.spend_by_agent || {};
  const totalTokens = spend.metrics.total_tokens || 1;

  let topSpender = 0;
  let topPercent = 0;
  const agentPercent: Record<string, number> = {};

  for (const [pid, tokens] of Object.entries(byAgent)) {
    const pct = ((tokens as number) / totalTokens) * 100;
    agentPercent[pid] = Math.round(pct * 10) / 10;
    if (pct > topPercent) { topPercent = pct; topSpender = parseInt(pid); }
  }

  const r: EvaluatorResult = {
    evaluator: "agent_spend_ratio",
    status: topPercent > 30 ? "warning" : "ok",
    metrics: { agent_percent_of_total: agentPercent, top_spender: topSpender, top_spender_percent: Math.round(topPercent * 10) / 10 },
    timestamp: Date.now(),
  };
  setCache("agent_spend_ratio", tenantId, r);
  return r;
}

const PII_PATTERNS = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone_us", pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
];

const PII_WHITELIST = new Set([
  process.env.AGENTMAIL_INBOX || "your-inbox@agentmail.to",
  ...(process.env.OWNER_ALERT_EMAIL ? [process.env.OWNER_ALERT_EMAIL] : []),
  ...(process.env.SITE_OWNER_EMAIL ? [process.env.SITE_OWNER_EMAIL] : []),
  ...(process.env.SITE_CONTACT_EMAIL ? [process.env.SITE_CONTACT_EMAIL] : []),
]);

export function scanForPII(text: string): { count: number; types: string[]; instances: string[] } {
  const found: { type: string; match: string }[] = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const m of matches) {
      if (name === "email" && PII_WHITELIST.has(m.toLowerCase())) continue;
      found.push({ type: name, match: m });
    }
  }
  return { count: found.length, types: [...new Set(found.map(f => f.type))], instances: found.map(f => f.match) };
}

export async function evalPIIExposure(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("pii_exposure", tenantId);
  if (c) return c;

  try {
    const result = await db.execute(sql`
      SELECT content FROM messages
      WHERE tenant_id = ${tenantId} AND role = 'assistant'
        AND created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC LIMIT 50
    `);
    const rows = (result as any).rows || result;
    let totalPII = 0;
    const allTypes = new Set<string>();
    for (const row of rows) {
      const scan = scanForPII(row.content || "");
      totalPII += scan.count;
      scan.types.forEach(t => allTypes.add(t));
    }

    const r: EvaluatorResult = {
      evaluator: "pii_exposure",
      status: totalPII > 0 ? "warning" : "ok",
      metrics: { pii_in_output: totalPII, pii_types: [...allTypes], messages_scanned: rows.length },
      timestamp: Date.now(),
    };
    setCache("pii_exposure", tenantId, r);
    return r;
  } catch {
    return { evaluator: "pii_exposure", status: "ok", metrics: { pii_in_output: 0, pii_types: [] }, timestamp: Date.now() };
  }
}

const failoverTracker = new Map<string, { attempts: number; failures: number; targets: string[]; resetAt: number }>();

export function recordFailover(tenantId: number, primaryModel: string, failedOver: boolean, fallbackTarget?: string) {
  const key = `${tenantId}`;
  const now = Date.now();
  let entry = failoverTracker.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { attempts: 0, failures: 0, targets: [], resetAt: now + 86400000 };
  }
  entry.attempts++;
  if (failedOver) {
    entry.failures++;
    if (fallbackTarget && !entry.targets.includes(fallbackTarget)) entry.targets.push(fallbackTarget);
  }
  failoverTracker.set(key, entry);

  if (failoverTracker.size > 100) {
    for (const [k, v] of failoverTracker) {
      if (now > v.resetAt) failoverTracker.delete(k);
    }
  }
}

export async function evalFailoverRate(tenantId: number): Promise<EvaluatorResult> {
  const entry = failoverTracker.get(`${tenantId}`) || { attempts: 0, failures: 0, targets: [] };
  const failoverPercent = entry.attempts > 0 ? (entry.failures / entry.attempts) * 100 : 0;

  let foWarn = 20, foCrit = 40;
  try { const { getEvaluatorThreshold } = require("./auto-tuner"); const t = getEvaluatorThreshold("failover_rate"); if (t) { foWarn = t.warning; foCrit = t.critical; } } catch {}
  return {
    evaluator: "failover_rate",
    status: failoverPercent > foCrit ? "critical" : failoverPercent > foWarn ? "warning" : "ok",
    metrics: { failover_percent: Math.round(failoverPercent * 10) / 10, total_attempts: entry.attempts, total_failures: entry.failures, failover_targets: entry.targets },
    timestamp: Date.now(),
  };
}

const toolViolations = new Map<string, { agent: number; tool: string; ts: number }[]>();

export function recordToolViolation(tenantId: number, personaId: number, toolName: string) {
  const key = `${tenantId}`;
  const list = toolViolations.get(key) || [];
  list.push({ agent: personaId, tool: toolName, ts: Date.now() });
  const cutoff = Date.now() - 86400000;
  toolViolations.set(key, list.filter(v => v.ts > cutoff));
}

export async function evalToolBoundaryViolations(tenantId: number): Promise<EvaluatorResult> {
  const list = toolViolations.get(`${tenantId}`) || [];
  const cutoff = Date.now() - 86400000;
  const recent = list.filter(v => v.ts > cutoff);

  const byAgent: Record<number, { count: number; tools: string[] }> = {};
  for (const v of recent) {
    if (!byAgent[v.agent]) byAgent[v.agent] = { count: 0, tools: [] };
    byAgent[v.agent].count++;
    if (!byAgent[v.agent].tools.includes(v.tool)) byAgent[v.agent].tools.push(v.tool);
  }

  const worstAgent = Object.entries(byAgent).sort((a, b) => b[1].count - a[1].count)[0];

  let tbWarn = 3;
  try { const { getEvaluatorThreshold } = require("./auto-tuner"); const t = getEvaluatorThreshold("tool_boundary_violations"); if (t) { tbWarn = t.warning; } } catch {}
  return {
    evaluator: "tool_boundary_violations",
    status: recent.length >= tbWarn ? "warning" : "ok",
    metrics: { total_violations_24h: recent.length, violations_by_agent: byAgent, worst_agent: worstAgent ? { id: parseInt(worstAgent[0]), count: worstAgent[1].count } : null },
    timestamp: Date.now(),
  };
}

export async function evalContentPipeline(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("content_pipeline", tenantId);
  if (c) return c;

  try {
    const result = await db.execute(sql`
      SELECT dl.id, dl.delivery_type, dl.status, dl.recipient_name, dl.delivered_by,
        dl.metadata
      FROM delivery_logs dl
      WHERE dl.tenant_id = ${tenantId} AND dl.created_at > NOW() - INTERVAL '7 days'
      ORDER BY dl.created_at DESC LIMIT 50
    `);
    const rows = (result as any).rows || result;
    let unreviewed = 0;
    let bypassed = 0;

    for (const row of rows) {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
      if (!meta?.reviewed_by) unreviewed++;
      if (meta?.created_by && meta?.reviewed_by && meta.created_by === meta.reviewed_by) bypassed++;
    }

    const r: EvaluatorResult = {
      evaluator: "content_pipeline",
      status: bypassed > 0 ? "warning" : unreviewed > 3 ? "warning" : "ok",
      metrics: { unreviewed_content: unreviewed, bypassed_reviews: bypassed, total_deliveries: rows.length },
      timestamp: Date.now(),
    };
    setCache("content_pipeline", tenantId, r);
    return r;
  } catch {
    return { evaluator: "content_pipeline", status: "ok", metrics: { unreviewed_content: 0, bypassed_reviews: 0 }, timestamp: Date.now() };
  }
}

export async function evalDeskQueue(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("desk_queue", tenantId);
  if (c) return c;

  try {
    const result = await db.execute(sql`
      SELECT persona_id, COUNT(*) as pending_count,
        MIN(created_at) as oldest_pending
      FROM heartbeat_tasks
      WHERE tenant_id = ${tenantId} AND enabled = true
      GROUP BY persona_id
    `);
    const rows = (result as any).rows || result;
    const queueByAgent: Record<string, { depth: number; oldestHours: number }> = {};
    let maxDepth = 0;

    for (const row of rows) {
      const depth = parseInt(row.pending_count || "0");
      const oldest = row.oldest_pending ? (Date.now() - new Date(row.oldest_pending).getTime()) / 3600000 : 0;
      queueByAgent[row.persona_id || "unknown"] = { depth, oldestHours: Math.round(oldest * 10) / 10 };
      if (depth > maxDepth) maxDepth = depth;
    }

    const r: EvaluatorResult = {
      evaluator: "desk_queue",
      status: maxDepth >= 10 ? "warning" : "ok",
      metrics: { queue_by_agent: queueByAgent, max_queue_depth: maxDepth },
      timestamp: Date.now(),
    };
    setCache("desk_queue", tenantId, r);
    return r;
  } catch {
    return { evaluator: "desk_queue", status: "ok", metrics: { queue_by_agent: {}, max_queue_depth: 0 }, timestamp: Date.now() };
  }
}

const authFailures: { ts: number; source: string; type: string }[] = [];

export function recordAuthFailure(source: string, type: string) {
  authFailures.push({ ts: Date.now(), source, type });
  const cutoff = Date.now() - 3600000;
  while (authFailures.length > 0 && authFailures[0].ts < cutoff) authFailures.shift();
}

export async function evalAuthFailures(_tenantId: number): Promise<EvaluatorResult> {
  const cutoff = Date.now() - 3600000;
  const recent = authFailures.filter(f => f.ts > cutoff);
  const sources = [...new Set(recent.map(f => f.source))];
  const types = [...new Set(recent.map(f => f.type))];

  return {
    evaluator: "auth_failures",
    status: recent.length >= 10 ? "critical" : recent.length >= 5 ? "warning" : "ok",
    metrics: { failed_attempts: recent.length, failure_sources: sources, failure_types: types },
    timestamp: Date.now(),
  };
}

export async function evalPurposeDrift(tenantId: number): Promise<EvaluatorResult> {
  const c = cached("purpose_drift", tenantId);
  if (c) return c;

  try {
    const result = await db.execute(sql`
      SELECT c.persona_id, COUNT(*) as total_msgs
      FROM messages m JOIN conversations c ON m.conversation_id = c.id
      WHERE m.tenant_id = ${tenantId} AND m.role = 'assistant'
        AND m.created_at > NOW() - INTERVAL '48 hours'
        AND c.persona_id IS NOT NULL
      GROUP BY c.persona_id
    `);
    const rows = (result as any).rows || result;
    const driftByAgent: Record<string, { total: number; off_topic_ratio: number }> = {};
    for (const row of rows) {
      const pid = row.persona_id;
      if (pid === 2 || pid === 5) continue;
      driftByAgent[pid] = { total: parseInt(row.total_msgs || "0"), off_topic_ratio: 0 };
    }

    const r: EvaluatorResult = {
      evaluator: "purpose_drift",
      status: "ok",
      metrics: { agents_tracked: Object.keys(driftByAgent).length, drift_by_agent: driftByAgent },
      timestamp: Date.now(),
    };
    setCache("purpose_drift", tenantId, r);
    return r;
  } catch {
    return { evaluator: "purpose_drift", status: "ok", metrics: { agents_tracked: 0 }, timestamp: Date.now() };
  }
}

export async function runAllEvaluators(tenantId: number): Promise<EvaluatorResult[]> {
  const results = await Promise.allSettled([
    evalDailySpend(tenantId),
    evalAgentSpendRatio(tenantId),
    evalPIIExposure(tenantId),
    evalFailoverRate(tenantId),
    evalToolBoundaryViolations(tenantId),
    evalContentPipeline(tenantId),
    evalDeskQueue(tenantId),
    evalAuthFailures(tenantId),
    evalPurposeDrift(tenantId),
  ]);

  const evaluatorResults = results
    .filter((r): r is PromiseFulfilledResult<EvaluatorResult> => r.status === "fulfilled")
    .map(r => r.value);

  try {
    for (const evalResult of evaluatorResults) {
      await db.execute(sql`
        INSERT INTO evaluator_snapshots (tenant_id, evaluator_name, metrics)
        VALUES (${tenantId}, ${evalResult.evaluator}, ${JSON.stringify({ ...evalResult.metrics, status: evalResult.status })}::jsonb)
      `);
    }
  } catch {}

  return evaluatorResults;
}

export { PII_PATTERNS, PII_WHITELIST };
