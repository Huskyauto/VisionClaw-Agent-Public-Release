import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_KERNEL_TEXT_BYTES, readBoundedKernelText } from "../../server/lib/bounded-kernel-text";

test("kernel file reads accept the cap and reject overflow before unbounded allocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-kernel-"));
  const file = join(directory, "metadata");
  try {
    writeFileSync(file, "x".repeat(MAX_KERNEL_TEXT_BYTES));
    assert.equal(readBoundedKernelText(file).length, MAX_KERNEL_TEXT_BYTES);
    writeFileSync(file, "x".repeat(MAX_KERNEL_TEXT_BYTES + 1));
    for (let i = 0; i < 4; i++) assert.throws(() => readBoundedKernelText(file), /read limit/);
    writeFileSync(file, "memory accounting\n");
    assert.equal(readBoundedKernelText(file), "memory accounting\n");
    assert.throws(() => readBoundedKernelText(join(directory, "absent")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});