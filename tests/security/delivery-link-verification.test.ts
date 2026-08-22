import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("delivery never emails or completes an artifact whose customer link is unverified", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");

  assert.match(source, /Link verification failed after all upload attempts; refusing to email an inaccessible artifact/);
  assert.doesNotMatch(source, /Link not verified after .* proceeding anyway/);
  assert.match(source, /const verification = await verifyDeliveryArtifact/);
  assert.match(source, /uploadResult\.directDownloadLink,\s+uploadResult\.shareableLink/);
  assert.match(source, /bundle\.directDownloadLink, bundle\.shareableLink/);
});