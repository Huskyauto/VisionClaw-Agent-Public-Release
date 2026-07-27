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

import { logSilentCatch } from "./lib/silent-catch";
const WATERMARK_TITLE = "auto_memorize:watermark";
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

async function getWatermark(): Promise<Date> {
  try {
    const r: any = await db.execute(sql`
      SELECT content FROM agent_knowledge
      WHERE category = 'auto_memorize_watermark' AND title = ${WATERMARK_TITLE}
      ORDER BY id DESC
      LIMIT 1
    `);
    const ts = r.rows?.[0]?.content;
    if (ts) return new Date(String(ts));
  } catch (_silentErr) { logSilentCatch("server/auto-memorize.ts", _silentErr); }
  // Default to 6 hours back on first run
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

async function setWatermark(ts: Date): Promise<void> {
  try {
    const existing: any = await db.execute(sql`
      SELECT id FROM agent_knowledge
      WHERE category = 'auto_memorize_watermark' AND title = ${WATERMARK_TITLE}
      LIMIT 1
    `);
    if (existing.rows?.[0]?.id) {
      await db.execute(sql`
        UPDATE agent_knowledge SET content = ${ts.toISOString()}, updated_at = NOW()
        WHERE id = ${existing.rows[0].id}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO agent_knowledge (title, content, category, priority, tenant_id, source, created_at, updated_at)
        VALUES (${WATERMARK_TITLE}, ${ts.toISOString()}, 'auto_memorize_watermark', 1, 1, 'auto_memorize', NOW(), NOW())
      `);
    }
  } catch (e: any) {
    console.error("[auto-memorize] watermark write failed:", e.message);
  }
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
  try {
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
  } catch (_silentErr) { logSilentCatch("server/auto-memorize.ts", _silentErr); }
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

export async function runAutoMemorize(opts?: { force?: boolean; windowHours?: number }): Promise<AutoMemorizeResult> {
  if (_isRunning) {
    return { success: false, windowStart: "", windowEnd: "", messagesScanned: 0, lessonsProposed: 0, lessonsStored: 0, duplicatesSkipped: 0, redactionsApplied: [], error: "auto-memorize already running" };
  }
  _isRunning = true;
  try {
    return await _runAutoMemorizeInner(opts);
  } finally {
    _isRunning = false;
  }
}

async function _runAutoMemorizeInner(opts?: { force?: boolean; windowHours?: number }): Promise<AutoMemorizeResult> {
  const windowEnd = new Date();
  const windowStart = opts?.force
    ? new Date(Date.now() - (opts.windowHours || 6) * 60 * 60 * 1000)
    : await getWatermark();

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

  // 1. Pull recent user/assistant messages within the window.
  // R-tenant-isolation: select m.tenant_id so we can partition rows by tenant.
  // A single LLM prompt must NEVER mix messages from multiple tenants, so we
  // synthesize per-tenant below rather than concatenating one global transcript.
  let msgs: any;
  try {
    msgs = await db.execute(sql`
      SELECT m.tenant_id, m.role, m.content, m.created_at, c.title AS conv_title
      FROM messages m
      LEFT JOIN conversations c ON c.id = m.conversation_id
      WHERE m.created_at > ${windowStart.toISOString()}
        AND m.created_at <= ${windowEnd.toISOString()}
        AND m.role IN ('user','assistant')
      ORDER BY m.tenant_id ASC, m.created_at ASC
      LIMIT 400
    `);
  } catch (e: any) {
    result.error = `message read failed: ${e.message}`;
    return result;
  }

  const rows = msgs.rows || [];
  result.messagesScanned = rows.length;
  if (rows.length < 4) {
    result.success = true;
    if (!opts?.force) await setWatermark(windowEnd);
    return result;
  }

  // Partition rows by tenant so no prompt ever crosses a tenant boundary.
  const rowsByTenant = new Map<number, any[]>();
  for (const r of rows) {
    const tid = Number(r.tenant_id);
    if (!Number.isInteger(tid) || tid <= 0) continue; // fail closed on unscoped rows
    if (!rowsByTenant.has(tid)) rowsByTenant.set(tid, []);
    rowsByTenant.get(tid)!.push(r);
  }

  const { enqueueMemoryFact } = await import("./lib/memory-queue");
  const redactionsAll = new Set<string>();

  for (const [tenantId, tenantRows] of rowsByTenant) {
    if (tenantRows.length < 4) continue; // too little signal to synthesize for this tenant

    // 2. Build this tenant's transcript, redacting + capping
    const transcript = tenantRows
      .map((r: any) => `${r.role.toUpperCase()}: ${String(r.content || "").slice(0, 1200)}`)
      .join("\n");
    for (const red of listRedactionsFound(transcript)) redactionsAll.add(red);
    const safeTranscript = applyCaps(redactSecrets(transcript), { maxChars: 16000 });

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
      result.error = `synthesis failed (tenant ${tenantId}): ${r.error}`;
      continue;
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
  }

  result.redactionsApplied = [...redactionsAll];

  // 6. Advance watermark only on success (and only if not forced)
  if (!opts?.force) await setWatermark(windowEnd);

  result.success = true;
  return result;
}

// Throttle: don't run more than once every N minutes when called from heartbeat.
let _lastRun = 0;
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function maybeRunAutoMemorize(): Promise<AutoMemorizeResult | null> {
  const now = Date.now();
  if (now - _lastRun < MIN_INTERVAL_MS) return null;
  // Set a short retry-backoff first so we don't hammer if a crash recurs;
  // promote to full MIN_INTERVAL_MS only on success below.
  const SHORT_BACKOFF_MS = 5 * 60 * 1000;
  _lastRun = now - (MIN_INTERVAL_MS - SHORT_BACKOFF_MS);
  try {
    const r = await runAutoMemorize();
    _lastRun = Date.now(); // success → respect full 6h interval
    return r;
  } catch (e: any) {
    console.error("[auto-memorize] tick crashed:", e.message);
    return { success: false, windowStart: "", windowEnd: "", messagesScanned: 0, lessonsProposed: 0, lessonsStored: 0, duplicatesSkipped: 0, redactionsApplied: [], error: e.message };
  }
}
