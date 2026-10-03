import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { failedDeliveryRequiresReconciliation } from "../../server/delivery-pipeline";

const { db } = await import("../../server/db");
const { artifactRecords, deliveryLogs } = await import("@shared/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const { deliverDigitalProduct, retryDelivery } = await import("../../server/delivery-pipeline");

const tenantId = 1;
const mark = `__delivery_retry_reconciliation_${Date.now()}__`;

async function createFailedDelivery({
  idempotencyKey,
  stripePaymentId,
  metadata,
}: {
  idempotencyKey?: string;
  stripePaymentId?: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const [row] = await db.insert(deliveryLogs).values({
    tenantId,
    customerName: `Delivery retry ${mark}`,
    customerEmail: "owner@example.test",
    productName: `Receipt reconciliation ${mark}`,
    fileName: `${mark}.unsupported`,
    status: "failed",
    idempotencyKey,
    stripePaymentId,
    metadata,
    errorMessage: "source file is unavailable",
  }).returning({ id: deliveryLogs.id });
  return row.id;
}

after(async () => {
  const rows = await db.select({ id: deliveryLogs.id }).from(deliveryLogs).where(and(
    eq(deliveryLogs.tenantId, tenantId),
    eq(deliveryLogs.productName, `Receipt reconciliation ${mark}`),
  ));
  const deliveryIds = rows.map((row) => row.id);
  if (deliveryIds.length === 0) return;
  await db.delete(artifactRecords).where(inArray(artifactRecords.deliveryLogId, deliveryIds));
  await db.delete(deliveryLogs).where(inArray(deliveryLogs.id, deliveryIds));
});

test("receipt-bearing failed delivery rows require reconciliation", () => {
  const receiptCases = [
    { driveFileId: "drive-primary" },
    { driveFolderId: "folder-primary" },
    { emailSent: true },
    { emailMessageId: "mail-receipt" },
    { metadata: { _deliveryBundleFiles: [{ fileName: "companion.txt", driveFileId: "drive-companion" }] } },
    { metadata: { _deliveryBundleFiles: [{ fileName: "companion.txt", driveFileId: 42 }] } },
    { errorMessage: "Drive upload completed but its delivery receipt could not be checkpointed" },
  ];

  for (const receipt of receiptCases) {
    assert.equal(
      failedDeliveryRequiresReconciliation(receipt),
      true,
      `receipt-bearing failure must not release for a new side effect: ${JSON.stringify(receipt)}`,
    );
  }
});

test("demonstrably pre-side-effect failures remain retryable", () => {
  assert.equal(failedDeliveryRequiresReconciliation({ errorMessage: "source file is unavailable" }), false);
});

test("generic and Stripe retry branches refuse receipt-bearing rows before releasing their keys", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");
  const genericStart = source.indexOf('if (!deliveryId && req.idempotencyKey)');
  const genericRelease = source.indexOf("const [released] = await db.update(deliveryLogs)", genericStart);
  const stripeStart = source.indexOf("if (req.stripePaymentId)");
  const stripeRelease = source.indexOf("console.log(`[delivery] RETRY-AFTER-FAILURE stripe=", stripeStart);

  assert.ok(genericStart >= 0 && genericRelease > genericStart);
  assert.ok(stripeStart >= 0 && stripeRelease > stripeStart);
  assert.ok(
    source.indexOf("if (failedDeliveryRequiresReconciliation(prior))", genericStart) < genericRelease,
    "generic idempotency must refuse a receipt-bearing failure before it releases the key",
  );
  assert.ok(
    source.indexOf("if (failedDeliveryRequiresReconciliation(prior))", stripeStart) < stripeRelease,
    "Stripe idempotency must refuse a receipt-bearing failure before it releases the payment key",
  );
});

test("runtime retry paths preserve receipt-bearing keys and only release demonstrably pre-side-effect failures", async () => {
  const genericReceiptKey = `generic-receipt-${mark}`;
  const genericReceiptId = await createFailedDelivery({
    idempotencyKey: genericReceiptKey,
    metadata: { _deliveryBundleFiles: [{ fileName: "proof.txt", driveFileId: 42 }] },
  });
  const genericReceiptResult = await deliverDigitalProduct({
    tenantId,
    customerName: "Owner",
    productName: `Receipt reconciliation ${mark}`,
    fileName: `${mark}.unsupported`,
    fileData: Buffer.from("no remote delivery should start"),
    idempotencyKey: genericReceiptKey,
  });
  assert.equal(genericReceiptResult.deliveryId, genericReceiptId);
  assert.equal(genericReceiptResult.inProgress, true);
  const [genericReceiptAfter] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, genericReceiptId));
  assert.equal(genericReceiptAfter.idempotencyKey, genericReceiptKey, "generic receipt-bearing key must remain claimed");
  const genericReceiptArtifacts = await db.select().from(artifactRecords).where(eq(artifactRecords.deliveryLogId, genericReceiptId));
  assert.equal(genericReceiptArtifacts.length, 0, "generic receipt-bearing retry must not begin a new artifact/send attempt");

  const stripeReceiptKey = `pi_receipt_${mark}`;
  const stripeReceiptId = await createFailedDelivery({
    stripePaymentId: stripeReceiptKey,
    metadata: { _deliveryBundleFiles: { corrupted: true } },
  });
  const stripeReceiptResult = await deliverDigitalProduct({
    tenantId,
    customerName: "Owner",
    productName: `Receipt reconciliation ${mark}`,
    fileName: `${mark}.unsupported`,
    fileData: Buffer.from("no remote delivery should start"),
    stripePaymentId: stripeReceiptKey,
  });
  assert.equal(stripeReceiptResult.deliveryId, stripeReceiptId);
  assert.equal(stripeReceiptResult.inProgress, true);
  const [stripeReceiptAfter] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, stripeReceiptId));
  assert.equal(stripeReceiptAfter.stripePaymentId, stripeReceiptKey, "Stripe receipt-bearing key must remain claimed");
  const stripeReceiptArtifacts = await db.select().from(artifactRecords).where(eq(artifactRecords.deliveryLogId, stripeReceiptId));
  assert.equal(stripeReceiptArtifacts.length, 0, "Stripe receipt-bearing retry must not begin a new artifact/send attempt");

  const manualRetryReceiptId = await createFailedDelivery({
    metadata: { _deliveryBundleFiles: { corrupted: true } },
  });
  const manualRetryReceiptResult = await retryDelivery(manualRetryReceiptId, tenantId);
  assert.equal(manualRetryReceiptResult.inProgress, true, "manual retry must route receipt-bearing rows to reconciliation");
  assert.match(manualRetryReceiptResult.error || "", /reconciliation/i);
  const manualRetryReceiptArtifacts = await db.select().from(artifactRecords).where(eq(artifactRecords.deliveryLogId, manualRetryReceiptId));
  assert.equal(manualRetryReceiptArtifacts.length, 0, "manual retry must not begin a new artifact/send attempt");

  const cmmcRetryId = await createFailedDelivery({
    metadata: {
      cmmcReportId: 2_000_000_000 + (Date.now() % 100_000_000),
      _deliverySourcePath: `tmp/missing-cmmc-${mark}.pdf`,
    },
  });
  const cmmcRetryResult = await retryDelivery(cmmcRetryId, tenantId);
  assert.equal(cmmcRetryResult.success, false);
  assert.match(
    cmmcRetryResult.error || "",
    /CMMC report record is unavailable; refusing an unsafe local-file retry/,
    "CMMC failures must execute durable report recovery before generic local-source retry",
  );

  const genericRetryKey = `generic-retry-${mark}`;
  const genericRetryId = await createFailedDelivery({ idempotencyKey: genericRetryKey });
  const genericRetryResult = await deliverDigitalProduct({
    tenantId,
    customerName: "Owner",
    productName: `Receipt reconciliation ${mark}`,
    fileName: `${mark}.unsupported`,
    fileData: Buffer.alloc(0),
    idempotencyKey: genericRetryKey,
  });
  assert.equal(genericRetryResult.success, false, "empty fixture must stop before Drive/email side effects");
  const [genericRetryAfter] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, genericRetryId));
  assert.equal(genericRetryAfter.idempotencyKey, null, "receipt-free generic failure must release its old key");

  const stripeRetryKey = `pi_retry_${mark}`;
  const stripeRetryId = await createFailedDelivery({ stripePaymentId: stripeRetryKey });
  const stripeRetryResult = await deliverDigitalProduct({
    tenantId,
    customerName: "Owner",
    productName: `Receipt reconciliation ${mark}`,
    fileName: `${mark}.unsupported`,
    fileData: Buffer.alloc(0),
    stripePaymentId: stripeRetryKey,
  });
  assert.equal(stripeRetryResult.success, false, "empty fixture must stop before Drive/email side effects");
  const [stripeRetryAfter] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, stripeRetryId));
  assert.equal(stripeRetryAfter.stripePaymentId, null, "receipt-free Stripe failure must release its old key");
});