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