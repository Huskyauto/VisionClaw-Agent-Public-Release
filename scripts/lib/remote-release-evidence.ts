import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { inflateRawSync } from "node:zlib";
import type { RemoteCheckReceipt, RemoteReleasePlan } from "./remote-release-contract";

export const hashBytes = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

type ZipEntry = {
  entryName: string;
  isDirectory: boolean;
  attr: number;
  header: { size: number; compressedSize: number; method: number; encrypted: boolean; crc: number };
  getCompressedData(): Buffer;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function boundedEntryData(entry: ZipEntry): Buffer {
  const header = entry.header;
  if (!Number.isSafeInteger(header.size) || header.size < 0 || header.size > MAX_ENTRY_BYTES ||
      !Number.isSafeInteger(header.compressedSize) || header.compressedSize < 0 ||
      header.compressedSize > MAX_ARCHIVE_BYTES)
    throw Error("Remote artifact member exceeds limit");

  const compressed = Buffer.from(entry.getCompressedData());
  if (compressed.length !== header.compressedSize)
    throw Error("Remote artifact compressed-size mismatch");

  let data: Buffer;
  try {
    if (header.method === 0) {
      if (compressed.length !== header.size) throw Error("Stored remote member size mismatch");
      data = compressed;
    } else if (header.method === 8) {
      data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } else {
      throw Error("Unsupported remote artifact compression method");
    }
  } catch (error) {
    if (error instanceof Error && /Stored remote member size mismatch|Unsupported remote artifact/.test(error.message))
      throw error;
    throw Error("Remote artifact decompression failed or exceeded limit");
  }
  if (data.length !== header.size) throw Error("Remote artifact size mismatch");
  if (crc32(data) !== header.crc) throw Error("Remote artifact CRC mismatch");
  return data;
}

/** Inspect in memory; never extract an API archive onto arbitrary filesystem paths. */
export function readRemoteEvidence(bytes: Uint8Array, expected: RemoteReleasePlan) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw Error("Remote archive exceeds 32 MiB");
  const entries = new AdmZip(Buffer.from(bytes)).getEntries();
  if (entries.length > 64) throw Error("Remote archive entry limit");
  const allowed = new Set(["plan.json", ...expected.checks.flatMap(c =>
    [`results/${c.id}.json`, `results/${c.id}.log`])]);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (name.includes("\\") || name.startsWith("/") || name.split("/").some(p => p === ".." || p === "."))
      throw Error("Unsafe remote artifact path");
    if (entry.isDirectory) {
      if (name !== "results/") throw Error("Unexpected remote artifact directory");
      continue;
    }
    if (!allowed.has(name) || files.has(name) || ((entry.attr >>> 16) & 0o170000) === 0o120000 ||
        entry.header.encrypted)
      throw Error("Unexpected, duplicate or symlink remote artifact entry");
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.header.size > MAX_ENTRY_BYTES)
      throw Error("Remote artifact member exceeds limit");
    total += entry.header.size;
    if (total > MAX_TOTAL_BYTES) throw Error("Remote artifact expansion exceeds limit");
    const data = boundedEntryData(entry);
    files.set(name, data);
  }
  if (files.size !== allowed.size) throw Error("Incomplete remote artifact");
  const plan = JSON.parse(files.get("plan.json")!.toString("utf8"));
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw Error("Remote plan differs from the submitted candidate");
  const receipts = expected.checks.map(check => {
    const receipt = JSON.parse(files.get(`results/${check.id}.json`)!.toString("utf8")) as RemoteCheckReceipt;
    if (receipt.logSha256 !== hashBytes(files.get(`results/${check.id}.log`)!))
      throw Error(`Remote log integrity failure: ${check.id}`);
    return receipt;
  });
  return { receipts, files, artifactSha256: hashBytes(Buffer.from(bytes)) };
}
