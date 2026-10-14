/** Connection keepalives are not inference progress. No retries or spend here. */
export function hasModelProgress(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") return false;
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return false;
  const nonempty = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  return choices.some(choice => {
    const d = choice?.delta;
    if (!d || typeof d !== "object") return false;
    if ([d.content, d.reasoning, d.reasoning_content].some(nonempty)) return true;
    if (Array.isArray(d.reasoning_details) &&
        d.reasoning_details.some((r: { text?: unknown; data?: unknown }) => r && (nonempty(r.text) || nonempty(r.data)))) return true;
    return Array.isArray(d.tool_calls) && d.tool_calls.some(
      (t: { function?: { name?: unknown; arguments?: unknown } }) =>
        t?.function && (nonempty(t.function.name) || nonempty(t.function.arguments)),
    );
  });
}

export async function* streamWithProgressDeadline<T>(
  stream: AsyncIterable<T>,
  options: { timeoutMs: number; signal?: AbortSignal; onTimeout?: () => void },
): AsyncGenerator<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Invalid model progress deadline");
  }
  const iterator = stream[Symbol.asyncIterator]();
  let deadline = performance.now() + options.timeoutMs;
  let finished = false;
  let frames = 0;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      const bound = new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Model stream aborted"));
        if (options.signal?.aborted) { abort(); return; }
        options.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          // Settle the deadline before aborting: some SDKs synchronously finish
          // next() during abort, which must not turn a timeout into success.
          reject(new Error("Timed out waiting for model progress"));
          try { options.onTimeout?.(); } catch { /* timeout must still terminate */ }
        }, Math.max(1, deadline - performance.now()));
      });
      let next: IteratorResult<T>;
      try {
        next = await Promise.race([iterator.next(), bound]);
      } finally {
        clearTimeout(timer);
        if (abort) options.signal?.removeEventListener("abort", abort);
      }
      if (next.done) { finished = true; return; }
      // Check the clock too: synchronously resolved empty chunks must not starve
      // the timer/event loop indefinitely.
      if (performance.now() >= deadline) {
        try { options.onTimeout?.(); } catch { /* preserve deadline error */ }
        throw new Error("Timed out waiting for model progress");
      }
      if (hasModelProgress(next.value)) deadline = performance.now() + options.timeoutMs;
      yield next.value;
      // A synchronously resolved keepalive storm must yield to cancellation,
      // HTTP work and timer callbacks rather than monopolizing microtasks.
      if (++frames % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally {
    // Some SDKs ignore abort or return() hangs. Do not await cleanup; attach a
    // rejection handler so late iterator failures never escape unhandled.
    if (!finished) {
      try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* bounded cleanup */ }
    }
  }
}
