/** One process owns audit authority; only remote inference is concurrent. */
export function auditConcurrency(value: string | undefined): number {
  if (value === undefined) return 2;
  if (!/^[1-4]$/.test(value)) throw new Error("Audit concurrency must be an integer from 1 to 4");
  return Number(value);
}

/** Hold across read/check/write, not across provider network calls. */
export function createAuditStateGate(onFailure?: (error: unknown) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  return function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      try { return await work(); }
      catch (error) { onFailure?.(error); throw error; }
    });
    tail = result.catch(() => undefined);
    return result;
  };
}

export interface AuditPoolControl {
  stop(reason: unknown): void;
  assertDispatchAllowed(): void;
}

export const AUDIT_PRECISION_RESPONSE_BYTES = 128 * 1024;
const RESPONSE_RESERVE = 6 * AUDIT_PRECISION_RESPONSE_BYTES + 512;
// Leave room for paid-attempt receipts, health, cursors and JSON field names.
const PRECISION_STATE_BYTES = 7 * 1024 * 1024;

export function createAuditPrecisionState(ports: {
  read(field: "auditPrecision" | "auditHandoff"): Promise<any>;
  write(field: "auditPrecision" | "auditHandoff", value: unknown): Promise<unknown>;
}, gate: ReturnType<typeof createAuditStateGate>) {
  const pending = new Set<string>();
  const receipts = async (): Promise<Record<string, string>> => {
    const value = await ports.read("auditPrecision") ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.values(value).some(raw => typeof raw !== "string"))
      throw new Error("Invalid precision receipt state");
    return value;
  };
  return {
    acquire: (key: string) => gate(async () => {
      const saved = await receipts();
      if (saved[key] !== undefined) return saved[key];
      if (pending.has(key)) throw new Error("Duplicate precision dispatch");
      if (Buffer.byteLength(JSON.stringify(saved)) + (pending.size + 1) * RESPONSE_RESERVE > PRECISION_STATE_BYTES)
        throw new Error("Precision checkpoint capacity exhausted before dispatch");
      pending.add(key);
      return undefined;
    }),
    release: (key: string) => gate(async () => { pending.delete(key); }),
    save: (key: string, raw: string) => gate(async () => {
      if (!pending.has(key)) throw new Error("Precision task has no capacity reservation");
      if (Buffer.byteLength(raw) > AUDIT_PRECISION_RESPONSE_BYTES)
        throw new Error("Precision response exceeds retained byte limit");
      const saved = await receipts(); // Never merge into a pre-network snapshot.
      if (saved[key] !== undefined && saved[key] !== raw) throw new Error("Conflicting precision receipt");
      await ports.write("auditPrecision", { ...saved, [key]: raw });
      pending.delete(key);
    }),
    cursor: (key: string) => gate(async () => {
      const state = await ports.read("auditHandoff");
      const value = state?.tasks?.[key] ?? (state?.key === key ? state.nextRoute : 0);
      if (!Number.isInteger(value) || value < 0 || value >= 5) throw new Error("Invalid precision route cursor");
      return value as number;
    }),
    advance: (key: string, nextRoute: number) => gate(async () => {
      if (!Number.isInteger(nextRoute) || nextRoute < 0 || nextRoute >= 5)
        throw new Error("Invalid precision route cursor");
      const state = await ports.read("auditHandoff") ?? {};
      const tasks = state.tasks ?? {};
      if (!tasks || typeof tasks !== "object" || Array.isArray(tasks) ||
          Object.getPrototypeOf(tasks) !== Object.prototype) throw new Error("Invalid precision handoff state");
      const legacy = typeof state.key === "string" && Number.isInteger(state.nextRoute) &&
        state.nextRoute >= 0 && state.nextRoute < 5 ? { [state.key]: state.nextRoute } : {};
      await ports.write("auditHandoff", { ...state, key, nextRoute, tasks: { ...legacy, ...tasks, [key]: nextRoute } });
    }),
  };
}

export async function runAuditTaskPool(
  keys: readonly string[], concurrency: number,
  execute: (index: number, control: AuditPoolControl) => Promise<void>,
) {
  auditConcurrency(String(concurrency));
  if (keys.some(key => typeof key !== "string" || !key) || new Set(keys).size !== keys.length)
    throw new Error("Duplicate or invalid audit task identity");
  let next = 0, started = 0, completed = 0, stopped = false;
  let stopReason: unknown;
  const errors: unknown[] = [];
  const control: AuditPoolControl = {
    stop(reason) {
      if (!stopped) { stopped = true; stopReason = reason ?? new Error("Audit dispatch stopped"); }
    },
    assertDispatchAllowed() { if (stopped) throw stopReason; },
  };
  const worker = async () => {
    while (!stopped && next < keys.length) {
      const index = next++;
      started++;
      try { await execute(index, control); completed++; }
      catch (error) { errors.push(error); control.stop(error); }
    }
  };
  // Drain already-started work even when another worker loses authority.
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return { started, completed, stopped, errors };
}
