import { setTimeout as delay } from "node:timers/promises";
import { currentTenantContext } from "./tenant-context";

type Release = (() => Promise<void>) & { cooldown?: (ms: number) => Promise<void> };
type Dependencies = {
  acquire: (signal?: AbortSignal | null) => Promise<Release | null>;
  fetch?: typeof fetch;
  schedule?: (fn: () => void, ms: number) => void;
  queueMs?: number;
};
const DEFAULT_COOLDOWN_MS = 60_000;
const START_GAP_MS = 500;

/** Only the provider's explicit retry instruction, never its raw error body. */
export function replitRetryDelay(headers: Headers, now = Date.now()): number {
  const milliseconds = headers.get("retry-after-ms")?.trim();
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds) &&
      Number.isFinite(Number(milliseconds)) && Number(milliseconds) > 0) {
    return Math.min(2_147_000_000, Math.max(START_GAP_MS, Math.ceil(Number(milliseconds))));
  }
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return DEFAULT_COOLDOWN_MS;
  const seconds = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  // Node timers overflow above ~24 days; do not turn overflow into an immediate retry.
  return Number.isFinite(ms) && ms > 0
    ? Math.min(2_147_000_000, Math.max(START_GAP_MS, Math.ceil(ms)))
    : DEFAULT_COOLDOWN_MS;
}

function busy(status = 429): Response {
  return Response.json({ error: {
    message: status === 429
      ? "Replit AI is busy or cooling down; no upstream request was sent. Retry later."
      : "Replit AI admission is temporarily unavailable; no upstream request was sent.",
    type: "temporary_provider_admission",
    code: status === 429 ? "REPLIT_ADMISSION_BUSY" : "REPLIT_ADMISSION_UNAVAILABLE",
  } }, { status, headers: { "retry-after": "2" } });
}

/**
 * All Replit OpenAI SDK instances share this transport, including direct callers.
 * The session lock is held through response headers, then a short pacing gap.
 * On 429 a saved deadline enforces Retry-After (60s if absent), even after exit.
 * Only persistence failure retains the session as a conservative backstop.
 * No inference retries,
 * customer content storage, model substitution or new spending permission.
 */
export function createReplitAdmissionFetch(deps: Dependencies): typeof fetch {
  const send = deps.fetch ?? globalThis.fetch;
  const schedule = deps.schedule ?? ((fn, ms) => { setTimeout(fn, ms).unref(); });
  let waiting = 0;
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const url = new URL(request?.url ?? String(input));
    if (method !== "POST" || !/\/(chat\/completions|responses|embeddings)\/?$/.test(url.pathname)) {
      return send(input, init);
    }
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    if (waiting >= 16) return busy();
    // Foreground gets a bounded opportunity; background work defers promptly.
    const source = currentTenantContext()?.source;
    const background = source === "background-job" || source === "cron";
    const queueMs = deps.queueMs ?? (background ? 100 : 1500);
    const deadline = Date.now() + queueMs;
    let release: Release | null = null;
    waiting++;
    try {
      do {
        signal?.throwIfAborted();
        release = await deps.acquire(signal);
        if (release || Date.now() >= deadline) break;
        await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, {
          signal: signal ?? undefined,
        });
      } while (true);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("[replit-admission] Shared admission unavailable; dispatch deferred");
      return busy(503);
    } finally {
      waiting--;
    }
    if (!release) return busy();
    const unlock = release;
    let holdMs = START_GAP_MS;
    try {
      signal?.throwIfAborted(); // cancellation during acquisition cannot dispatch.
      const response = await send(input, init);
      if (response.status === 429) {
        const cooldownMs = replitRetryDelay(response.headers);
        // Production persists the deadline before releasing the short session lock.
        // Injected/session-only collaborators conservatively retain their lease.
        if (unlock.cooldown) {
          try { await unlock.cooldown(cooldownMs); }
          catch {
            holdMs = cooldownMs;
            console.warn("[replit-admission] Cooldown persistence unavailable; session hold retained");
          }
        } else holdMs = cooldownMs;
        const requestId = response.headers.get("x-request-id");
        console.warn("[replit-admission] Upstream 429; shared cooldown", {
          retryAfterMs: cooldownMs,
          requestId: requestId && /^[A-Za-z0-9_-]{1,100}$/.test(requestId) ? requestId : undefined,
        });
      }
      return response;
    } finally {
      // Stream bodies remain untouched: callers retain usage/cancellation ownership.
      schedule(() => { void unlock().catch(() => {
        console.warn("[replit-admission] Session cleanup failed");
      }); }, holdMs);
    }
  };
}

export const replitAdmissionFetch = createReplitAdmissionFetch({
  acquire: async signal => {
    const { acquireReplitSession } = await import("./replit-admission-postgres");
    return acquireReplitSession(signal);
  },
});
