#!/usr/bin/env tsx
/**
 * Read-only classification of retained SkillOpt artifacts.
 *
 * This script never imports the database or promotion service. It proves old
 * filesystem evidence is deterministic and non-authoritative: each run is
 * classified as rejected, held for full recreation/review, or failed.
 */

import fs from "node:fs";
import path from "node:path";
import { classifyRetainedOptimizerArtifact } from "../server/skill-optimizer-run";

const ROOT = path.resolve("data/skill-optimization");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/^run-.*\.json$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

const summary = { held: 0, rejected: 0, failed: 0 };
const results = walk(ROOT).map((runPath) => {
  let parsed: unknown;
  let parseError: string | undefined;
  try {
    parsed = JSON.parse(fs.readFileSync(runPath, "utf8"));
  } catch (error) {
    parsed = null;
    parseError = error instanceof Error ? error.message : String(error);
  }
  const classification = parseError
    ? { state: "failed" as const, reason: `artifact parse failed: ${parseError}` }
    : classifyRetainedOptimizerArtifact(
        parsed,
        fs.existsSync(path.join(path.dirname(runPath), "best_skill.md")),
      );
  summary[classification.state]++;
  return {
    runPath: path.relative(process.cwd(), runPath),
    ...classification,
  };
});

process.stdout.write(`${JSON.stringify({
  mode: "read-only-shadow",
  artifactRoot: path.relative(process.cwd(), ROOT),
  total: results.length,
  summary,
  results,
}, null, 2)}\n`);
if (summary.failed > 0) process.exitCode = 1;