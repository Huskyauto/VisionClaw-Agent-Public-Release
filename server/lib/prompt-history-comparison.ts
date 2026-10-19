import { createHmac, randomBytes } from "node:crypto";
import { logSilentCatch } from "./silent-catch";

interface Scope { tenantId: number; conversationId: number; channel: string }
interface Observation { compared: number; changed: number; skipped: number }

function safeToSerialize(value: unknown, budget: number): boolean {
  const seen = new Set<object>();
  let nodes = 4096;
  function visit(v: unknown, depth: number): boolean {
    if (--nodes < 0 || depth > 16 || budget < 0) return false;
    if (typeof v === "string") { budget -= v.length * 6 + 2; return budget >= 0; }
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      budget -= 32; return budget >= 0;
    }
    if (!v || typeof v !== "object" || seen.has(v)) return false;
    const proto = Object.getPrototypeOf(v);
    // Plain objects (including cross-realm fixtures), arrays and null records.
    if (!Array.isArray(v) && proto !== null && Object.getPrototypeOf(proto) !== null) return false;
    if ("toJSON" in v || (Array.isArray(v) && v.length > 4096)) return false;
    seen.add(v);
    budget -= 2;
    for (const key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
      budget -= key.length * 6 + 4;
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !("value" in descriptor) || !visit(descriptor.value, depth + 1)) return false;
    }
    seen.delete(v);
    return budget >= 0;
  }
  return visit(value, 0);
}

/** Advisory, process-local only. Keyed digests cannot be dictionary-tested
 * without the disposable secret; raw prompt bytes are never retained/logged. */
export class PromptHistoryComparison {
  private readonly secret = randomBytes(32);
  private readonly snapshots = new Map<string, { at: number; hashes: Map<number, string> }>();
  constructor(private readonly capacity = 200, private readonly ttlMs = 30 * 60_000) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 ||
        !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 60_000) {
      throw new Error("Invalid prompt comparison bounds");
    }
  }

  observe(scope: Scope, messages: { id: number; message: unknown }[], now = Date.now()): Observation {
    const result = { compared: 0, changed: 0, skipped: 0 };
    if (!Number.isSafeInteger(scope.tenantId) || scope.tenantId <= 0 ||
        !Number.isSafeInteger(scope.conversationId) || scope.conversationId <= 0) {
      return { ...result, skipped: messages.length };
    }
    for (const [key, value] of this.snapshots) {
      if (now - value.at > this.ttlMs) this.snapshots.delete(key);
    }
    const key = JSON.stringify([scope.tenantId, scope.conversationId, scope.channel]);
    const previous = this.snapshots.get(key);
    const hashes = new Map<number, string>();
    let bytesLeft = 512_000;
    for (const record of messages.slice(-128)) {
      if (!Number.isSafeInteger(record.id) || record.id <= 0) { result.skipped++; continue; }
      try {
        // Bound size/depth/nodes before allocating a serialized prompt. Refuse
        // getters/toJSON so diagnostics cannot invoke application behavior.
        if (!safeToSerialize(record.message, bytesLeft)) { result.skipped++; continue; }
        const serialized = JSON.stringify(record.message);
        if (!serialized || serialized.length > bytesLeft) { result.skipped++; continue; }
        bytesLeft -= serialized.length;
        const hash = createHmac("sha256", this.secret).update(serialized).digest("hex");
        hashes.set(record.id, hash);
        const old = previous?.hashes.get(record.id);
        if (old) { result.compared++; if (old !== hash) result.changed++; }
      } catch { result.skipped++; }
    }
    this.snapshots.delete(key);
    this.snapshots.set(key, { at: now, hashes });
    while (this.snapshots.size > this.capacity) this.snapshots.delete(this.snapshots.keys().next().value!);
    return result;
  }
}

const comparison = new PromptHistoryComparison();

/** Input windowing preserves a source-message suffix. This measures the prepared
 * history projection, not provider transport cache hits or billing savings. */
export function observePreparedHistory(
  scope: Scope, source: { id: number }[], prepared: unknown[],
): void {
  try {
    if (!prepared.length || prepared.length > source.length) return;
    const records = source.slice(-prepared.length).map((m, i) => ({ id: m.id, message: prepared[i] }));
    const result = comparison.observe(scope, records);
    if (result.compared || result.skipped) {
      console.info(`[prompt-history-comparison] channel=${scope.channel} compared=${result.compared} changed=${result.changed} skipped=${result.skipped}`);
    }
  } catch { logSilentCatch("prompt-history-comparison:advisory", "Advisory comparison failed"); }
}
