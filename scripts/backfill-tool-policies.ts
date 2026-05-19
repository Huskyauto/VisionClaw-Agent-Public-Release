#!/usr/bin/env tsx
/**
 * R115.5+sec round 3 — bulk-backfill TOOL_POLICIES for every tool currently
 * defined in TOOL_DEFINITIONS but missing from the explicit policy registry.
 *
 * Classification heuristic (descending priority):
 *  1. Name fragments matching destructive verbs → destructive HIGH
 *  2. Name fragments matching mutation/send verbs → sensitive MEDIUM
 *  3. Name fragments matching read-only verbs → safe LOW
 *  4. Default → sensitive MEDIUM (fail-secure for ambiguous tools)
 *
 * Each entry includes `requiresStructuredArgs: true` for non-`safe` tools so
 * the AHB gate inspects shape before dispatch. Output is appended to the
 * existing TOOL_POLICIES object via a marker-anchored edit.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TOOLS_PATH = path.join(ROOT, "server/tools.ts");
const POLICY_PATH = path.join(ROOT, "server/safety/destructive-tool-policy.ts");

const toolsSrc = fs.readFileSync(TOOLS_PATH, "utf8");
const policySrc = fs.readFileSync(POLICY_PATH, "utf8");

const allTools = new Set<string>();
const reName = /name:\s*"([a-z_][a-z0-9_]*)"/g;
let m: RegExpExecArray | null;
while ((m = reName.exec(toolsSrc))) allTools.add(m[1]);

const registered = new Set<string>();
const rePolicy = /^\s*([a-z_][a-z0-9_]*):\s*\{\s*name:\s*"([a-z_][a-z0-9_]*)"/gm;
while ((m = rePolicy.exec(policySrc))) registered.add(m[2]);

const unregistered = [...allTools].filter(t => !registered.has(t)).sort();

const DESTRUCTIVE_FRAGS = [
  "delete_", "destroy_", "drop_", "wipe_", "purge_", "remove_",
  "uninstall_", "revoke_", "_delete", "_destroy", "_remove",
];
const SENSITIVE_FRAGS = [
  "create_", "update_", "edit_", "modify_", "set_", "add_", "insert_",
  "send_", "post_", "publish_", "schedule_", "queue_", "enqueue_",
  "approve_", "reject_", "apply_", "execute_", "run_", "trigger_",
  "compose_", "draft_", "produce_", "generate_", "build_", "compile_",
  "submit_", "register_", "configure_", "rotate_", "upload_", "ingest_",
  "import_", "sync_", "commit_", "advance_", "promote_", "supersede_",
  "auto_", "deliver_", "broadcast_", "fire_", "dispatch_",
];
const SAFE_FRAGS = [
  "get_", "list_", "search_", "query_", "read_", "view_", "check_",
  "lookup_", "describe_", "explain_", "show_", "fetch_", "find_",
  "analyze", "audit", "report_", "status", "summary", "stats",
  "verify_", "inspect_", "scan_", "preview_", "_status", "_summary",
  "_get", "_list", "_search", "_query", "_check", "_view",
];

function classify(name: string): { risk: "safe" | "sensitive" | "destructive"; riskClass: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; structured: boolean } {
  const n = name.toLowerCase();
  for (const f of DESTRUCTIVE_FRAGS) if (n.includes(f)) return { risk: "destructive", riskClass: "HIGH", structured: true };
  for (const f of SENSITIVE_FRAGS) if (n.startsWith(f) || n.includes(f)) return { risk: "sensitive", riskClass: "MEDIUM", structured: true };
  for (const f of SAFE_FRAGS) if (n.startsWith(f) || n.includes(f)) return { risk: "safe", riskClass: "LOW", structured: false };
  return { risk: "sensitive", riskClass: "MEDIUM", structured: true };
}

const padName = Math.max(...unregistered.map(t => t.length));
const lines: string[] = [];
lines.push("  // R115.5+sec round 3 — bulk backfill of every previously-unregistered");
lines.push("  // tool. Auto-classified by name heuristic (scripts/backfill-tool-policies.ts):");
lines.push("  //   delete/destroy/drop/wipe/purge → destructive HIGH");
lines.push("  //   create/update/send/post/publish/schedule/run/etc. → sensitive MEDIUM");
lines.push("  //   get/list/search/query/read/check → safe LOW");
lines.push("  //   ambiguous → sensitive MEDIUM (fail-secure default)");
lines.push("  // Re-classify any individual entry by editing the row directly.");
const counts = { safe: 0, sensitive: 0, destructive: 0 };
for (const name of unregistered) {
  const c = classify(name);
  counts[c.risk]++;
  const key = (name + ":").padEnd(padName + 2);
  const body = c.structured
    ? `{ name: "${name}", risk: "${c.risk}", riskClass: "${c.riskClass}", requiresStructuredArgs: true }`
    : `{ name: "${name}", risk: "${c.risk}", riskClass: "${c.riskClass}" }`;
  lines.push(`  ${key}${body},`);
}

const marker = "  shell_exec:                  { name: \"shell_exec\",                  risk: \"destructive\", riskClass: \"CRITICAL\", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },";

if (!policySrc.includes(marker)) {
  console.error("[backfill] marker not found in policy file; aborting");
  process.exit(2);
}
if (policySrc.includes("R115.5+sec round 3 — bulk backfill")) {
  console.error("[backfill] round 3 backfill already present; refusing to double-append");
  process.exit(3);
}

// Find the closing `};` of TOOL_POLICIES — the line at column 0 with `};` AFTER our marker.
const markerIdx = policySrc.indexOf(marker);
const tail = policySrc.slice(markerIdx);
const closeRel = tail.search(/^};$/m);
if (closeRel < 0) {
  console.error("[backfill] TOOL_POLICIES closing brace not found");
  process.exit(4);
}
const closeAbs = markerIdx + closeRel;
const before = policySrc.slice(0, closeAbs);
const after = policySrc.slice(closeAbs);
const insertion = lines.join("\n") + "\n";
const out = before + insertion + after;
fs.writeFileSync(POLICY_PATH, out);
console.log(`[backfill] appended ${unregistered.length} entries (safe ${counts.safe} / sensitive ${counts.sensitive} / destructive ${counts.destructive}) to TOOL_POLICIES.`);
