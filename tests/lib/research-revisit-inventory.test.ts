import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadResearchRevisitReport } from "../../scripts/lib/research-revisit-inventory";

test("inventory refuses symlinked and oversized source files instead of returning green", () => {
  const root = mkdtempSync(join(tmpdir(), "research-revisit-"));
  try {
    const now = new Date("2026-09-23T12:00:00Z");
    const opts = { now };
    writeFileSync(join(root, "MEMORY.md"), "- [Study](paper-verdict.md) — a source.");
    writeFileSync(join(root, "target.txt"), "---\nname: study\n---\nsource");
    symlinkSync(join(root, "target.txt"), join(root, "paper-verdict.md"));
    assert.throws(() => loadResearchRevisitReport(opts, root), /invalid research memory topic/i);
    rmSync(join(root, "paper-verdict.md"));
    writeFileSync(join(root, "paper-verdict.md"), "a".repeat(50_001));
    assert.throws(() => loadResearchRevisitReport(opts, root), /invalid research memory topic/i);
    writeFileSync(join(root, "paper-verdict.md"), "---\nname: study\n---\nsource");
    assert.equal(loadResearchRevisitReport(opts, root).total, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inventory fails visibly when the deployment has no memory directory", () => {
  const root = join(tmpdir(), `missing-research-inventory-${process.pid}`);
  assert.throws(() => loadResearchRevisitReport({ now: new Date("2026-09-23") }, root));
});

test("inventory rejects aggregate file-count and byte overflows before serving a partial match", () => {
  const root = mkdtempSync(join(tmpdir(), "research-revisit-bounds-"));
  try {
    writeFileSync(join(root, "MEMORY.md"), "- [Study](paper-verdict.md) — a source.");
    writeFileSync(join(root, "paper-verdict.md"), "---\nname: Study\n---\nsource");
    for (let i = 0; i < 1024; i++) writeFileSync(join(root, `extra-${i}.txt`), "");
    assert.throws(() => loadResearchRevisitReport({ now: new Date("2026-09-23") }, root), /file limit/i);
    for (let i = 0; i < 1024; i++) rmSync(join(root, `extra-${i}.txt`));
    for (let i = 0; i < 164; i++) writeFileSync(join(root, `older-${i}-verdict.md`), "x".repeat(49_000));
    assert.throws(() => loadResearchRevisitReport({ now: new Date("2026-09-23") }, root), /byte limit/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});