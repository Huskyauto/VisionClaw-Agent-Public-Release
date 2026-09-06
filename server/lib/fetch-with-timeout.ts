import { logSilentCatch } from "./silent-catch";
import { recordEgress, hostOf } from "./egress-telemetry";
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
  const { timeoutMs = 60_000, signal: explicitSignal, ...rest } = opts;

  // Action Ledger S4 — advisory cancellation: when this fetch runs inside a
  // timeout-wrapped tool dispatch, adopt the dispatch's AbortSignal so a
  // tool that already lost its outer race stops burning the upstream call.
  // An explicit caller-supplied signal always wins; the ALS signal is only a
  // fallback, and absence of both preserves the pre-S4 behavior exactly.
  let callerSignal = explicitSignal;
  if (!callerSignal) {
    try {
      const { getCurrentToolAbortSignal } = await import("./tool-abort-context");
      callerSignal = getCurrentToolAbortSignal() ?? undefined;
    } catch (_silentErr) { logSilentCatch("server/lib/fetch-with-timeout.ts", _silentErr); }
  }

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

  // Egress telemetry (OpenClaw proxy-capture borrow, R125+137.22): record
  // host/method/outcome into the in-memory ring. Record-only + fail-open —
  // never gates or breaks the fetch.
  const startedAt = Date.now();
  const record = (status: number | null, outcome: "ok" | "http_error" | "timeout" | "aborted" | "network_error") => {
    try {
      recordEgress({ host: hostOf(url), method: String(rest.method || "GET").toUpperCase(), status, ms: Date.now() - startedAt, outcome, source: "fetchWithTimeout" });
    } catch (_silentErr) { logSilentCatch("server/lib/fetch-with-timeout.ts", _silentErr); }
  };

  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    record(res.status, res.ok ? "ok" : "http_error");
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      // Distinguish caller-abort from timeout-abort.
      if (callerSignal?.aborted) { record(null, "aborted"); throw err; }
      record(null, "timeout");
      throw new FetchTimeoutError(url, timeoutMs);
    }
    record(null, "network_error");
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal && callerAbortHandler) {
      callerSignal.removeEventListener("abort", callerAbortHandler);
    }
  }
}
