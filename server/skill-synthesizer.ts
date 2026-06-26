// Self-Improving Skill Loop — patterns from NousResearch/hermes-agent.
//
// After a task completes successfully, an agent reviews the trajectory and
// proposes a "skill candidate" — a reusable playbook for future similar
// tasks. Candidates are stored in agent_knowledge with category='skill_candidate'
// (existing table, no schema change). They start as DRAFT; once a human (or
// supervisor agent) approves, the skill is promoted to category='skill'
// and surfaces to the persona's tools_doc on next sync.
//
// "Nudge yourself": between turns, the agent can also synthesize a memory
// entry — "I noticed Bob prefers metric units" → memory_entries — without
// being explicitly asked.

import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
export interface SkillCandidate {
  id: number;
  title: string;
  trigger: string;        // when should this skill activate
  steps: string[];        // ordered playbook
  toolsUsed: string[];    // tool names referenced
  evidence: string;       // what task produced this candidate
  personaId?: number;
  status: "draft" | "approved" | "rejected";
  createdAt: string;
}

export interface SynthesizeInput {
  taskSummary: string;          // short description of what was accomplished
  userMessage?: string;         // original user message that started the task
  toolsUsed?: string[];         // names of tools called during the task
  outcome?: string;             // what was delivered / outcome
  personaId?: number;
  tenantId?: number;
  conversationId?: number;
}

// Use the LLM to synthesize a skill from a trajectory. Falls back to a
// deterministic stub if no LLM is reachable, so the loop is always closeable.
async function llmSynthesize(input: SynthesizeInput): Promise<{ title: string; trigger: string; steps: string[] } | null> {
  try {
    // @ts-ignore - optional dynamic module
    const { callLLM } = await import("./llm-router").catch(() => ({} as any));
    if (!callLLM) return null;
    const prompt = `You are a skill synthesizer. Review this completed task and propose a reusable skill (playbook) for next time a similar task arrives.

TASK: ${input.taskSummary}
USER ASKED: ${input.userMessage || "(not recorded)"}
TOOLS USED: ${(input.toolsUsed || []).join(", ") || "(none)"}
OUTCOME: ${input.outcome || "(not recorded)"}

Respond with ONLY a JSON object:
{
  "title": "short skill name (3-6 words)",
  "trigger": "one sentence describing WHEN to use this skill (the user signal)",
  "steps": ["step 1 (imperative)", "step 2", "step 3"]
}
Keep steps to 3-7 imperative actions. Reference specific tool names where relevant.`;
    const resp: any = await callLLM({ messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.4 });
    const text = String(resp?.content || resp?.text || resp || "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (!obj?.title || !Array.isArray(obj?.steps)) return null;
    return { title: String(obj.title), trigger: String(obj.trigger || ""), steps: obj.steps.map(String) };
  } catch {
    return null;
  }
}

function fallbackSynthesize(input: SynthesizeInput): { title: string; trigger: string; steps: string[] } {
  const verb = (input.taskSummary || "task").split(/\s+/)[0] || "Handle";
  const tools = input.toolsUsed || [];
  return {
    title: `${verb} playbook (auto)`,
    trigger: `User asks something similar to: "${(input.userMessage || input.taskSummary).slice(0, 80)}"`,
    steps: [
      "1. Confirm the user's specific intent and scope.",
      tools.length ? `2. Call: ${tools.slice(0, 4).join(" → ")}.` : "2. Plan the work.",
      "3. Verify the result matches the user's expectation.",
      "4. Deliver and capture any new lesson learned.",
    ],
  };
}

export async function synthesizeSkill(input: SynthesizeInput): Promise<{ success: boolean; candidate?: SkillCandidate; error?: string }> {
  try {
    const synth = (await llmSynthesize(input)) || fallbackSynthesize(input);
    const payload = {
      trigger: synth.trigger,
      steps: synth.steps,
      toolsUsed: input.toolsUsed || [],
      evidence: input.taskSummary,
      conversationId: input.conversationId,
      status: "draft",
    };
    const personaId = input.personaId ?? null;
    // Tenant context is REQUIRED — defaulting to tenant 1 would misroute a
    // non-admin caller's candidate row into the admin tenant (cross-tenant write).
    if (!Number.isInteger(input.tenantId as any) || (input.tenantId as number) <= 0) {
      return { success: false, error: "Tenant context required to synthesize a skill candidate" };
    }
    const tenantId = input.tenantId as number;
    const inserted: any = await db.execute(sql`
      INSERT INTO agent_knowledge (title, content, category, priority, persona_id, tenant_id, source)
      VALUES (
        ${synth.title},
        ${JSON.stringify(payload)},
        'skill_candidate',
        3,
        ${personaId},
        ${tenantId},
        'skill_synthesizer'
      )
      RETURNING id, created_at
    `);
    const id = inserted.rows[0].id;
    return {
      success: true,
      candidate: {
        id,
        title: synth.title,
        trigger: synth.trigger,
        steps: synth.steps,
        toolsUsed: input.toolsUsed || [],
        evidence: input.taskSummary,
        personaId: input.personaId,
        status: "draft",
        createdAt: inserted.rows[0].created_at,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function listSkillCandidates(tenantId: number, opts?: { personaId?: number; status?: string; limit?: number }): Promise<SkillCandidate[]> {
  // agent_knowledge is tenant-scoped; an unscoped list leaks other tenants'
  // candidates. Fail-closed to an empty list when no valid tenant is supplied.
  if (!Number.isInteger(tenantId) || tenantId <= 0) return [];
  const limit = Math.min(opts?.limit ?? 50, 200);
  const rows: any = await db.execute(sql`
    SELECT id, title, content, persona_id, created_at
    FROM agent_knowledge
    WHERE category = 'skill_candidate'
      AND tenant_id = ${tenantId}
      ${opts?.personaId ? sql`AND persona_id = ${opts.personaId}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return (rows.rows || []).map((r: any) => {
    let payload: any = {};
    try { payload = JSON.parse(r.content); } catch (_silentErr) { logSilentCatch("server/skill-synthesizer.ts", _silentErr); }
    return {
      id: r.id,
      title: r.title,
      trigger: payload.trigger || "",
      steps: payload.steps || [],
      toolsUsed: payload.toolsUsed || [],
      evidence: payload.evidence || "",
      personaId: r.persona_id,
      status: payload.status || "draft",
      createdAt: r.created_at,
    };
  }).filter((s: SkillCandidate) => !opts?.status || s.status === opts.status);
}

export async function promoteSkillCandidate(id: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { success: false, error: "Tenant context required to promote a skill candidate" };
  try {
    // agent_knowledge is tenant-scoped: constrain BOTH the lookup and the UPDATE
    // by tenant_id so a caller can never promote another tenant's candidate row.
    const row: any = await db.execute(sql`SELECT id, title, content, persona_id, tenant_id FROM agent_knowledge WHERE id = ${id} AND tenant_id = ${tenantId} AND category = 'skill_candidate' LIMIT 1`);
    if (!row.rows?.[0]) return { success: false, error: `No candidate ${id}` };
    const r = row.rows[0];
    let payload: any = {};
    try { payload = JSON.parse(r.content); } catch (_silentErr) { logSilentCatch("server/skill-synthesizer.ts", _silentErr); }
    payload.status = "approved";
    await db.execute(sql`
      UPDATE agent_knowledge
      SET category = 'skill', content = ${JSON.stringify(payload)}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND category = 'skill_candidate'
    `);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function rejectSkillCandidate(id: number, reason?: string, tenantId?: number): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(tenantId) || (tenantId as number) <= 0) return { success: false, error: "Tenant context required to reject a skill candidate" };
  try {
    await db.execute(sql`
      UPDATE agent_knowledge
      SET category = 'skill_rejected',
          content = jsonb_set(COALESCE(content::jsonb, '{}'::jsonb), '{rejectReason}', to_jsonb(${reason || ""}::text))::text,
          updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND category = 'skill_candidate'
    `);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// "Nudge yourself" — record a self-noticed insight as a memory entry without
// being asked. Personas can call this between turns when they observe something
// worth remembering about the user.
export async function nudgeMemory(input: { fact: string; category?: string; personaId?: number; tenantId?: number; source?: string }): Promise<{ success: boolean; memoryId?: number; error?: string }> {
  // memory_entries is tenant-scoped; defaulting to tenant 1 would write one
  // tenant's self-nudge into the admin tenant's memory (cross-tenant write).
  if (!Number.isInteger(input.tenantId as any) || (input.tenantId as number) <= 0) {
    return { success: false, error: "Tenant context required to record a self-nudge memory" };
  }
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO memory_entries (fact, category, source, persona_id, tenant_id)
      VALUES (
        ${input.fact},
        ${input.category || "preference"},
        ${input.source || "self_nudge"},
        ${input.personaId ?? null},
        ${input.tenantId as number}
      )
      RETURNING id
    `);
    return { success: true, memoryId: inserted.rows[0].id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Get all approved skills surfaced as a docs string for a persona's tools_doc.
export async function getApprovedSkillsForPersona(personaId: number, tenantId: number): Promise<string> {
  // agent_knowledge is tenant-scoped; surface only the calling tenant's approved
  // skills. Fail-closed to an empty doc when no valid tenant is supplied. This
  // helper is currently unused — scoping the signature now prevents a future
  // caller from adopting it as an unscoped cross-tenant read.
  if (!Number.isInteger(tenantId) || tenantId <= 0) return "";
  const rows: any = await db.execute(sql`
    SELECT title, content
    FROM agent_knowledge
    WHERE category = 'skill'
      AND tenant_id = ${tenantId}
      AND (persona_id = ${personaId} OR persona_id IS NULL)
    ORDER BY priority DESC, created_at DESC
    LIMIT 20
  `);
  if (!rows.rows?.length) return "";
  const lines = rows.rows.map((r: any) => {
    let p: any = {}; try { p = JSON.parse(r.content); } catch (_silentErr) { logSilentCatch("server/skill-synthesizer.ts", _silentErr); }
    return `• ${r.title} — ${p.trigger || "(no trigger)"}\n    Steps: ${(p.steps || []).join(" → ")}`;
  });
  return `\n\nLEARNED SKILLS (auto-synthesized from past sessions, approved):\n${lines.join("\n")}`;
}
