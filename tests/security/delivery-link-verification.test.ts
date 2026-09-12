import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("delivery never emails or completes an artifact whose customer link is unverified", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");

  assert.match(source, /verifyDriveFilePublicAccess/);
  assert.match(source, /Drive permission verification failed; refusing to email an inaccessible artifact/);
  assert.match(source, /customerDelivery: true/);
  assert.doesNotMatch(source, /Link not verified after .* proceeding anyway/);
  assert.match(source, /const verification = await verifyDeliveryArtifact/);
  assert.match(source, /const uploadedFiles = \[/);
  assert.match(source, /for \(const uploaded of uploadedFiles\)/);
});

test("Drive permission proof paginates and rejects non-success upload responses", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/google-drive.ts"), "utf8");

  assert.match(source, /async function listAllDrivePermissions/);
  assert.match(source, /async function listMarkedCustomerDeliveryRoots/);
  assert.match(source, /nextPageToken/);
  assert.match(source, /if \(!resp\.ok\)/);
  assert.match(source, /if \(!response\.ok\)/);
  assert.match(source, /did not include a valid file ID/);
});

test("requested customer email cannot silently complete without a configured transport", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");
  assert.match(source, /req\.sendEmail !== false && req\.customerEmail && !isEmailConfigured\(\)/);
  assert.match(source, /Customer email transport is unavailable\. Do not retry automatically/);
});

test("uncertain or active deliveries cannot be retried into duplicate email sends", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");
  assert.match(source, /success: false,\s+deliveryId: prior\.id,[\s\S]*inProgress: true/);
  assert.match(source, /if \(prior && prior\.status !== "failed"\)/);
  assert.match(source, /log\.errorMessage\?\.includes\("Do not retry automatically"\)/);
  assert.match(source, /if \(log\.status !== "failed"\)/);
  assert.match(source, /idempotencyKey: log\.idempotencyKey \|\| undefined/);
  assert.doesNotMatch(source, /await updateDeliveryLog\(deliveryId, \{ status: "retrying"/);
});