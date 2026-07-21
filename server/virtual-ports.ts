import { Request, Response, NextFunction } from "express";

export type ChannelName = "chat-stream" | "api" | "sse-events" | "static" | "webhook" | "upload";

interface ActiveRequest {
  id: string;
  channel: ChannelName;
  startedAt: number;
  path: string;
  timer: ReturnType<typeof setTimeout> | null;
}

interface QueuedRequest {
  id: string;
  channel: ChannelName;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timer: ReturnType<typeof setTimeout>;
  path: string;
}

interface ChannelConfig {
  maxConcurrent: number;
  maxQueued: number;
  priority: number;
  timeoutMs: number;
}

const CHANNEL_CONFIGS: Record<ChannelName, ChannelConfig> = {
  "chat-stream": { maxConcurrent: 6, maxQueued: 10, priority: 1, timeoutMs: 600_000 },
  "api":         { maxConcurrent: 50, maxQueued: 100, priority: 2, timeoutMs: 30_000 },
  "sse-events":  { maxConcurrent: 20, maxQueued: 30, priority: 3, timeoutMs: 0 },
  "static":      { maxConcurrent: 100, maxQueued: 200, priority: 5, timeoutMs: 15_000 },
  "webhook":     { maxConcurrent: 10, maxQueued: 20, priority: 1, timeoutMs: 60_000 },
  "upload":      { maxConcurrent: 5, maxQueued: 10, priority: 2, timeoutMs: 120_000 },
};

const activeRequests = new Map<string, ActiveRequest>();
const channelQueues = new Map<ChannelName, QueuedRequest[]>();
const channelActiveCount = new Map<ChannelName, number>();
let requestCounter = 0;

for (const ch of Object.keys(CHANNEL_CONFIGS) as ChannelName[]) {
  channelActiveCount.set(ch, 0);
  channelQueues.set(ch, []);
}

const CHAT_STREAM_PATTERN = /^\/api\/conversations\/\d+\/messages$/;
const SYNC_SSE_PATTERN = /^\/api\/conversations\/\d+\/sync$/;
const DELEGATION_SSE_PATTERN = /^\/api\/delegation-events\//;

function classifyRequest(req: Request): ChannelName {
  const path = req.path;
  const method = req.method;

  if (method === "POST" && CHAT_STREAM_PATTERN.test(path)) return "chat-stream";
  if (path === "/api/chat" && method === "POST") return "chat-stream";

  if (SYNC_SSE_PATTERN.test(path)) return "sse-events";
  if (DELEGATION_SSE_PATTERN.test(path)) return "sse-events";
  if (path.includes("/stream") || path.includes("/sse") || path.includes("/events")) return "sse-events";

  if (path.startsWith("/api/stripe/webhook") || path.startsWith("/api/webhook") || path.startsWith("/api/whatsapp") || path.startsWith("/api/coinbase/webhook")) return "webhook";

  if (path === "/api/upload" || path === "/api/tts" || path.includes("/import")) return "upload";

  if (path.startsWith("/api/")) return "api";

  return "static";
}

function tryProcessQueue(channel: ChannelName): void {
  const queue = channelQueues.get(channel);
  if (!queue || queue.length === 0) return;

  const config = CHANNEL_CONFIGS[channel];
  const active = channelActiveCount.get(channel) || 0;

  if (active >= config.maxConcurrent) return;

  const entry = queue.shift()!;
  clearTimeout(entry.timer);
  channelActiveCount.set(channel, active + 1);
  entry.resolve();
}

function releaseSlot(requestId: string): void {
  const req = activeRequests.get(requestId);
  if (!req) return;
  activeRequests.delete(requestId);

  if (req.timer) clearTimeout(req.timer);

  const current = channelActiveCount.get(req.channel) || 1;
  channelActiveCount.set(req.channel, Math.max(0, current - 1));

  tryProcessQueue(req.channel);

  const allChannels = Object.keys(CHANNEL_CONFIGS) as ChannelName[];
  for (const ch of allChannels) {
    if (ch !== req.channel) tryProcessQueue(ch);
  }
}

async function acquireChannel(channel: ChannelName, path: string, signal?: AbortSignal): Promise<{ requestId: string; release: () => void }> {
  const config = CHANNEL_CONFIGS[channel];
  const active = channelActiveCount.get(channel) || 0;
  const requestId = `vp_${++requestCounter}_${channel}`;

  if (signal?.aborted) {
    return Promise.reject(new Error("Client disconnected before acquire"));
  }

  if (active < config.maxConcurrent) {
    channelActiveCount.set(channel, active + 1);
    const timeoutMs = config.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        releaseSlot(requestId);
      }, timeoutMs);
    }
    activeRequests.set(requestId, { id: requestId, channel, startedAt: Date.now(), path, timer });
    return { requestId, release: () => releaseSlot(requestId) };
  }

  const currentQueue = channelQueues.get(channel)!;
  if (currentQueue.length >= config.maxQueued) {
    return Promise.reject(new Error(`Channel "${channel}" queue is full (${config.maxQueued} waiting). Server is under heavy load — try again in a few seconds.`));
  }

  return new Promise<{ requestId: string; release: () => void }>((resolve, reject) => {
    const queueTimeout = Math.min(config.timeoutMs || 30_000, 30_000);
    let settled = false;

    const removeFromQueue = () => {
      const queue = channelQueues.get(channel);
      if (queue) {
        const idx = queue.findIndex(e => e.id === requestId);
        if (idx !== -1) queue.splice(idx, 1);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeFromQueue();
      reject(new Error("Client disconnected while queued"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      removeFromQueue();
      reject(new Error(`Channel "${channel}" is at capacity (${config.maxConcurrent} concurrent). Try again shortly.`));
    }, queueTimeout);

    const entry: QueuedRequest = {
      id: requestId,
      channel,
      resolve: () => {
        if (settled) {
          const current = channelActiveCount.get(channel) || 1;
          channelActiveCount.set(channel, Math.max(0, current - 1));
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        let reqTimer: ReturnType<typeof setTimeout> | null = null;
        if (config.timeoutMs > 0) {
          reqTimer = setTimeout(() => releaseSlot(requestId), config.timeoutMs);
        }
        activeRequests.set(requestId, { id: requestId, channel, startedAt: Date.now(), path, timer: reqTimer });
        resolve({ requestId, release: () => releaseSlot(requestId) });
      },
      reject: (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        removeFromQueue();
        reject(err);
      },
      enqueuedAt: Date.now(),
      timer,
      path,
    };

    currentQueue.push(entry);
  });
}

export function virtualPortMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const channel = classifyRequest(req);

    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    req.on("close", onAbort);

    try {
      const { requestId, release } = await acquireChannel(channel, req.path, abortController.signal);

      req.removeListener("close", onAbort);

      (req as any)._vpChannel = channel;
      (req as any)._vpRequestId = requestId;
      (req as any)._vpRelease = release;

      res.on("close", release);
      res.on("finish", release);

      next();
    } catch (err: any) {
      req.removeListener("close", onAbort);
      if (err.message?.includes("Client disconnected")) {
        return;
      }
      if (!res.headersSent) {
        res.status(503).json({
          error: err.message || "Server is busy. Please try again.",
          channel,
          retryAfterMs: 2000,
        });
      }
    }
  };
}

export function getVirtualPortStats(): {
  channels: Record<string, { active: number; max: number; queued: number; priority: number }>;
  totalActive: number;
  totalQueued: number;
} {
  const channels: Record<string, { active: number; max: number; queued: number; priority: number }> = {};
  let totalActive = 0;
  let totalQueued = 0;

  for (const [name, config] of Object.entries(CHANNEL_CONFIGS)) {
    const active = channelActiveCount.get(name as ChannelName) || 0;
    const queued = channelQueues.get(name as ChannelName)?.length || 0;
    channels[name] = { active, max: config.maxConcurrent, queued, priority: config.priority };
    totalActive += active;
    totalQueued += queued;
  }

  return { channels, totalActive, totalQueued };
}
