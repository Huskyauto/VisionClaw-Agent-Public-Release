import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractPdfTextBounded } from "../../server/upload-handling";
import { restorePdfCacheFromDurableBytes } from "../../server/service-review-queue";

test("bounded PDF inspector rejects oversized input and malformed PDF", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-bound-"));
  try {
    const huge = path.join(dir, "huge.pdf");
    await fs.writeFile(huge, Buffer.alloc(15 * 1024 * 1024 + 1, 0x41));
    await assert.rejects(() => extractPdfTextBounded(huge), /size/i);
    const malformed = path.join(dir, "bad.pdf");
    await fs.writeFile(malformed, Buffer.from("%PDF-not-a-real-document"));
    await assert.rejects(() => extractPdfTextBounded(malformed), /PDF|parser/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("bounded inspector enforces page, output, and deadline bounds", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-bound-"));
  const file = path.join(dir, "x.pdf");
  await fs.writeFile(file, Buffer.from("%PDF-"));
  try {
    const parser = (pages: number, text: string, delay = 0) => ({
      async load() {},
      async getInfo() { return { total: pages }; },
      async getText() { if (delay) await new Promise(r => setTimeout(r, delay)); return { text }; },
      destroy() {},
    });
    await assert.rejects(() => extractPdfTextBounded(file, { parserFactory: () => parser(101, "ok") }), /page/i);
    await assert.rejects(() => extractPdfTextBounded(file, { parserFactory: () => parser(1, "x".repeat(200_001)) }), /length/i);
    await assert.rejects(() => extractPdfTextBounded(file, { timeoutMs: 10, parserFactory: () => parser(1, "ok", 100) }), /timeout/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("durable PDF cache restoration validates signature", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-restore-"));
  const target = path.join(dir, "restored.pdf");
  try {
    await restorePdfCacheFromDurableBytes(target, Buffer.from("%PDF-valid"));
    assert.equal((await fs.readFile(target)).subarray(0, 5).toString(), "%PDF-");
    await assert.rejects(() => restorePdfCacheFromDurableBytes(target, Buffer.from("not-pdf")), /PDF/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("PDF worker timeout kills the child before delayed side effects", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-worker-"));
  const file = path.join(dir, "x.pdf");
  const worker = path.join(dir, "hang.cjs");
  const sentinel = path.join(dir, "sentinel");
  await fs.writeFile(file, Buffer.from("%PDF-"));
  await fs.writeFile(worker, `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(sentinel)}, "late"), 500);`);
  const started = Date.now();
  try {
    await assert.rejects(() => extractPdfTextBounded(file, { workerPath: worker, timeoutMs: 40 }), /timeout/i);
    assert.ok(Date.now() - started < 1000);
    await new Promise(r => setTimeout(r, 600));
    await assert.rejects(() => fs.access(sentinel));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});