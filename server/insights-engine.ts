// ─────────────────────────────────────────────────────────────────────────────
// R88 — Tenant usage-insights engine (ported from Hermes Alpha insights.py)
// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant analytics over the last N days:
//   - Overview totals (sessions, turns, tokens, est. cost)
//   - Model breakdown (cost + tokens by model)
//   - Tool usage histogram (best-effort regex over assistant content)
//   - Activity heatmap (by hour of day, by day of week)
//   - Top sessions (longest by turn count + most tokens)
// Cost estimation reads MODEL_REGISTRY pricing where available.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./db";
import { sql } from "drizzle-orm";

export interface InsightsRange {
  tenantId: number;
  days: number;
}

export interface UsageInsights {
  range: { tenantId: number; days: number; sinceIso: string };
  overview: {
    totalSessions: number;
    totalMessages: number;
    totalUserMessages: number;
    totalAssistantMessages: number;
    totalCharsIn: number;
    totalCharsOut: number;
    estTokensIn: number;
    estTokensOut: number;
    estCostUsd: number;
  };
  models: Array<{
    model: string;
    sessions: number;
    messages: number;
    estTokens: number;
    estCostUsd: number;
  }>;
  tools: Array<{ tool: string; uses: number }>;
  activityByHour: number[];   // length 24
  activityByDow: number[];    // length 7 (Sun=0)
  topSessions: Array<{
    conversationId: number;
    title: string;
    model: string;
    turns: number;
    estTokens: number;
    lastAt: string;
  }>;
}

const CHARS_PER_TOKEN = 3.5;

// rough $/1M input tokens — fuzzy match by id prefix
const PRICING_PER_M_TOKENS: Array<[string, { in: number; out: number }]> = [
  ["claude-opus", { in: 0, out: 0 }],            // free via Anthropic integration
  ["gemini-3.1-pro", { in: 0, out: 0 }],
  ["gemini-3-pro", { in: 0, out: 0 }],
  ["gemini-3-flash", { in: 0, out: 0 }],
  ["gemini-2.5-flash", { in: 0, out: 0 }],
  ["gpt-5.4", { in: 2.5, out: 15 }],
  // R125+137.3 — platform default model since the Sol migration; without this entry
  // pricingFor() falls through to {0,0} and usage insights silently report $0 for the
  // majority of conversations. Flagship-class estimate (matches gpt-5.4) pending a
  // verified live rate; metered flagship lane applies when the ChatGPT OAuth sub is off.
  ["gpt-5.6-sol", { in: 2.5, out: 15 }],
  ["gpt-5-mini", { in: 0.25, out: 2 }],
  ["gpt-4.1", { in: 2, out: 8 }],
  ["gpt-4.1-mini", { in: 0.4, out: 1.6 }],
  ["o4-mini", { in: 1.1, out: 4.4 }],
  ["claude-sonnet-4", { in: 3, out: 15 }],
  // ultra:free must sit ABOVE the generic "nvidia/nemotron-3" matching (first-match-wins)
  ["nvidia/nemotron-3-ultra-550b-a55b:free", { in: 0, out: 0 }],
  ["nvidia/nemotron-3-super", { in: 0.3, out: 0.6 }],
  ["x-ai/grok-4.20-multi-agent", { in: 1.25, out: 2.5 }],
  ["x-ai/grok-4.5", { in: 2, out: 6 }],
  ["deepseek/deepseek-v4-pro", { in: 0.27, out: 1.1 }],
  ["deepseek/deepseek-v4-flash", { in: 0.07, out: 0.28 }],
  ["deepseek/deepseek-v3.2", { in: 0.214, out: 0.322 }],
  ["deepseek/deepseek-r1", { in: 0.55, out: 2.19 }],
  ["z-ai/glm-5.1", { in: 0.966, out: 3.036 }],
  ["z-ai/glm-5", { in: 0.45, out: 1.35 }],
  ["z-ai/glm-4.7-flash", { in: 0.1, out: 0.4 }],
  ["z-ai/glm-4.5-air:free", { in: 0, out: 0 }],
  ["xiaomi/mimo-v2-flash", { in: 0.09, out: 0.27 }],
  ["xiaomi/mimo-v2-omni", { in: 0.4, out: 1.2 }],
  // kimi-k3 must sit ABOVE the generic "moonshotai/kimi" prefix (first-match-wins)
  ["moonshotai/kimi-k3", { in: 3.0, out: 15.0 }],
  ["moonshotai/kimi", { in: 0.5, out: 1.5 }],
  ["meta/muse-spark-1.1", { in: 1.25, out: 4.25 }],
  ["meta-llama/llama-4", { in: 0.18, out: 0.6 }],
  ["google/gemma", { in: 0.05, out: 0.15 }],
  ["sonar", { in: 1, out: 1 }],
];

function pricingFor(model: string): { in: number; out: number } {
  const id = (model || "").toLowerCase();
  for (const [prefix, price] of PRICING_PER_M_TOKENS) {
    if (id.startsWith(prefix.toLowerCase())) return price;
  }
  return { in: 0, out: 0 };
}

function estTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

const TOOL_HINT_RE = /\[tool:\s*([\w.-]+)\]|Executing:\s*([\w.-]+)|Called\s+([\w.-]+)|<tool_call>\s*\{\s*"name"\s*:\s*"([\w.-]+)"/gi;

export async function getUsageInsights(opts: InsightsRange): Promise<UsageInsights> {
  const { tenantId, days } = opts;
  const sinceMs = Date.now() - days * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  const convsRes: any = await db.execute(sql`
    SELECT id, title, model, created_at, updated_at
    FROM conversations
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND updated_at >= ${sinceIso}::timestamptz
    ORDER BY updated_at DESC
  `);
  const conversations = (convsRes.rows || convsRes) as Array<{
    id: number; title: string; model: string; created_at: string; updated_at: string;
  }>;
  const convIds = conversations.map((c) => c.id);

  let messages: Array<{ id: number; conversation_id: number; role: string; content: string; created_at: string }> = [];
  if (convIds.length > 0) {
    const msgsRes: any = await db.execute(sql`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE tenant_id = ${tenantId}
        AND conversation_id = ANY(${convIds})
        AND created_at >= ${sinceIso}::timestamptz
    `);
    messages = msgsRes.rows || msgsRes;
  }

  const convModel = new Map<number, string>();
  for (const c of conversations) convModel.set(c.id, c.model || "unknown");

  let userMsgs = 0, asstMsgs = 0, charsIn = 0, charsOut = 0;
  const modelAgg = new Map<string, { sessions: Set<number>; messages: number; charsIn: number; charsOut: number }>();
  const toolCounts = new Map<string, number>();
  const hourBucket = new Array(24).fill(0);
  const dowBucket = new Array(7).fill(0);
  const sessionTurns = new Map<number, { turns: number; chars: number; lastAt: string }>();

  for (const m of messages) {
    const len = (m.content || "").length;
    const model = convModel.get(m.conversation_id) || "unknown";
    let agg = modelAgg.get(model);
    if (!agg) { agg = { sessions: new Set(), messages: 0, charsIn: 0, charsOut: 0 }; modelAgg.set(model, agg); }
    agg.sessions.add(m.conversation_id);
    agg.messages++;

    if (m.role === "user") { userMsgs++; charsIn += len; agg.charsIn += len; }
    else if (m.role === "assistant") {
      asstMsgs++; charsOut += len; agg.charsOut += len;
      const content = m.content || "";
      for (const match of content.matchAll(TOOL_HINT_RE)) {
        const name = match[1] || match[2] || match[3] || match[4];
        if (name) toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
    }

    const t = new Date(m.created_at);
    if (!isNaN(t.getTime())) {
      hourBucket[t.getUTCHours()]++;
      dowBucket[t.getUTCDay()]++;
    }

    const s = sessionTurns.get(m.conversation_id) || { turns: 0, chars: 0, lastAt: m.created_at };
    s.turns++;
    s.chars += len;
    if (m.created_at > s.lastAt) s.lastAt = m.created_at;
    sessionTurns.set(m.conversation_id, s);
  }

  let totalCost = 0;
  const modelsOut = Array.from(modelAgg.entries())
    .map(([model, a]) => {
      const p = pricingFor(model);
      const tIn = estTokens(a.charsIn);
      const tOut = estTokens(a.charsOut);
      const cost = (tIn / 1_000_000) * p.in + (tOut / 1_000_000) * p.out;
      totalCost += cost;
      return {
        model,
        sessions: a.sessions.size,
        messages: a.messages,
        estTokens: tIn + tOut,
        estCostUsd: Math.round(cost * 10000) / 10000,
      };
    })
    .sort((a, b) => b.estCostUsd - a.estCostUsd || b.estTokens - a.estTokens);

  const toolsOut = Array.from(toolCounts.entries())
    .map(([tool, uses]) => ({ tool, uses }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 25);

  const topSessionsOut = Array.from(sessionTurns.entries())
    .map(([cid, s]) => {
      const conv = conversations.find((c) => c.id === cid);
      return {
        conversationId: cid,
        title: conv?.title || "Untitled",
        model: conv?.model || "unknown",
        turns: s.turns,
        estTokens: estTokens(s.chars),
        lastAt: s.lastAt,
      };
    })
    .sort((a, b) => b.turns - a.turns || b.estTokens - a.estTokens)
    .slice(0, 10);

  return {
    range: { tenantId, days, sinceIso },
    overview: {
      totalSessions: conversations.length,
      totalMessages: messages.length,
      totalUserMessages: userMsgs,
      totalAssistantMessages: asstMsgs,
      totalCharsIn: charsIn,
      totalCharsOut: charsOut,
      estTokensIn: estTokens(charsIn),
      estTokensOut: estTokens(charsOut),
      estCostUsd: Math.round(totalCost * 10000) / 10000,
    },
    models: modelsOut,
    tools: toolsOut,
    activityByHour: hourBucket,
    activityByDow: dowBucket,
    topSessions: topSessionsOut,
  };
}
