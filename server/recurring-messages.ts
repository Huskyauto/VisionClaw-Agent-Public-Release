// Recurring Messages — natural-language scheduling + multi-platform delivery.
// Pattern from NousResearch/hermes-agent: "every Monday at 7am send Bob a
// weekly weigh-in prompt via WhatsApp" → parsed → cron → delivered.
//
// Storage: agent_knowledge with category='recurring_message' (existing table).
// Execution: piggybacks on the existing heartbeat tick — every minute we
// scan for due jobs and deliver via the messaging-gateway.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { deliverMessage, type DeliveryTarget, type Channel } from "./messaging-gateway";

import { logSilentCatch } from "./lib/silent-catch";
export interface ScheduledMessage {
  id: number;
  title: string;
  cron: string;
  prompt: string;          // either a literal message or a prompt to be expanded by the persona
  expandViaPersona?: number; // if set, run prompt through this persona before sending
  target: DeliveryTarget;
  nextRunAt: string;
  lastRunAt?: string;
  status: "active" | "paused";
  tenantId: number;
}

interface PayloadShape {
  cron: string;
  prompt: string;
  target: DeliveryTarget;
  expandViaPersona?: number;
  nextRunAt: string;
  lastRunAt?: string;
  status: "active" | "paused";
}

// ---------------------------------------------------------------------------
// Natural language → cron parser. Tries cron-utils LLM helper first, then
// falls back to a deterministic regex-based parser for the common patterns.
// ---------------------------------------------------------------------------

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseNaturalSchedule(text: string, tz = "America/Chicago"): { cron: string; humanReadable: string } | null {
  const t = text.toLowerCase().trim();

  // "every day at 7am", "daily at 7:30 am"
  let m = t.match(/(?:every day|daily|each day).*?(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    const hr = to24h(m[1], m[3]); const mn = m[2] || "0";
    return { cron: `${mn} ${hr} * * *`, humanReadable: `Every day at ${formatTime(hr, mn)} (${tz})` };
  }

  // "every monday at 9am", "every mon at 9", "weekly on monday at 9"
  m = t.match(/(?:every|each|weekly on)\s+(sun|mon|tue|wed|thu|fri|sat)\w*\b.*?(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    const dow = DAYS[m[1]]; const hr = to24h(m[2], m[4]); const mn = m[3] || "0";
    return { cron: `${mn} ${hr} * * ${dow}`, humanReadable: `Every ${capitalize(m[1])} at ${formatTime(hr, mn)} (${tz})` };
  }

  // "every weekday at 8am"
  m = t.match(/(?:every weekday|weekdays).*?(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    const hr = to24h(m[1], m[3]); const mn = m[2] || "0";
    return { cron: `${mn} ${hr} * * 1-5`, humanReadable: `Every weekday at ${formatTime(hr, mn)} (${tz})` };
  }

  // "every N hours", "hourly"
  if (/\bhourly\b/.test(t)) return { cron: "0 * * * *", humanReadable: "Every hour" };
  m = t.match(/every (\d+) hours?/);
  if (m) return { cron: `0 */${m[1]} * * *`, humanReadable: `Every ${m[1]} hours` };

  // "every N minutes"
  m = t.match(/every (\d+) minutes?/);
  if (m) return { cron: `*/${m[1]} * * * *`, humanReadable: `Every ${m[1]} minutes` };

  // Fall through — let caller try LLM parse
  return null;
}

function to24h(h: string, ampm?: string): string {
  let n = parseInt(h, 10);
  if (ampm === "pm" && n < 12) n += 12;
  if (ampm === "am" && n === 12) n = 0;
  return String(n);
}
function formatTime(h: string, m: string): string {
  const hr = parseInt(h, 10); const mn = m.padStart(2, "0");
  const ampm = hr >= 12 ? "PM" : "AM"; const h12 = hr % 12 || 12;
  return `${h12}:${mn} ${ampm}`;
}
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// Compute next run from cron string. Uses cron-parser if available.
async function computeNextRun(cron: string, from: Date = new Date()): Promise<Date> {
  try {
    const cp: any = await import("cron-parser").catch(() => null);
    if (cp) {
      const interval = (cp.default || cp).parseExpression(cron, { currentDate: from, tz: "America/Chicago" });
      return interval.next().toDate();
    }
  } catch (_silentErr) { logSilentCatch("server/recurring-messages.ts", _silentErr); }
  // Fallback: just add an hour so we don't lose the job entirely.
  return new Date(from.getTime() + 60 * 60_000);
}

// ---------------------------------------------------------------------------
// CRUD on scheduled messages (stored in agent_knowledge)
// ---------------------------------------------------------------------------

export async function createScheduledMessage(input: {
  title: string;
  cron?: string;
  naturalSchedule?: string;
  prompt: string;
  target: DeliveryTarget;
  expandViaPersona?: number;
  tenantId?: number;
}): Promise<{ success: boolean; scheduled?: ScheduledMessage; error?: string }> {
  try {
    let cron = input.cron;
    if (!cron && input.naturalSchedule) {
      const parsed = parseNaturalSchedule(input.naturalSchedule);
      if (!parsed) return { success: false, error: `Could not parse schedule: "${input.naturalSchedule}". Try a literal cron expression.` };
      cron = parsed.cron;
    }
    if (!cron) return { success: false, error: "cron or naturalSchedule required" };

    const nextRun = await computeNextRun(cron);
    const payload: PayloadShape = {
      cron,
      prompt: input.prompt,
      target: input.target,
      expandViaPersona: input.expandViaPersona,
      nextRunAt: nextRun.toISOString(),
      status: "active",
    };
    const tenantId = input.tenantId;
    if (!tenantId || typeof tenantId !== "number") {
      return { success: false, error: "tenantId is required for createScheduledMessage (R95.b cross-tenant isolation guard)" };
    }
    const inserted: any = await db.execute(sql`
      INSERT INTO agent_knowledge (title, content, category, priority, tenant_id, source)
      VALUES (${input.title}, ${JSON.stringify(payload)}, 'recurring_message', 4, ${tenantId}, 'cron_scheduler')
      RETURNING id
    `);
    return {
      success: true,
      scheduled: {
        id: inserted.rows[0].id,
        title: input.title,
        cron,
        prompt: input.prompt,
        target: input.target,
        expandViaPersona: input.expandViaPersona,
        nextRunAt: payload.nextRunAt,
        status: "active",
        tenantId,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function listScheduledMessages(opts: { tenantId: number; activeOnly?: boolean } | { tenantId?: number; activeOnly?: boolean; _allowGlobalSystemUseOnly: true }): Promise<ScheduledMessage[]> {
  // R95.b — fail-closed cross-tenant guard. Caller must either pass a numeric
  // tenantId, or explicitly opt into the unscoped global view via the
  // `_allowGlobalSystemUseOnly` flag (used only by the cron runner inside this
  // file, which then enforces tenant context per-row before delivery).
  const isGlobal = (opts as any)._allowGlobalSystemUseOnly === true;
  const tenantId = (opts as any).tenantId;
  if (!isGlobal && (!tenantId || typeof tenantId !== "number")) {
    throw new Error("listScheduledMessages requires numeric tenantId (R95.b cross-tenant isolation guard)");
  }
  const rows: any = await db.execute(sql`
    SELECT id, title, content, tenant_id
    FROM agent_knowledge
    WHERE category = 'recurring_message'
      ${tenantId && typeof tenantId === "number" ? sql`AND tenant_id = ${tenantId}` : sql``}
    ORDER BY id DESC
  `);
  return (rows.rows || []).map((r: any) => {
    let p: PayloadShape = {} as any; try { p = JSON.parse(r.content); } catch (_silentErr) { logSilentCatch("server/recurring-messages.ts", _silentErr); }
    return {
      id: r.id, title: r.title, cron: p.cron, prompt: p.prompt, target: p.target,
      expandViaPersona: p.expandViaPersona, nextRunAt: p.nextRunAt, lastRunAt: p.lastRunAt,
      status: p.status || "active", tenantId: r.tenant_id,
    };
  }).filter((s: ScheduledMessage) => !opts?.activeOnly || s.status === "active");
}

export async function cancelScheduledMessage(id: number, tenantId?: number): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== "number") {
    return { success: false, error: "tenantId is required for cancelScheduledMessage (R95.b cross-tenant isolation guard)" };
  }
  try {
    const result: any = await db.execute(sql`
      UPDATE agent_knowledge
      SET category = 'recurring_message_cancelled', updated_at = NOW()
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND category IN ('recurring_message', 'recurring_message_paused')
    `);
    const rowCount = (result as any).rowCount ?? (result as any).rows?.length ?? 0;
    if (rowCount === 0) {
      return { success: false, error: `Scheduled message ${id} not found in this tenant` };
    }
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

export async function pauseScheduledMessage(id: number, paused: boolean, tenantId?: number): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== "number") {
    return { success: false, error: "tenantId is required for pauseScheduledMessage (R95.b cross-tenant isolation guard)" };
  }
  try {
    const row: any = await db.execute(sql`SELECT content FROM agent_knowledge WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`);
    if (!row.rows?.[0]) return { success: false, error: `No scheduled message ${id} in this tenant` };
    let p: PayloadShape = {} as any; try { p = JSON.parse(row.rows[0].content); } catch (_silentErr) { logSilentCatch("server/recurring-messages.ts", _silentErr); }
    p.status = paused ? "paused" : "active";
    const result: any = await db.execute(sql`UPDATE agent_knowledge SET content = ${JSON.stringify(p)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`);
    const rowCount = (result as any).rowCount ?? (result as any).rows?.length ?? 0;
    if (rowCount === 0) return { success: false, error: `Pause failed: row ${id} not found in this tenant` };
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ---------------------------------------------------------------------------
// The runner — called from the heartbeat every minute. Finds due jobs,
// expands prompt via persona if needed, delivers via gateway, advances cron.
// ---------------------------------------------------------------------------

// Module-level mutex — prevents overlap if a tick takes longer than the
// heartbeat interval. Single-process Node, so a boolean is sufficient.
let _runnerBusy = false;

export async function runDueScheduledMessages(): Promise<{ fired: number; errors: number }> {
  if (_runnerBusy) return { fired: 0, errors: 0 };
  _runnerBusy = true;
  try {
    return await _runDueInner();
  } finally {
    _runnerBusy = false;
  }
}

async function _runDueInner(): Promise<{ fired: number; errors: number }> {
  const now = new Date();
  let rows: any;
  try {
    rows = await db.execute(sql`
    SELECT id, title, content, tenant_id
    FROM agent_knowledge
    WHERE category = 'recurring_message'
    LIMIT 500
  `).catch(() => ({ rows: [] }));
  } catch (e: any) {
    console.error("[recurring] outer query failed:", e.message);
    return { fired: 0, errors: 1 };
  }

  let fired = 0, errors = 0;
  for (const r of (rows.rows || [])) {
    let p: PayloadShape = {} as any; try { p = JSON.parse(r.content); } catch { continue; }
    if (p.status !== "active" || !p.nextRunAt) continue;
    const due = new Date(p.nextRunAt);
    if (due > now) continue;

    try {
      let messageText = p.prompt;
      if (p.expandViaPersona) {
        try {
          const { processMessage } = await import("./chat-engine");
          const { db: ddb } = await import("./db");
          // Use a hidden conversation per scheduled job.
          const convTitle = `__scheduled_${r.id}`;
          const conv: any = await ddb.execute(sql`SELECT id FROM conversations WHERE title = ${convTitle} AND tenant_id = ${r.tenant_id} LIMIT 1`);
          let convId = conv.rows?.[0]?.id;
          if (!convId) {
            const ins: any = await ddb.execute(sql`INSERT INTO conversations (title, tenant_id, persona_id) VALUES (${convTitle}, ${r.tenant_id}, ${p.expandViaPersona}) RETURNING id`);
            convId = ins.rows[0].id;
          }
          const result: any = await processMessage(convId, p.prompt, { source: "scheduler" });
          messageText = String(result?.response || result?.message || p.prompt);
        } catch (e) {
          console.error(`[recurring] persona expand failed for #${r.id}:`, e);
        }
      }

      const delivery = await deliverMessage(p.target, messageText.slice(0, 4000));
      const next = await computeNextRun(p.cron, now);
      const updated: PayloadShape = { ...p, lastRunAt: now.toISOString(), nextRunAt: next.toISOString() };
      await db.execute(sql`UPDATE agent_knowledge SET content = ${JSON.stringify(updated)}, updated_at = NOW() WHERE id = ${r.id}`);

      if (delivery.success) fired++;
      else { errors++; console.error(`[recurring] delivery failed for #${r.id}:`, delivery.error); }
    } catch (e: any) {
      errors++;
      console.error(`[recurring] job #${r.id} error:`, e.message);
    }
  }
  return { fired, errors };
}
