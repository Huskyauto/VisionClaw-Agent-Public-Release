const MAX_GLOBAL_CONCURRENT = 10;
const QUEUE_TIMEOUT_MS = 120_000;

interface QueueEntry {
  conversationId: number;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const activeProcessing = new Set<number>();
const waitingQueues = new Map<number, QueueEntry[]>();
let globalActiveCount = 0;

function tryDequeue(conversationId: number): void {
  const queue = waitingQueues.get(conversationId);
  if (!queue || queue.length === 0) {
    waitingQueues.delete(conversationId);
    return;
  }

  if (globalActiveCount >= MAX_GLOBAL_CONCURRENT) return;
  if (activeProcessing.has(conversationId)) return;

  const entry = queue.shift()!;
  if (queue.length === 0) waitingQueues.delete(conversationId);

  clearTimeout(entry.timer);
  activeProcessing.add(conversationId);
  globalActiveCount++;
  entry.resolve();
}

export async function acquireConversationLock(conversationId: number): Promise<() => void> {
  if (!activeProcessing.has(conversationId) && globalActiveCount < MAX_GLOBAL_CONCURRENT) {
    activeProcessing.add(conversationId);
    globalActiveCount++;
    return createRelease(conversationId);
  }

  return new Promise<() => void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const queue = waitingQueues.get(conversationId);
      if (queue) {
        const idx = queue.findIndex(e => e.resolve === wrappedResolve);
        if (idx !== -1) queue.splice(idx, 1);
        if (queue.length === 0) waitingQueues.delete(conversationId);
      }
      reject(new Error(`Conversation ${conversationId} queue timeout — another message is still processing`));
    }, QUEUE_TIMEOUT_MS);

    const wrappedResolve = () => resolve(createRelease(conversationId));

    const entry: QueueEntry = {
      conversationId,
      resolve: wrappedResolve,
      reject,
      enqueuedAt: Date.now(),
      timer,
    };

    if (!waitingQueues.has(conversationId)) {
      waitingQueues.set(conversationId, []);
    }
    waitingQueues.get(conversationId)!.push(entry);
  });
}

function createRelease(conversationId: number): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeProcessing.delete(conversationId);
    globalActiveCount--;
    tryDequeue(conversationId);

    for (const [cid] of waitingQueues) {
      if (cid !== conversationId) tryDequeue(cid);
    }
  };
}

export function getQueueStats(): {
  globalActive: number;
  maxGlobal: number;
  conversationsProcessing: number;
  conversationsWaiting: number;
  totalWaiting: number;
} {
  let totalWaiting = 0;
  for (const [, queue] of waitingQueues) totalWaiting += queue.length;

  return {
    globalActive: globalActiveCount,
    maxGlobal: MAX_GLOBAL_CONCURRENT,
    conversationsProcessing: activeProcessing.size,
    conversationsWaiting: waitingQueues.size,
    totalWaiting,
  };
}
