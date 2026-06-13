// R75 — GraphRAG Five: causal chain extraction + query.
// Extracts cause→effect chains from recent memories + tensions for a tenant
// via gpt-5-mini and persists to causal_chains. Designed for the REM phase
// of the dreaming scheduler (rare, narrative — not every cycle).

import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { logSilentCatch } from "./lib/silent-catch";

const CHAIN_SCHEMA = z.object({
  cause: z.string().min(1).max(400),
  effect: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1).default(0.5),
  time_lag_seconds: z.number().int().nonnegative().nullable().optional(),
  evidence: z.string().max(800).default(""),
});
type Chain = z.infer<typeof CHAIN_SCHEMA>;

export interface ExtractionResult {
  tenantId: number;
  scanned: number;
  chains: number;
  inserted: number;
  skippedReason?: string;
}

const MIN_MEMORIES = 4;
const BATCH_SIZE = 10;
const MAX_BATCHES = 3;

function splitNounPhrase(s: string): { subject: string; predicate?: string; object: string } {
  // Lightweight split: look for " causes "/" leads to "/" results in "/" because " etc.
  // Falls back to the whole string as subject + empty object.
  const m = s.match(/^(.+?)\s+(causes|caused|led to|leads to|results in|due to|because of|triggers|triggered|resulted in)\s+(.+)$/i);
  if (m) return { subject: m[1].trim().slice(0, 200), predicate: m[2].toLowerCase().slice(0, 40), object: m[3].trim().slice(0, 200) };
  return { subject: s.trim().slice(0, 200), object: "" };
}

export async function extractCausalChainsForTenant(
  tenantId: number,
  opts: { limit?: number; sinceHours?: number } = {},
): Promise<ExtractionResult> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return { tenantId, scanned: 0, chains: 0, inserted: 0, skippedReason: "invalid-tenant" };
  }

  const limit = Math.min(60, Math.max(MIN_MEMORIES, opts.limit ?? 30));
  const sinceHours = Math.max(1, Math.min(168, opts.sinceHours ?? 72));

  const rows = await db.execute<{ kind: string; ts: Date; text: string }>(sql`
    SELECT 'memory' AS kind, created_at AS ts, fact AS text
    FROM memory_entries
    WHERE tenant_id = ${tenantId}
      AND created_at > now() - (${sinceHours}::int * interval '1 hour')
      AND status = 'active'
    UNION ALL
    SELECT 'tension' AS kind, created_at AS ts,
           (COALESCE(title, '') || ' | PRED: ' || COALESCE(predicted_state::text, '') || ' | ACT: ' || COALESCE(actual_state::text, '')) AS text
    FROM tensions
    WHERE tenant_id = ${tenantId}
      AND created_at > now() - (${sinceHours}::int * interval '1 hour')
    ORDER BY ts DESC
    LIMIT ${limit}
  `);

  const items = (rows.rows as any[]).map(r => ({ kind: String(r.kind), ts: r.ts, text: String(r.text || "").slice(0, 600) }))
    .filter(r => r.text.length >= 20);

  if (items.length < MIN_MEMORIES) {
    return { tenantId, scanned: items.length, chains: 0, inserted: 0, skippedReason: "too-few-items" };
  }

  // Batch into groups of BATCH_SIZE; one LLM call per batch.
  let chainsAll: Chain[] = [];
  for (let i = 0; i < items.length && i / BATCH_SIZE < MAX_BATCHES; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const corpus = batch.map((m, idx) => `[${i + idx + 1}] (${m.kind}, ${new Date(m.ts).toISOString().slice(0, 19)}) ${m.text}`).join("\n");
    try {
      const { default: OpenAI } = await import("openai");
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) break;
      const client = new OpenAI({ apiKey });
      const resp = await client.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "You extract causal chains (cause→effect pairs) from agent memories and tensions. Output STRICT JSON with key 'chains' = array of {cause, effect, confidence (0-1), time_lag_seconds (int or null), evidence (≤200 chars)}. Only include chains where causation is reasonably evidenced — no speculation. Each cause and effect must be a short noun phrase (≤200 chars). If none, return {\"chains\": []}.",
          },
          { role: "user", content: `Items:\n${corpus}\n\nReturn JSON only.` },
        ],
      });
      const raw = resp.choices?.[0]?.message?.content?.trim() || "{}";
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, "");
      const parsed = JSON.parse(cleaned);
      const chains = Array.isArray(parsed.chains) ? parsed.chains : [];
      for (const c of chains) {
        const v = CHAIN_SCHEMA.safeParse({
          cause: c.cause,
          effect: c.effect,
          confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
          time_lag_seconds: c.time_lag_seconds ?? null,
          evidence: c.evidence ?? "",
        });
        if (v.success) chainsAll.push(v.data);
      }
    } catch (err) {
      logSilentCatch("server/causal-extractor.ts", err);
      // Continue with what we have rather than failing the whole batch.
    }
  }

  // Dedup by (cause, effect) lowercase
  const seen = new Set<string>();
  chainsAll = chainsAll.filter(c => {
    const key = `${c.cause.toLowerCase().trim()}|${c.effect.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let inserted = 0;
  let skippedDup = 0;
  for (const c of chainsAll) {
    const causeParts = splitNounPhrase(c.cause);
    const effectParts = splitNounPhrase(c.effect);
    // Stable cross-run dedup hash — must match the unique index on causal_chains(tenant_id, chain_hash).
    const hashSrc = `${(causeParts.subject || "").toLowerCase().trim()}|${(causeParts.object || "").toLowerCase().trim()}|${(effectParts.subject || "").toLowerCase().trim()}|${(effectParts.object || "").toLowerCase().trim()}`;
    try {
      const res = await db.execute(sql`
        INSERT INTO causal_chains
          (tenant_id, cause_subject, cause_predicate, cause_object,
           effect_subject, effect_predicate, effect_object,
           confidence, time_lag_seconds, evidence_text, source_kind, chain_hash)
        VALUES
          (${tenantId},
           ${causeParts.subject}, ${causeParts.predicate ?? null}, ${causeParts.object},
           ${effectParts.subject}, ${effectParts.predicate ?? null}, ${effectParts.object},
           ${c.confidence}, ${c.time_lag_seconds ?? null}, ${c.evidence}, 'llm-extracted',
           md5(${hashSrc}))
        ON CONFLICT (tenant_id, chain_hash) DO NOTHING
        RETURNING id
      `);
      const newId = ((res as any).rows?.[0] as any)?.id;
      if (newId) inserted++;
      else skippedDup++;
    } catch (err) {
      logSilentCatch("server/causal-extractor.ts:insert", err);
    }
  }

  return { tenantId, scanned: items.length, chains: chainsAll.length, inserted, skippedDup } as ExtractionResult & { skippedDup: number };
}

export type CausalDirection = "forward" | "backward" | "both";

export async function queryCausalChain(
  tenantId: number,
  term: string,
  direction: CausalDirection = "both",
  limit = 10,
): Promise<Array<{
  id: number;
  causeSubject: string;
  causeObject: string;
  effectSubject: string;
  effectObject: string;
  confidence: number;
  timeLagSeconds: number | null;
  evidence: string;
  direction: "forward" | "backward";
}>> {
  const q = String(term || "").trim().slice(0, 200);
  if (!q) return [];
  const pattern = `%${q.replace(/[%_]/g, ch => "\\" + ch)}%`;

  const out: any[] = [];

  if (direction === "forward" || direction === "both") {
    // What does X cause? — match cause side, return effect.
    const r = await db.execute(sql`
      SELECT id, cause_subject, cause_object, effect_subject, effect_object,
             confidence, time_lag_seconds, evidence_text
      FROM causal_chains
      WHERE tenant_id = ${tenantId}
        AND (cause_subject ILIKE ${pattern} OR cause_object ILIKE ${pattern})
      ORDER BY confidence DESC, created_at DESC
      LIMIT ${limit}
    `);
    for (const row of r.rows as any[]) {
      out.push({
        id: row.id,
        causeSubject: row.cause_subject,
        causeObject: row.cause_object,
        effectSubject: row.effect_subject,
        effectObject: row.effect_object,
        confidence: Number(row.confidence),
        timeLagSeconds: row.time_lag_seconds,
        evidence: row.evidence_text,
        direction: "forward",
      });
    }
  }
  if (direction === "backward" || direction === "both") {
    // What causes X? — match effect side, return cause.
    const r = await db.execute(sql`
      SELECT id, cause_subject, cause_object, effect_subject, effect_object,
             confidence, time_lag_seconds, evidence_text
      FROM causal_chains
      WHERE tenant_id = ${tenantId}
        AND (effect_subject ILIKE ${pattern} OR effect_object ILIKE ${pattern})
      ORDER BY confidence DESC, created_at DESC
      LIMIT ${limit}
    `);
    for (const row of r.rows as any[]) {
      out.push({
        id: row.id,
        causeSubject: row.cause_subject,
        causeObject: row.cause_object,
        effectSubject: row.effect_subject,
        effectObject: row.effect_object,
        confidence: Number(row.confidence),
        timeLagSeconds: row.time_lag_seconds,
        evidence: row.evidence_text,
        direction: "backward",
      });
    }
  }
  // Dedup by id
  const byId = new Map<number, any>();
  for (const r of out) byId.set(r.id, r);
  return Array.from(byId.values()).slice(0, limit);
}
