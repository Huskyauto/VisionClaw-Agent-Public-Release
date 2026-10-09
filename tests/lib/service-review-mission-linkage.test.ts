/**
 * Task #157 — mission linkage on queued service orders must not silently
 * break in future changes.
 *
 * Proves the full chain that keeps fulfillment/delivery costs attributable
 * to revenue missions:
 *   1. Stripe checkout metadata.mission_id parses via missionIdFromStripeMetadata
 *      (absent/invalid metadata stays unattributed → null).
 *   2. addReviewItem persists missionId and getReviewItem returns it.
 *   3. The manual-approve + DFY-upgrade routes and the webhook service branch
 *      still FORWARD the linkage (static source guards — the routes need a
 *      live server/Stripe session, so the wiring is pinned at source level).
 *
 * Isolation: the queue module resolves its file through the
 * SERVICE_REVIEW_QUEUE_FILE test seam, so this test runs against a temp file
 * and never touches the operator's live data/service-review-queue.json.
 * Query-free: no DB calls (node:test pg-pool hang rule).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the queue at an isolated temp file BEFORE importing the module.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srq-test-"));
const tmpQueue = path.join(tmpDir, "service-review-queue.json");
process.env.SERVICE_REVIEW_QUEUE_FILE = tmpQueue;

const REAL_QUEUE = path.join(process.cwd(), "data", "service-review-queue.json");
const realQueueBytesBefore = fs.existsSync(REAL_QUEUE) ? fs.statSync(REAL_QUEUE).size : -1;
const realQueueMtimeBefore = fs.existsSync(REAL_QUEUE) ? fs.statSync(REAL_QUEUE).mtimeMs : -1;

import { addReviewItem, getReviewItem, updateReviewItem, findReviewItemBySessionId } from "../../server/service-review-queue";
import { missionIdFromStripeMetadata } from "../../server/lib/revenue-missions";

function baseItem(sessionId: string, missionId?: number) {
  return {
    sessionId,
    sku: "test-sku",
    productName: "Test Report",
    customerEmail: "test@example.com",
    customerName: "Test Customer",
    intake: {},
    filePath: "/tmp/nonexistent.pdf",
    fileName: "report.pdf",
    qa: { passed: true, issues: [] },
    missionId,
  };
}

test("mission_id in checkout metadata parses; absent/invalid stays unattributed", () => {
  assert.equal(missionIdFromStripeMetadata({ mission_id: "42" }), 42);
  assert.equal(missionIdFromStripeMetadata({ missionId: 7 }), 7);
  // Unattributed shapes → null (never a guessed/garbage id)
  assert.equal(missionIdFromStripeMetadata({}), null);
  assert.equal(missionIdFromStripeMetadata(undefined), null);
  assert.equal(missionIdFromStripeMetadata(null), null);
  assert.equal(missionIdFromStripeMetadata({ mission_id: "" }), null);
  assert.equal(missionIdFromStripeMetadata({ mission_id: "abc" }), null);
  assert.equal(missionIdFromStripeMetadata({ mission_id: "-3" }), null);
  assert.equal(missionIdFromStripeMetadata({ mission_id: "0" }), null);
  assert.equal(missionIdFromStripeMetadata({ mission_id: "1.5" }), null);
});

test("enqueue with mission_id metadata → getReviewItem returns missionId", async () => {
  const missionId = missionIdFromStripeMetadata({ mission_id: "42" });
  assert.equal(missionId, 42);
  const created = await addReviewItem(baseItem("cs_test_mission_42", missionId ?? undefined));
  assert.equal(created.missionId, 42);

  const fetched = getReviewItem(created.id);
  assert.ok(fetched, "getReviewItem must find the enqueued item");
  assert.equal(fetched!.missionId, 42, "missionId must round-trip through the queue file");

  // Linkage survives status updates (the approve path patches status/deliveryId).
  const updated = await updateReviewItem(created.id, { status: "shipped", deliveryId: 999 });
  assert.equal(updated!.missionId, 42, "missionId must survive updateReviewItem patches");

  // Dedupe path returns the SAME item (webhook replays keep the linkage).
  const dupe = await addReviewItem(baseItem("cs_test_mission_42", undefined));
  assert.equal(dupe.id, created.id);
  assert.equal(dupe.missionId, 42);
  assert.equal(findReviewItemBySessionId("cs_test_mission_42")!.missionId, 42);
});

test("enqueue without mission metadata stays unattributed", async () => {
  const missionId = missionIdFromStripeMetadata({ some_other_key: "x" });
  assert.equal(missionId, null);
  const created = await addReviewItem(baseItem("cs_test_no_mission", missionId ?? undefined));
  assert.equal(created.missionId, undefined);
  const fetched = getReviewItem(created.id);
  assert.equal(fetched!.missionId, undefined, "no metadata → item stays unattributed");
});

// ─────────────────────────────────────────────────────────────────────────
// Static source guards: the routes that FORWARD the linkage can't run in a
// query-free test, so pin the wiring at source level. If a future refactor
// drops the forwarding, these fail with a pointed message.
// ─────────────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("approve route forwards item.missionId into deliverDigitalProduct", () => {
  const src = stripComments(fs.readFileSync("server/routes/admin.ts", "utf8"));
  const approveIdx = src.indexOf("/api/admin/service-orders/:id/approve");
  assert.ok(approveIdx >= 0, "approve route must exist");
  const window = src.slice(approveIdx, approveIdx + 4000);
  assert.ok(
    /missionId:\s*item\.missionId/.test(window),
    "approve route must pass missionId: item.missionId to deliverDigitalProduct (task #153 linkage)"
  );
});

test("DFY-upgrade path inherits item.missionId", () => {
  const src = stripComments(fs.readFileSync("server/routes/admin.ts", "utf8"));
  const approveIdx = src.indexOf("/api/admin/service-orders/:id/approve");
  const upgradeWindow = src.slice(approveIdx + 4000); // rest of file incl. upgrade route
  assert.ok(
    /missionId:\s*item\.missionId/.test(upgradeWindow),
    "DFY-upgrade addReviewItem call must inherit missionId: item.missionId"
  );
});

test("webhook service branch stamps missionId from Stripe metadata at enqueue", () => {
  const src = stripComments(fs.readFileSync("server/webhookHandlers.ts", "utf8"));
  assert.ok(
    /missionIdFromStripeMetadata/.test(src),
    "webhookHandlers must derive the mission id via missionIdFromStripeMetadata"
  );
  const stamps = src.match(/missionId:\s*fulfillmentMissionId\s*\?\?\s*undefined/g) || [];
  assert.ok(
    stamps.length >= 2,
    `webhook service branch must stamp missionId on enqueue paths (success + failed); found ${stamps.length}`
  );
});

test("queue module honors the SERVICE_REVIEW_QUEUE_FILE test seam (real queue untouched)", () => {
  assert.ok(fs.existsSync(tmpQueue), "queue writes must land in the overridden temp file");
  const parsed = JSON.parse(fs.readFileSync(tmpQueue, "utf8"));
  assert.equal(parsed.version, 1);
  assert.ok(parsed.items.some((i: any) => i.sessionId === "cs_test_mission_42"));
  // The operator's live queue must be byte-for-byte untouched.
  const bytesAfter = fs.existsSync(REAL_QUEUE) ? fs.statSync(REAL_QUEUE).size : -1;
  const mtimeAfter = fs.existsSync(REAL_QUEUE) ? fs.statSync(REAL_QUEUE).mtimeMs : -1;
  assert.equal(bytesAfter, realQueueBytesBefore, "live queue size must not change");
  assert.equal(mtimeAfter, realQueueMtimeBefore, "live queue mtime must not change");
});
