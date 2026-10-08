/**
 * Static execution guard for the scheduled IdeaBrowser report.
 * The script has provider/DB side effects at module load, so this validates
 * its fail-closed delivery contract without executing the full paid scenario.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const source = readFileSync(
  path.join(ROOT, "scripts/ideabrowser-weekly-scenario.ts"),
  "utf8",
);
const masterSource = readFileSync(
  path.join(ROOT, "scripts/ideabrowser-master-scenario.ts"),
  "utf8",
);

test("weekly scenario requires a configured owner address and verified email", () => {
  assert.match(source, /if\s*\(\s*!to\s*\)\s*\{[\s\S]*owner email is not configured/);
  assert.match(source, /if\s*\(\s*dr\.success\s*&&\s*dr\.emailSent\s*\)/);
  assert.match(source, /deliveryFailure\s*=\s*new Error/);
  assert.match(source, /if\s*\(\s*deliveryFailure\s*\)\s*\{\s*throw deliveryFailure/);
});

test("weekly scenario never labels email delivery best-effort", () => {
  assert.doesNotMatch(source, /Best-effort[\s\S]{0,200}deliverDigitalProduct/);
  assert.doesNotMatch(source, /if\s*\(\s*dr\.success\s*\)\s*\{/);
});

test("weekly scenario delivers and records an approved durable report path", () => {
  assert.match(source, /const deliveryPath = path\.join\("deliverables", reportFileName\)/);
  assert.match(source, /fs\.writeFileSync\(deliveryPath, md, "utf-8"\)/);
  assert.match(source, /filePath:\s*deliveryPath/);
  assert.match(source, /\$\{runProjectId\}, \$\{reportFileName\}, \$\{deliveryPath\}/);
  assert.doesNotMatch(source, /filePath:\s*outPath/);
  assert.match(source, /if\s*\(\s*persistenceFailure\s*\)\s*\{\s*throw persistenceFailure/);
  assert.match(source, /RETURNING id/);
  assert.match(source, /winner project #\$\{winner\.projectId\} was not updated/);
  assert.match(source, /persistenceFailure = e instanceof Error/);
});

test("master sweep covers the complete scored pool and fails closed on delivery", () => {
  assert.doesNotMatch(masterSource, /created_at\s*<=\s*NOW\(\)\s*-\s*INTERVAL\s*'7 days'/);
  assert.match(masterSource, /const deliveryPath = path\.join\("deliverables", reportFileName\)/);
  assert.match(masterSource, /filePath:\s*deliveryPath/);
  assert.match(masterSource, /if\s*\(\s*deliveryFailure\s*\)\s*\{\s*throw deliveryFailure/);
  assert.match(masterSource, /if\s*\(\s*persistenceFailure\s*\)\s*\{\s*throw persistenceFailure/);
  assert.match(masterSource, /'winnerProjectId', \$\{winner\.projectId\}::int/);
  assert.match(masterSource, /INSERT INTO project_files/);
  assert.match(masterSource, /RETURNING id/);
  assert.match(masterSource, /winner project #\$\{winner\.projectId\} was not updated/);
  assert.match(masterSource, /Report: \$\{deliveryPath\}/);
});