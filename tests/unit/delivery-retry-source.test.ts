import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRetryDeliveryRequest,
  readRetrySource,
  resolveRetrySourcePath,
} from "../../server/delivery-pipeline";

test("retry preserves an eligible delivery's original workspace-relative source path", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "delivery-retry-source-"));
  const sourcePath = path.join(dir, "weekly-2026-08-23-github-render.mp4");
  const relativePath = path.relative(process.cwd(), sourcePath);
  fs.writeFileSync(sourcePath, "verified video fixture");
  try {
    assert.equal(
      resolveRetrySourcePath({
        fileName: "weekly-2026-08-23-github-render.mp4",
        metadata: { _deliverySourcePath: relativePath },
      }),
      relativePath,
    );
    assert.equal(
      readRetrySource({
        fileName: "weekly-2026-08-23-github-render.mp4",
        metadata: { _deliverySourcePath: relativePath },
      })?.fileData.toString(),
      "verified video fixture",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retry rejects a workspace symlink that resolves outside the project", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "delivery-retry-source-"));
  const outsidePath = path.join(os.tmpdir(), `delivery-retry-outside-${process.pid}.mp4`);
  const linkPath = path.join(dir, "escaped-video.mp4");
  fs.writeFileSync(outsidePath, "outside workspace fixture");
  fs.symlinkSync(outsidePath, linkPath);
  try {
    assert.equal(
      resolveRetrySourcePath({
        fileName: "escaped-video.mp4",
        metadata: {
          _deliverySourcePath: path.relative(process.cwd(), linkPath),
        },
      }),
      null,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsidePath, { force: true });
  }
});

test("retry rejects a source reached through a symlinked directory", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "delivery-retry-source-"));
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-retry-source-"));
  const linkDir = path.join(dir, "linked-directory");
  const sourcePath = path.join(externalDir, "external-video.mp4");
  fs.writeFileSync(sourcePath, "external content");
  fs.symlinkSync(externalDir, linkDir, "dir");

  try {
    assert.equal(
      readRetrySource({
        fileName: "external-video.mp4",
        metadata: { _deliverySourcePath: path.relative(process.cwd(), path.join(linkDir, "external-video.mp4")) },
      }),
      null,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});

test("retry rejects a source swapped to an in-workspace symlink immediately before open", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "delivery-retry-source-"));
  const sourcePath = path.join(dir, "expected-video.mp4");
  const sensitivePath = path.join(dir, "sensitive-but-in-workspace.mp4");
  const relativePath = path.relative(process.cwd(), sourcePath);
  fs.writeFileSync(sourcePath, "expected bytes");
  fs.writeFileSync(sensitivePath, "sensitive bytes");

  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = ((file: fs.PathLike, flags: string | number, mode?: string | number) => {
    if (!swapped && path.resolve(String(file)) === sourcePath) {
      swapped = true;
      fs.rmSync(sourcePath);
      fs.symlinkSync(sensitivePath, sourcePath);
    }
    return originalOpen(file, flags, mode as number | undefined);
  }) as typeof fs.openSync;

  try {
    assert.equal(
      readRetrySource({
        fileName: "expected-video.mp4",
        metadata: { _deliverySourcePath: relativePath },
      }),
      null,
      "a swap before open must not disclose another workspace file",
    );
  } finally {
    fs.openSync = originalOpen;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retry rejects absolute, traversal, malformed, missing, and non-file sources", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "delivery-retry-source-"));
  const directoryPath = path.join(dir, "not-a-file");
  const missingPath = path.join(dir, "missing-video.mp4");
  fs.mkdirSync(directoryPath);
  try {
    for (const candidate of [
      "/etc/passwd",
      "../outside.mp4",
      { unexpected: "metadata shape" },
      path.relative(process.cwd(), missingPath),
      path.relative(process.cwd(), directoryPath),
    ]) {
      assert.equal(
        resolveRetrySourcePath({
          fileName: `unavailable-${process.pid}.mp4`,
          metadata: { _deliverySourcePath: candidate },
        }),
        null,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy upload fallback is supported and retry preserves the original MIME type", () => {
  const fileName = `legacy-retry-${process.pid}.mp4`;
  const uploadsDir = path.join(process.cwd(), "uploads");
  const sourcePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(sourcePath, "legacy upload fixture");
  try {
    const source = readRetrySource({ fileName, metadata: null });
    assert.ok(source, "legacy uploads/<filename> source should be available");
    assert.equal(source.filePath, path.join("uploads", fileName));

    const request = buildRetryDeliveryRequest({
      tenantId: 1,
      customerName: "Test Customer",
      customerEmail: "test@example.test",
      productName: "Weekly recap",
      fileName,
      orderId: null,
      stripePaymentId: null,
      metadata: {
        _deliveryMimeType: "video/mp4",
        _deliverySourcePath: source.filePath,
      },
    }, source);
    assert.equal(request.filePath, undefined, "retry must use the verified byte snapshot, not reopen a path");
    assert.equal(request.fileData?.toString(), "legacy upload fixture");
    assert.equal(request.mimeType, "video/mp4");
  } finally {
    fs.rmSync(sourcePath, { force: true });
  }
});