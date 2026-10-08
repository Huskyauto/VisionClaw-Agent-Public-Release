import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePublicDrivePermissions,
  ensureRecoveredDriveFileSharing,
  extractDriveFileId,
  isPrivateCustomerDeliveryRootPermissions,
  isSuitableCustomerDeliveryParentPermissions,
} from "../../server/google-drive";

test("customer delivery accepts only reader-only public Drive access", () => {
  assert.deepEqual(
    evaluatePublicDrivePermissions([{ type: "anyone", role: "reader", deleted: false }]),
    { verified: true, reason: "anyone-reader" },
  );
  assert.deepEqual(
    evaluatePublicDrivePermissions([
      { type: "anyone", role: "reader", deleted: false },
      { type: "anyone", role: "writer", deleted: false },
    ]),
    { verified: false, reason: "broader-anyone-permission" },
  );
  assert.deepEqual(
    evaluatePublicDrivePermissions([{ type: "user", role: "owner", deleted: false }]),
    { verified: false, reason: "missing-anyone-reader" },
  );
});

test("customer delivery root requires an owner-only permission set", () => {
  assert.equal(
    isPrivateCustomerDeliveryRootPermissions([{ type: "user", role: "owner", deleted: false }]),
    true,
  );
  assert.equal(
    isPrivateCustomerDeliveryRootPermissions([
      { type: "user", role: "owner", deleted: false },
      { type: "anyone", role: "writer", deleted: false },
    ]),
    false,
  );
});

test("customer delivery refuses inherited parent access beyond its owner", () => {
  for (const permission of [
    { type: "domain", role: "reader", deleted: false, permissionDetails: [{ inherited: true }] },
    { type: "group", role: "reader", deleted: false, permissionDetails: [{ inherited: true }] },
    { type: "user", role: "organizer", deleted: false, permissionDetails: [{ inherited: true }] },
  ]) {
    assert.deepEqual(
      isSuitableCustomerDeliveryParentPermissions([
        { type: "user", role: "owner", deleted: false },
        permission,
      ]),
      { suitable: false, reason: "non-owner-parent-permission" },
    );
  }
});

test("registered project files retain a durable Drive identity after local loss", () => {
  assert.equal(
    extractDriveFileId("https://drive.google.com/file/d/Abcdefghij_123456789/view?usp=sharing"),
    "Abcdefghij_123456789",
  );
  assert.equal(extractDriveFileId("Abcdefghij_123456789"), "Abcdefghij_123456789");
  assert.equal(extractDriveFileId("not a drive file"), null);
});

test("recovered customer deliveries force exact permission repair even when publicly readable", async () => {
  let repairs = 0;
  const result = await ensureRecoveredDriveFileSharing(
    { fileId: "Abcdefghij_123456789", viewUrl: "https://drive.google.com/file/d/Abcdefghij_123456789/view" },
    true,
    {
      forcePermissionRepair: true,
      verifyPublicAccess: async () => ({ verified: true, reason: "anyone-reader" }),
      makeShareable: async () => {
        repairs++;
        return { success: false, error: "inherited domain permission" };
      },
    },
  );
  assert.equal(repairs, 1);
  assert.deepEqual(result, { success: false, error: "Drive recovery found a file but sharing could not be verified: inherited domain permission" });
});