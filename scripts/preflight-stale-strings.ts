#!/usr/bin/env tsx
/**
 * preflight-stale-strings.ts (R110.12, IJFW-inspired)
 *
 * Fails CI / preflight if forbidden stale strings appear in shippable surfaces.
 * Driven by `data/preflight-stale-strings.json`.
 *
 * Each rule:
 *   - `pattern`: either a literal string, or a /regex/ wrapped string
 *   - `forbidden_files`: globs that MUST NOT contain matches
 *   - `allowed_files`: globs that ARE permitted to contain matches (intentional history)
 *   - `current`: human-readable "what it should say now" (printed in the failure message)
 *   - `rationale`: why we care
 *
 * Exit codes:
 *   0 = clean (no stale strings found)
 *   1 = stale strings found (preflight blocker)
 *   2 = config or runtime error
 *
 * Usage:
 *   npx tsx scripts/preflight-stale-strings.ts
 *   npx tsx scripts/preflight-stale-strings.ts --json   # machine-readable output
 *   npx tsx scripts/preflight-stale-strings.ts --rule tools-count  # single rule
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

const CONFIG_PATH = path.resolve(process.cwd(), "data/preflight-stale-strings.json");

interface Rule {
  id: string;
  pattern: string;
  current: string;
  forbidden_files: string[];
  allowed_files: string[];
  rationale: string;
}

interface Config {
  rules: Rule[];
}

interface Finding {
  ruleId: string;
  file: string;
  line: number;
  match: string;
  current: string;
  rationale: string;
}

function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[preflight-stale] config not found: ${CONFIG_PATH}`);
    process.exit(2);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err: any) {
    console.error(`[preflight-stale] failed to read config: ${err?.message || err}`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.rules || !Array.isArray(parsed.rules)) {
      console.error(`[preflight-stale] config missing 'rules' array`);
      process.exit(2);
    }
    return parsed as Config;
  } catch (err: any) {
    // R110.11.5 pattern — distinguish ENOENT (handled above) from corrupt JSON.
    console.error(`[preflight-stale] config corrupt — refusing to run: ${err?.message || err}`);
    process.exit(2);
  }
}

function compilePattern(pattern: string): RegExp {
  // /regex/flags form
  const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    const [, body, flags] = m;
    return new RegExp(body, flags.includes("g") ? flags : flags + "g");
  }
  // Literal string — escape regex metachars, case-insensitive
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "gi");
}

async function expandGlobs(globs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const g of globs) {
    const matches = await glob(g, { cwd: process.cwd(), nodir: true, ignore: ["node_modules/**", ".git/**"] });
    for (const m of matches) out.add(path.normalize(m));
  }
  return out;
}

async function checkRule(rule: Rule): Promise<Finding[]> {
  const findings: Finding[] = [];
  const forbidden = await expandGlobs(rule.forbidden_files);
  const allowed = await expandGlobs(rule.allowed_files);
  const re = compilePattern(rule.pattern);

  for (const file of Array.from(forbidden)) {
    if (allowed.has(file)) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    } catch {
      continue; // file may have been deleted between glob and read
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        findings.push({
          ruleId: rule.id,
          file,
          line: i + 1,
          match: m[0],
          current: rule.current,
          rationale: rule.rationale,
        });
      }
    }
  }

  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const ruleIdx = args.indexOf("--rule");
  const onlyRule = ruleIdx >= 0 ? args[ruleIdx + 1] : null;

  const cfg = loadConfig();
  const rules = onlyRule ? cfg.rules.filter((r) => r.id === onlyRule) : cfg.rules;
  if (onlyRule && rules.length === 0) {
    console.error(`[preflight-stale] no rule with id="${onlyRule}"`);
    process.exit(2);
  }

  const allFindings: Finding[] = [];
  for (const rule of rules) {
    try {
      const f = await checkRule(rule);
      allFindings.push(...f);
    } catch (err: any) {
      console.error(`[preflight-stale] rule "${rule.id}" runtime error: ${err?.message || err}`);
      process.exit(2);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ status: allFindings.length === 0 ? "clean" : "stale", findings: allFindings }, null, 2));
  } else if (allFindings.length === 0) {
    console.log(`[preflight-stale] CLEAN — ${rules.length} rule(s) checked, no stale strings found.`);
  } else {
    console.error(`[preflight-stale] FAIL — ${allFindings.length} stale string(s) found across ${rules.length} rule(s):\n`);
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}  rule=${f.ruleId}  match="${f.match}"`);
      console.error(`    current SoT: ${f.current}`);
      console.error(`    rationale:   ${f.rationale}\n`);
    }
    console.error(`Fix each occurrence above OR add the file to the rule's allowed_files in data/preflight-stale-strings.json.`);
  }

  process.exit(allFindings.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[preflight-stale] uncaught: ${err?.stack || err}`);
  process.exit(2);
});
