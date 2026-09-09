/**
 * Forcing-function test for AHB TOOL_POLICIES registry coverage.
 *
 * Pins the invariant that EVERY tool defined in server/tools.ts has an
 * explicit policy entry in destructive-tool-policy.ts. New tools must
 * appear in BOTH files in lockstep.
 *
 * Hard-fails if any TOOL_DEFINITIONS name is missing from TOOL_POLICIES so
 * unregistered destructive surface cannot land silently behind the default
 * `safe` posture. Adopted in R115.5+sec round 3 alongside the bulk backfill.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// R115.6 — ESM-safe __dirname replacement. The repo runs under "type":"module"
// so `__dirname` is undefined at runtime; use import.meta.url instead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const TOOLS_SRC = fs.readFileSync(path.join(ROOT, "server/tools.ts"), "utf8");
const POLICY_SRC = fs.readFileSync(path.join(ROOT, "server/safety/destructive-tool-policy.ts"), "utf8");

function parseToolNames(): Set<string> {
  const set = new Set<string>();
  const re = /name:\s*"([a-z_][a-z0-9_]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TOOLS_SRC))) set.add(m[1]);
  return set;
}

function parsePolicyNames(): Set<string> {
  const set = new Set<string>();
  const re = /^\s*[a-z_][a-z0-9_]*:\s*\{\s*name:\s*"([a-z_][a-z0-9_]*)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(POLICY_SRC))) set.add(m[1]);
  return set;
}

test("TOOL_DEFINITIONS ⊆ TOOL_POLICIES — every tool has an explicit policy row", () => {
  const tools = parseToolNames();
  const policies = parsePolicyNames();
  const missing = [...tools].filter(t => !policies.has(t)).sort();
  assert.equal(
    missing.length,
    0,
    `Tools missing explicit policy rows: ${missing.join(", ")}.\n` +
      `Add an entry to TOOL_POLICIES in server/safety/destructive-tool-policy.ts ` +
      `(or run scripts/backfill-tool-policies.ts for a default classification).`
  );
});

test("no destructive tool defaults to safe (kill-switch invariant)", () => {
  // Any policy row marked destructive must also have requiresApproval and trustedPersonasOnly.
  // This catches a future edit that downgrades a destructive entry by removing one of those flags.
  const reBlock = /\{\s*name:\s*"([a-z_][a-z0-9_]*)"[\s\S]*?\}/g;
  const blocks = POLICY_SRC.match(reBlock) || [];
  const offenders: string[] = [];
  for (const b of blocks) {
    if (!/risk:\s*"destructive"/.test(b)) continue;
    const name = (b.match(/name:\s*"([a-z_][a-z0-9_]*)"/) || [])[1] || "?";
    if (!/requiresApproval:\s*true/.test(b) || !/trustedPersonasOnly:\s*true/.test(b)) {
      offenders.push(name);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `Destructive tools without requiresApproval+trustedPersonasOnly: ${offenders.join(", ")}`
  );
});
