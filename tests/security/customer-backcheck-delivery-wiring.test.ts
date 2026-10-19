import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pipeline=fs.readFileSync("server/delivery-pipeline.ts","utf8");
test("primary and companion snapshots bind verifier to durable intent before secret scan and upload",()=>{
  const source=pipeline.slice(pipeline.indexOf("async function attemptUpload("));
  assert.ok(source.indexOf("verifyDeliveryArtifact(")<source.indexOf("assertBackcheckIdentity("));
  assert.ok(source.indexOf("assertBackcheckIdentity(")<source.indexOf("artifact.fileData = bytes"));
  assert.ok(source.indexOf("artifact.fileData = bytes")<source.indexOf("scanDeliverablesForSecrets("));
  assert.ok(source.indexOf("scanDeliverablesForSecrets(")<source.indexOf("await uploadToDrive("));
  assert.match(source,/artifactIntents\.bundleArtifactIds\[index - 1\]/);
});
test("secret gate prefers the exact frozen buffer over a replaceable path",()=>{
  const scan=pipeline.slice(pipeline.indexOf("async function scanDeliverablesForSecrets("),pipeline.indexOf("async function attemptUpload("));
  assert.ok(scan.indexOf("if (f.fileData")>=0);
  assert.ok(scan.indexOf("if (f.fileData")<scan.indexOf("else if (f.filePath"));
});
test("both idempotency and Stripe receipts retain criteria and enforce completed-source identity",()=>{
  assert.equal((pipeline.match(/retainedAcceptanceCriteria\(req\.acceptanceCriteria, prior\.metadata\)/g)||[]).length,2);
  assert.equal((pipeline.match(/await assertCompletedReplayIdentity\(req, (?:prior|current)\.id\)/g)||[]).length,3);
  assert.match(pipeline,/eq\(artifactRecords\.tenantId, req\.tenantId\), eq\(artifactRecords\.deliveryLogId, deliveryId\)/);
});
