/**
 * Explicitly opted-in flat-rate requests only. Retry a rejected request once,
 * never an ambiguous timeout or a response/stream that already started.
 */
export function wrapProfundoTransientRetry<
  T extends { chat: { completions: { create: (...args: any[]) => any } } },
>(client: T, deps: {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
} = {}): T {
  const sleep = deps.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Profundo retry aborted")); return; }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Profundo retry aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  }));
  const now = deps.now ?? Date.now;
  const original = client.chat.completions.create.bind(client.chat.completions);
  const completions = Object.create(client.chat.completions);
  completions.create = async (params: any, options: any = {}) => {
    // The private opt-in is never sent to the SDK or upstream provider.
    const { profundoRetry, ...requestOptions } = options;
    const sdkOptions = profundoRetry === true ? { ...requestOptions, maxRetries: 0 } : requestOptions;
    try {
      return await original(params, sdkOptions);
    } catch (error: any) {
      if (profundoRetry !== true || sdkOptions.signal?.aborted ||
          /abort|timeout/i.test(String(error?.name)) ||
          ![429, 502, 503].includes(error?.status)) throw error;
      const raw = error?.headers?.get?.("retry-after") ?? error?.headers?.["retry-after"] ??
        error?.response?.headers?.get?.("retry-after") ?? error?.response?.headers?.["retry-after"];
      let waitMs = 30_000;
      if (raw !== undefined && raw !== null && String(raw).trim()) {
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds < 0) throw error;
        waitMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(raw)) - now();
        if (!Number.isFinite(waitMs)) throw error;
        waitMs = Math.max(0, waitMs);
      }
      // Never shorten the provider's delay or wait without a finite bound.
      if (waitMs > 60_000) throw error;
      console.warn(`[providers] Profundo HTTP ${error.status}; retrying once after ${waitMs}ms`);
      await sleep(waitMs, sdkOptions.signal);
      if (sdkOptions.signal?.aborted) throw error;
      return original(params, sdkOptions);
    }
  };
  const wrapped = Object.create(client);
  wrapped.chat = Object.create(client.chat);
  wrapped.chat.completions = completions;
  return wrapped;
}
