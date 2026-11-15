import { createHash } from "node:crypto";
import { AuditContentError, type AuditRoute } from "./tenant-audit-fallback";

export function auditPaidRequestKey(route: AuditRoute, system: string, user: string, maxTokens: number): string {
  return createHash("sha256").update(JSON.stringify({
    contract: "audit-paid-request-v1", route, system, user, maxTokens: Math.min(maxTokens, 8192),
  })).digest("hex");
}
/** Write-ahead attempt is deliberately separate from clearable coverage caches.
 * Unknown outcomes require an explicit operator retry, never automatic wraparound.
 */
function readAttempts(raw: unknown): Record<string, number> {
  const value = raw === undefined ? {} : raw;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !Object.entries(value).every(([k, v]) => /^[a-f0-9]{64}$/.test(k) &&
        Number.isSafeInteger(v) && Number(v) > 0))
    throw new Error("Invalid durable audit paid-attempt state");
  return value as Record<string, number>;
}
export async function auditPaidAttemptExists(key: string, read: () => Promise<unknown>): Promise<boolean> {
  return !!readAttempts(await read())[key];
}
export async function reserveAuditPaidAttempt(key: string, ports: {
  read(): Promise<unknown>; write(value: Record<string, number>): Promise<void>; now?: () => number;
}): Promise<void> {
  const attempts = readAttempts(await ports.read());
  if (attempts[key]) throw new AuditContentError("Paid audit request was already attempted; explicit operator retry required");
  const next = { ...attempts, [key]: (ports.now ?? Date.now)() };
  if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024)
    throw new Error("Audit paid-attempt receipt capacity exhausted");
  await ports.write(next); // Must succeed under the current fence before dispatch.
}
