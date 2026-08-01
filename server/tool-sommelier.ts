// R74.13z-quint+3 (Apr 29 2026): Tool Sommelier — async, runs once per 24h.
//
// Why this exists: 257 of 259 registered tools have 0 successful invocations
// in 14 days. Personas reach for the same handful (search_memory, web_search,
// project, write_file, recall_context) because they don't know the others
// exist for their task, or because near-duplicate tools confuse the router.
//
// What this does: reads dormancy + tool-failure stats once a day, generates
// 3-5 short ADRs ("PLAYBOOK: when X, use Y because Z") via the cheap LLM,
// and writes them under the existing architecture_decisions table with the
// `tool-sommelier` tag. The chat engine reads the latest 5 of these into
// every persona's system prompt so the playbook is always one prompt away.
//
// Not a per-turn agent — that would add latency on every message. This is
// a nightly background pass that builds the institutional memory of "which
// tool actually works for which kind of task."

import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { logSilentCatch } from "./lib/silent-catch";
import { replitOpenai } from "./providers";
import { ADMIN_TENANT_ID } from "./auth";
import { getAllRegisteredTools, getToolMeta } from "./tool-registry";

const SOMMELIER_TAG = "tool-sommelier";
const SOMMELIER_AUTHOR_PERSONA_ID = 2; // Felix — orchestrator owns playbook authorship
const CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PLAYBOOK_ENTRIES_PER_CYCLE = 5;
const STATS_WINDOW_DAYS = 14;

let timer: NodeJS.Timeout | null = null;

interface ToolStat {
  tool_name: string;
  success_count: number;
  fail_count: number;
  last_failure_reason: string | null;
}

interface DormantTool {
  tool_name: string;
  category: string;
}

async function getToolStats(tenantId: number): Promise<{ stats: ToolStat[]; dormant: DormantTool[] }> {
  const statsResult = await db.execute(sql`
    SELECT tool_name, success_count, fail_count, last_failure_reason
    FROM tool_performance
    WHERE tenant_id = ${tenantId}
      AND updated_at > NOW() - (${STATS_WINDOW_DAYS} || ' days')::interval
    ORDER BY (success_count + fail_count) DESC
    LIMIT 50
  `);
  const stats = (((statsResult as any).rows || statsResult) as any[]).map(r => ({
    tool_name: String(r.tool_name),
    success_count: Number(r.success_count || 0),
    fail_count: Number(r.fail_count || 0),
    last_failure_reason: r.last_failure_reason || null,
  }));

  const usedNames = new Set(stats.filter(s => s.success_count > 0).map(s => s.tool_name));
  const allRegistered = getAllRegisteredTools();
  const dormant: DormantTool[] = [];
  for (const name of allRegistered) {
    if (!usedNames.has(name)) {
      const meta = getToolMeta(name);
      const category = meta?.categories?.[0] || "general";
      dormant.push({ tool_name: name, category });
    }
  }

  return { stats, dormant };
}

async function getRecentPlaybookTitles(tenantId: number): Promise<Set<string>> {
  const adrs = await storage.listAdrs(tenantId, { tag: SOMMELIER_TAG, limit: 30 });
  return new Set(adrs.map(a => (a.title || "").toLowerCase().trim()));
}

interface PlaybookEntry {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

async function generatePlaybookEntries(
  tenantId: number,
  stats: ToolStat[],
  dormant: DormantTool[],
  alreadyCovered: Set<string>,
): Promise<PlaybookEntry[]> {
  const failingTools = stats
    .filter(s => s.fail_count > 0 && s.fail_count >= s.success_count)
    .slice(0, 8)
    .map(s => `- ${s.tool_name}: ${s.fail_count} fails / ${s.success_count} successes${s.last_failure_reason ? ` — last error: ${s.last_failure_reason.slice(0, 120)}` : ""}`)
    .join("\n");

  const dormantByCategory: Record<string, string[]> = {};
  for (const d of dormant) {
    (dormantByCategory[d.category] ||= []).push(d.tool_name);
  }
  const dormantSummary = Object.entries(dormantByCategory)
    .filter(([, names]) => names.length > 0)
    .slice(0, 8)
    .map(([cat, names]) => `- ${cat}: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` (+${names.length - 6} more)` : ""}`)
    .join("\n");

  const popularTools = stats
    .filter(s => s.success_count > 0)
    .slice(0, 10)
    .map(s => `- ${s.tool_name}: used ${s.success_count}× successfully`)
    .join("\n");

  const recentTitles = Array.from(alreadyCovered).slice(0, 15).join("\n  - ") || "(none yet)";

  const prompt = `You are the Tool Sommelier for an autonomous AI agent platform with 259 registered tools across 16 personas. Your job is to write a short PLAYBOOK that helps personas pick the right tool for the task.

USAGE STATS (last ${STATS_WINDOW_DAYS} days, this tenant):

POPULAR (working well):
${popularTools || "(no usage yet)"}

FAILING (need guidance):
${failingTools || "(no failures recorded)"}

DORMANT (registered but never used in this window — agents don't know about them or there's a better-known alternative):
${dormantSummary || "(none)"}

ALREADY-WRITTEN PLAYBOOK ENTRIES (do NOT re-cover these topics):
  - ${recentTitles}

Write up to ${MAX_PLAYBOOK_ENTRIES_PER_CYCLE} NEW playbook entries. Each entry must:
1. Cover a distinct decision a persona faces (not yet covered above).
2. Surface a dormant tool when it's genuinely better than the popular alternative, OR steer agents away from a failing tool toward the right one, OR codify a non-obvious tool-chaining recipe.
3. Be SHORT and ACTIONABLE — one paragraph per field.

Return STRICT JSON: an array of objects with fields: title (under 80 chars, format "PLAYBOOK: when X, use Y"), context (the situation, 1-2 sentences), decision (which tool(s) to use and why, 1-3 sentences), consequences (what happens if you do/don't follow this, 1-2 sentences).

If there is nothing useful to add (everything is already covered or there's not enough signal), return [].`;

  try {
    const completion = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You are a precise tool-selection coach. Output only valid JSON arrays." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const entries: PlaybookEntry[] = Array.isArray(parsed) ? parsed : (parsed.entries || parsed.playbook || []);

    return entries
      .filter(e => e && typeof e.title === "string" && typeof e.decision === "string")
      .filter(e => !alreadyCovered.has(e.title.toLowerCase().trim()))
      .slice(0, MAX_PLAYBOOK_ENTRIES_PER_CYCLE);
  } catch (err) {
    console.warn(`[tool-sommelier] LLM playbook generation failed for tenant ${tenantId}:`, (err as Error).message);
    return [];
  }
}

export async function runToolSommelierCycle(tenantId: number): Promise<{ written: number; skipped: number }> {
  try {
    const { stats, dormant } = await getToolStats(tenantId);
    if (stats.length === 0 && dormant.length === 0) {
      return { written: 0, skipped: 0 };
    }

    const alreadyCovered = await getRecentPlaybookTitles(tenantId);
    const entries = await generatePlaybookEntries(tenantId, stats, dormant, alreadyCovered);

    if (entries.length === 0) {
      console.log(`[tool-sommelier] tenant ${tenantId}: no new playbook entries needed (${alreadyCovered.size} already covered)`);
      return { written: 0, skipped: 0 };
    }

    // Architect-fix (R74.13z-quint+3 round 1): update `alreadyCovered` while we
    // iterate so a same-cycle duplicate title (LLM occasionally returns near-dupes)
    // doesn't write a second row. Plus a defensive full-history check via SQL on
    // the normalized title — catches duplicates beyond the 30-row prefetch window.
    let written = 0;
    for (const entry of entries) {
      const titleKey = entry.title.toLowerCase().trim();
      if (alreadyCovered.has(titleKey)) continue;
      try {
        const existing = await db.execute(sql`
          SELECT 1 FROM architecture_decisions
          WHERE tenant_id = ${tenantId}
            AND ${SOMMELIER_TAG} = ANY(tags)
            AND lower(trim(title)) = ${titleKey}
          LIMIT 1
        `);
        if ((((existing as any).rows || existing) as any[]).length > 0) {
          alreadyCovered.add(titleKey);
          continue;
        }

        await storage.createAdr({
          tenantId,
          title: entry.title.slice(0, 200),
          status: "accepted",
          context: entry.context || "Tool Sommelier observation from usage stats.",
          decision: entry.decision,
          consequences: entry.consequences || "",
          tags: [SOMMELIER_TAG, "playbook"],
          authorPersonaId: SOMMELIER_AUTHOR_PERSONA_ID,
        } as any);
        alreadyCovered.add(titleKey);
        written++;
      } catch (err) {
        console.warn(`[tool-sommelier] failed to write ADR "${entry.title}":`, (err as Error).message);
      }
    }

    console.log(`[tool-sommelier] tenant ${tenantId}: wrote ${written} new playbook ADR(s)`);
    return { written, skipped: entries.length - written };
  } catch (err) {
    console.warn(`[tool-sommelier] cycle failed for tenant ${tenantId}:`, (err as Error).message);
    return { written: 0, skipped: 0 };
  }
}

export async function runAllTenants(): Promise<void> {
  try {
    const tenantsResult = await db.execute(sql`SELECT id FROM tenants WHERE is_active = true`);
    const tenantIds = (((tenantsResult as any).rows || tenantsResult) as any[])
      .map(r => Number(r.id))
      .filter(n => Number.isFinite(n) && n > 0);
    if (tenantIds.length === 0) {
      tenantIds.push(ADMIN_TENANT_ID);
    }
    // R94 SECURITY — wrap each tenant cycle in AsyncLocalStorage context so
    // the cheap LLM call inside generatePlaybooks bills the correct tenant
    // (was previously billing ADMIN via the singleton replitOpenai client).
    const { withTenantContext } = await import("./lib/tenant-context");
    for (const tid of tenantIds) {
      await withTenantContext({ tenantId: tid, source: "cron" }, () => runToolSommelierCycle(tid));
    }
  } catch (_silentErr) { logSilentCatch("server/tool-sommelier.ts:runAllTenants", _silentErr); }
}

export function startToolSommelier(): void {
  if (timer) return;
  console.log(`[tool-sommelier] Started — cycle every 24h, max ${MAX_PLAYBOOK_ENTRIES_PER_CYCLE} new ADRs per cycle, stats window ${STATS_WINDOW_DAYS}d`);
  // Wait 5 minutes after boot for the system to settle, then run first cycle.
  setTimeout(() => { runAllTenants().catch(() => {}); }, 5 * 60 * 1000);
  timer = setInterval(() => { runAllTenants().catch(() => {}); }, CYCLE_INTERVAL_MS);
}

export function stopToolSommelier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function getLatestPlaybookEntries(tenantId: number, limit: number = 5): Promise<Array<{ title: string; decision: string }>> {
  try {
    const adrs = await storage.listAdrs(tenantId, { tag: SOMMELIER_TAG, limit });
    return adrs
      .filter(a => a.status === "accepted")
      .map(a => ({ title: a.title || "", decision: a.decision || "" }));
  } catch (_silentErr) {
    logSilentCatch("server/tool-sommelier.ts:getLatestPlaybookEntries", _silentErr);
    return [];
  }
}
