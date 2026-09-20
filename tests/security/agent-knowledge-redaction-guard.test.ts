/**
 * CI guard — every direct `INSERT INTO agent_knowledge` callsite must run its
 * payload through the storage-boundary PII/secret redaction guard
 * (server/storage-helpers/pii-redaction-guard.ts).
 *
 * Why: agent_knowledge is a durable store fed by untrusted ingest (external
 * papers, research summaries, user prompts, cross-critique targets). The
 * central guard is only a chokepoint if EVERY write path is wired to it —
 * post-edit-code-review 2026-07-08 found 6 raw-SQL insert sites bypassing it.
 * This test fails CLOSED when a NEW file gains a raw agent_knowledge INSERT
 * without importing the guard.
 *
 * Static text scan only — never imports server/tools.ts or opens a DB pool
 * (node-test-db-pool-hang / tool-smoke-program rules).
 */
import { test } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";

// ESM-safe __dirname replacement — the repo runs under "type":"module" so
// `__dirname` is undefined at runtime (tool-policy-coverage.test.ts pattern).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../../server");
const GUARD_IMPORT = "pii-redaction-guard";
const INSERT_RE = /INSERT\s+INTO\s+agent_knowledge/i;

// Files allowed to insert WITHOUT the guard, with the reason pinned here so
// the allowlist stays auditable:
const ALLOWLIST = new Set([
  // watermark row — content is an internally-generated ISO timestamp only
  "auto-memorize.ts",
  // static, human-authored seed content — no untrusted input reaches it
  "seed.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("every raw agent_knowledge INSERT site imports the pii-redaction-guard", () => {
  const files = walk(SERVER_ROOT);
  assert.ok(files.length > 50, `sanity: expected many server .ts files, saw ${files.length}`);

  const violations: string[] = [];
  let insertSiteFiles = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf-8");
    if (!INSERT_RE.test(src)) continue;
    insertSiteFiles++;
    const base = path.basename(file);
    if (ALLOWLIST.has(base)) continue;
    if (!src.includes(GUARD_IMPORT)) {
      violations.push(path.relative(SERVER_ROOT, file));
    }
  }

  // Sanity: the scan must actually be finding the known insert sites — if the
  // regex or root path drifts, fail loudly instead of passing on 0 coverage
  // (audit-fail-closed-on-coverage rule).
  assert.ok(
    insertSiteFiles >= 5,
    `coverage sanity failed: only ${insertSiteFiles} files with agent_knowledge INSERTs found — scan is broken, not clean`,
  );

  assert.deepStrictEqual(
    violations,
    [],
    `Files with raw "INSERT INTO agent_knowledge" but NO ${GUARD_IMPORT} import — wire redactPiiForStorage/redactObjectForStorage before the INSERT (or add to the allowlist with a pinned reason): ${violations.join(", ")}`,
  );
});

test("guarded files call the redaction functions (import alone is not wiring)", () => {
  // For the sites fixed on 2026-07-08, assert the guard is actually CALLED,
  // not just imported — an unused import would silently satisfy the test above.
  const fixedFiles = [
    "recurring-messages.ts",
    "cross-critique.ts",
    "skill-synthesizer.ts",
    "research-engine.ts",
    "lib/paper-ingest.ts",
  ];
  const CALL_RE = /redact(PiiForStorage|ObjectForStorage|RecordFields)\s*\(/;
  for (const rel of fixedFiles) {
    const full = path.join(SERVER_ROOT, rel);
    assert.ok(fs.existsSync(full), `expected ${rel} to exist`);
    const src = fs.readFileSync(full, "utf-8");
    assert.ok(CALL_RE.test(src), `${rel} imports the guard but never calls a redaction function`);
  }
});
