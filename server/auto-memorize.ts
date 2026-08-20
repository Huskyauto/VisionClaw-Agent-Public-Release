// Auto-memorize — periodic synthesis of the recent conversation stream
// into structured long-term memories. Runs from the heartbeat (every N hours).
//
// Pipeline:
//  1. Read messages from the last window (default 6h) we haven't yet processed.
//  2. Redact secrets, cap sizes.
//  3. Ask a cheap model to extract 0-5 high-signal lessons (errors, fixes,
//     preferences, decisions) as structured JSON.
//  4. Dedup against recent memory_entries (Jaccard token overlap).
//  5. Insert survivors via existing memory_entries with source='auto_memorize'.
//  6. Stamp a "watermark" in agent_knowledge so we don't re-process.
//
// Zero schema changes. Safe to run unattended.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { runLlmTask } from "./llm-task";
import { redactSecrets, applyCaps, listRedactionsFound } from "./redactor";

const WATERMARK_TITLE = "auto_memorize:watermark";
const MAX_MESSAGE_CONTENT_CHARS = 1_200;
const MAX_MESSAGES_PER_BATCH = 12;
const MAX_TRANSCRIPT_CHARS = 16_000;
let _isRunning = false; // module-level mutex — only one auto-memorize pass at a time per process
const SCHEMA = {
  type: "object",
  required: ["lessons"],
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        required: ["fact", "kind"],
        properties: {
          fact: { type: "string" },
          kind: { type: "string" }, // pattern | decision | preference | observation
          why: { type: "string" },
          // R98.19: per-fact confidence (0..1). The queue gate drops any
          // fact below MEMORY_FACT_CONFIDENCE_THRESHOLD (default 0.7).
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

interface Watermark {
  at: Date;
  afterMessageId: number | null;
}

function initialWatermark(): Watermark {
  return { at: new Date(Date.now() - 6 * 60 * 60 * 1000), afterMessageId: null };
}

async function getWatermark(tenantId: number): Promise<Watermark> {
  const r: any = await db.execute(sql`
    SELECT content FROM agent_knowledge
    WHERE category = 'auto_memorize_watermark' AND title = ${WATERMARK_TITLE}
      AND tenant_id = ${tenantId}
    ORDER BY id DESC
    LIMIT 1
  `);
  const raw = r.rows?.[0]?.content;
  if (!raw) return initialWatermark();

  // Older rows stored a bare ISO string. New rows add an ID tie-breaker so a
  // full 400-row page can resume without skipping equal-timestamp messages.
  const parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : { at: raw };
  const at = new Date(String(parsed.at));
  if (Number.isNaN(at.getTime())) {
    throw new Error(`invalid auto-memorize watermark for tenant ${tenantId}`);
  }
  const afterMessageId = Number.isInteger(parsed.afterMessageId) && parsed.afterMessageId > 0
    ? parsed.afterMessageId
    : null;
  return { at, afterMessageId };
}

async function setWatermark(tenantId: number, watermark: Watermark): Promise<void> {
  const content = JSON.stringify({
    at: watermark.at.toISOString(),
    afterMessageId: watermark.afterMessageId,
  });
  const updated: any = await db.execute(sql`
    UPDATE agent_knowledge
    SET content = ${content}, updated_at = NOW()
    WHERE id = (
      SELECT id FROM agent_knowledge
      WHERE category = 'auto_memorize_watermark' AND title = ${WATERMARK_TITLE}
        AND tenant_id = ${tenantId}
      ORDER BY id DESC
      LIMIT 1
    ) AND tenant_id = ${tenantId}
    RETURNING id
  `);
  if ((updated.rows || updated || []).length > 0) return;

  const inserted: any = await db.execute(sql`
    INSERT INTO agent_knowledge (title, content, category, priority, tenant_id, source, created_at, updated_at)
    VALUES (${WATERMARK_TITLE}, ${content}, 'auto_memorize_watermark', 1, ${tenantId}, 'auto_memorize', NOW(), NOW())
    RETURNING id
  `);
  if ((inserted.rows || inserted || []).length === 0) {
    throw new Error(`failed to persist auto-memorize watermark for tenant ${tenantId}`);
  }
}

function nextWatermark(rows: any[], windowEnd: Date): Watermark {
  if (rows.length >= MAX_MESSAGES_PER_BATCH) {
    const last = rows[rows.length - 1];
    const at = new Date(last.created_at);
    const afterMessageId = Number(last.id);
    if (!Number.isNaN(at.getTime()) && Number.isInteger(afterMessageId) && afterMessageId > 0) {
      return { at, afterMessageId };
    }
    throw new Error("auto-memorize page is missing a stable message cursor");
  }
  return { at: windowEnd, afterMessageId: null };
}

// R98.19: whitespace-normalize before tokenizing so dedup doesn't miss the
// same fact written with different spacing/casing.
function normalizeForJaccard(s: string): string {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function jaccard(a: string, b: string): number {
  const ta = new Set(normalizeForJaccard(a).split(/\W+/).filter((w) => w.length > 3));
  const tb = new Set(normalizeForJaccard(b).split(/\W+/).filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

async function isDuplicate(fact: string, tenantId: number): Promise<boolean> {
  const recent: any = await db.execute(sql`
    SELECT fact FROM memory_entries
    WHERE created_at > NOW() - INTERVAL '60 days'
      AND tenant_id = ${tenantId}
    ORDER BY id DESC LIMIT 200
  `);
  const norm = normalizeForJaccard(fact);
  for (const row of (recent.rows || [])) {
    const rowNorm = normalizeForJaccard(String(row.fact || ""));
    if (rowNorm === norm) return true; // R98.19: exact normalized match
    if (jaccard(String(row.fact || ""), fact) > 0.5) return true;
  }
  return false;
}

export interface AutoMemorizeResult {
  success: boolean;
  windowStart: string;
  windowEnd: string;
  messagesScanned: number;
  lessonsProposed: number;
  lessonsStored: number;
  duplicatesSkipped: number;
  redactionsApplied: string[];
  error?: string;
}

export async function runAutoMemorizeForTenant(
  tenantId: number,
  opts?: { force?: boolean; windowHours?: number },
): Promise<AutoMemorizeResult> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return {
      success: false,
      windowStart: "",
      windowEnd: "",
      messagesScanned: 0,
      lessonsProposed: 0,
      lessonsStored: 0,
      duplicatesSkipped: 0,
      redactionsApplied: [],
      error: "valid tenant context is required",
    };
  }
  if (_isRunning) {
    return { success: false, windowStart: "", windowEnd: "", messagesScanned: 0, lessonsProposed: 0, lessonsStored: 0, duplicatesSkipped: 0, redactionsApplied: [], error: "auto-memorize already running" };
  }
  _isRunning = true;
  try {
    return await runAutoMemorizeForTenantInner(tenantId, opts);
  } catch (e: any) {
    console.error(`[auto-memorize] tenant ${tenantId} failed:`, e?.message || String(e));
    return {
      success: false,
      windowStart: "",
      windowEnd: "",
      messagesScanned: 0,
      lessonsProposed: 0,
      lessonsStored: 0,
      duplicatesSkipped: 0,
      redactionsApplied: [],
      error: e?.message || String(e),
    };
  } finally {
    _isRunning = false;
  }
}

async function runAutoMemorizeForTenantInner(
  tenantId: number,
  opts?: { force?: boolean; windowHours?: number },
): Promise<AutoMemorizeResult> {
  const windowEnd = new Date();
  const watermark = opts?.force
    ? { at: new Date(Date.now() - (opts.windowHours || 6) * 60 * 60 * 1000), afterMessageId: null }
    : await getWatermark(tenantId);
  const windowStart = watermark.at;

  const result: AutoMemorizeResult = {
    success: false,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    messagesScanned: 0,
    lessonsProposed: 0,
    lessonsStored: 0,
    duplicatesSkipped: 0,
    redactionsApplied: [],
  };

  // 1. Pull only this tenant's recent user/assistant messages. The platform
  // worker discovers IDs first, then calls this function once per tenant, so
  // no code path holds content from multiple tenants at the same time.
  let msgs: any;
  try {
    msgs = await db.execute(sql`
      SELECT m.id, m.role, m.content, m.created_at, c.title AS conv_title
      FROM messages m
      LEFT JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId}
        AND (
          m.created_at > ${windowStart.toISOString()}
          OR (m.created_at = ${windowStart.toISOString()} AND m.id > ${watermark.afterMessageId ?? 0})
        )
        AND m.created_at <= ${windowEnd.toISOString()}
        AND m.role IN ('user','assistant')
      ORDER BY m.created_at ASC, m.id ASC
       LIMIT ${MAX_MESSAGES_PER_BATCH}
    `);
  } catch (e: any) {
    result.error = `message read failed: ${e.message}`;
    return result;
  }

  const rows = msgs.rows || [];
  result.messagesScanned = rows.length;
  if (rows.length < 4) {
    // Keep sparse activity in this tenant's next window. Advancing here would
    // permanently discard the first few messages before they can combine with
    // later context into a useful, safely synthesized lesson.
    result.success = true;
    return result;
  }

  const { enqueueMemoryFact, flushNow } = await import("./lib/memory-queue");
  const redactionsAll = new Set<string>();

  // 2. Build this tenant's transcript, redacting + capping.
  const transcript = rows
    .map((r: any) => `${r.role.toUpperCase()}: ${String(r.content || "").slice(0, MAX_MESSAGE_CONTENT_CHARS)}`)
    .join("\n");
  for (const red of listRedactionsFound(transcript)) redactionsAll.add(red);
  const safeTranscript = redactSecrets(transcript);
  if (safeTranscript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error("auto-memorize transcript exceeded its bounded batch budget");
  }

  // 3. Synthesize (one prompt = one tenant's messages only)
  const prompt = `You are scanning a recent conversation transcript and extracting durable lessons worth remembering for future sessions. Focus on:
- Concrete user preferences ("Bob prefers metric units")
- Technical decisions made ("we chose Twilio over Vonage because…")
- Recurring error patterns and their fixes
- Project facts that aren't obvious from code (owner, billing, deadlines, integrations)

Skip: small talk, one-off chitchat, anything that doesn't help future-you.
Return 0-5 lessons. If nothing is worth remembering, return an empty array.

For each lesson, include a "confidence" between 0 and 1 reflecting how
sure you are this is durable, generalizable, and worth remembering. Use:
  • 0.95 — explicit, repeated, unambiguous (e.g. "Bob said three times he prefers metric units")
  • 0.85 — clear single-instance signal with no contradiction
  • 0.75 — likely durable but inferred from one example
  • 0.60 — speculative; only one weak signal
  • <0.50 — don't bother emitting it; the queue will drop it
Lessons below the platform threshold (default 0.7) are dropped at write time.

Transcript:
${safeTranscript}

Return ONLY JSON: {"lessons":[{"fact":"single sentence ≤200 chars","kind":"pattern|decision|preference|observation","why":"≤120 char justification","confidence":0.0_to_1.0}]}`;

  const r = await runLlmTask({
    prompt,
    schema: SCHEMA,
    model: "gemini-2.5-flash",
    temperature: 0.3,
    maxTokens: 1200,
    timeoutMs: 30000,
    // Cost attributed to the tenant whose messages are being synthesized.
    tenantId,
  });

  if (!r.success || !r.json?.lessons) {
    result.error = `synthesis failed: ${r.error}`;
    return result;
  }

  const lessons: Array<{ fact: string; kind: string; why?: string; confidence?: number }> = (r.json.lessons || []).slice(0, 5);
  result.lessonsProposed += lessons.length;

  // 4. Dedup + 5. Enqueue (R98.19: route through debounced queue)
  for (const l of lessons) {
    const fact = applyCaps(redactSecrets(l.fact), { maxChars: 220 });
    if (!fact || fact.length < 8) continue;
    if (await isDuplicate(fact, tenantId)) { result.duplicatesSkipped++; continue; }
    const conf = typeof l.confidence === "number" && Number.isFinite(l.confidence)
      ? Math.max(0, Math.min(1, l.confidence))
      : 0.75; // sensible default if model omits the field
    const category = ["pattern", "decision", "preference", "observation"].includes(l.kind) ? l.kind : "observation";
    const enq = enqueueMemoryFact({
      tenantId,
      personaId: null,
      fact,
      category,
      source: "auto_memorize",
      confidence: conf,
      confidenceSource: "llm_self_reported",
    });
    if (enq.ok) result.lessonsStored++;
    else if (enq.reason === "below_threshold") result.duplicatesSkipped++;
  }

  // A successful enqueue is not a successful durable write. This background
  // batch owns its watermark, so force the queue to finish before advancing it.
  await flushNow({ throwOnError: true });
  result.redactionsApplied = [...redactionsAll];

  // 6. Advance only this tenant's watermark after its complete success.
  if (!opts?.force) await setWatermark(tenantId, nextWatermark(rows, windowEnd));

  result.success = true;
  return result;
}

