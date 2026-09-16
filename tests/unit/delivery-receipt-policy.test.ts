import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCompletedArtifactReceipt,
  validateCompletedEmailReceipt,
} from "../../server/lib/delivery-receipt-policy";

const delivery = {
  status: "completed",
  emailSent: false,
  driveFileId: "drive-123",
  shareableLink: "https://drive.example/view",
  downloadLink: "https://app.example/download",
  folderLink: "https://drive.example/folder",
};

const artifacts = [{ status: "durable", driveFileId: "drive-123" }];

test("artifact receipt accepts a completed durable upload without producer email", () => {
  assert.equal(validateCompletedArtifactReceipt(delivery, artifacts, "drive-123"), null);
});

test("email receipt preserves the stricter persisted-email requirement", () => {
  assert.equal(
    validateCompletedEmailReceipt(delivery, artifacts, "drive-123"),
    "Delivery is not completed with a persisted email receipt",
  );
});

test("artifact receipt still fails closed on incomplete or mismatched durability evidence", () => {
  assert.match(
    validateCompletedArtifactReceipt({ ...delivery, status: "completion_uncertain" }, artifacts, "drive-123") || "",
    /not completed/,
  );
  assert.match(
    validateCompletedArtifactReceipt(delivery, [{ status: "pending", driveFileId: "drive-123" }], "drive-123") || "",
    /missing, non-durable, or do not match/,
  );
  assert.match(
    validateCompletedArtifactReceipt(delivery, artifacts, "different-drive-file") || "",
    /does not match/,
  );
});