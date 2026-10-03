import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("delivery creates a durable artifact intent before Drive and verifies the Drive bytes before completion", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");
  const receiptPolicy = fs.readFileSync(path.join(process.cwd(), "server/lib/delivery-receipt-policy.ts"), "utf8");
  const deliveryStart = source.indexOf("async function deliverDigitalProductInner");
  const delivery = source.slice(deliveryStart);
  const attempt = source.slice(source.indexOf("async function attemptUpload"), deliveryStart);

  assert.match(delivery, /createDeliveryArtifactIntents\(req, deliveryId\)/);
  assert.ok(
    delivery.indexOf("createDeliveryArtifactIntents(req, deliveryId)") < delivery.indexOf("for (let attempt = 1"),
    "intent must exist before upload/email retry side effects",
  );
  assert.match(attempt, /verifyAndMarkArtifactDurable/);
  assert.match(
    attempt,
    /durableArtifactKey: `delivery:\$\{deliveryId\}:primary`/,
    "the primary customer delivery must carry its stable delivery identity to Drive for crash recovery",
  );
  assert.match(
    attempt,
    /durableArtifactKey: `delivery:\$\{deliveryId\}:bundle:\$\{bundleIndex\}`/,
    "each bundled delivery file must carry its own stable recovery identity",
  );
  assert.ok(
    attempt.indexOf("verifyAndMarkArtifactDurable") < attempt.indexOf("return { success: true, uploadResult"),
    "Drive receipt must be byte-verified before upload succeeds",
  );
  assert.match(
    source,
    /if \(log\.status !== "completed"\) return \{ success: false, error: "Only completed deliveries can be resent" \}/,
  );
  assert.match(
    source,
    /artifacts\.length === 0 \|\| artifacts\.some\(\(artifact\) => artifact\.status !== "durable"\)/,
  );
  assert.match(source, /export async function verifyCompletedDeliveryReceipt/);
  assert.match(source, /eq\(artifactRecords\.deliveryLogId, params\.deliveryId\)/);
  assert.match(source, /validateCompletedArtifactReceipt\(delivery, artifacts, params\.driveFileId\)/);
  assert.match(receiptPolicy, /artifact\.driveFileId === expectedDriveFileId/);
  assert.match(
    source,
    /where\(and\(eq\(deliveryLogs\.id, id\), eq\(deliveryLogs\.tenantId, tenantId\)\)\)/,
  );
  assert.match(
    source,
    /status: "completion_uncertain"/,
    "a post-upload checkpoint failure must visibly stop automatic retries",
  );
  assert.match(
    source,
    /const resendPendingAt = new Date\(\)\.toISOString\(\)/,
    "resend intent must persist before the email side effect",
  );
});

test("generated Drive producers use the shared intent-before-upload durability boundary", () => {
  const drive = fs.readFileSync(path.join(process.cwd(), "server/google-drive.ts"), "utf8");
  const pdf = fs.readFileSync(path.join(process.cwd(), "server/pdf-create.ts"), "utf8");
  const docs = fs.readFileSync(path.join(process.cwd(), "server/doc-create.ts"), "utf8");
  const video = fs.readFileSync(path.join(process.cwd(), "server/video-job-runner.ts"), "utf8");
  const files = fs.readFileSync(path.join(process.cwd(), "server/tools/domains/files/handlers.ts"), "utf8");

  assert.ok(
    drive.indexOf("createArtifactIntent") < drive.indexOf("const result = await uploadToDrive"),
    "the shared generated-output boundary must record intent before Drive upload",
  );
  assert.match(drive, /verifyAndMarkArtifactDurable/);
  assert.match(drive, /if \(artifact\.driveFileId\)/, "retries must re-verify a receipt rather than duplicate an upload");
  for (const [name, source] of [["PDF", pdf], ["DOCX/XLSX", docs], ["video", video], ["agent file", files]] as const) {
    assert.match(source, /generatedArtifact:/, `${name} producer must opt into the durable artifact boundary`);
    assert.match(source, /tenantId:/, `${name} producer must pass trusted tenant ownership`);
  }
});