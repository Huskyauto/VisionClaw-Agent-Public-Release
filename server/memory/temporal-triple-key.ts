import { createHash, randomUUID } from "node:crypto";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A temporal triple needs one identity per source event, not one identity for
 * all time: a later message may reassert a fact after an earlier version expired.
 * Hashing keeps extracted conversation text out of the indexed key.
 */
export function temporalTripleKey(
  subject: string,
  predicate: string,
  object: string,
  sourceMessageId?: number | null,
): string {
  const source = Number.isSafeInteger(sourceMessageId) && Number(sourceMessageId) > 0
    ? `message:${sourceMessageId}`
    : `unlinked:${randomUUID()}`;
  return `temporal:${createHash("sha256")
    .update(JSON.stringify([normalize(subject), normalize(predicate), normalize(object), source]))
    .digest("hex")}`;
}