import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  cmmcArtifactFilename,
  sha256Artifact,
  verifyCmmcArtifactBytes,
} from "../../server/cmmc-artifacts";

test("CMMC artifact names bind storage to one report revision and snapshot", () => {
  const hash = "a".repeat(64);
  assert.equal(
    cmmcArtifactFilename({ reportId: 42, snapshotHash: hash, kind: "pdf" }),
    `cmmc-report-42-${hash}-pdf`,
  );
  assert.notEqual(
    cmmcArtifactFilename({ reportId: 42, snapshotHash: hash, kind: "pdf" }),
    cmmcArtifactFilename({ reportId: 43, snapshotHash: hash, kind: "pdf" }),
  );
});

test("CMMC artifact verification refuses altered bytes and mismatched metadata", () => {
  const bytes = Buffer.from("signed report bytes");
  const sha256 = sha256Artifact(bytes);

  assert.doesNotThrow(() => verifyCmmcArtifactBytes({
    bytes,
    expectedSha256: sha256,
    expectedSize: bytes.length,
  }));
  assert.throws(
    () => verifyCmmcArtifactBytes({
      bytes: Buffer.from("signed rep0rt bytes"),
      expectedSha256: sha256,
      expectedSize: bytes.length,
    }),
    /hash mismatch/,
  );
  assert.throws(
    () => verifyCmmcArtifactBytes({
      bytes,
      expectedSha256: sha256,
      expectedSize: bytes.length + 1,
    }),
    /size mismatch/,
  );
});

test("CMMC delivery loads durable bytes before claiming delivery or reading an uploads path", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/cmmc-report.ts"), "utf8");
  const delivery = source.slice(source.indexOf("export async function deliverCmmcReportPair"));

  assert.match(delivery, /artifacts = await loadCmmcReportPair\(currentReport, params\.tenantId\)/);
  assert.match(delivery, /fileData: artifacts\.pdf/);
  assert.match(delivery, /fileData: artifacts\.docx/);
  assert.doesNotMatch(delivery, /filePath: resolveCmmcDeliveryFilePath/);
  assert.ok(
    delivery.indexOf("reconcileCompletedCmmcDelivery") < delivery.indexOf("loadCmmcReportPair"),
    "a completed receipt must reconcile before artifact recovery",
  );
});

test("CMMC reports cannot become ready without a verified durable read-back and deployable schema", () => {
  const artifacts = fs.readFileSync(path.join(process.cwd(), "server/cmmc-artifacts.ts"), "utf8");
  const report = fs.readFileSync(path.join(process.cwd(), "server/cmmc-report.ts"), "utf8");
  const seed = fs.readFileSync(path.join(process.cwd(), "server/seed.ts"), "utf8");

  assert.match(artifacts, /const databaseFallback = params\.bytes\.toString\("base64"\)/);
  assert.match(artifacts, /await loadCmmcArtifact\(\{[\s\S]*?expectedSha256: sha256/);
  assert.match(artifacts, /object storage read or verification failed; using database fallback/);
  assert.ok(
    report.indexOf("persistCmmcArtifact") < report.indexOf('status: "reports_ready"'),
    "the ready transition must remain after durable persistence",
  );
  for (const column of [
    "pdf_artifact_key",
    "docx_artifact_key",
    "pdf_sha256",
    "docx_sha256",
    "pdf_size",
    "docx_size",
  ]) {
    assert.match(seed, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(seed, /file_storage_cmmc_artifact_uidx/);
});

test("CMMC delivery retries return to durable paired-artifact recovery", () => {
  const pipeline = fs.readFileSync(path.join(process.cwd(), "server/delivery-pipeline.ts"), "utf8");
  const report = fs.readFileSync(path.join(process.cwd(), "server/cmmc-report.ts"), "utf8");

  assert.match(report, /metadata: \{ cmmcReportId: report\.id \}/);
  assert.match(pipeline, /const CMMC_DELIVERY_IDEMPOTENCY_KEY = \/\^cmmc-delivery-/);
  assert.match(pipeline, /async function retryCmmcDeliveryIfApplicable/);
  assert.match(pipeline, /const cmmcRetry = await retryCmmcDeliveryIfApplicable\(log\)/);
  assert.ok(
    pipeline.indexOf("const cmmcRetry = await retryCmmcDeliveryIfApplicable(log)") <
      pipeline.indexOf("const retrySource = readRetrySource(log)"),
    "CMMC must recover durable bytes before a generic retry reads a local source",
  );
});