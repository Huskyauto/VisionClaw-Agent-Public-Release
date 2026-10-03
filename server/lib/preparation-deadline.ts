/**
 * Bounds work performed before the first useful action in an interactive turn.
 *
 * Preparation enriches a request with optional context. It must never be the
 * reason a user waits indefinitely for the agent to begin. A local controller
 * keeps a timeout from aborting the parent request, while still giving
 * cooperative operations (for example fetch) a cancellation signal.
 */
export class PreparationDeadlineExceededError extends Error {
  readonly timeoutMs: number;
  readonly label: string;

  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded its ${timeoutMs}ms preparation deadline`);
    this.name = "PreparationDeadlineExceededError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

function createParentAbortError(): DOMException {
  return new DOMException("Preparation cancelled because the client disconnected", "AbortError");
}

export async function runWithPreparationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    timeoutMs: number;
    label: string;
    parentSignal?: AbortSignal;
  },
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;

  let rejectParentAbort: ((reason: DOMException) => void) | undefined;
  const parentAbort = new Promise<never>((_resolve, reject) => {
    rejectParentAbort = reject;
  });
  const onParentAbort = () => {
    rejectParentAbort?.(createParentAbortError());
    controller.abort();
  };
  if (options.parentSignal?.aborted) {
    onParentAbort();
  } else {
    options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new PreparationDeadlineExceededError(options.label, options.timeoutMs));
    }, options.timeoutMs);
  });

  const work = operation(controller.signal);
  // A library task may ignore AbortSignal and reject after the race has
  // continued. Consume that late rejection so it cannot surface as unhandled,
  // but leave an operational breadcrumb without exposing upstream error text.
  work.catch(() => {
    if (controller.signal.aborted) {
      console.warn(`[preparation-deadline] ${options.label} settled after cancellation`);
    }
  });

  try {
    return await Promise.race([work, deadline, parentAbort]);
  } catch (error) {
    if (timedOut && !options.parentSignal?.aborted) {
      throw new PreparationDeadlineExceededError(options.label, options.timeoutMs);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.parentSignal?.removeEventListener("abort", onParentAbort);
  }
}