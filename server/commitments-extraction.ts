/**
 * Open-loop / commitment mining (OpenClaw borrow, R125+137.22).
 *
 * Mines end-of-turn conversation text for OPEN LOOPS — user promises
 * ("I'll weigh in Monday"), agent promises ("I'll have the draft by
 * Friday"), and awaited third parties — and records them as `commitments`
 * rows so the existing heartbeat scanner (server/commitments.ts
 * scanAndEscalate) follows up when they come due.
 *
 * Design constraints:
 * - Fire-and-forget quality path: every failure is swallowed + logged; a
 *   mining failure must never break a chat turn (fail OPEN).
 * - Cheap: a regex cue pre-filter gates the LLM call, so most turns cost $0.
 * - Tenant fail-CLOSED: no tenantId ⇒ no write (mirrors
 *   intelligentExtractMemory).
 * - Dedupe: sha256 of the normalized description keyed per-tenant, so
 *   restating the same promise doesn't create a second open loop.
 */
// NOTE: db/providers are imported LAZILY inside mineCommitmentsFromTurn /
// extractOpenLoops so the pure helpers (cue filter, dedupe key, extraction
// with an injected client) stay importable from query-free unit tests
// without opening a pg pool (node:test exit-124 hang gotcha).
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "./lib/silent-catch";

// Cue pre-filter: only turns that plausibly contain a promise/open loop go
// to the LLM. Deliberately broad — false positives just cost one mini call.
const CUE_RE = /\b(i'?ll|i will|i promise|i'?m going to|remind me|follow up|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next week|end of (day|week|month))|due (on|by)|deadline|don'?t let me forget|waiting (on|for)|get back to (you|me))\b/i;

export interface MinedCommitment {
  description: string;
  who: "user" | "agent" | "third_party";
  dueAt: string | null;
  confidence: number;
  sensitivity: "routine" | "sensitive";
}

export function hasCommitmentCue(text: string): boolean {
  return CUE_RE.test(text || "");
}

export function commitmentDedupeKey(description: string): string {
  const normalized = (description || "").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

function rowsOf(result: any): any[] { return (result?.rows || result) || []; }

/** LLM extraction — exported for tests via injectable client. */
export async function extractOpenLoops(
  userMessage: string,
  assistantResponse: string,
  client?: { chat: { completions: { create: (args: any) => Promise<any> } } },
): Promise<MinedCommitment[]> {
  const llm = client ?? (await import("./providers")).replitOpenai;
  const resp = await llm.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: `You mine conversations for OPEN LOOPS: concrete promises or follow-ups someone committed to. Output JSON: {"loops": [{"description": "...", "who": "user|agent|third_party", "dueAt": "ISO-8601 or null", "stated": "explicit|implied", "sensitivity": "routine|sensitive"}]}

Rules:
- Only CONCRETE commitments with a clear action ("User will weigh in Monday morning", "Agent will deliver the draft PDF by Friday"). No vague intentions.
- "who": user = the human promised, agent = the assistant promised, third_party = someone else is being waited on.
- dueAt: resolve relative dates against now = ${new Date().toISOString()}; null if no time window was stated or implied.
- sensitivity "sensitive" for health, finances, legal, relationships; else "routine".
- Third-person phrasing. Max 3 loops. If none, return {"loops": []}.`,
      },
      {
        role: "user",
        content: `User said: "${(userMessage || "").slice(0, 700)}"\nAssistant responded: "${(assistantResponse || "").slice(0, 700)}"\n\nExtract open loops:`,
      },
    ],
    max_completion_tokens: 350,
    response_format: { type: "json_object" },
  });
  const content = resp.choices?.[0]?.message?.content;
  if (!content) return [];
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { return []; }
  return (Array.isArray(parsed.loops) ? parsed.loops : [])
    .filter((l: any) => typeof l?.description === "string" && l.description.trim().length > 10)
    .map((l: any): MinedCommitment => ({
      description: l.description.trim().slice(0, 500),
      who: l.who === "agent" || l.who === "third_party" ? l.who : "user",
      dueAt: typeof l.dueAt === "string" && !Number.isNaN(new Date(l.dueAt).getTime()) ? l.dueAt : null,
      confidence: l.stated === "explicit" ? 0.9 : 0.6,
      sensitivity: l.sensitivity === "sensitive" ? "sensitive" : "routine",
    }))
    .filter((l: MinedCommitment) => l.confidence >= 0.6)
    .slice(0, 3);
}

const MIN_CONFIDENCE_TO_STORE = 0.6;

/**
 * Post-turn fire-and-forget entry point. Callers MUST .catch() — this
 * function still guards internally so a throw can never surface.
 */
export interface MineDeps {
  /** Drizzle-shaped db (execute(sql) => {rows}) — injectable for query-free tests. */
  db?: { execute: (q: any) => Promise<any> };
  /** LLM client passed through to extractOpenLoops. */
  llmClient?: { chat: { completions: { create: (args: any) => Promise<any> } } };
}

export async function mineCommitmentsFromTurn(
  userMessage: string,
  assistantResponse: string,
  tenantId: number | undefined,
  persona?: string | null,
  deps: MineDeps = {},
): Promise<{ mined: number; stored: number }> {
  const out = { mined: 0, stored: 0 };
  try {
    if (tenantId == null || !Number.isInteger(tenantId) || tenantId <= 0) return out; // fail CLOSED on writes, OPEN on the turn
    const combined = `${userMessage}\n${assistantResponse}`;
    if (!hasCommitmentCue(combined)) return out;

    const loops = await extractOpenLoops(userMessage, assistantResponse, deps.llmClient);
    out.mined = loops.length;
    if (loops.length === 0) return out;
    const db = deps.db ?? (await import("./db")).db;
    // Storage-boundary redaction (same guard as memory/knowledge writes):
    // strips secrets / Luhn-valid CCs / SSNs from the mined description
    // before it lands in a durable store. Lazy import keeps pure helpers
    // importable from query-free tests.
    const { redactPiiForStorage } = await import("./storage-helpers/pii-redaction-guard");
    for (const loop of loops) {
      if (loop.confidence < MIN_CONFIDENCE_TO_STORE) continue;
      const safeDescription = redactPiiForStorage(loop.description).redacted.slice(0, 500);
      const dedupeKey = commitmentDedupeKey(safeDescription);
      try {
        // Dedupe is enforced at the DB level by the unique partial index
        // commitments_tenant_dedupe_active_uidx ON (tenant_id, dedupe_key)
        // WHERE dedupe_key IS NOT NULL AND status IN ('active','escalated'),
        // so concurrent turns can't race a duplicate past a check-then-insert.
        const inserted = await db.execute(sql`
          INSERT INTO commitments (tenant_id, persona, description, due_at, heartbeat_interval_ms, status, evidence, source, dedupe_key, confidence, sensitivity)
          VALUES (${tenantId}, ${persona ? String(persona).slice(0, 80) : null},
                  ${`[${loop.who}] ${safeDescription}`}, ${loop.dueAt ? new Date(loop.dueAt) : null},
                  ${24 * 60 * 60 * 1000}, 'active', '[]'::jsonb,
                  'mined', ${dedupeKey}, ${loop.confidence}, ${loop.sensitivity})
          ON CONFLICT (tenant_id, dedupe_key)
            WHERE dedupe_key IS NOT NULL AND status IN ('active', 'escalated')
          DO NOTHING
          RETURNING id`);
        if (rowsOf(inserted).length > 0) out.stored++;
      } catch (_silentErr) { logSilentCatch("server/commitments-extraction.ts", _silentErr); }
    }
    if (out.stored > 0) console.log(`[commitments] mined ${out.stored} open loop(s) from turn (tenant ${tenantId})`);
  } catch (_silentErr) { logSilentCatch("server/commitments-extraction.ts", _silentErr); }
  return out;
}
