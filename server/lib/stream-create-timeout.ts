/**
 * Bounded stream-creation guard.
 *
 * The SSE chat round arms a first-CHUNK timeout that fires only AFTER the
 * provider returns the async-iterable stream object. But the upstream
 * `client.chat.completions.create()` call itself can hang for minutes before
 * it ever returns that object (observed in prod: gemini-3.5-flash took ~4 min
 * to establish the stream, then emitted 1 char — a 353s dead turn). Nothing
 * aborted it because the first-chunk timer wasn't armed yet.
 *
 * `createCompletionWithTimeout` wraps the create() call so a hung creation
 * aborts after `timeoutMs` and surfaces a distinguishable
 * `StreamCreateTimeoutError` the caller routes into its normal failover path.
 *
 * It uses a LOCAL AbortController linked to the caller's shared signal so it
 * never aborts (poisons) the shared controller that the failover/RLM recovery
 * path reuses. A genuine client-disconnect on the shared signal still cancels
 * the create() (via the link) but is reported as the original error, NOT as a
 * creation timeout.
 */

export class StreamCreateTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly modelId?: string;
  constructor(timeoutMs: number, modelId?: string) {
    super(
      `stream creation timed out after ${timeoutMs}ms${modelId ? ` on ${modelId}` : ""}`,
    );
    this.name = "StreamCreateTimeoutError";
    this.timeoutMs = timeoutMs;
    this.modelId = modelId;
  }
}

export async function createCompletionWithTimeout<T>(
  createFn: (signal: AbortSignal) => Promise<T>,
  sharedSignal: AbortSignal,
  timeoutMs: number,
  modelId?: string,
): Promise<T> {
  const localAc = new AbortController();
  let timedOut = false;

  const onShared = () => localAc.abort();
  if (sharedSignal.aborted) {
    localAc.abort();
  } else {
    sharedSignal.addEventListener("abort", onShared, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    localAc.abort();
  }, timeoutMs);

  try {
    return await createFn(localAc.signal);
  } catch (err: any) {
    // Only translate to a creation-timeout when WE tripped the timer AND the
    // shared signal is not aborted (i.e. it was not a client disconnect). This
    // keeps disconnects flowing to the caller's break-to-persistence path.
    if (timedOut && !sharedSignal.aborted) {
      throw new StreamCreateTimeoutError(timeoutMs, modelId);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    sharedSignal.removeEventListener("abort", onShared);
  }
}
