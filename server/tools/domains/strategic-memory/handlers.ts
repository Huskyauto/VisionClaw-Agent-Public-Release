/**
 * Tools-layer-split S26h — strategic-memory-domain migrated handlers.
 *
 * The strategic-lesson / strategic-win reflection memory family (4 tools):
 * `record_failure_pattern` / `recall_failure_patterns` (R98.7) and their
 * SUCCESS mirror `record_strategic_win` / `recall_strategic_wins` (R98.12 W7).
 * All four use INLINE db logic against `memory_entries` (no backing lib) —
 * bodies are a MECHANICAL move of the legacy switch arms (standing rules: no
 * renames, no behavior change, no added/removed gate; INLINE SQL, dedup keys,
 * V2/V1 parse fallbacks, field caps, error strings preserved VERBATIM).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-
 * STRIPPED `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * AND read `(params as any)._personaId || 2` for the per-persona memory scope.
 * Migrated handlers read `ctx.tenantId` / `ctx.personaId` (the same platform-
 * derived values) in the SAME order with IDENTICAL guards and error strings.
 * `_tenantId` + `_personaId` are the ONLY stripped signals these arms read
 * (grepped — no `_conversationId`/`_projectId`).
 *
 * `../../../db` and `logSilentCatch` are pulled via call-time dynamic `import(...)`
 * — NOT top-level static imports — so the domain module statically imports only
 * within server/tools/ and cannot recurse into the app graph (acyclicity
 * invariant, plan.md S2). Neither `server/db` nor `server/lib/silent-catch`
 * imports the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  recordFailurePatternDefinition,
  recallFailurePatternsDefinition,
  recordStrategicWinDefinition,
  recallStrategicWinsDefinition,
} from "./definitions";

async function recordFailurePatternHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.7 — Felix Failure-Pattern Memory. Persists strategic regressions
  // (planning prose, forgot-the-photo, silent-quit, meta-video, etc.) into
  // memory_entries with category='strategic_lesson' so recall_failure_patterns
  // can surface them next session. Reuses the existing self-reflection
  // memory infrastructure rather than introducing a new table.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "record_failure_pattern requires tenant context" };
  }
  const pattern = String(params.pattern || "").trim();
  const trigger = String(params.trigger || "").trim();
  const fix = String(params.fix || "").trim();
  const severity = String(params.severity || "").trim().toLowerCase();
  const selfCheck = String(params.self_check || "").trim();
  const tags = Array.isArray(params.tags) ? params.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (!pattern || !trigger || !fix) return { error: "pattern, trigger, fix are all required" };
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    return { error: "severity must be one of: low, medium, high, critical" };
  }
  if (pattern.length > 200 || trigger.length > 500 || fix.length > 500 || selfCheck.length > 300) {
    return { error: "field length cap exceeded (pattern≤200, trigger≤500, fix≤500, self_check≤300)" };
  }
  try {
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");
    const personaId = ctx.personaId || 2;
    // R98.7+sec — deterministic key-based dedup (architect HIGH finding):
    // The original LIKE-based dedup let `%` and `_` in user text become SQL
    // wildcards, AND prefix-matching could stomp the wrong row. Fix: hash
    // the normalized pattern into a key with a controlled character set
    // (a-z 0-9 -), embed it in a stable prefix, and exact-equal-match on
    // a normal-string LIKE that has zero user-controlled wildcard chars.
    const normKey = pattern.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unnamed";
    // V2 fact format (architect MEDIUM finding): structured JSON instead of
    // a delimiter-formatted string the recall parser regexes against. The
    // prefix `STRATEGIC_LESSON_V2:<normKey>|` is a deterministic exact-key
    // we can dedup on without any user-provided wildcard surface.
    const payload = { v: 2, pattern, trigger, fix, self_check: selfCheck, severity, tags };
    const fact = `STRATEGIC_LESSON_V2:${normKey}|${JSON.stringify(payload)}`;
    const dedupPrefix = `STRATEGIC_LESSON_V2:${normKey}|`;
    const existing = await db.execute(sql`
      SELECT id FROM memory_entries
      WHERE tenant_id = ${tid}
        AND persona_id = ${personaId}
        AND category = 'strategic_lesson'
        AND fact LIKE ${dedupPrefix + "%"}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) {
      const id = (existing as any).rows[0].id;
      await db.execute(sql`
        UPDATE memory_entries
        SET fact = ${fact}, last_accessed = NOW(), access_count = access_count + 1
        WHERE id = ${id}
      `);
      return { success: true, action: "updated", id, pattern, severity, key: normKey };
    }
    await db.execute(sql`
      INSERT INTO memory_entries (tenant_id, persona_id, fact, category, source, created_at)
      VALUES (${tid}, ${personaId}, ${fact}, 'strategic_lesson', 'self_reflection', NOW())
    `);
    return { success: true, action: "recorded", pattern, severity, key: normKey, note: "Pattern persisted. recall_failure_patterns will surface it next session." };
  } catch (e: any) {
    return { error: `record_failure_pattern failed: ${e?.message || String(e)}` };
  }
}

async function recallFailurePatternsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.7 — Pull strategic lessons recorded by record_failure_pattern,
  // tenant + persona scoped. Optional tag filter (substring match against
  // the [tags:...] suffix). Returns parsed structured rows so the LLM
  // doesn't have to re-parse the formatted fact string.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "recall_failure_patterns requires tenant context" };
  }
  const personaId = ctx.personaId || 2;
  const tags = Array.isArray(params.tags) ? params.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
  try {
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT id, fact, created_at, last_accessed, access_count FROM memory_entries
      WHERE tenant_id = ${tid}
        AND persona_id = ${personaId}
        AND category = 'strategic_lesson'
      ORDER BY last_accessed DESC, created_at DESC
      LIMIT ${limit * 3}
    `);
    let rows = (result as any).rows || [];
    // Tag filter (substring match).
    if (tags.length > 0) {
      rows = rows.filter((r: any) => {
        const f = String(r.fact || "").toLowerCase();
        return tags.some((t: string) => f.includes(t));
      });
    }
    rows = rows.slice(0, limit);
    // Bump last_accessed so dormancy doesn't expire frequently-recalled lessons.
    if (rows.length > 0) {
      const ids = rows.map((r: any) => Number(r.id)).filter(Boolean);
      if (ids.length > 0) {
        await db.execute(sql`UPDATE memory_entries SET last_accessed = NOW(), access_count = access_count + 1 WHERE id = ANY(${ids as any})`).catch(() => {});
      }
    }
    // R98.7+sec — V2 = JSON payload after deterministic prefix; no delimiter
    // collisions with user content (architect MEDIUM finding).
    // logSilentCatch is pulled once here (call-time dynamic import, acyclic) so
    // the synchronous .map() callback below can use it without an inner await.
    const { logSilentCatch } = await import("../../../lib/silent-catch");
    const parsed = rows.map((r: any) => {
      const f = String(r.fact || "");
      if (f.startsWith("STRATEGIC_LESSON_V2:")) {
        const pipeIdx = f.indexOf("|");
        if (pipeIdx > 0) {
          try {
            const obj = JSON.parse(f.slice(pipeIdx + 1));
            return {
              id: r.id,
              severity: String(obj.severity || "medium").toLowerCase(),
              pattern: String(obj.pattern || "").slice(0, 200),
              trigger: String(obj.trigger || "").slice(0, 500),
              fix: String(obj.fix || "").slice(0, 500),
              self_check: String(obj.self_check || "").slice(0, 300),
              tags: Array.isArray(obj.tags) ? obj.tags.map((t: any) => String(t)) : [],
              recorded_at: r.created_at,
              access_count: r.access_count,
            };
          } catch (_silentErr) { logSilentCatch("server/tools.ts", _silentErr); }
        }
      }
      // Legacy V1 fallback (delimiter-formatted) — only present if any rows
      // were written before R98.7+sec; we keep this so old data still reads.
      const sevMatch = f.match(/STRATEGIC LESSON \[([A-Z]+)\]\s+(.+?)\s+\|\s+TRIGGER:/);
      const trigMatch = f.match(/\|\s+TRIGGER:\s+(.+?)\s+\|\s+FIX:/);
      const fixMatch = f.match(/\|\s+FIX:\s+(.+?)(?:\s+\|\s+SELF-CHECK:|\s+\[tags:|$)/);
      const checkMatch = f.match(/\|\s+SELF-CHECK:\s+(.+?)(?:\s+\[tags:|$)/);
      const tagMatch = f.match(/\[tags:([^\]]+)\]/);
      return {
        id: r.id,
        severity: (sevMatch?.[1] || "MEDIUM").toLowerCase(),
        pattern: sevMatch?.[2]?.trim() || f.slice(0, 80),
        trigger: trigMatch?.[1]?.trim() || "",
        fix: fixMatch?.[1]?.trim() || "",
        self_check: checkMatch?.[1]?.trim() || "",
        tags: tagMatch ? tagMatch[1].split(",").map((s: string) => s.trim()) : [],
        recorded_at: r.created_at,
        access_count: r.access_count,
      };
    });
    return {
      success: true,
      count: parsed.length,
      patterns: parsed,
      static_doc_hint: "Felix has a static doc at data/personas/felix/known-failure-patterns.md covering P001-P010 (R98.1-R98.6 regressions) — those are baked-in patterns; the entries above are the LIVE additions.",
    };
  } catch (e: any) {
    return { error: `recall_failure_patterns failed: ${e?.message || String(e)}` };
  }
}

async function recordStrategicWinHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.12 W7 — positive-exemplar memory. Mirrors record_failure_pattern.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "record_strategic_win requires tenant context" };
  const win = String(params.win || "").trim();
  const trigger = String(params.trigger || "").trim();
  const technique = String(params.technique || "").trim();
  const doThisAgain = String(params.do_this_again || "").trim();
  const impact = String(params.impact || "").trim().toLowerCase();
  const tags = Array.isArray(params.tags) ? params.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (!win || !trigger || !technique) return { error: "win, trigger, technique are all required" };
  if (!["low", "medium", "high", "exemplar"].includes(impact)) return { error: "impact must be one of: low, medium, high, exemplar" };
  if (win.length > 200 || trigger.length > 500 || technique.length > 500 || doThisAgain.length > 300) {
    return { error: "field length cap exceeded (win≤200, trigger≤500, technique≤500, do_this_again≤300)" };
  }
  try {
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");
    const personaId = ctx.personaId || 2;
    const normKey = win.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unnamed";
    const payload = { v: 1, win, trigger, technique, do_this_again: doThisAgain, impact, tags };
    const fact = `STRATEGIC_WIN_V1:${normKey}|${JSON.stringify(payload)}`;
    const dedupPrefix = `STRATEGIC_WIN_V1:${normKey}|`;
    const existing = await db.execute(sql`
      SELECT id FROM memory_entries
      WHERE tenant_id = ${tid} AND persona_id = ${personaId}
        AND category = 'strategic_win'
        AND fact LIKE ${dedupPrefix + "%"}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) {
      const id = (existing as any).rows[0].id;
      await db.execute(sql`UPDATE memory_entries SET fact = ${fact}, last_accessed = NOW(), access_count = access_count + 1 WHERE id = ${id}`);
      return { success: true, action: "updated", id, win, impact, key: normKey };
    }
    await db.execute(sql`
      INSERT INTO memory_entries (tenant_id, persona_id, fact, category, source, created_at)
      VALUES (${tid}, ${personaId}, ${fact}, 'strategic_win', 'self_reflection', NOW())
    `);
    return { success: true, action: "recorded", win, impact, key: normKey, note: "Win persisted. recall_strategic_wins will surface it next session." };
  } catch (e: any) {
    return { error: `record_strategic_win failed: ${e?.message || String(e)}` };
  }
}

async function recallStrategicWinsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.12 W7 — return parsed wins.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "recall_strategic_wins requires tenant context" };
  try {
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");
    const personaId = ctx.personaId || 2;
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const tagFilter: string[] = Array.isArray(params.tags) ? params.tags.map((t: any) => String(t).toLowerCase()) : [];
    const impactMin = String(params.impact_min || "low").toLowerCase();
    const impactRank: Record<string, number> = { low: 0, medium: 1, high: 2, exemplar: 3 };
    const minRank = impactRank[impactMin] ?? 0;
    const rows = await db.execute(sql`
      SELECT id, fact, last_accessed, access_count, created_at FROM memory_entries
      WHERE tenant_id = ${tid} AND persona_id = ${personaId}
        AND category = 'strategic_win'
      ORDER BY last_accessed DESC NULLS LAST, created_at DESC
      LIMIT ${limit * 2}
    `);
    const parsed: any[] = [];
    for (const r of ((rows as any).rows || [])) {
      const f = String(r.fact || "");
      if (!f.startsWith("STRATEGIC_WIN_V1:")) continue;
      const pipeIdx = f.indexOf("|");
      if (pipeIdx < 0) continue;
      let payload: any;
      try { payload = JSON.parse(f.slice(pipeIdx + 1)); } catch { continue; }
      const rank = impactRank[String(payload.impact || "low")] ?? 0;
      if (rank < minRank) continue;
      if (tagFilter.length > 0) {
        const wTags: string[] = Array.isArray(payload.tags) ? payload.tags.map((t: any) => String(t).toLowerCase()) : [];
        if (!tagFilter.some((tf) => wTags.some((wt) => wt.includes(tf)))) continue;
      }
      parsed.push({
        id: r.id, win: payload.win, trigger: payload.trigger, technique: payload.technique,
        do_this_again: payload.do_this_again, impact: payload.impact, tags: payload.tags || [],
        recorded_at: r.created_at, last_accessed: r.last_accessed, access_count: r.access_count,
      });
      if (parsed.length >= limit) break;
    }
    return { count: parsed.length, wins: parsed, hint: parsed.length === 0 ? "No strategic wins recorded yet for this persona. Call record_strategic_win after your next clean success." : undefined };
  } catch (e: any) {
    return { error: `recall_strategic_wins failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const strategicMemoryDomainTools: RegisteredTool[] = [
  defineTool(recordFailurePatternDefinition, recordFailurePatternHandler),
  defineTool(recallFailurePatternsDefinition, recallFailurePatternsHandler),
  defineTool(recordStrategicWinDefinition, recordStrategicWinHandler),
  defineTool(recallStrategicWinsDefinition, recallStrategicWinsHandler),
];
