import { ADMIN_TENANT_ID } from "./tenant-constants";

type Entry = {
  key: string; tenantId: number; owner: boolean;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Admission only, never authorization. Call after verifying conversation
 * ownership. Public widgets always use secondary capacity, including Bob's.
 * State is deliberately process-local; no claim of distributed preemption.
 */
export function createConversationQueue(options: {
  maxConcurrent?: number; maxSecondary?: number; timeoutMs?: number;
} = {}) {
  const maxGlobal = options.maxConcurrent ?? 10;
  const maxSecondary = options.maxSecondary ?? 2;
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(maxGlobal) || maxGlobal < 1 ||
      !Number.isSafeInteger(maxSecondary) || maxSecondary < 0 || maxSecondary >= maxGlobal ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid conversation capacity");
  const active = new Map<string, Entry>();
  const waiting: Entry[] = [];
  const secondaryActive = () => [...active.values()].filter(e => !e.owner);
  function drain() {
    while (active.size < maxGlobal) {
      const eligible = (e: Entry) => !active.has(e.key) && (e.owner ||
        (secondaryActive().length < maxSecondary && !secondaryActive().some(a => a.tenantId === e.tenantId)));
      let idx = waiting.findIndex(e => e.owner && eligible(e));
      if (idx < 0) idx = waiting.findIndex(eligible);
      if (idx < 0) return;
      const [entry] = waiting.splice(idx, 1);
      clearTimeout(entry.timer);
      active.set(entry.key, entry);
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        active.delete(entry.key);
        drain();
      });
    }
  }
  async function acquire(conversationId: number, tenantId: number, opts: { publicAccess?: boolean } = {}) {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("A trusted tenant is required");
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error("Invalid conversation");
    const owner = tenantId === ADMIN_TENANT_ID && opts.publicAccess !== true;
    if (waiting.filter(e => e.owner === owner).length >= 100 ||
        (!owner && waiting.filter(e => !e.owner && e.tenantId === tenantId).length >= 10)) {
      throw new Error("Conversation queue full; please retry later");
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry: Entry = { key: `${tenantId}:${conversationId}`, tenantId, owner, resolve, reject };
      entry.timer = setTimeout(() => {
        const idx = waiting.indexOf(entry);
        if (idx >= 0) waiting.splice(idx, 1);
        reject(new Error(`Conversation ${conversationId} queue timeout — another message is still processing`));
        drain();
      }, timeoutMs);
      waiting.push(entry);
      drain();
    });
  }
  function stats() {
    return {
      globalActive: active.size, maxGlobal, conversationsProcessing: active.size,
      conversationsWaiting: new Set(waiting.map(e => e.key)).size,
      totalWaiting: waiting.length, secondaryActive: secondaryActive().length,
      maxSecondary, reservedOwnerCapacity: maxGlobal - maxSecondary,
    };
  }
  return { acquire, stats };
}

const queue = createConversationQueue();
export const acquireConversationLock = queue.acquire;
export const getQueueStats = queue.stats;
