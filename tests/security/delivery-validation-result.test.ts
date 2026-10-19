import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../server/db";
import { deliverDigitalProduct, type DeliveryRequest } from "../../server/delivery-pipeline";

test("pre-delivery validation failures return an unallocated identity without database side effects", async (t) => {
  const guards = ["select", "insert", "update", "delete", "execute"].map(method =>
    t.mock.method(db, method as keyof typeof db, () => { throw new Error("Validation must not touch the database"); }));
  const request: DeliveryRequest = {
    tenantId: 1, customerName: "Validation fixture", productName: "Validation fixture",
    fileName: "validation.txt", fileData: Buffer.from("fixture"), sendEmail: false,
  };
  for (const [overrides, error] of [
    [{ acceptanceCriteria: { requiredText: "invalid" } }, "Invalid customer acceptance criteria"],
    [{ reservedDeliveryId: 123, acceptanceCriteria: { requiredText: ["Required"] } },
      "Acceptance criteria require a non-reserved delivery identity"],
  ] as const) {
    const result = await deliverDigitalProduct({ ...request, ...overrides } as DeliveryRequest);
    assert.deepEqual(result, { success: false, deliveryId: 0, error });
  }
  for (const guard of guards) assert.equal(guard.mock.callCount(), 0);
});
