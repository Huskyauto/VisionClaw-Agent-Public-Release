import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sanitizeFilePath } from "../../server/webhookHandlers";

// Regression tests for the Stripe-metadata file_path traversal fix
// (72h review 2026-07-30): prefix-confusion siblings (uploads_evil),
// dot-dot traversal, and absolute paths must all fall back to
// uploads/<basename>, and in-root paths must come back normalized
// under uploads/.

const FALLBACK = path.join("uploads", "product.pdf");

test("legit uploads path passes and is normalized", () => {
  assert.equal(sanitizeFilePath("uploads/product.pdf", "product.pdf"), path.join("uploads", "product.pdf"));
  assert.equal(sanitizeFilePath("uploads/./sub/../product.pdf", "product.pdf"), path.join("uploads", "product.pdf"));
});

test("missing path falls back to uploads/<fileName>", () => {
  assert.equal(sanitizeFilePath(undefined, "product.pdf"), path.join("uploads", "product.pdf"));
});

test("sibling prefix-confusion dir is blocked (uploads_evil)", () => {
  assert.equal(sanitizeFilePath("uploads_evil/secret.txt", "product.pdf"), FALLBACK);
  assert.equal(sanitizeFilePath("uploadsX/secret.txt", "product.pdf"), FALLBACK);
});

test("dot-dot traversal is blocked", () => {
  assert.equal(sanitizeFilePath("uploads/../server/auth.ts", "product.pdf"), FALLBACK);
  assert.equal(sanitizeFilePath("../.env", "product.pdf"), FALLBACK);
});

test("absolute paths outside root are blocked", () => {
  assert.equal(sanitizeFilePath("/etc/passwd", "product.pdf"), FALLBACK);
});

test("uploads root itself (no file) is blocked", () => {
  assert.equal(sanitizeFilePath("uploads", "product.pdf"), FALLBACK);
  assert.equal(sanitizeFilePath("uploads/", "product.pdf"), FALLBACK);
});
