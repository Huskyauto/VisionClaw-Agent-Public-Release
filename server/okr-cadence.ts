/**
 * Autonomous OKR cadence (R125+14 — Manus agentic gap #2).
 *
 * Wires the EXEC-06 "Goal Setting & OKR Management" scaffold to the heartbeat so
 * the company reviews its objectives on a fixed rhythm WITHOUT a human prompt.
 * Once per cadence window (default weekly) Felix recalls the current OKRs from
 * memory, assesses on-track/at-risk/off-track, proposes next-period adjustments,
 * stores the scorecard back to memory, and emits an `okr.reviewed` event.
 *
 * Throttle state is derived from the last source='okr-cadence' memory entry — no
 * extra table. Runs only for the admin tenant by default (the company itself);
 * per-tenant OKR cadence can be layered on later.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { runLlmTask } from "./llm-task";
import { emitEvent } from "./event-bus";
import { ADMIN_TENANT_ID } from "./tenant-utils";
import { OPERATION_SCAFFOLDS } from "./scaffolding";
import { logSilentCatch } from "./lib/silent-catch";

const CADENCE_DAYS = Number(process.env.OKR_CADENCE_DAYS || 7);
const FELIX_PERSONA_ID = 2;

async function lastReviewAgeDays(tenantId: number): Promise<number | null> {
  const r: any = await db.execute(sql`
    SELECT created_at FROM memory_entries
    WHERE tenant_id = ${tenantId} AND source = 'okr-cadence' AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = (r.rows ?? r)[0];
  if (!row) return null;
  return (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
}

async function recallCurrentOkrs(tenantId: number): Promise<string[]> {
  const r: any = await db.execute(sql`
    SELECT fact FROM memory_entries
    WHERE tenant_id = ${tenantId} AND status = 'active'
      AND (room ILIKE '%okr%' OR room ILIKE '%goal%' OR fact ILIKE '%objective%' OR fact ILIKE '%key result%' OR source = 'okr-cadence')
    ORDER BY created_at DESC LIMIT 25
  `);
  return ((r.rows ?? r) as any[]).map(x => x.fact).filter(Boolean);
}

export interface OkrReviewResult {
  ran: boolean;
  reason?: string;
  scorecard?: string;
  objectives?: { objective: string; status: string; owner?: string }[];
}

export async function runOkrReview(tenantId: number, force = false): Promise<OkrReviewResult> {
  try {
    if (!force) {
      const age = await lastReviewAgeDays(tenantId);
      if (age != null && age < CADENCE_DAYS) {
        return { ran: false, reason: `last review ${age.toFixed(1)}d ago (<${CADENCE_DAYS}d)` };
      }
    }

    const current = await recallCurrentOkrs(tenantId);
    const scaffold = OPERATION_SCAFFOLDS.find(s => s.operationId === "EXEC-06");
    const steps = scaffold?.stepSequence?.join("\n- ") ?? "Recall OKRs, assess progress, propose next period, assign owners.";

    const prompt = `You are Felix, CEO of an autonomous AI corporation, running the periodic OKR review (EXEC-06).

Current OKRs and goal-related facts from company memory:
${current.length ? current.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none on record yet — bootstrap an initial OKR set from first principles for an AI services company)"}

Run this sequence:
- ${steps}

Return STRICT JSON:
{
  "scorecard": "2-4 sentence assessment of current-period progress",
  "objectives": [
    { "objective": "string", "status": "on_track|at_risk|off_track|new", "owner": "persona name", "keyResults": ["measurable KR"] }
  ],
  "nextActions": ["1-3 concrete next-period actions"]
}
Every key result MUST be measurable and every objective MUST have an owner.`;

    const res = await runLlmTask({
      prompt,
      model: "anthropic/claude-sonnet-4.5",
      temperature: 0.3,
      maxTokens: 1400,
      timeoutMs: 90_000,
      tenantId,
      schema: {
        type: "object",
        properties: {
          scorecard: { type: "string" },
          objectives: {
            type: "array",
            items: {
              type: "object",
              properties: {
                objective: { type: "string" },
                status: { type: "string" },
                owner: { type: "string" },
                keyResults: { type: "array", items: { type: "string" } },
              },
              required: ["objective", "status"],
            },
          },
          nextActions: { type: "array", items: { type: "string" } },
        },
        required: ["scorecard", "objectives"],
      },
    });

    if (!res.success || !res.json) {
      return { ran: false, reason: `LLM review failed: ${res.error ?? "no json"}` };
    }

    const out = res.json as {
      scorecard: string;
      objectives: { objective: string; status: string; owner?: string; keyResults?: string[] }[];
      nextActions?: string[];
    };

    // Persist the scorecard + each objective as durable memory for the next cadence.
    await storage.createMemoryEntry({
      fact: `OKR review ${new Date().toISOString().slice(0, 10)}: ${out.scorecard}`,
      category: "goal",
      source: "okr-cadence",
      tenantId,
      personaId: FELIX_PERSONA_ID,
      wing: "executive",
      room: "okrs",
    } as any).catch(e => logSilentCatch("server/okr-cadence.ts", e));

    for (const o of out.objectives.slice(0, 12)) {
      await storage.createMemoryEntry({
        fact: `OKR [${o.status}] ${o.objective}${o.owner ? ` — owner: ${o.owner}` : ""}${o.keyResults?.length ? ` | KRs: ${o.keyResults.join("; ")}` : ""}`,
        category: "goal",
        source: "okr-cadence",
        tenantId,
        personaId: FELIX_PERSONA_ID,
        wing: "executive",
        room: "okrs",
      } as any).catch(e => logSilentCatch("server/okr-cadence.ts", e));
    }

    await emitEvent({
      type: "okr.reviewed", source: "okr-cadence", tenantId,
      data: { scorecard: out.scorecard, objectiveCount: out.objectives.length, nextActions: out.nextActions ?? [] },
    }).catch(e => logSilentCatch("server/okr-cadence.ts", e));

    return {
      ran: true,
      scorecard: out.scorecard,
      objectives: out.objectives.map(o => ({ objective: o.objective, status: o.status, owner: o.owner })),
    };
  } catch (e) {
    logSilentCatch("server/okr-cadence.ts", e);
    return { ran: false, reason: String(e).slice(0, 160) };
  }
}

/** Heartbeat-callable. Throttled by CADENCE_DAYS; only runs the admin tenant. */
export async function maybeRunOkrCadence(): Promise<{ ran: boolean }> {
  const res = await runOkrReview(ADMIN_TENANT_ID, false);
  return { ran: res.ran };
}
