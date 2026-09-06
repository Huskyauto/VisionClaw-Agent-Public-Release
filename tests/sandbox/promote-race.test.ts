/**
 * Regression pins for the sandbox_promote concurrent-promote race fix
 * (2026-07-19 post-edit review, MEDIUM). The race is made structurally
 * impossible by the partial unique index uq_sandbox_improvements_tenant_run
 * ON sandbox_improvements (tenant_id, run_id) WHERE run_id IS NOT NULL,
 * paired with ON CONFLICT ... DO NOTHING in the handler and a tenant-scoped
 * lost-race SELECT that returns alreadyPromoted instead of double-inserting
 * (and therefore never double-runs the jury).
 *
 * These pins are static-source on purpose: the sandbox test suite is DB-free
 * (a live pg pool keeps node:test from exiting — exit 124), and the invariant
 * being protected is the SHAPE of the SQL + control flow, which is exactly
 * what a refactor would silently drop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const handlersSrc = readFileSync(
  join(ROOT, "server/tools/domains/sandbox/handlers.ts"),
  "utf8",
);
const modelSrc = readFileSync(join(ROOT, "shared/models/sandbox.ts"), "utf8");

test("promote INSERT carries ON CONFLICT on the partial unique index (race-safe, no double-insert)", () => {
  const m = handlersSrc.match(
    /INSERT INTO sandbox_improvements[\s\S]{0,400}?RETURNING id/,
  );
  assert.ok(m, "sandbox_improvements INSERT block not found (update this pin if it moved)");
  const block = m[0];
  assert.match(
    block,
    /ON CONFLICT \(tenant_id, run_id\) WHERE run_id IS NOT NULL DO NOTHING/,
    "INSERT lost its ON CONFLICT clause matching the partial unique index — concurrent promotes can double-insert again",
  );
  assert.match(block, /RETURNING id/, "INSERT must RETURN id so the conflict loser sees zero rows");
});

test("lost-race branch: empty RETURNING ⇒ tenant-scoped SELECT + alreadyPromoted (never a second jury run)", () => {
  // The conflict-loser branch must exist, be tenant-scoped, and return
  // alreadyPromoted BEFORE any juryTriage call in source order.
  const raceIdx = handlersSrc.indexOf("Lost the race");
  assert.ok(raceIdx > 0, "lost-race branch comment/marker missing from sandbox_promote handler");

  const raceBlock = handlersSrc.slice(raceIdx, raceIdx + 900);
  assert.match(
    raceBlock,
    /SELECT id, status, jury_verdict FROM sandbox_improvements WHERE run_id = \$1 AND tenant_id = \$2/,
    "lost-race SELECT must stay tenant-scoped (run_id AND tenant_id)",
  );
  assert.match(raceBlock, /alreadyPromoted: true/, "lost-race branch must return alreadyPromoted:true");

  // Single-writer by construction: the INSERT (and its lost-race return) must
  // precede the juryTriage import/call, so only the row winner reaches the jury.
  const insertIdx = handlersSrc.indexOf("INSERT INTO sandbox_improvements");
  const juryIdx = handlersSrc.indexOf("juryTriage(");
  assert.ok(insertIdx > 0 && juryIdx > 0, "INSERT or juryTriage call not found");
  assert.ok(
    insertIdx < juryIdx && raceIdx < juryIdx,
    "INSERT + lost-race return must come BEFORE the juryTriage call — otherwise a conflict loser can still run the jury",
  );
});

test("Drizzle model mirrors the live partial unique index uq_sandbox_improvements_tenant_run", () => {
  assert.match(
    modelSrc,
    /uniqueIndex\("uq_sandbox_improvements_tenant_run"\)/,
    "shared/models/sandbox.ts lost the uq_sandbox_improvements_tenant_run uniqueIndex declaration",
  );
  const idx = modelSrc.indexOf("uq_sandbox_improvements_tenant_run");
  const near = modelSrc.slice(idx, idx + 300);
  assert.match(
    near,
    /run_id IS NOT NULL/,
    "uniqueIndex must keep its partial predicate (WHERE run_id IS NOT NULL) to match the live index",
  );
});
