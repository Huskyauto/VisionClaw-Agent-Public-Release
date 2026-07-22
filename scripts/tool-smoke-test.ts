/**
 * tool-smoke-test — thin driver for the staged Tool Smoke-Test & Documentation
 * Program. Reads the REAL tool-registry SoT + the pure classifier in
 * server/lib/tool-smoke-core.ts; does all IO (manifest, progress, stage
 * worklists). $0 / no LLM / no tenant — it documents + classifies, it does NOT
 * auto-invoke any tool. Live invocation of `live-safe` tools is a deliberate,
 * opt-in per-tool step done while working a stage (NEVER destructive tools).
 *
 * IMPORTANT: server/tools.ts (1.3 MB, TOOL_DEFINITIONS) is NOT imported — doing
 * so loads the whole app graph and never resolves (same reason the wiring audit
 * avoids it). Descriptions + param schemas are extracted by STATICALLY parsing
 * that file with the TypeScript compiler API (best-effort, fail-soft). Registry
 * meta + policy ARE imported (they load cleanly).
 *
 * USAGE (one-line agent-runnable, no prompts/TTY):
 *   npx tsx scripts/tool-smoke-test.ts                 # (re)generate manifest + summary
 *   npx tsx scripts/tool-smoke-test.ts --status        # progress + next stage to work
 *   npx tsx scripts/tool-smoke-test.ts --stage N       # emit stage N worklist markdown
 *   npx tsx scripts/tool-smoke-test.ts --complete N    # mark stage N signed-off
 *
 * ENV
 *   STAGE_SIZE   tools per stage (default 20)
 *
 * EXIT CODES
 *   0 success   1 usage / IO error   2 bad stage number
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as ts from "typescript";
import { getAllRegisteredTools, getToolMeta } from "../server/tool-registry";
import { TOOL_POLICIES, getToolRiskClass, getEffectiveToolRisk } from "../server/safety/destructive-tool-policy";
import {
  buildSmokeRecord,
  partitionStages,
  computeProgress,
  summarizeParams,
} from "../server/lib/tool-smoke-core";
import { getToolSourceFiles } from "./lib/tool-source-files";

const DOC_DIR = path.join(process.cwd(), "docs", "tool-smoke-test");
const STAGES_DIR = path.join(DOC_DIR, "stages");
const MANIFEST = path.join(DOC_DIR, "manifest.json");
const PROGRESS = path.join(DOC_DIR, "progress.json");
const TOOLS_SRC = path.join(process.cwd(), "server", "tools.ts");
const STAGE_SIZE = Math.max(1, parseInt(process.env.STAGE_SIZE || "20", 10) || 20);

interface ExtractedDef {
  description?: string;
  params: Array<{ name: string; type: string; required: boolean }>;
}

/** Read a string-literal-ish node's text, or undefined for dynamic templates. */
function literalText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Find a property's initializer in an object literal by key name. */
function prop(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const m of obj.properties) {
    if (ts.isPropertyAssignment(m)) {
      const n = m.name;
      const k = ts.isIdentifier(n) ? n.text : ts.isStringLiteral(n) ? n.text : undefined;
      if (k === key) return m.initializer;
    }
  }
  return undefined;
}

/**
 * Statically extract { name → {description, params} } from the TOOL_DEFINITIONS
 * array in server/tools.ts WITHOUT executing the module. Fail-soft: any entry it
 * can't parse is simply omitted (the manifest then just lacks docs for that tool).
 */
function extractToolDefs(): Map<string, ExtractedDef> {
  const out = new Map<string, ExtractedDef>();
  // Source union: server/tools.ts + server/tools/domains/** (tools-layer-split S1).
  // Domain files export per-domain arrays (e.g. SYSTEM_TOOL_DEFINITIONS), so the
  // AST visitor matches any array variable whose name ends with TOOL_DEFINITIONS.
  for (const file of getToolSourceFiles()) {
    let srcText: string;
    try {
      srcText = fs.readFileSync(file, "utf8");
    } catch {
      continue; // fail-soft: that file just lacks docs enrichment
    }
    const sf = ts.createSourceFile(file, srcText, ts.ScriptTarget.Latest, true);
    parseSourceFile(sf, out);
  }
  return out;
}

function parseSourceFile(sf: ts.SourceFile, out: Map<string, ExtractedDef>) {

  function parseEntry(entry: ts.ObjectLiteralExpression) {
    const fn = prop(entry, "function");
    if (!fn || !ts.isObjectLiteralExpression(fn)) return;
    const name = literalText(prop(fn, "name"));
    if (!name) return;
    const description = literalText(prop(fn, "description"));
    let params: ExtractedDef["params"] = [];
    const paramsNode = prop(fn, "parameters");
    if (paramsNode && ts.isObjectLiteralExpression(paramsNode)) {
      const propsNode = prop(paramsNode, "properties");
      const requiredNode = prop(paramsNode, "required");
      const required = new Set<string>();
      if (requiredNode && ts.isArrayLiteralExpression(requiredNode)) {
        for (const el of requiredNode.elements) {
          const t = literalText(el);
          if (t) required.add(t);
        }
      }
      if (propsNode && ts.isObjectLiteralExpression(propsNode)) {
        for (const m of propsNode.properties) {
          if (!ts.isPropertyAssignment(m)) continue;
          const pn = m.name;
          const key = ts.isIdentifier(pn) ? pn.text : ts.isStringLiteral(pn) ? pn.text : undefined;
          if (!key) continue;
          let type = "any";
          if (ts.isObjectLiteralExpression(m.initializer)) {
            const t = literalText(prop(m.initializer, "type"));
            if (t) type = t;
            else if (prop(m.initializer, "enum")) type = "enum";
          }
          params.push({ name: key, type, required: required.has(key) });
        }
      }
    }
    out.set(name, { description: description ? description.slice(0, 280) : undefined, params });
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      // Legacy shape: inline object literals inside a *TOOL_DEFINITIONS array (server/tools.ts).
      if (node.name.text.endsWith("TOOL_DEFINITIONS") && ts.isArrayLiteralExpression(node.initializer)) {
        for (const el of node.initializer.elements) {
          if (ts.isObjectLiteralExpression(el)) parseEntry(el);
        }
      }
      // Domain shape (tools-layer-split): standalone `const xDefinition: ToolDefinition = {...}`
      // consts referenced by identifier from a *DomainDefinitions array. parseEntry is safe on
      // any object literal — it bails unless the entry has a string-literal function.name.
      if (ts.isObjectLiteralExpression(node.initializer)) {
        parseEntry(node.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function ensureDirs() {
  fs.mkdirSync(STAGES_DIR, { recursive: true });
}

/** Build the fully-classified record set from the live registry SoT + static docs. */
function buildRecords() {
  const defs = extractToolDefs();
  const names = getAllRegisteredTools();
  const records = names.map((name) => {
    const meta = getToolMeta(name);
    const policy = TOOL_POLICIES[name];
    const def = defs.get(name);
    const base = buildSmokeRecord({
      name,
      description: def?.description,
      categories: meta?.categories,
      speed: meta?.speed,
      isNetworkTool: meta?.isNetworkTool,
      risk: getEffectiveToolRisk(name),
      riskClass: getToolRiskClass(name),
      requiresApproval: !!policy?.requiresApproval,
      trustedPersonasOnly: !!policy?.trustedPersonasOnly,
      requiresStructuredArgs: !!policy?.requiresStructuredArgs,
      hasValueCap: !!policy?.maxValue,
      irreversible: !!policy?.irreversible,
    });
    return { ...base, params: def?.params ?? [], hasDoc: !!def, explicitPolicy: !!policy };
  });
  return records;
}

/** Progress is tracked by signed-off tool NAME (resilient to registry churn). */
function readProgress(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
    if (Array.isArray(raw?.completedTools)) return raw.completedTools.filter((n: any) => typeof n === "string");
    return [];
  } catch {
    return [];
  }
}

function writeProgress(completedTools: string[]) {
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify(
      { completedTools: [...new Set(completedTools)].sort((a, b) => a.localeCompare(b)), updatedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
}

/** Drift fingerprint of the staged toolset (sorted names + stage size). */
function fingerprint(names: string[], stageSize: number): string {
  return crypto
    .createHash("sha256")
    .update(stageSize + "\n" + [...names].sort((a, b) => a.localeCompare(b)).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function generate(): void {
  ensureDirs();
  const records = buildRecords();
  const stages = partitionStages(records.map((r) => r.name), STAGE_SIZE);
  const liveSafe = records.filter((r) => r.smokeClass === "live-safe").length;
  const noDoc = records.filter((r) => !r.hasDoc).map((r) => r.name);

  const manifest = {
    generatedAt: new Date().toISOString(),
    stageSize: STAGE_SIZE,
    totalTools: records.length,
    liveSafeCount: liveSafe,
    docOnlyCount: records.length - liveSafe,
    totalStages: stages.length,
    // Drift token: changes when the staged toolset (names) or stage size changes.
    // Progress is name-based so completion auto-recomputes, but this surfaces churn.
    fingerprint: fingerprint(records.map((r) => r.name), STAGE_SIZE),
    toolsWithoutStaticDoc: noDoc,
    stages,
    tools: records,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  if (!fs.existsSync(PROGRESS)) writeProgress([]);

  const p = computeProgress(records, stages, STAGE_SIZE, readProgress());
  console.log(`[tool-smoke] manifest written: ${MANIFEST}`);
  console.log(`[tool-smoke] ${records.length} tools → ${stages.length} stages of ${STAGE_SIZE}`);
  console.log(`[tool-smoke] live-safe: ${liveSafe}  doc-only: ${records.length - liveSafe}`);
  if (noDoc.length)
    console.log(`[tool-smoke] NOTE: ${noDoc.length} registered tools have no TOOL_DEFINITIONS doc: ${noDoc.slice(0, 8).join(", ")}${noDoc.length > 8 ? " …" : ""}`);
  console.log(`[tool-smoke] progress: ${p.completedStageCount}/${stages.length} stages signed off — next: ${p.nextStage || "ALL DONE"}`);
}

function status(): void {
  if (!fs.existsSync(MANIFEST)) { console.error("[tool-smoke] no manifest — run with no args first"); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const p = computeProgress(m.tools, m.stages, m.stageSize, readProgress());
  console.log(`[tool-smoke] STATUS`);
  console.log(`  fingerprint:  ${m.fingerprint ?? "(none — regenerate manifest)"}`);
  console.log(`  tools:        ${p.totalTools} (live-safe ${p.liveSafeCount} / doc-only ${p.docOnlyCount})`);
  console.log(`  stages:       ${p.completedStageCount}/${p.totalStages} signed off (${p.percentComplete}%)`);
  console.log(`  tools done:   ${p.toolsVerified}/${p.totalTools}`);
  console.log(`  completed:    ${p.completedStages.join(", ") || "(none)"}`);
  console.log(`  NEXT STAGE:   ${p.nextStage || "ALL DONE"}${p.nextStage ? `  →  npx tsx scripts/tool-smoke-test.ts --stage ${p.nextStage}` : ""}`);
}

function emitStage(n: number, force: boolean): void {
  if (!fs.existsSync(MANIFEST)) { console.error("[tool-smoke] no manifest — run with no args first"); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!Number.isInteger(n) || n < 1 || n > m.stages.length) { console.error(`[tool-smoke] stage ${n} out of range 1..${m.stages.length}`); process.exit(2); }
  ensureDirs();
  const pad = String(n).padStart(2, "0");
  const out = path.join(STAGES_DIR, `stage-${pad}.md`);
  if (fs.existsSync(out) && !force) {
    console.error(`[tool-smoke] stage ${n} worklist already exists (${out}); it may contain hand-worked notes. Re-run with --force to regenerate.`);
    process.exit(1);
  }
  const byName = new Map<string, any>(m.tools.map((t: any) => [t.name, t]));
  const names: string[] = m.stages[n - 1];
  const doneSet = new Set(readProgress());
  const completed = names.length > 0 && names.every((nm) => doneSet.has(nm));
  const lines: string[] = [];
  lines.push(`# Tool Smoke-Test — Stage ${n} of ${m.stages.length}`);
  lines.push("");
  lines.push(`> ${names.length} tools. Status: ${completed ? "✅ signed off" : "⬜ pending"}. Generated from \`manifest.json\` (registry SoT).`);
  lines.push(`> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).`);
  lines.push(`> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). \`[x]\` = wired & documented; \`[ ]\` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a \`live-safe\` tool.`);
  lines.push("");
  for (const name of names) {
    const r = byName.get(name);
    const params = Array.isArray(r?.params) && r.params.length
      ? r.params.map((p: any) => `${p.name}${p.required ? "*" : ""}:${p.type}`).join(", ")
      : "(none)";
    // Programmatic wiring verdict: present in registry (always, since sourced from it) +
    // explicit policy (or documented default) + a static TOOL_DEFINITIONS doc.
    const wired = !!r?.hasDoc;
    const policyNote = r?.explicitPolicy ? "policy✓" : "policy=default(safe)";
    let verdict: string;
    if (!wired) {
      verdict = `[ ] **needs attention** — no TOOL_DEFINITIONS doc found (registry✓, ${policyNote}); confirm the tool is defined/wired`;
    } else if (r?.smokeClass === "live-safe") {
      verdict = `[x] wired & documented (registry✓, ${policyNote}, doc✓) — **live-safe**, live invocation optional/deferred`;
    } else {
      verdict = `[x] wired & documented (registry✓, ${policyNote}, doc✓) — **doc-only**, NOT invoked (${r?.reasons?.join("; ") || "gated"})`;
    }
    lines.push(`## \`${name}\`  —  **${r?.smokeClass ?? "?"}**`);
    if (r?.description) lines.push(`${r.description}`);
    lines.push(`- categories: ${r?.categories?.join(", ") || "—"} · speed: ${r?.speed || "—"} · network: ${r?.isNetworkTool ? "yes" : "no"}`);
    lines.push(`- risk: ${r?.risk || "safe"}${r?.riskClass ? ` (${r.riskClass})` : ""}${r?.reasons?.length ? ` · gates: ${r.reasons.join("; ")}` : ""}`);
    lines.push(`- params: ${params}`);
    lines.push(`- ${verdict}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`When every tool above is reviewed, run: \`npx tsx scripts/tool-smoke-test.ts --complete ${n}\``);
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`[tool-smoke] stage ${n} worklist → ${out} (${names.length} tools)`);
}

function complete(n: number): void {
  if (!fs.existsSync(MANIFEST)) { console.error("[tool-smoke] no manifest — run with no args first"); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!Number.isInteger(n) || n < 1 || n > m.stages.length) { console.error(`[tool-smoke] stage ${n} out of range 1..${m.stages.length}`); process.exit(2); }
  const stageTools: string[] = m.stages[n - 1] ?? [];
  const merged = [...new Set([...readProgress(), ...stageTools])];
  writeProgress(merged);
  const p = computeProgress(m.tools, m.stages, m.stageSize, merged);
  console.log(`[tool-smoke] stage ${n} signed off (${stageTools.length} tools). ${p.completedStageCount}/${p.totalStages} done — next: ${p.nextStage || "ALL DONE"}`);
}

function main() {
  const args = process.argv.slice(2);
  const flag = args[0];
  try {
    if (!flag || flag === "--generate") return generate();
    if (flag === "--status") return status();
    if (flag === "--stage") return emitStage(parseInt(args[1], 10), args.includes("--force"));
    if (flag === "--complete") return complete(parseInt(args[1], 10));
    console.error(`[tool-smoke] unknown flag: ${flag}`);
    process.exit(1);
  } catch (e: any) {
    console.error(`[tool-smoke] error: ${e?.message || e}`);
    process.exit(1);
  }
}

main();
