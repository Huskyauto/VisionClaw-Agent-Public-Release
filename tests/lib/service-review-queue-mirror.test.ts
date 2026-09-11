/**
 * Republish-durability regression tests (architect HIGH, 2026-08-14):
 * fire-and-forget queue mirrors must never land out of order — a stale
 * mirror overwriting a newer one would make boot restore resurrect an old
 * queue and silently lose paid orders.
 *
 * Uses the SERVICE_REVIEW_QUEUE_FILE test seam for file isolation and the
 * injectable mirror writer so no live DB is touched (lib tests stay
 * query-free — pg pool holds the test process open otherwise).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpQueue = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "srq-test-")), "queue.json");
process.env.SERVICE_REVIEW_QUEUE_FILE = tmpQueue;

// Import AFTER the env seam is set.
const mod = await import("../../server/service-review-queue");

test("mirror scheduler: delayed older write can never overwrite a newer one", async () => {
  const landed: string[] = [];
  let firstCall = true;
  const prev = mod.__setMirrorWriterForTest(async (json: string) => {
    if (firstCall) {
      firstCall = false;
      await new Promise((r) => setTimeout(r, 50)); // slow "A" write
    }
    landed.push(json);
  });
  try {
    // Simulate rapid successive queue writes A → B → C while A's DB write drags.
    mod.__test_scheduleMirror("A");
    mod.__test_scheduleMirror("B");
    mod.__test_scheduleMirror("C");
    await mod.__awaitMirrorIdleForTest();
    assert.ok(landed.length >= 1);
    assert.equal(landed[landed.length - 1], "C", `newest snapshot must land last (got ${landed.join(",")})`);
    // Coalescing: B may be skipped entirely, but must never land AFTER C.
    assert.ok(!landed.slice(landed.indexOf("C") + 1).length, "no stale write after the newest");
  } finally {
    mod.__setMirrorWriterForTest(prev);
  }
});

test("queue file writes with test seam set never invoke the DB mirror", async () => {
  let mirrored = 0;
  const prev = mod.__setMirrorWriterForTest(async () => { mirrored += 1; });
  try {
    await mod.addReviewItem({
      sessionId: `sess_${Date.now()}`,
      sku: "test-sku",
      productName: "Test",
      customerEmail: "t@example.com",
      customerName: "T",
      intake: {},
      filePath: "uploads/x.pdf",
      fileName: "x.pdf",
      qa: { passed: true, issues: [] },
    } as any);
    await mod.__awaitMirrorIdleForTest();
    assert.equal(mirrored, 0, "test-seam queue writes must not mirror to the live DB");
  } finally {
    mod.__setMirrorWriterForTest(prev);
  }
});

test("durable add repairs an existing local item after first mirror failure", async () => {
  let calls = 0;
  const prev = mod.__setMirrorWriterForTest(async () => {
    calls++;
    if (calls === 1) throw new Error("simulated mirror outage");
  });
  const input: any = {
    sessionId: `durable_${Date.now()}`, sku: "test-sku", productName: "Test",
    customerEmail: "t@example.com", customerName: "T", intake: {},
    filePath: "", fileName: "", qa: { passed: false, issues: [] }, durable: true,
  };
  try {
    await assert.rejects(() => mod.addReviewItem(input));
    const repaired = await mod.addReviewItem(input);
    assert.equal(repaired.sessionId, input.sessionId);
    assert.equal(calls, 2);
    assert.equal(mod.listReviewItems().filter(i => i.sessionId === input.sessionId).length, 1);
  } finally { mod.__setMirrorWriterForTest(prev); }
});

test("durable update retries mirror failure without losing the queue item", async () => {
  let calls = 0;
  const prev = mod.__setMirrorWriterForTest(async () => {
    calls++;
    if (calls === 1) throw new Error("simulated mirror outage");
  });
  try {
    const item = await mod.addReviewItem({
      sessionId: `update_${Date.now()}`, sku: "test-sku", productName: "Test",
      customerEmail: "t@example.com", customerName: "T", intake: {},
      filePath: "", fileName: "", qa: { passed: false, issues: [] },
    } as any);
    await assert.rejects(() => mod.updateReviewItem(item.id, { artifactFilename: "a.pdf" }, { durable: true }));
    const repaired = await mod.updateReviewItem(item.id, { artifactFilename: "a.pdf" }, { durable: true });
    assert.equal(repaired?.artifactFilename, "a.pdf");
    assert.equal(calls, 2);
  } finally { mod.__setMirrorWriterForTest(prev); }
});

test("update returns target after terminal transition compacts and reorders queue", async () => {
  const first = await mod.addReviewItem({
    sessionId: `reorder_a_${Date.now()}`, sku: "test-sku", productName: "First",
    customerEmail: "first@example.com", customerName: "First", intake: {},
    filePath: "", fileName: "", qa: { passed: false, issues: [] },
  } as any);
  const second = await mod.addReviewItem({
    sessionId: `reorder_b_${Date.now()}`, sku: "test-sku", productName: "Second",
    customerEmail: "second@example.com", customerName: "Second", intake: {},
    filePath: "", fileName: "", qa: { passed: false, issues: [] },
  } as any);
  const updated = await mod.updateReviewItem(first.id, { status: "shipped" });
  assert.equal(updated?.id, first.id);
  assert.equal(updated?.customerName, "First");
  const listed = mod.listReviewItems();
  assert.equal(listed.find(item => item.id === first.id)?.customerName, "First");
  assert.ok(listed.findIndex(item => item.id === first.id) >= 0);
  void second;
});

after(() => {
  try { fs.rmSync(path.dirname(tmpQueue), { recursive: true, force: true }); } catch {}
});
