import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  isTenantAuditCheckpointValid,
  tenantAuditCheckpointChecksum,
  type TenantAuditCheckpointShape,
} from "../../scripts/lib/tenant-audit-checkpoint";
import {
  computeTenantAuditCheckpointSourceHash,
  computeTenantAuditEvidenceHash,
} from "../../scripts/lib/tenant-audit-evidence-hash";
import { buildTenantAuditSchemaIndex } from "../../scripts/lib/tenant-audit-schema-index";

const source = readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
const checkpointSource = readFileSync("scripts/lib/tenant-audit-checkpoint.ts", "utf8");

test("tenant-isolation audit model calls are abortable and bounded", () => {
  assert.match(source, /AUDIT_CHUNK_TIMEOUT_MS/);
  assert.match(source, /AUDIT_TRIAGE_TIMEOUT_MS/);
  assert.match(source, /AUDIT_JURY_TIMEOUT_MS/);
  assert.match(source, /AUDIT_OPERATION_TIMEOUT_MS/);
  assert.match(source, /withAuditDeadline\(/);
  assert.match(
    source,
    /chat\.completions\.create\(\s*params,\s*\{\s*signal\s*\}\s*\)/s,
  );
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /timed out after/);
  assert.match(
    source,
    /if\s*\(failureReason\)[\s\S]*?writeReport\(\[\],\s*cov,\s*\[\],\s*evidenceHash\)[\s\S]*?process\.exit\(5\)/,
    "a budget-denied run must be degraded, never green",
  );
  assert.match(
    source,
    /if\s*\(precision\.degraded\)[\s\S]*?process\.exit\(5\)/,
    "an incomplete precision pass must be degraded, never green",
  );
  assert.match(
    source,
    /Math\.min\(2,\s*Math\.max\(0,\s*Math\.floor\(Number\(process\.env\.AUDIT_PARSE_RETRY_MAX\)\)\)\)/,
    "parse retries must have a small hard ceiling",
  );
  assert.match(
    source,
    /const estimate = meteredLlmEnabled\(\)[\s\S]*?\?\s*Math\.max\(0\.5,\s*chunksThisInvocation \* EST_USD_PER_CHUNK\)[\s\S]*?:\s*0\.01/,
    "free-only routing must retain a minimum claim without reserving paid per-chunk spend",
  );
  assert.match(source, /loadCheckpoint\(sourceFingerprint\(chunks,\s*evidenceHash\),\s*chunks\)/);
  assert.match(
    checkpointSource,
    /sortedKeys\.every\(\(key,\s*index\)\s*=>\s*key === String\(index\)\)/,
    "checkpoint indices must use canonical contiguous integer keys",
  );
  assert.match(source, /checkpoint\.completed\[String\(i\)\]\s*=\s*r\.findings[\s\S]*?saveCheckpoint\(checkpoint\)/);
  assert.match(
    source,
    /slice checkpointed:[\s\S]*?process\.exit\(7\)/,
    "saved partial coverage must never exit green",
  );
  assert.match(source, /chunksPending:\s*Math\.max\(0,\s*requiredChunks - chunksSucceeded - failures\.length\)/);
  assert.match(source, /const requiredChunks = chunks\.length/);
  assert.match(source, /const fullCoverage =\s*!intentionallyCapped/);
  assert.match(source, /\(cov\.chunksPending \|\| 0\) > 0/);
  assert.match(source, /const evidenceHash = computeTenantAuditEvidenceHash\(ROOT\)[\s\S]*?const files = collectFiles\(\)/);
  assert.match(source, /cov\.sourceChangedDuringRun = computeTenantAuditEvidenceHash\(ROOT\) !== evidenceHash/);
  assert.match(source, /!cov\.sourceChangedDuringRun/);
  assert.match(
    source,
    /if \(computeTenantAuditEvidenceHash\(ROOT\) !== evidenceHash\)[\s\S]*?checkpoint retained[\s\S]*?process\.exit\(5\)/,
  );

  const runner = readFileSync("scripts/run-tenant-isolation-audit-resumable.ts", "utf8");
  assert.match(runner, /if \(code !== 7\)/);
  assert.match(runner, /AUDIT_RUNNER_ALLOW_METERED === "1" \? "1" : "0"/);
  assert.match(runner, /TENANT_AUDIT_ENQUEUE_FIXES: "0"/);
  assert.match(runner, /JURY_AUTOAPPLY: "0"/);

  const readiness = readFileSync("scripts/verify-republish-readiness.ts", "utf8");
  assert.match(readiness, /checkpoint still exists/);
  assert.match(readiness, /coverage\.chunksSucceeded !== coverage\.chunksAttempted/);
  assert.match(readiness, /coverage\.sourceChangedDuringRun !== false/);
  assert.match(readiness, /report\.evidenceHash !== currentEvidenceHash/);
  assert.match(readiness, /severe finding disposition partition is incomplete/);
  assert.match(readiness, /deferred real-risk finding\(s\) remain/);

  const normalizer = readFileSync("scripts/normalize-completed-tenant-audit-report.ts", "utf8");
  assert.match(normalizer, /report\.evidenceHash !== currentEvidenceHash/);
  assert.doesNotMatch(normalizer, /report\.evidenceHash = computeTenantAuditEvidenceHash/);
  assert.ok(normalizer.indexOf("fs.writeFileSync(markdownPath") < normalizer.indexOf("fs.writeFileSync(reportPath"));

  const evidenceHash = readFileSync("scripts/lib/tenant-audit-evidence-hash.ts", "utf8");
  assert.match(evidenceHash, /"shared\/schema\.ts"/);
});

test("resumable audit controller preserves terminal statuses and resumes only on exit 7", () => {
  const dir = mkdtempSync(join(tmpdir(), "tenant-audit-resumable-"));
  const fixtureBin = join(dir, "bin");
  const fixtureNpx = join(fixtureBin, "npx");
  const statePath = join(dir, "invocations.txt");
  const runnerPath = join(process.cwd(), "scripts/run-tenant-isolation-audit-resumable.ts");
  const tsxPath = join(process.cwd(), "node_modules/.bin/tsx");

  mkdirSync(fixtureBin);
  writeFileSync(fixtureNpx, `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.AUDIT_FIXTURE_STATE;
const invocation = Number(fs.readFileSync(statePath, "utf8") || "0");
const codes = (process.env.AUDIT_FIXTURE_CODES || "").split(",").filter(Boolean).map(Number);
fs.writeFileSync(statePath, String(invocation + 1));
process.exit(codes[invocation] ?? 99);
`);
  chmodSync(fixtureNpx, 0o755);

  const runFixture = (codes: number[]) => {
    writeFileSync(statePath, "0");
    const result = spawnSync(tsxPath, [runnerPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
        AUDIT_FIXTURE_CODES: codes.join(","),
        AUDIT_FIXTURE_STATE: statePath,
        AUDIT_MAX_SLICES: "3",
        AUDIT_SLICE_CHUNKS: "1",
      },
    });
    const invocations = Number(readFileSync(statePath, "utf8"));
    return { result, invocations };
  };

  try {
    const resumed = runFixture([7, 6]);
    assert.equal(resumed.result.status, 6, "exit 6 is an accepted-risk terminal status");
    assert.equal(resumed.invocations, 2, "exit 7 must start the next bounded slice");

    for (const code of [0, 1, 2, 3, 4, 5, 6]) {
      const terminal = runFixture([code, 0]);
      assert.equal(terminal.result.status, code, `exit ${code} must be returned unchanged`);
      assert.equal(terminal.invocations, 1, `exit ${code} must stop without another slice`);
    }

    const capped = runFixture([7, 7, 7]);
    assert.equal(capped.result.status, 7, "slice-cap exhaustion must remain resumable, never green");
    assert.equal(capped.invocations, 3, "the controller must stop at the configured slice cap");
    assert.match(capped.result.stderr, /slice cap reached/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkpoint validation restarts after any tenant-audit evidence input changes", () => {
  const root = mkdtempSync(join(tmpdir(), "tenant-audit-checkpoint-"));
  const files = new Map([
    ["server/routes.ts", "db.select().from(example)\n"],
    ["scripts/tenant-isolation-audit.ts", "const auditVersion = 1;\n"],
    ["scripts/lib/tenant-audit-checkpoint.ts", "export const checkpointVersion = 1;\n"],
    ["scripts/lib/tenant-audit-evidence-hash.ts", "export const evidenceVersion = 1;\n"],
    ["scripts/lib/tenant-audit-schema-index.ts", "export const schemaIndexVersion = 1;\n"],
    ["shared/schema.ts", "export const example = pgTable(\"example\", {});\n"],
    ["data/tenant-isolation-audit/suppressions.json", "[]\n"],
    ["data/tenant-isolation-audit/deferrals.json", "[]\n"],
  ]);
  const chunks = [{ files: ["server/routes.ts"], text: "db.select().from(example)" }];
  const configuration = { model: "fixture-model", prompt: "fixture-prompt" };

  try {
    for (const [relativePath, body] of files) {
      const fullPath = join(root, relativePath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, body);
    }

    const evidenceHash = computeTenantAuditEvidenceHash(root);
    const sourceHash = computeTenantAuditCheckpointSourceHash(evidenceHash, configuration, chunks);
    const unsigned: Omit<TenantAuditCheckpointShape, "checksum"> = {
      version: 1,
      sourceHash,
      model: "fixture-model",
      chunksTotal: chunks.length,
      completed: { "0": [] },
      updatedAt: "2026-09-03T00:00:00.000Z",
    };
    const checkpoint: TenantAuditCheckpointShape = {
      ...unsigned,
      checksum: tenantAuditCheckpointChecksum(unsigned),
    };
    const checkpointPath = join(root, "data/tenant-isolation-audit/checkpoint.json");
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));

    const checkpointIsCurrent = () => {
      const parsed = JSON.parse(readFileSync(checkpointPath, "utf8")) as TenantAuditCheckpointShape;
      const currentEvidenceHash = computeTenantAuditEvidenceHash(root);
      const currentSourceHash = computeTenantAuditCheckpointSourceHash(
        currentEvidenceHash,
        configuration,
        chunks,
      );
      return isTenantAuditCheckpointValid({
        checkpoint: parsed,
        sourceHash: currentSourceHash,
        model: "fixture-model",
        chunksTotal: chunks.length,
        isCompletedEntryValid: () => true,
      });
    };

    assert.equal(checkpointIsCurrent(), true, "the original checksummed checkpoint must resume");
    for (const [relativePath, originalBody] of files) {
      const fullPath = join(root, relativePath);
      writeFileSync(fullPath, `${originalBody}// changed\n`);
      assert.equal(
        checkpointIsCurrent(),
        false,
        `changing ${relativePath} must invalidate old resumable progress`,
      );
      writeFileSync(fullPath, originalBody);
      assert.equal(checkpointIsCurrent(), true, `restoring ${relativePath} must restore the identity`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("precision schema indexing fails explicitly and retries after a read failure", () => {
  const root = mkdtempSync(join(tmpdir(), "tenant-audit-schema-index-"));
  const schemaPath = join(root, "shared/schema.ts");
  try {
    const missing = buildTenantAuditSchemaIndex(schemaPath);
    assert.equal(missing.ok, false, "a missing schema must not look like an empty valid index");

    mkdirSync(join(root, "shared"), { recursive: true });
    writeFileSync(
      schemaPath,
      `export const example = pgTable("example", { tenantId: integer("tenant_id") });\n`,
    );
    const recovered = buildTenantAuditSchemaIndex(schemaPath);
    assert.equal(recovered.ok, true, "a transient read failure must not be cached");
    if (recovered.ok) {
      assert.deepEqual(recovered.index.get("example"), { hasTenantId: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("republish readiness rejects a stale completed report", () => {
  const dir = mkdtempSync(join(tmpdir(), "republish-readiness-"));
  const reportPath = join(dir, "latest.json");
  const checkpointPath = join(dir, "checkpoint.json");
  writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    evidenceHash: "0".repeat(64),
    degraded: false,
    coverage: {
      scanned: 658,
      chunksAttempted: 61,
      chunksSucceeded: 61,
      chunksFailed: 0,
      chunksPending: 0,
      sourceChangedDuringRun: false,
      filesAudited: 658,
      failures: [],
      unreadableFiles: [],
    },
    findings: [],
    suppressed: [],
    severeDispositions: [],
  }));
  try {
    const result = spawnSync("npx", ["tsx", "scripts/verify-republish-readiness.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        AUDIT_REPORT_JSON: reportPath,
        AUDIT_CHECKPOINT_JSON: checkpointPath,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the current server\/audit inputs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});