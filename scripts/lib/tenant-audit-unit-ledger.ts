import { createHash } from "node:crypto";

export interface AuditUnitReceipt<T> { findings: T[]; provider: string; model: string }
export interface AuditUnitLedger<T> {
  version: 1;
  contextHash: string;
  receipts: Record<string, AuditUnitReceipt<T>>;
  checksum: string;
}
const MAX_LEDGER_BYTES = 6 * 1024 * 1024; // Leaves room in the existing 8 MiB job checkpoint.
export function planAuditSlice<T>(chunks: readonly T[], start: number, limit: number,
  cached: (chunk: T) => boolean): { end: number; uncached: number } {
  if (!Number.isSafeInteger(start) || start < 0 || start > chunks.length ||
      !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid bounded audit slice plan");
  let end = start, uncached = 0;
  while (end < chunks.length) {
    if (!cached(chunks[end])) {
      if (uncached >= limit) break;
      uncached++;
    }
    end++;
  }
  return { end, uncached };
}
export function assertAuditReceiptCapacity(ledger: unknown, checkpoint: unknown): void {
  // A fresh result is represented both in the ledger and the prefix/pending
  // receipts. Reserve its transport maximum BEFORE spending, including metadata.
  const resultBytes = 512 * 1024 + 4096;
  if ((ledger && Buffer.byteLength(JSON.stringify(ledger)) + resultBytes > MAX_LEDGER_BYTES) ||
      (checkpoint && Buffer.byteLength(JSON.stringify(checkpoint)) + 2 * resultBytes > 8 * 1024 * 1024))
    throw new Error("Audit receipt capacity exhausted before dispatch");
}
function hash(value: unknown): string {
  const json = JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  return createHash("sha256").update("tenant-audit-unit-ledger-v1\0").update(json).digest("hex");
}
export function auditUnitKey(contextHash: string, source: string): string {
  return hash({ contextHash, source });
}
export function auditScanContext(configuration: unknown, producerHashes: unknown): string {
  return hash({ configuration, producerHashes });
}
export function sealAuditUnitLedger<T>(
  contextHash: string, receipts: Record<string, AuditUnitReceipt<T>> = {},
): AuditUnitLedger<T> {
  const unsigned = { version: 1 as const, contextHash, receipts };
  if (Buffer.byteLength(JSON.stringify(unsigned)) > MAX_LEDGER_BYTES)
    throw new Error("Audit unit ledger capacity exhausted; refusing uncheckpointed work");
  return { ...unsigned, checksum: hash(unsigned) };
}

/** Old results are cache, never clearance. Only current exact-input keys survive. */
export function restoreAuditUnitLedger<T>(
  value: unknown, contextHash: string, sources: readonly string[],
  valid: (receipt: AuditUnitReceipt<T>, source: string) => boolean,
): AuditUnitLedger<T> {
  const empty = () => sealAuditUnitLedger<T>(contextHash);
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty();
  const v = value as AuditUnitLedger<T>;
  if (v.version !== 1 || v.contextHash !== contextHash || !v.receipts ||
      typeof v.receipts !== "object" || Array.isArray(v.receipts) ||
      Object.getPrototypeOf(v.receipts) !== Object.prototype ||
      typeof v.checksum !== "string" ||
      Buffer.byteLength(JSON.stringify(v)) > MAX_LEDGER_BYTES + 256) return empty();
  const { checksum, ...unsigned } = v;
  if (checksum !== hash(unsigned)) return empty();
  const current = new Map(sources.map(source => [auditUnitKey(contextHash, source), source]));
  const receipts: Record<string, AuditUnitReceipt<T>> = {};
  for (const [key, receipt] of Object.entries(v.receipts)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !receipt || !Array.isArray(receipt.findings) ||
        typeof receipt.provider !== "string" || !receipt.provider ||
        typeof receipt.model !== "string" || !receipt.model) return empty();
    const source = current.get(key);
    if (source === undefined) continue; // Deleted/edited units are not part of coverage.
    if (!valid(receipt, source)) return empty();
    receipts[key] = receipt;
  }
  return sealAuditUnitLedger(contextHash, receipts);
}
