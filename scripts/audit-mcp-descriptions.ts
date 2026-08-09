#!/usr/bin/env tsx
/**
 * audit-mcp-descriptions (R115.5) — scan installed MCP skill descriptions
 * for prompt-injection-style imperative language directed at the agent.
 *
 * Per Osmani's "Agent Harness Engineering" (O'Reilly Radar, 2026-05-15):
 *
 *   "Tool descriptions populate the prompt, so any MCP server you install
 *    is trusted text the model will read. A sloppy or malicious MCP can
 *    prompt-inject your agent before you've typed anything."
 *
 * Currently the only installed MCP is figma (`.local/mcp_skills/figma/`).
 * That surface is small and Replit-provided, but we want a CI-runnable
 * gate so that the moment a less-trusted MCP gets added, hostile
 * instructions in its description get caught at install time.
 *
 * Rules (all case-insensitive substring or simple regex):
 *   - "ignore previous instructions"
 *   - "ignore all prior"
 *   - "disregard previous"
 *   - "system:"                 (mid-text, common injection lead)
 *   - "you must now"
 *   - "you are now a"
 *   - "act as "                 (when followed by another role)
 *   - "override your"
 *   - "do not refuse"
 *   - "without confirmation"    (often paired with destructive intent)
 *   - "<\\|.*\\|>"               (sentinel-tag injection style)
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one hit
 *   2 — config / read error
 *
 * Operator-facing per project conventions: env-var configured, no TTY
 * prompts, meaningful exit codes, stderr tells future-agent what to fix.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const MCP_ROOT = path.resolve(process.cwd(), ".local", "mcp_skills");

interface Rule {
  id: string;
  test: (haystack: string) => boolean;
  hint: string;
}

const RULES: Rule[] = [
  { id: "ignore-prior",       test: h => /ignore (previous|all prior|prior)\b/i.test(h),  hint: "imperative override directed at the agent" },
  { id: "disregard-previous", test: h => /disregard (previous|prior|earlier)/i.test(h),    hint: "imperative override directed at the agent" },
  { id: "system-marker",      test: h => /(^|\n|\s)system:\s/i.test(h),                    hint: "embedded 'system:' role marker" },
  { id: "you-must-now",       test: h => /\byou must now\b/i.test(h),                      hint: "imperative role-switch directed at agent" },
  { id: "you-are-now",        test: h => /\byou are now (a|an|the)\b/i.test(h),            hint: "imperative role-switch directed at agent" },
  { id: "override-your",      test: h => /\boverride your\b/i.test(h),                     hint: "explicit policy override" },
  { id: "do-not-refuse",      test: h => /\bdo not refuse\b/i.test(h),                     hint: "safety-bypass directive" },
  { id: "without-confirm",    test: h => /\bwithout (confirmation|approval|asking)\b/i.test(h), hint: "bypass HITL gates" },
  { id: "sentinel-tag",       test: h => /<\|[^|]{1,40}\|>/.test(h),                       hint: "sentinel-tag style injection" },
];

interface Finding {
  file: string;
  ruleId: string;
  hint: string;
  excerpt: string;
}

export interface ReadError {
  file: string;
  message: string;
}

function excerpt(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

// R115.5 MED-2 (architect close): scanFile now bubbles read errors up via a
// distinct ReadError channel instead of swallowing into empty findings. Read
// failures escalate to exit code 2 in main() so a broken scanner can never
// produce a false-clean outcome.
function scanFile(fp: string): { findings: Finding[]; readError?: ReadError } {
  let content = "";
  try {
    content = fs.readFileSync(fp, "utf8");
  } catch (e) {
    return { findings: [], readError: { file: fp, message: (e as Error).message } };
  }
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (rule.test(content)) {
      findings.push({ file: fp, ruleId: rule.id, hint: rule.hint, excerpt: excerpt(content) });
    }
  }
  return { findings };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (/SKILL\.md$/i.test(e.name)) out.push(fp);
  }
  return out;
}

export function auditMcpDescriptions(): { ok: boolean; findings: Finding[]; scannedFiles: string[]; readErrors: ReadError[] } {
  const files = walk(MCP_ROOT);
  const findings: Finding[] = [];
  const readErrors: ReadError[] = [];
  for (const fp of files) {
    const r = scanFile(fp);
    findings.push(...r.findings);
    if (r.readError) readErrors.push(r.readError);
  }
  return { ok: findings.length === 0 && readErrors.length === 0, findings, scannedFiles: files, readErrors };
}

// Exported rule list for invariant tests.
export const __rules = RULES;

function main(): void {
  if (!fs.existsSync(MCP_ROOT)) {
    process.stderr.write(`[audit-mcp-descriptions] no MCP root at ${MCP_ROOT} — nothing to scan.\n`);
    process.exit(0);
  }
  const { findings, scannedFiles, readErrors } = auditMcpDescriptions();
  // Exit 2: scanner integrity failure (read errors). MUST be checked before
  // exit 1 so a broken scanner never reports "clean".
  if (readErrors.length > 0) {
    process.stderr.write(`[audit-mcp-descriptions] SCANNER ERROR — ${readErrors.length} read failure(s):\n`);
    for (const r of readErrors) {
      process.stderr.write(`  - ${r.file}: ${r.message}\n`);
    }
    process.stderr.write(`\nFix: resolve the read error and re-run. Exit code 2 indicates scanner integrity, NOT a clean scan.\n`);
    process.exit(2);
  }
  if (findings.length > 0) {
    process.stderr.write(`[audit-mcp-descriptions] FAIL — ${findings.length} finding(s) across ${scannedFiles.length} MCP skill file(s):\n`);
    for (const f of findings) {
      process.stderr.write(`  - ${f.file} :: rule=${f.ruleId} (${f.hint})\n`);
      process.stderr.write(`    excerpt: ${f.excerpt}\n`);
    }
    process.stderr.write(`\nFix: review the SKILL.md, strip imperative-agent-directed language, or move the language into\nfenced code blocks that document USAGE (not directives). Re-run: npx tsx scripts/audit-mcp-descriptions.ts\n`);
    process.exit(1);
  }
  process.stdout.write(`[audit-mcp-descriptions] CLEAN — ${RULES.length} rule(s) checked across ${scannedFiles.length} MCP skill file(s).\n`);
  process.exit(0);
}

// Only run when invoked directly.
const isDirectInvocation = (() => {
  try { return import.meta.url === `file://${process.argv[1]}` || (process.argv[1] || "").endsWith("audit-mcp-descriptions.ts"); }
  catch { return false; }
})();
if (isDirectInvocation) main();
