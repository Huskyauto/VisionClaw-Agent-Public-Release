import { createHash } from "node:crypto";
import type { AuditPendingUnits } from "./tenant-audit-fallback";

export interface TenantAuditCheckpointShape<T = unknown> {
  version: 1;
  sourceHash: string;
  model: string;
  chunksTotal: number;
  completed: Record<string, T[]>;
  pending?: AuditPendingUnits<T>;
  updatedAt: string;
  checksum: string;
}

export function tenantAuditCheckpointChecksum<T>(
  checkpoint: Omit<TenantAuditCheckpointShape<T>, "checksum">,
): string {
  // jsonb reorders object keys at every durable write. Hash semantic JSON,
  // including nested findings/receipts, while preserving array order.
  const canonical = JSON.stringify(checkpoint, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value);
  return createHash("sha256").update("tenant-audit-checkpoint-json-v2\0").update(canonical).digest("hex");
}

export function isTenantAuditCheckpointValid<T>(options: {
  checkpoint: Partial<TenantAuditCheckpointShape<T>>;
  sourceHash: string;
  model: string;
  chunksTotal: number;
  isCompletedEntryValid: (entry: T, index: number) => boolean;
  routeCount?: number;
}): boolean {
  const { checkpoint, sourceHash, model, chunksTotal, isCompletedEntryValid } = options;
  const completed = checkpoint.completed;
  if (
    !completed ||
    typeof completed !== "object" ||
    Array.isArray(completed) ||
    Object.getPrototypeOf(completed) !== Object.prototype
  ) {
    return false;
  }

  const keys = Object.keys(completed);
  const sortedKeys = [...keys].sort((a, b) => Number(a) - Number(b));
  const contiguous = sortedKeys.every((key, index) => key === String(index));
  const validEntries = contiguous && sortedKeys.every((key) => {
    const index = Number(key);
    const entries = completed[key];
    return (
      index >= 0 &&
      index < chunksTotal &&
      Array.isArray(entries) &&
      entries.every((entry) => isCompletedEntryValid(entry, index))
    );
  });
  const pending = checkpoint.pending;
  if (pending !== undefined) {
    if (!pending || pending.chunk !== sortedKeys.length || pending.chunk >= chunksTotal ||
        !Number.isInteger(pending.nextRoute) || pending.nextRoute < 0 || pending.nextRoute >= (options.routeCount ?? 3) ||
        !pending.completed || Object.getPrototypeOf(pending.completed) !== Object.prototype ||
        !Object.keys(pending.completed).sort((a,b) => Number(a)-Number(b)).every((key, i) => {
          const receipt = pending.completed[key];
          return key === String(i) && receipt && typeof receipt.provider === "string" &&
            typeof receipt.model === "string" && Array.isArray(receipt.findings) &&
            receipt.findings.every(entry => isCompletedEntryValid(entry, pending.chunk));
        })) return false;
  }
  if (
    checkpoint.version !== 1 ||
    checkpoint.sourceHash !== sourceHash ||
    checkpoint.model !== model ||
    checkpoint.chunksTotal !== chunksTotal ||
    typeof checkpoint.updatedAt !== "string" ||
    typeof checkpoint.checksum !== "string" ||
    !validEntries
  ) {
    return false;
  }

  const { checksum, ...unsigned } = checkpoint as TenantAuditCheckpointShape<T>;
  // Legacy local JSON retains insertion order and may resume safely once.
  // Legacy jsonb that lost that order cannot be blessed or re-signed.
  return checksum === tenantAuditCheckpointChecksum(unsigned) ||
    checksum === createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
}