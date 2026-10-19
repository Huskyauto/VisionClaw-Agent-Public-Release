import fs from "node:fs";
import { createHash } from "node:crypto";

/** Validate the exact newly-written region, including UTF-8 byte length.
 * For append, this certifies the appended region, not preexisting file content.
 * Caller owns path authorization; do not expose this helper as a path probe. */
export function verifyWrittenRegion(filePath: string, content: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("write_readback_invalid_offset");
  const expected = Buffer.from(content, "utf8");
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== offset + expected.length) throw new Error("write_readback_size_mismatch");
    const chunk = Buffer.alloc(Math.min(64 * 1024, expected.length));
    for (let pos = 0; pos < expected.length;) {
      const size = Math.min(chunk.length, expected.length - pos);
      const n = fs.readSync(fd, chunk, 0, size, offset + pos);
      if (n !== size || !chunk.subarray(0, size).equals(expected.subarray(pos, pos + size))) throw new Error("write_readback_content_mismatch");
      pos += size;
    }
    return { version: 1, status: "checked" as const, scope: offset ? "appended_region" : "written_file",
      offset, bytes: expected.length, regionSha256: createHash("sha256").update(expected).digest("hex") };
  } finally { fs.closeSync(fd); }
}
