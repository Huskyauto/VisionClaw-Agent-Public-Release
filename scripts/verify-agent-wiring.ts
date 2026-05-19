/**
 * Agent Wiring Audit — proves every registered tool is known by at least one
 * persona, and that trustedPersonasOnly tools never leak into consumer-facing
 * personas.
 *
 * Three checks (run against the LIVE personas DB, after persona-sync):
 *   1) DEAD TOOLS (HARD FAIL) — registered in tool-registry but mentioned in
 *      zero personas. A registered tool no persona knows about is stat fraud.
 *   2) DRIFT (HARD FAIL) — live DB persona docs differ from what
 *      composeOperatingLoop() would produce from the seed file. Means the
 *      file was edited but the sync workflow never ran.
 *   3) TRUSTED LEAK (WARN-ONLY) — a trustedPersonasOnly tool mentioned in a
 *      non-trusted persona's per-persona prompt section. The destructive-tool
 *      policy still gates execution fail-closed, so this is informational
 *      surface-cleanup backlog, not a security bug.
 *
 * Usage:    npx tsx scripts/verify-agent-wiring.ts
 * Workflow: chained at the end of `Agent Knowledge Refresh` so every refresh
 *           is followed by an audit. Exit non-zero on hard failures only.
 *
 * Exit codes:
 *   0  clean (or warn-only findings)
 *   1  DEAD TOOLS found
 *   2  DRIFT found
 *   3  both DEAD + DRIFT
 *   5  audit itself errored (DB unreachable, etc.)
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getAllRegisteredTools } from "../server/tool-registry";
import { TOOL_POLICIES, TRUSTED_PERSONA_NAMES } from "../server/safety/destructive-tool-policy";
import { PERSONA_DOCS, composeOperatingLoop } from "../server/seed-persona-prompts";
import { PLATFORM_TOOLS_CONTRACT } from "../server/persona-sync";

/**
 * Strip the universal blocks (PLATFORM_TOOLS_CONTRACT for tools_doc,
 * UNIVERSAL_OPERATING_CONTRACT for operating_loop) so the trusted-leak check
 * only inspects the PER-PERSONA portion. Without this, every persona appears
 * to "mention" every tool listed in the universal contract — pure false-pos.
 */
function perPersonaToolsDoc(full: string): string {
  if (!full) return "";
  // The contract is appended after a "═══ PLATFORM-WIDE CAPABILITIES" or
  // "═══ OPERATING DOCTRINE" delimiter (whichever comes first marks the
  // start of the universal block).
  const idx1 = full.indexOf("═══ OPERATING DOCTRINE");
  const idx2 = full.indexOf("═══ PLATFORM-WIDE CAPABILITIES");
  const idx = [idx1, idx2].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return idx >= 0 ? full.slice(0, idx) : full;
}
function perPersonaOperatingLoop(full: string): string {
  if (!full) return "";
  const idx = full.indexOf("═══ UNIVERSAL OPERATING CONTRACT");
  return idx >= 0 ? full.slice(0, idx) : full;
}

/**
 * Resolved at runtime from the LIVE personas table by name-matching against
 * `TRUSTED_PERSONA_NAMES` exported by destructive-tool-policy.ts (the same
 * source of truth the runtime gate uses). This avoids the silent false-negative
 * where the audit's hardcoded ID list drifts from the policy enforcement set.
 */
let TRUSTED_PERSONA_IDS = new Set<number>();

interface PersonaRow {
  id: number;
  name: string;
  operating_loop: string;
  tools_doc: string;
}

async function loadLivePersonas(): Promise<PersonaRow[]> {
  const result: any = await db.execute(sql`
    SELECT id, name, operating_loop, tools_doc
    FROM personas
    WHERE is_active = true
    ORDER BY id
  `);
  return ((result as any).rows || result) as PersonaRow[];
}

function mentionsTool(text: string, toolName: string): boolean {
  if (!text) return false;
  // word-boundary match — avoid false positives like "send_email" matching "send_emails"
  const re = new RegExp(`\\b${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return re.test(text);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log("[wiring-audit] starting…");

  const registeredTools = getAllRegisteredTools().sort();
  const personas = await loadLivePersonas();
  // Resolve TRUSTED_PERSONA_IDS from the policy-enforcement source of truth
  // (TRUSTED_PERSONA_NAMES) by name-matching against the live personas table.
  TRUSTED_PERSONA_IDS = new Set(
    personas.filter((p) => TRUSTED_PERSONA_NAMES.has(p.name)).map((p) => p.id)
  );
  console.log(`[wiring-audit] loaded ${registeredTools.length} registered tools, ${personas.length} active personas, trusted personas resolved=[${[...TRUSTED_PERSONA_IDS].join(",")}] (from policy SoT: ${[...TRUSTED_PERSONA_NAMES].join(",")})`);

  // ──────────────────────────────────────────────────────────────────────
  // Check 1: DEAD TOOLS
  // ──────────────────────────────────────────────────────────────────────
  const deadTools: string[] = [];
  for (const tool of registeredTools) {
    let mentioned = false;
    for (const p of personas) {
      if (mentionsTool(p.operating_loop || "", tool) || mentionsTool(p.tools_doc || "", tool)) {
        mentioned = true;
        break;
      }
    }
    if (!mentioned) deadTools.push(tool);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 2: DRIFT (live DB operating_loop != composed-from-seed)
  // ──────────────────────────────────────────────────────────────────────
  const driftPersonas: { id: number; name: string; livLen: number; expLen: number }[] = [];
  for (const p of personas) {
    const seed = (PERSONA_DOCS as any)[p.id];
    if (!seed) continue; // custom personas added at runtime — skip
    const expected = composeOperatingLoop(seed.operating_loop);
    if ((p.operating_loop || "").trim() !== expected.trim()) {
      driftPersonas.push({ id: p.id, name: p.name, livLen: (p.operating_loop || "").length, expLen: expected.length });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 3: TRUSTED LEAK
  // ──────────────────────────────────────────────────────────────────────
  const trustedTools = Object.values(TOOL_POLICIES)
    .filter((p) => p.trustedPersonasOnly)
    .map((p) => p.name);

  const trustedLeaks: { tool: string; persona: string; id: number }[] = [];
  for (const tool of trustedTools) {
    for (const p of personas) {
      if (TRUSTED_PERSONA_IDS.has(p.id)) continue;
      // Only inspect the PER-PERSONA portion — not the universal contracts
      // appended to every persona's docs (those list all tools generically).
      const loop = perPersonaOperatingLoop(p.operating_loop || "");
      const tdoc = perPersonaToolsDoc(p.tools_doc || "");
      if (mentionsTool(loop, tool) || mentionsTool(tdoc, tool)) {
        trustedLeaks.push({ tool, persona: p.name, id: p.id });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 3.5: PERSONA TOOL SPRAWL (warn-only) — R110.13 (Barry Zhang).
  // Barry's seminar argues 8 sharp tools beats 40 overlapping ones because
  // model tool-selection accuracy degrades with the number of choices. VCA
  // scopes per-persona so the totals are higher, but we still want a smoke
  // signal when one persona's PER-PERSONA section mentions an unusual count.
  // Threshold = 30 (universal-block tools are stripped before counting).
  // ──────────────────────────────────────────────────────────────────────
  const PERSONA_TOOL_SPRAWL_WARN = 30;
  const personaToolCounts: { id: number; name: string; count: number }[] = [];
  for (const p of personas) {
    const loop = perPersonaOperatingLoop(p.operating_loop || "");
    const tdoc = perPersonaToolsDoc(p.tools_doc || "");
    const mentioned = new Set<string>();
    for (const tool of registeredTools) {
      if (mentionsTool(loop, tool) || mentionsTool(tdoc, tool)) mentioned.add(tool);
    }
    personaToolCounts.push({ id: p.id, name: p.name, count: mentioned.size });
  }
  const sprawlWarn = personaToolCounts.filter((p) => p.count > PERSONA_TOOL_SPRAWL_WARN);

  // ──────────────────────────────────────────────────────────────────────
  // Check 4: ORPHAN TABLES (warn-only) — DB tables with no Drizzle decl in
  // shared/schema*.ts. Type safety is lost on raw-SQL access; future schema
  // drift is invisible. Surfaces the cleanup backlog without hard-failing.
  // ──────────────────────────────────────────────────────────────────────
  const orphanTables: string[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    const schemaFiles = [
      path.join(process.cwd(), "shared/schema.ts"),
      path.join(process.cwd(), "shared/schema-orphans.ts"),
      path.join(process.cwd(), "shared/models/auth.ts"),
      path.join(process.cwd(), "shared/models/chat.ts"),
    ].filter((f) => fs.existsSync(f));
    const declared = new Set<string>();
    for (const f of schemaFiles) {
      const src = fs.readFileSync(f, "utf8");
      const re = /pgTable\(\s*"([a-z_][a-z0-9_]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) declared.add(m[1]);
    }
    const dbRes: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name
    `);
    const dbTables: string[] = ((dbRes as any).rows || dbRes).map((r: any) => r.table_name);
    for (const t of dbTables) if (!declared.has(t)) orphanTables.push(t);
  } catch (e: any) {
    console.log(`[wiring-audit] orphan-table check skipped: ${e?.message || e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Report
  // ──────────────────────────────────────────────────────────────────────
  console.log("");
  console.log("═══ AGENT WIRING AUDIT ═══");
  console.log(`Dead tools:      ${deadTools.length} / ${registeredTools.length} registered`);
  console.log(`Persona drift:   ${driftPersonas.length} / ${personas.length} active personas`);
  console.log(`Trusted leaks:   ${trustedLeaks.length} (across ${trustedTools.length} trusted-only tools)`);
  console.log(`Sprawl warns:    ${sprawlWarn.length} personas mention >${PERSONA_TOOL_SPRAWL_WARN} tools in their per-persona section`);
  console.log(`Orphan tables:   ${orphanTables.length} (DB tables with no Drizzle decl)`);
  console.log("");

  if (sprawlWarn.length > 0) {
    console.log(`⚠️  PERSONA TOOL SPRAWL (warn-only — Barry Zhang seminar §4.1: model tool-selection accuracy degrades with the number of choices):`);
    for (const p of sprawlWarn.slice(0, 20)) console.log(`   - #${p.id} ${p.name}: ${p.count} tools mentioned (threshold ${PERSONA_TOOL_SPRAWL_WARN})`);
    if (sprawlWarn.length > 20) console.log(`   …and ${sprawlWarn.length - 20} more.`);
    console.log(`   FIX: review the persona's operating_loop in server/seed-persona-prompts.ts; merge overlapping tools or drop unused ones.`);
    console.log("");
  }

  if (orphanTables.length > 0) {
    console.log("⚠️  ORPHAN TABLES (warn-only — type safety lost; raw SQL still works):");
    for (const t of orphanTables.slice(0, 50)) console.log(`   - ${t}`);
    if (orphanTables.length > 50) console.log(`   …and ${orphanTables.length - 50} more.`);
    console.log("   FIX: re-run `npx tsx scripts/introspect-orphan-tables.ts` to regenerate shared/schema-orphans.ts.");
    console.log("");
  }

  if (deadTools.length > 0) {
    console.log("❌ DEAD TOOLS (no persona's operating_loop or tools_doc mentions these):");
    for (const t of deadTools.slice(0, 50)) console.log(`   - ${t}`);
    if (deadTools.length > 50) console.log(`   …and ${deadTools.length - 50} more.`);
    console.log("   FIX: load .agents/skills/agent-context-wiring/SKILL.md, wire each into the appropriate persona's operating_loop with WHAT/WHEN/NOT-WHEN/EXAMPLE.");
    console.log("");
  }

  if (driftPersonas.length > 0) {
    console.log("⚠️  DRIFT (live DB operating_loop ≠ composed-from-seed):");
    for (const d of driftPersonas) console.log(`   - #${d.id} ${d.name}: live=${d.livLen} chars, expected=${d.expLen} chars`);
    console.log("   FIX: re-run `npx tsx scripts/agent-knowledge-refresh.ts` (or restart workflow Agent Knowledge Refresh).");
    console.log("");
  }

  if (trustedLeaks.length > 0) {
    // Group by tool for readable output
    const byTool = new Map<string, string[]>();
    for (const l of trustedLeaks) {
      if (!byTool.has(l.tool)) byTool.set(l.tool, []);
      byTool.get(l.tool)!.push(`#${l.id} ${l.persona}`);
    }
    console.log(`⚠️  TRUSTED LEAK (warn-only — destructive-policy still gates execution fail-closed):`);
    for (const [tool, personas] of byTool) {
      console.log(`   - ${tool}: ${personas.length} non-trusted persona${personas.length === 1 ? "" : "s"}`);
    }
    console.log(`   These are likely auto-generated by buildToolsDoc() from tool categories.`);
    console.log(`   Cleanup backlog: filter trustedPersonasOnly tools out of buildToolsDoc per persona.`);
    console.log("");
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (deadTools.length === 0 && driftPersonas.length === 0) {
    const warnParts: string[] = [];
    if (trustedLeaks.length > 0) warnParts.push(`${trustedLeaks.length} trusted-leak mentions`);
    if (orphanTables.length > 0) warnParts.push(`${orphanTables.length} orphan tables`);
    const warnSuffix = warnParts.length > 0 ? ` (warn-only: ${warnParts.join(", ")})` : "";
    console.log(`✅ CLEAN — every registered tool is known to at least one persona, no drift${warnSuffix} (${elapsed}s)`);
    process.exit(0);
  }

  let exitCode = 0;
  if (deadTools.length > 0) exitCode |= 1;
  if (driftPersonas.length > 0) exitCode |= 2;
  console.log(`❌ FAIL — exit code ${exitCode} (1=dead, 2=drift, 3=both) (${elapsed}s)`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[wiring-audit] ERRORED:", err);
  process.exit(5);
});
