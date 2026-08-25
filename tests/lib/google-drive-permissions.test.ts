import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePublicDrivePermissions,
  isPrivateCustomerDeliveryRootPermissions,
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