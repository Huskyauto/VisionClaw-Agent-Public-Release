import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "server/google-drive.ts"), "utf8");
const deliverySource = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");

test("Drive upload handles an unauthorized response before generic HTTP failure", () => {
  const uploadStart = source.indexOf("export async function uploadToDrive");
  const upload = source.slice(uploadStart, source.indexOf("async function findDriveFileByDurableArtifactKey", uploadStart));
  assert.ok(upload.indexOf("response.status === 401") < upload.indexOf("await response.json()"));
  assert.ok(upload.indexOf("response.status === 401") < upload.indexOf("if (!response.ok)"));
  assert.doesNotMatch(upload, /result\?\.error\?\.code === 401/);
  assert.match(upload, /fullRefreshCascade\("upload-401"\)/);
  assert.match(upload, /uploadToDrive\(\{ \.\.\.params, _retryCount: 1 \}\)/);
});

test("a dispatched upload with no observable response becomes reconciliation-only, never an automatic retry", () => {
  const uploadStart = source.indexOf("export async function uploadToDrive");
  const upload = source.slice(uploadStart, source.indexOf("async function findDriveFileByDurableArtifactKey", uploadStart));

  assert.match(upload, /let response: Response;/);
  assert.match(upload, /response = await fetchWithTimeout/);
  assert.match(upload, /Drive upload outcome is uncertain after request dispatch/);
  assert.match(upload, /Drive upload response could not be read; outcome is uncertain/);
  assert.match(upload, /completionUncertain: true/);
  assert.match(upload, /Drive upload returned HTTP \$\{response\.status\}; outcome is uncertain/);
  assert.match(upload, /Drive upload completed but sharing could not be verified/);
  assert.match(
    upload,
    /makeFileShareable\(result\.id, \{ relocateToPrivateRoot: true \}\)/,
    "all shared uploads must escape unsuitable inherited parent permissions before sharing",
  );
  assert.match(upload, /if \(!sharing\.success\) \{[\s\S]*completionUncertain: true/);
  assert.match(deliverySource, /completionUncertain: uploadResult\.completionUncertain/);
  assert.match(deliverySource, /if \(r\.completionUncertain\)/);
  assert.match(deliverySource, /could not checkpoint known primary Drive receipt/);
  assert.match(deliverySource, /could not checkpoint known bundle Drive receipt/);
  assert.match(deliverySource, /markArtifactDriveUploadDispatchPending/);
  assert.match(deliverySource, /clearArtifactDriveUploadDispatchPending/);
  const generatedUpload = source.slice(source.indexOf("export async function uploadAndShare"), source.length);
  assert.match(generatedUpload, /markArtifactDriveUploadDispatchPending/);
  assert.match(generatedUpload, /result\.completionUncertain/);
  assert.match(generatedUpload, /clearArtifactDriveUploadDispatchPending/);
  assert.match(source, /Bare artifact row IDs are recycled\/collide/);
  assert.match(source, /\^\(\?:delivery\|artifact\):\[A-Za-z0-9:_-\]\{8,180\}\$/);
  assert.match(deliverySource, /durableArtifactKey: `delivery:\$\{deliveryId\}:primary`/);
  const artifactSource = fs.readFileSync(path.join(process.cwd(), "server/durable-artifacts.ts"), "utf8");
  assert.match(artifactSource, /durability_verification_uncertain/);
  assert.match(artifactSource, /\^Artifact \(\?:size\|hash\) mismatch\$/);
});

test("every recovered Drive receipt repairs required sharing before it can complete", () => {
  assert.match(source, /async function ensureRecoveredDriveFileSharing/);
  const helperUses = source.match(/ensureRecoveredDriveFileSharing\(/g) || [];
  assert.equal(helperUses.length, 4, "one helper definition plus all three recovered receipt paths");
  assert.match(source, /Drive recovery found a file but sharing could not be verified/);
  const deliveryHelperUses = deliverySource.match(/ensureRecoveredDriveFileSharing/g) || [];
  assert.equal(deliveryHelperUses.length, 3, "delivery must import and call share repair for primary and bundle receipt reuse");
  const forcedPrivateRepairs = deliverySource.match(/forcePermissionRepair:\s*true/g) || [];
  assert.equal(forcedPrivateRepairs.length, 2, "primary and bundle recovery must force exact private-root permission repair");
});