import { createHash } from "node:crypto";

export interface TenantAuditCheckpointShape<T = unknown> {
  version: 1;
  sourceHash: string;
  model: string;
  chunksTotal: number;
  completed: Record<string, T[]>;
  updatedAt: string;
  checksum: string;
}

export function tenantAuditCheckpointChecksum<T>(
  checkpoint: Omit<TenantAuditCheckpointShape<T>, "checksum">,
): string {
  return createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex");
}

export function isTenantAuditCheckpointValid<T>(options: {
  checkpoint: Partial<TenantAuditCheckpointShape<T>>;
  sourceHash: string;
  model: string;
  chunksTotal: number;
  isCompletedEntryValid: (entry: T, index: number) => boolean;
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
  return checksum === tenantAuditCheckpointChecksum(unsigned);
}