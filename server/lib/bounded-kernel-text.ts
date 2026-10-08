import { closeSync, openSync, readSync } from "node:fs";

export const MAX_KERNEL_TEXT_BYTES = 256 * 1024;

/** Bound allocation before reading, including proc/sysfs files with size=0. */
export function readBoundedKernelText(name: string): string {
  const fd = openSync(name, "r");
  try {
    const chunk = Buffer.allocUnsafe(4096);
    const parts: Buffer[] = [];
    let total = 0;
    for (;;) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, MAX_KERNEL_TEXT_BYTES + 1 - total), null);
      if (count === 0) return Buffer.concat(parts, total).toString("utf8");
      total += count;
      if (total > MAX_KERNEL_TEXT_BYTES) throw new Error("Kernel metadata exceeds read limit");
      parts.push(Buffer.from(chunk.subarray(0, count)));
    }
  } finally {
    closeSync(fd);
  }
}