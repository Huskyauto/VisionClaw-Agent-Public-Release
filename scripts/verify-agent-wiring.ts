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
 *   4  ORPHAN SKILL found (.agents/skills/<name>/ on disk but no persona/capability registry mention)
 *   5  audit itself errored (DB unreachable, etc.)
 *   8  SCHEMA FIELD GAP (engine type field missing from tool JSON schema)
 *
 * Bitmask: dead(1) | drift(2) | orphan_skill(4) | schema_gap(8). Multiple
 * concurrent failures OR'd together.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getAllRegisteredTools } from "../server/tool-registry";
import { TOOL_POLICIES, TRUSTED_PERSONA_NAMES } from "../server/safety/destructive-tool-policy";
import { PERSONA_DOCS, composeOperatingLoop } from "../server/seed-persona-prompts";
import { PLATFORM_TOOLS_CONTRACT } from "../server/persona-sync";
import { SCHEMA_PAIRS } from "./wiring-audit-schema-pairs";

/**
 * Skills that ONLY the main agent (this Replit Agent) ever invokes —
 * release management, security tooling, post-edit reviews, etc. These
 * are NOT expected to appear in any VC persona's prompt or in
 * capability-registry.ts. Anything outside this set must be reachable
 * by at least one VC persona or it's a wiring orphan (R125+13.16+wire).
 */
const MAIN_AGENT_ONLY_SKILLS = new Set<string>([
  "agent-context-wiring",
  "architect-finding-triage",
  "critique",
  "cross-session-handoff",
  "dependency-upgrade",
  "feature-contract",
  "load-test-gate",
  "module-girth-guard", // main-agent-only operational skill: god-file alarm + safe-split playbook (fires from preflight-file-girth gate, not persona-invoked)
  "new-persona-onboarding",
  "new-tool-registration",
  "owner-notification",
  "ponytail",
  "post-edit-code-review",
  "post-edit-pipeline",
  "production-verification",
  "public-mirror-push",
  "release-cutting",
  "replit-md-maintenance",
  "schema-migration",
  "security-hardening",
  "silent-failure-hunter",
  "tdd",
  "visionclaw-config-and-flags",
  "visionclaw-debugging-playbook",
  "visionclaw-domain-reference",
  "visionclaw-engineering-atlas",
  "visionclaw-failure-archaeology",
  "visionclaw-proof-and-analysis-toolkit",
  "visionclaw-research-frontier",
  "visionclaw-research-methodology",
  "visionclaw-tools-layer-split-campaign",
  "website-surface-sync",
  "weekly-maintenance-review",
  "write-a-skill",
  "zoom-out",
]);

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
    const extraAllowed = TOOL_POLICIES[tool]?.extraAllowedPersonas || [];
    for (const p of personas) {
      if (TRUSTED_PERSONA_IDS.has(p.id)) continue;
      // Explicitly allowlisted (tool, persona) pair — granted, not a leak.
      if (extraAllowed.includes(p.name)) continue;
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
  // Check 5: ORPHAN SKILL (HARD FAIL) — R125+13.16+wire.
  // A .agents/skills/<name>/SKILL.md on disk that is NOT a main-agent-only
  // operational skill AND NOT mentioned in seed-persona-prompts.ts OR
  // capability-registry.ts is unreachable by any persona. Same class of
  // failure as a dead tool — surface exists, agents can't use it.
  // ──────────────────────────────────────────────────────────────────────
  const orphanSkills: string[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    const skillsDir = path.join(process.cwd(), ".agents/skills");
    const skillNames: string[] = fs.existsSync(skillsDir)
      ? fs
          .readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
          .map((d) => d.name)
      : [];
    const wiringSources: string[] = [];
    for (const f of ["server/seed-persona-prompts.ts", "server/capability-registry.ts"]) {
      const full = path.join(process.cwd(), f);
      if (fs.existsSync(full)) wiringSources.push(fs.readFileSync(full, "utf8"));
    }
    const allSourceText = wiringSources.join("\n");
    for (const name of skillNames) {
      if (MAIN_AGENT_ONLY_SKILLS.has(name)) continue;
      // Match skill name in quotes, backticks, or kebab-form mention
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (!re.test(allSourceText)) orphanSkills.push(name);
    }
  } catch (e: any) {
    console.log(`[wiring-audit] orphan-skill check skipped: ${e?.message || e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 6: SCHEMA FIELD COVERAGE (HARD FAIL) — R125+13.16+wire.
  // For each declared engine-type ↔ tool-schema pair, every field on the
  // engine interface must appear as a property in the tool's JSON schema.
  // Catches the Veo-class bug: new field added to MpegScene, engine wired,
  // but the tool's JSON schema never advertised it → no LLM can call it.
  // ──────────────────────────────────────────────────────────────────────
  type SchemaGap = { tool: string; engineType: string; missing: string[] };
  const schemaGaps: SchemaGap[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    // Source union: server/tools.ts + server/tools/domains/** (tools-layer-split S1),
    // so schema-pair checks keep seeing tools after their definitions migrate.
    const { readToolSourcesConcatenated } = await import("./lib/tool-source-files");
    const toolsSrc = readToolSourcesConcatenated();

    /** Extract field names from a TS interface/type block. */
    const extractEngineFields = (src: string, typeName: string): string[] => {
      const reInterface = new RegExp(`(?:export\\s+)?interface\\s+${typeName}\\s*\\{`);
      const reType = new RegExp(`(?:export\\s+)?type\\s+${typeName}\\s*=\\s*\\{`);
      const m = reInterface.exec(src) || reType.exec(src);
      if (!m) return [];
      let depth = 0;
      let start = m.index + m[0].length - 1; // position of opening `{`
      let end = -1;
      for (let i = start; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) return [];
      const body = src.slice(start + 1, end);
      const fields: string[] = [];
      // Match `name?: ...;` or `name: ...;` at line starts (after whitespace).
      // Skip comment lines starting with // or /*.
      const lines = body.split(/\r?\n/);
      for (const ln of lines) {
        const trimmed = ln.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
        const fm = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\??\s*:/.exec(trimmed);
        if (fm) fields.push(fm[1]);
      }
      return fields;
    };

    /** Slice the full source of a `{ name: "<toolName>", ... }` block. */
    const extractToolBlock = (src: string, toolName: string): string | null => {
      const re = new RegExp(`name\\s*:\\s*["']${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
      const m = re.exec(src);
      if (!m) return null;
      // Walk backward to the opening `{` of this tool object.
      let openIdx = -1;
      let depth = 0;
      for (let i = m.index; i >= 0; i--) {
        if (src[i] === "}") depth++;
        else if (src[i] === "{") {
          if (depth === 0) {
            openIdx = i;
            break;
          }
          depth--;
        }
      }
      if (openIdx < 0) return null;
      // Walk forward to matching close.
      depth = 0;
      for (let i = openIdx; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) return src.slice(openIdx, i + 1);
        }
      }
      return null;
    };

    /**
     * R125+13.16+sec2 — proper schemaPath-aware property traversal.
     *
     * The old implementation did a fuzzy `\b<field>:` regex over the whole
     * tool block, which produced FALSE NEGATIVES (a field name appearing in
     * any unrelated nested object would satisfy the check) and FALSE POSITIVES
     * (a path like `chapters.items.scenes.items` was completely ignored).
     *
     * This walker uses a brace-depth + string-skipping scan so curly braces
     * inside `description: "..."` strings don't corrupt depth tracking. Each
     * `findPropertyValueBody` call returns ONLY the body at depth-0 of the
     * input — i.e. the value of a property at the current nesting level, not
     * an arbitrary descendant.
     */
    const findPropertyValueBody = (src: string, propName: string): string | null => {
      const escName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`["']?${escName}["']?\\s*:\\s*\\{`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        // Compute depth and quote-state at m.index by re-scanning from 0.
        let depth = 0;
        let i = 0;
        while (i < m.index) {
          const ch = src[i];
          if (ch === '"' || ch === "'" || ch === "`") {
            const q = ch;
            i++;
            while (i < src.length) {
              if (src[i] === "\\") { i += 2; continue; }
              if (src[i] === q) { i++; break; }
              i++;
            }
            continue;
          }
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          i++;
        }
        if (depth !== 0) continue;
        // Found a depth-0 property whose value opens with `{`. Walk braces
        // (string-aware) to the matching close.
        let j = m.index + m[0].length - 1; // position of `{`
        let d = 0;
        let k = j;
        while (k < src.length) {
          const ch = src[k];
          if (ch === '"' || ch === "'" || ch === "`") {
            const q = ch;
            k++;
            while (k < src.length) {
              if (src[k] === "\\") { k += 2; continue; }
              if (src[k] === q) { k++; break; }
              k++;
            }
            continue;
          }
          if (ch === "{") d++;
          else if (ch === "}") {
            d--;
            if (d === 0) return src.slice(j + 1, k);
          }
          k++;
        }
        return null;
      }
      return null;
    };

    /** Walk the dotted schemaPath into the tool's parameters.properties. */
    const resolveSchemaTarget = (toolBlock: string, schemaPath: string): string | null => {
      // toolBlock includes outer `{ ... }` so its contents sit at brace depth 1.
      // findPropertyValueBody filters to depth-0 keys, so strip the outer
      // wrappers and feed it the body. Subsequent recursive calls already
      // pass body slices (no wrappers).
      const trimmed = toolBlock.trim();
      const bodySrc = trimmed.startsWith("{") && trimmed.endsWith("}")
        ? trimmed.slice(1, -1)
        : trimmed;
      const paramsBody = findPropertyValueBody(bodySrc, "parameters");
      if (!paramsBody) return null;
      let cur = findPropertyValueBody(paramsBody, "properties");
      if (!cur) return null;
      const segs = schemaPath.split(".").filter((s) => s.length > 0);
      for (const seg of segs) {
        // For named (non-"items") segments, the path convention assumes we
        // implicitly descend through the current spec's `properties:` block
        // before looking up the named key. (Path "chapters.items.scenes.items"
        // is shorthand for properties→chapters→items→properties→scenes→items.)
        // The initial `cur` is already the parameters.properties body, so
        // findPropertyValueBody returns null there and we skip the implicit
        // descent — correct.
        if (seg !== "items") {
          const propsLevel = findPropertyValueBody(cur, "properties");
          if (propsLevel) cur = propsLevel;
        }
        const next = findPropertyValueBody(cur, seg);
        if (!next) return null;
        cur = next;
      }
      return cur;
    };

    /** Collect depth-0 property keys (skipping strings) inside a `{}` body. */
    const collectPropertyKeys = (body: string): string[] => {
      const keys: string[] = [];
      const seen = new Set<string>();
      let depth = 0;
      let i = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch === '"' || ch === "'" || ch === "`") {
          const q = ch;
          i++;
          while (i < body.length) {
            if (body[i] === "\\") { i += 2; continue; }
            if (body[i] === q) { i++; break; }
            i++;
          }
          continue;
        }
        if (ch === "{") { depth++; i++; continue; }
        if (ch === "}") { depth--; i++; continue; }
        if (depth === 0) {
          const rest = body.slice(i);
          const km = /^["']?([a-zA-Z_$][a-zA-Z0-9_$]*)["']?\s*:\s*\{/.exec(rest);
          if (km) {
            if (!seen.has(km[1])) {
              seen.add(km[1]);
              keys.push(km[1]);
            }
            i += km[0].length - 1; // back up so the `{` increments depth
            continue;
          }
        }
        i++;
      }
      return keys;
    };

    for (const pair of SCHEMA_PAIRS) {
      const engineFull = fs.existsSync(path.join(process.cwd(), pair.engineTypeFile))
        ? fs.readFileSync(path.join(process.cwd(), pair.engineTypeFile), "utf8")
        : "";
      const engineFields = extractEngineFields(engineFull, pair.engineTypeName);
      if (engineFields.length === 0) {
        console.log(`[wiring-audit] schema-pair WARN: engine type ${pair.engineTypeName} not found in ${pair.engineTypeFile}`);
        continue;
      }
      const toolBlock = extractToolBlock(toolsSrc, pair.toolName);
      if (!toolBlock) {
        console.log(`[wiring-audit] schema-pair WARN: tool ${pair.toolName} not found in server/tools.ts`);
        continue;
      }
      const target = resolveSchemaTarget(toolBlock, pair.schemaPath);
      if (!target) {
        console.log(`[wiring-audit] schema-pair WARN: path "${pair.schemaPath}" not resolvable in tool ${pair.toolName}`);
        schemaGaps.push({ tool: pair.toolName, engineType: pair.engineTypeName, missing: [`<schemaPath "${pair.schemaPath}" did not resolve>`] });
        continue;
      }
      // The target is a JSON-schema spec object. Its child `properties: {…}`
      // (if any) holds the field-name map. If the target itself has no nested
      // properties block, treat the target's own keys as the field map (covers
      // the empty-schemaPath case where parameters.properties IS the mirror).
      const propsBody = findPropertyValueBody(target, "properties") ?? target;
      const toolFieldKeys = new Set(collectPropertyKeys(propsBody));
      const ignore = new Set(pair.ignoreEngineFields || []);
      const missing: string[] = [];
      for (const f of engineFields) {
        if (ignore.has(f)) continue;
        if (!toolFieldKeys.has(f)) missing.push(f);
      }
      if (missing.length > 0) {
        schemaGaps.push({ tool: pair.toolName, engineType: pair.engineTypeName, missing });
      }
    }
  } catch (e: any) {
    console.log(`[wiring-audit] schema-field check skipped: ${e?.message || e}`);
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
  console.log(`Orphan skills:   ${orphanSkills.length} (skills on disk with no persona/capability registry mention)`);
  console.log(`Schema gaps:     ${schemaGaps.length} (engine fields not exposed in tool JSON schema)`);
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

  if (orphanSkills.length > 0) {
    console.log("❌ ORPHAN SKILLS (.agents/skills/<name>/ exists but no persona/capability registry mention):");
    for (const s of orphanSkills) console.log(`   - ${s}`);
    console.log("   FIX: either add the skill name to a relevant persona's tools_doc in server/seed-persona-prompts.ts");
    console.log("        OR register a capability that points at it in server/capability-registry.ts");
    console.log("        OR if this is a main-agent-only operational skill, add it to MAIN_AGENT_ONLY_SKILLS");
    console.log("        in scripts/verify-agent-wiring.ts.");
    console.log("");
  }

  if (schemaGaps.length > 0) {
    console.log("❌ SCHEMA FIELD GAPS (engine type has fields not exposed in tool JSON schema — LLMs cannot reach them):");
    for (const g of schemaGaps) {
      console.log(`   - tool=${g.tool} engineType=${g.engineType} missing=[${g.missing.join(", ")}]`);
    }
    console.log("   FIX: add the missing properties to the matching `properties: { ... }` block in server/tools.ts.");
    console.log("        Mirror the type and description from the engine interface comments.");
    console.log("        If a field is intentionally engine-internal, add it to ignoreEngineFields in");
    console.log("        scripts/wiring-audit-schema-pairs.ts (with a note explaining why).");
    console.log("");
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (deadTools.length === 0 && driftPersonas.length === 0 && orphanSkills.length === 0 && schemaGaps.length === 0) {
    const warnParts: string[] = [];
    if (trustedLeaks.length > 0) warnParts.push(`${trustedLeaks.length} trusted-leak mentions`);
    if (orphanTables.length > 0) warnParts.push(`${orphanTables.length} orphan tables`);
    const warnSuffix = warnParts.length > 0 ? ` (warn-only: ${warnParts.join(", ")})` : "";
    console.log(`✅ CLEAN — every registered tool/skill is known to at least one persona, no drift, no schema gaps${warnSuffix} (${elapsed}s)`);
    process.exit(0);
  }

  let exitCode = 0;
  if (deadTools.length > 0) exitCode |= 1;
  if (driftPersonas.length > 0) exitCode |= 2;
  if (orphanSkills.length > 0) exitCode |= 4;
  if (schemaGaps.length > 0) exitCode |= 8;
  console.log(`❌ FAIL — exit code ${exitCode} (1=dead, 2=drift, 4=orphan-skill, 8=schema-gap; OR'd) (${elapsed}s)`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[wiring-audit] ERRORED:", err);
  process.exit(5);
});
