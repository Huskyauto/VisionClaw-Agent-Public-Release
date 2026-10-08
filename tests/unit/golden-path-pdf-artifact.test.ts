import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isFreshPdfReplayArtifact, resolvePdfReplayArtifactPath } from "../../scripts/lib/golden-path-pdf-artifact";

test("golden-path PDF replay resolves the producer's /uploads URL against the configured production directory", () => {
  const result = {
    success: true,
    viewUrl: "https://drive.google.com/file/d/example/view",
    localPath: "/uploads/Q4-Productivity-Recap.pdf",
  };
  assert.equal(
    resolvePdfReplayArtifactPath(result, "/tmp/uploads"),
    "/tmp/uploads/Q4-Productivity-Recap.pdf",
  );
});

test("golden-path PDF replay rejects an uploads URL that is not a single PDF filename", () => {
  assert.equal(
    resolvePdfReplayArtifactPath({ localPath: "/uploads/../private/report.pdf" }, "/tmp/uploads"),
    undefined,
  );
  assert.equal(
    resolvePdfReplayArtifactPath({ localPath: "https://example.com/report.pdf" }, "/tmp/uploads"),
    undefined,
  );
  assert.equal(
    resolvePdfReplayArtifactPath({ filePath: "/etc/other-report.pdf" }, "/tmp/uploads"),
    undefined,
  );
});

test("golden-path PDF replay accepts only a freshly written regular PDF within uploads", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "golden-path-pdf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uploads = path.join(root, "uploads");
  fs.mkdirSync(uploads);
  const fresh = path.join(uploads, "fresh.pdf");
  const stale = path.join(uploads, "stale.pdf");
  const outside = path.join(root, "outside.pdf");
  fs.writeFileSync(fresh, "%PDF-new");
  fs.writeFileSync(stale, "%PDF-old");
  fs.writeFileSync(outside, "%PDF-outside");
  const start = Date.now() - 1000;
  fs.utimesSync(stale, new Date(start - 10_000), new Date(start - 10_000));
  fs.symlinkSync(outside, path.join(uploads, "linked.pdf"));
  assert.equal(isFreshPdfReplayArtifact(fresh, start, uploads), true);
  assert.equal(isFreshPdfReplayArtifact(stale, start, uploads), false);
  assert.equal(isFreshPdfReplayArtifact(path.join(uploads, "linked.pdf"), start, uploads), false);
});