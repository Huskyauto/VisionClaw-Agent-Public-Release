/**
 * R98.27.6 — fetchWithTimeout
 *
 * Wrap a fetch() call with an AbortSignal-based hard timeout. Architect
 * orchestration audit found that leaf network calls into Drive, Browserless,
 * and ElevenLabs had NO bounded timeout — a stuck upstream could hold the
 * entire chat-engine turn open until the Replit Temporal StartToClose wall
 * killed it (~10–15 min), losing the work. This wrapper enforces a per-call
 * budget and throws a tagged error the caller can recognize and retry/fail
 * cleanly.
 *
 * Defaults are intentionally generous — the goal is "stop runaway hangs",
 * not "be aggressive". Pick the budget from the caller's known SLA.
 */

export class FetchTimeoutError extends Error {
  constructor(public url: string, public timeoutMs: number) {
    super(`fetch timed out after ${timeoutMs}ms: ${url}`);
    this.name = "FetchTimeoutError";
  }
}

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * fetch() with a hard wall-time cap. If the request hasn't returned by
 * `timeoutMs`, the underlying request is aborted and a FetchTimeoutError is
 * thrown. Composes safely with caller-supplied AbortSignals: if the caller
 * aborts first, we propagate that abort instead of the timeout.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 60_000, signal: callerSignal, ...rest } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let callerAbortHandler: (() => void) | null = null;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException("Aborted by caller", "AbortError");
    }
    callerAbortHandler = () => ctrl.abort();
    callerSignal.addEventListener("abort", callerAbortHandler, { once: true });
  }

  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      // Distinguish caller-abort from timeout-abort.
      if (callerSignal?.aborted) throw err;
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal && callerAbortHandler) {
      callerSignal.removeEventListener("abort", callerAbortHandler);
    }
  }
}
