export class ObsoleteWorkspaceRequest extends Error {
  constructor() { super("Browser request belongs to an expired page or sign-in."); }
}
export function workspaceReadFailureBlocksControls(readFailed: boolean, hasConfirmedState: boolean): boolean {
  return readFailed && !hasConfirmedState;
}
function waitForRead(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new ObsoleteWorkspaceRequest()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
/** GETs only: an aborted previous page can still hold the server's read lock. */
export async function readWorkspaceJson<T>(request: () => Promise<Response>,
  isCurrent: () => boolean, signal?: AbortSignal,
  wait: (ms: number, signal?: AbortSignal) => Promise<void> = waitForRead): Promise<T> {
  const delays = [250, 500, 1000, 2000, 2000];
  for (let attempt = 0; ; attempt++) {
    if (!isCurrent() || signal?.aborted) throw new ObsoleteWorkspaceRequest();
    const response = await request();
    const body = await response.json().catch(() => ({}));
    if (!isCurrent() || signal?.aborted) throw new ObsoleteWorkspaceRequest();
    if (response.status === 409 && body?.code === "browser_busy" && attempt < delays.length) {
      await wait(delays[attempt], signal);
      continue;
    }
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
    return body as T;
  }
}
/** Serializes requests without borrowing a later account's authentication. */
export class WorkspaceRequestLane {
  private tail: Promise<unknown> = Promise.resolve();
  private mounted = true;
  private lifetime = 0;
  constructor(private currentIdentity: () => number) {}
  activate() { this.mounted = true; }
  isCurrent(identity: number) { return this.mounted && identity === this.currentIdentity(); }
  dispose() { this.mounted = false; this.lifetime++; }
  enqueue<T>(fn: () => Promise<T>, identity: number, signal?: AbortSignal): Promise<T> {
    const lifetime = this.lifetime;
    const check = () => {
      if (!this.mounted || lifetime !== this.lifetime || identity !== this.currentIdentity() || signal?.aborted)
        throw new ObsoleteWorkspaceRequest();
    };
    const next = this.tail.then(async () => { check(); const result = await fn(); check(); return result; });
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}