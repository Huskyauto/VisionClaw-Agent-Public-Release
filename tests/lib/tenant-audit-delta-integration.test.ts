import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transformSync } from "esbuild";
import { auditUnitKey, sealAuditUnitLedger, restoreAuditUnitLedger, assertAuditReceiptCapacity } from "../../scripts/lib/tenant-audit-unit-ledger";
import { tenantAuditCheckpointChecksum, isTenantAuditCheckpointValid } from "../../scripts/lib/tenant-audit-checkpoint";
import { auditRoutes, resumeAuditUnits, splitAuditUnits, auditUnitLocationMatches,
  AuditProvidersExhausted, AuditWorkDeferred, AuditContentError } from "../../scripts/lib/tenant-audit-fallback";

test("real checkpoint/load/save/audit wiring rebuilds current coverage and dispatches only changed units", async () => {
  const source = fs.readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
  const loadSave = source.slice(source.indexOf("async function loadCheckpoint("), source.indexOf("\nasync function clearCheckpoint"));
  const audit = source.slice(source.indexOf("async function auditChunk("), source.indexOf("\nasync function prepareAuditCompletion("));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-delta-"));
  let durable: any, calls = 0;
  const contextHash = "a".repeat(64);
  const fixture = (file: string, body = "select") => ({ files: [file], text: `\n===== FILE: ${file} =====\n    1| ${body}\n` });
  const a = fixture("server/a.ts"), b = fixture("server/b.ts");
  const model = "claude-sonnet-5";
  const context: any = {
    fs, Buffer, console: { log() {}, error() {} }, log() {}, MODEL: model,
    CHECKPOINT_JSON: path.join(dir, "checkpoint.json"), REPORT_JSON_DIR: dir,
    unitLedger: sealAuditUnitLedger(contextHash), unitsDispatched: 0, unitsReused: 0,
    providerRecoveryNeeded: false, schedulingYieldNeeded: false,
    AUDIT_ROUTES: auditRoutes(), sealAuditUnitLedger, restoreAuditUnitLedger, auditUnitKey,
    splitAuditUnits, resumeAuditUnits, auditUnitLocationMatches, AuditProvidersExhausted, AuditWorkDeferred, AuditContentError,
    assertAuditReceiptCapacity, prepareAuditCompletion: async () => {},
    auditCompletionAvailable: async () => true,
    tenantAuditCheckpointChecksum, isTenantAuditCheckpointValid,
    isFinding: (f: any, files: Set<string>) => f && files.has(f.file) && f.line === 1 && f.severity === "HIGH",
    parseFindings: (raw: string) => JSON.parse(raw).findings,
    auditRouteAvailable: async () => true, auditRouteFailed: async () => {}, auditRouteSucceeded: async () => {},
    auditJobIdentity: () => ({ id: 1, attempt: 1 }),
    auditJobState: async (field?: string, value?: any) => {
      if (value !== undefined) durable = JSON.parse(JSON.stringify(value));
      return field ? durable : {};
    },
    freshCheckpoint: (sourceHash: string, chunksTotal: number) => {
      const unsigned = { version: 1 as const, sourceHash, chunksTotal, model, completed: {}, updatedAt: "fixture" };
      return { ...unsigned, checksum: tenantAuditCheckpointChecksum(unsigned) };
    },
    auditCompletion: async (_route: any, _system: any, content: string) => {
      calls++;
      const file = /FILE: ([^ ]+) =====/.exec(content)![1];
      return { raw: JSON.stringify({ findings: [{ file, line: 1, severity: "HIGH", issue: "fixture" }] }), model };
    },
    SYSTEM_PROMPT: "fixture", AUDIT_MAX_TOKENS: 100, AUDIT_CHUNK_TIMEOUT_MS: 55000,
  };
  const box = vm.createContext(context);
  // JSON values cross the same realm boundary as a jsonb round trip. Keep
  // Object's prototype aligned with the actual imported validator.
  vm.runInContext(transformSync(loadSave + audit +
    "\nglobalThis.entry={loadCheckpoint,saveCheckpoint,auditChunk};", { loader: "ts", format: "cjs" }).code, box);
  const run = async (hash: string, chunks: typeof a[]) => {
    const cp = await context.entry.loadCheckpoint(hash, chunks);
    for (let i = 0; i < chunks.length; i++) {
      const result = await context.entry.auditChunk(chunks[i], i, chunks.length, cp);
      assert.equal(result.ok, true);
      cp.completed[String(i)] = result.findings;
      delete cp.pending;
      await context.entry.saveCheckpoint(cp);
    }
    return cp;
  };
  try {
    await run("snapshot-1", [a, b]);
    assert.equal(calls, 2);
    // Simulate a fresh child process: the unit ledger must be restored only
    // from the persisted, checksummed checkpoint, not in-memory results.
    context.unitLedger = sealAuditUnitLedger(contextHash);
    const second = await run("snapshot-2", [a, fixture("server/b.ts", "changed")]);
    assert.equal(calls, 3, "the unchanged source must not be re-submitted");
    assert.equal(second.sourceHash, "snapshot-2");
    assert.equal(Object.keys(second.completed).length, 2);
    assert.equal(context.unitsReused, 1);
    context.unitLedger = sealAuditUnitLedger(contextHash);
    await run("snapshot-3", [fixture("server/0-new.ts"), a, fixture("server/b.ts", "changed")]);
    assert.equal(calls, 4, "early insertion must retain unchanged exact-input receipts");
    // A valid partial checkpoint predates a later unsplittable source unit.
    // Cache restoration may fail, but that must not erase its valid prefix.
    delete durable.completed["2"];
    durable.sourceHash = "with-poison";
    const { checksum: _checksum, ...unsigned } = durable;
    durable.checksum = tenantAuditCheckpointChecksum(unsigned);
    context.unitLedger = sealAuditUnitLedger(contextHash);
    const retained = await context.entry.loadCheckpoint("with-poison",
      [fixture("server/0-new.ts"), a, fixture("server/b.ts", "x".repeat(40_000))]);
    assert.equal(Object.keys(retained.completed).length, 2);
    assert.ok(Object.keys(context.unitLedger.receipts).length >= 2, "one unsplittable unit must not wipe unrelated receipts");
    assert.equal(calls, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
