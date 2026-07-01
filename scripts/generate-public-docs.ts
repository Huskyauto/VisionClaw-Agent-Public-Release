#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const TOOLS_SRC = path.join(ROOT, "server/tools.ts");
const PERSONA_SRC = path.join(ROOT, "server/seed-persona-prompts.ts");
const POLICY_SRC = path.join(ROOT, "server/safety/destructive-tool-policy.ts");
const OUT_DIR = path.join(ROOT, "docs");

function loadTrustedOnlyAllowlist(): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(POLICY_SRC)) return out;
  const src = fs.readFileSync(POLICY_SRC, "utf8");
  const re = /name:\s*"([a-z0-9_]+)"[^\n}]*trustedPersonasOnly:\s*true/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}
const TRUSTED_ONLY = loadTrustedOnlyAllowlist();

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

type ExtractedTools = { tools: Array<{ name: string; description: string }>; filteredCount: number };

function extractTools(): ExtractedTools {
  // Anchor on the OpenAI function-calling envelope used by every TOOL_DEFINITIONS
  // entry: `{ type: "function", function: { name: "...", description: "..." } }`.
  // The MoA role objects nested inside the `agent_op` handler
  // (`researcher`/`writer`/`analyst`/`critic`) lack the `function:` wrapper, so
  // this anchor cleanly excludes them. Earlier regex matched the bare
  // `{ name: ..., description: ... }` shape and over-counted by 4. Earlier
  // dynamic-import attempt was abandoned because importing tools.ts pulls the
  // entire app graph and stalls.
  const src = fs.readFileSync(TOOLS_SRC, "utf8");
  const declStart = src.indexOf("export const TOOL_DEFINITIONS");
  if (declStart < 0) throw new Error("TOOL_DEFINITIONS not found");
  const tail = src.slice(declStart);
  const re = /function:\s*\{\s*name:\s*"([a-z][a-z0-9_]*)"\s*,\s*description:\s*"((?:[^"\\]|\\.)*)"/g;
  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let filtered = 0;
  while ((m = re.exec(tail))) {
    const name = m[1];
    if (seen.has(name)) continue;
    if (TRUSTED_ONLY.has(name)) { seen.add(name); filtered++; continue; }
    seen.add(name);
    const desc = m[2].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
    out.push({ name, description: desc });
  }
  return { tools: out.sort((a, b) => a.name.localeCompare(b.name)), filteredCount: filtered };
}

function extractPersonas(): Array<{ id: number; name: string; role: string; identity: string }> {
  const src = fs.readFileSync(PERSONA_SRC, "utf8");
  const blockRe = /(\d+):\s*\{\s*identity:\s*`([^`]+)`/g;
  const out: Array<{ id: number; name: string; role: string; identity: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src))) {
    const id = parseInt(m[1], 10);
    const identity = m[2].trim();
    const first = identity.split(/\.|\n/)[0].trim();
    let name = "(unnamed)";
    let role = first;
    const yam = first.match(/^You are\s+([^,.]+?)(?:,\s*(.+))?$/i);
    if (yam) {
      name = yam[1].trim();
      role = (yam[2] || "").trim() || name;
    }
    out.push({ id, name, role, identity });
  }
  return out.sort((a, b) => a.id - b.id);
}

type ToolEntry = { name: string; description: string };
function writeToolsDoc(tools: ToolEntry[], filteredCount: number) {
  const lines: string[] = [];
  lines.push("# Tools Index");
  lines.push("");
  lines.push(`> Auto-generated from \`server/tools.ts\` by \`scripts/generate-public-docs.ts\`. Do not hand-edit.`);
  lines.push("");
  lines.push(`**${tools.length} public tools** wired into the persona dispatcher. Every call passes through the destructive-tool policy gate (\`server/safety/destructive-tool-policy.ts\`) and the AHB intent gate before execution. Tools flagged \`trustedPersonasOnly:true\` (introspection, raw SQL/shell, secret-rotation, undo, mass-comms) are intentionally **excluded** from this index so adversarial agents cannot fingerprint internal-only surface; ${filteredCount} such tools are filtered.`);
  lines.push("");
  lines.push("| Tool | Description |");
  lines.push("|------|-------------|");
  for (const t of tools) {
    const desc = t.description.length > 220 ? t.description.slice(0, 217) + "..." : t.description;
    lines.push(`| \`${t.name}\` | ${desc.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  fs.writeFileSync(path.join(OUT_DIR, "tools.md"), lines.join("\n"));
  console.log(`✓ wrote docs/tools.md (${tools.length} tools)`);
}

function writePersonasDoc(personas: ReturnType<typeof extractPersonas>) {
  const lines: string[] = [];
  lines.push("# Personas Index");
  lines.push("");
  lines.push(`> Auto-generated from \`server/seed-persona-prompts.ts\` by \`scripts/generate-public-docs.ts\`. Do not hand-edit.`);
  lines.push("");
  lines.push(`**${personas.length} personas** seeded into the platform. Each one is a distinct agent with its own identity, soul (personality), operating loop, tool allowlist, agents-doc (delegation map), and brand voice. Felix (CEO) coordinates; specialists execute.`);
  lines.push("");
  for (const p of personas) {
    lines.push(`## ${p.id}. ${p.name}`);
    lines.push("");
    lines.push(`**Role:** ${p.role}`);
    lines.push("");
    const summary = p.identity.length > 600 ? p.identity.slice(0, 597) + "..." : p.identity;
    lines.push(summary);
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "personas.md"), lines.join("\n"));
  console.log(`✓ wrote docs/personas.md (${personas.length} personas)`);
}

const extracted = extractTools();
const personas = extractPersonas();
writeToolsDoc(extracted.tools, extracted.filteredCount);
writePersonasDoc(personas);
console.log(`\nDone. Counts: ${extracted.tools.length} tools / ${personas.length} personas (${extracted.filteredCount} trusted-only filtered).`);
