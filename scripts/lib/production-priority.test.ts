import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Isolate the lock dir to a throwaway dir BEFORE importing the module (LOCK_DIR is
// read once at module load). Dynamic import lets us set the env first.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "prodlock-"));
process.env.PRODUCTION_LOCK_DIR = TMP;

const { acquireProductionPriority, isProductionActive, productionLockHolder, waitForProductionClear } =
  await import("./production-priority.ts");

const GEN_RE = /^production-priority\.lock\.(\d+)$/;
const genPath = (g: number) => path.join(TMP, `production-priority.lock.${g}`);

function writeGen(g: number, obj: unknown) {
  fs.writeFileSync(genPath(g), typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
}
function readGen(g: number): any {
  return JSON.parse(fs.readFileSync(genPath(g), "utf8"));
}
function highestGen(): number {
  let best = -1;
  for (const f of fs.readdirSync(TMP)) {
    const m = GEN_RE.exec(f);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best;
}
function clearAll() {
  for (const f of fs.readdirSync(TMP)) {
    if (/^production-priority\.lock\./.test(f) || /^\.tmp\./.test(f)) {
      try {
        fs.unlinkSync(path.join(TMP, f));
      } catch {
        /* already gone */
      }
    }
  }
}

test("acquire → active → release cycle", () => {
  clearAll();
  assert.equal(isProductionActive(), false);
  const release = acquireProductionPriority("test-job", 60_000);
  assert.equal(isProductionActive(), true);
  assert.equal(productionLockHolder(), "test-job");
  release();
  assert.equal(isProductionActive(), false);
  assert.equal(productionLockHolder(), null);
});

test("expired TTL is NOT active (fail-open backstop)", () => {
  clearAll();
  writeGen(0, { label: "stale", pid: process.pid, token: "x", startedAt: Date.now() - 1000, expiresAt: Date.now() - 1 });
  assert.equal(isProductionActive(), false);
  clearAll();
});

test("dead holder pid is NOT active (fail-open backstop)", () => {
  clearAll();
  // A pid that is virtually certain to be dead; TTL far in the future.
  writeGen(0, { label: "ghost", pid: 2147483646, token: "x", startedAt: Date.now(), expiresAt: Date.now() + 3_600_000 });
  assert.equal(isProductionActive(), false);
  clearAll();
});

test("corrupt top generation is NOT active (fail-open)", () => {
  clearAll();
  writeGen(0, "{not valid json");
  assert.equal(isProductionActive(), false);
  clearAll();
});

test("release only removes our OWN generation (does not clobber a later holder)", () => {
  clearAll();
  const release = acquireProductionPriority("first", 60_000); // authors gen 0
  // A later production run takes over by authoring the NEXT generation.
  writeGen(highestGen() + 1, {
    label: "second",
    pid: 2147483646,
    token: "other",
    startedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const later = highestGen();
  release(); // must remove ONLY gen 0 (its own), never the later holder's generation
  assert.equal(fs.existsSync(genPath(later)), true, "later holder's generation must survive");
  assert.equal(readGen(later).label, "second");
  clearAll();
});

test("acquire does NOT clobber an active lock held by another holder", () => {
  clearAll();
  // Active generation owned by a live pid (use our own pid so the liveness probe
  // passes) but a DIFFERENT token → a concurrent production run already owns it.
  writeGen(0, { label: "other-prod", pid: process.pid, token: "someone-else", startedAt: Date.now(), expiresAt: Date.now() + 60_000 });
  const release = acquireProductionPriority("second-prod", 60_000);
  assert.equal(readGen(0).label, "other-prod", "must not overwrite the active holder");
  assert.equal(fs.existsSync(genPath(1)), false, "must not author a competing generation while one is active");
  release(); // no-op: we never owned it
  assert.equal(readGen(0).label, "other-prod", "must not free another holder's generation on our exit");
  clearAll();
});

test("acquire takes over a stale/dead generation by authoring the next one", () => {
  clearAll();
  writeGen(0, { label: "dead-prod", pid: 2147483646, token: "x", startedAt: Date.now() - 1000, expiresAt: Date.now() - 1 });
  const release = acquireProductionPriority("fresh-prod", 60_000);
  assert.equal(isProductionActive(), true);
  assert.equal(productionLockHolder(), "fresh-prod");
  assert.equal(fs.existsSync(genPath(0)), false, "the superseded stale generation is GC'd");
  assert.equal(readGen(1).label, "fresh-prod", "the live holder authored generation 1");
  release();
  assert.equal(isProductionActive(), false);
  clearAll();
});

test("stale-takeover then a second acquire stands aside (exactly one owner)", () => {
  clearAll();
  // A stale generation exists; first run takes over and becomes the sole owner.
  writeGen(0, { label: "dead-prod", pid: 2147483646, token: "x", startedAt: Date.now() - 1000, expiresAt: Date.now() - 1 });
  const release1 = acquireProductionPriority("prod-1", 60_000); // authors gen 1
  const top = highestGen();
  const owner1 = readGen(top);
  assert.equal(owner1.label, "prod-1", "first run takes over the stale lock");
  // A second run now sees an ACTIVE generation (live pid + fresh TTL) → stand aside.
  const release2 = acquireProductionPriority("prod-2", 60_000);
  assert.equal(highestGen(), top, "second run must not author a new generation");
  assert.equal(readGen(top).token, owner1.token, "second run must not clobber the active owner");
  release2(); // no-op
  assert.equal(fs.existsSync(genPath(top)), true, "non-owner release must not free the lock");
  release1(); // real owner frees it
  assert.equal(fs.existsSync(genPath(top)), false, "owner release frees the lock");
  clearAll();
});

test("waitForProductionClear returns immediately when nothing is active", async () => {
  clearAll();
  const t0 = Date.now();
  await waitForProductionClear({ label: "waiter", maxWaitMs: 5000, pollMs: 50 });
  assert.ok(Date.now() - t0 < 500, "should not block when clear");
});

test("waitForProductionClear caps at maxWaitMs and proceeds (fail-open)", async () => {
  clearAll();
  // Active + held by THIS process with a future TTL → never clears on its own.
  acquireProductionPriority("blocker", 60_000);
  const t0 = Date.now();
  await waitForProductionClear({ label: "waiter", maxWaitMs: 200, pollMs: 50 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 150, `should have waited ~200ms, waited ${elapsed}ms`);
  assert.ok(elapsed < 2000, `should not block past the cap, waited ${elapsed}ms`);
  clearAll();
});
