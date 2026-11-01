/** Bound awaited reads, including DNS, browser coordination and cleanup.
 * Provider socket timeouts alone do not bound those surrounding awaits.
 * A timeout stops the batch; it never authorizes another browser or model call.
 * Underlying reads may settle late, but their values cannot reach the crawler. */
export function companyResearchDeadline() {
  const deadline = Date.now() + 180_000;
  let stopped: Error | undefined;
  const timeout = (step: string) => Object.assign(new Error(
    `Website research timed out during ${step}. Saved pages are preserved; this research step started no report-model calls. Continue the same package after checking browser availability.`,
  ), { code: "COMPANY_RESEARCH_TIMEOUT" });
  function assertOpen() {
    if (stopped) throw stopped;
    if (Date.now() >= deadline) throw (stopped = timeout("the research batch"));
  }
  async function read<T>(step: string, limitMs: number, action: (assertCurrent: () => void) => Promise<T>, cleanup = false): Promise<T> {
    if (!cleanup) assertOpen();
    const remaining = cleanup ? limitMs : Math.min(limitMs, deadline - Date.now());
    let expired = false;
    const assertCurrent = () => {
      if (expired) throw timeout(step);
      if (!cleanup) assertOpen();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { assertCurrent(); return action(assertCurrent); }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            const error = timeout(step);
            if (!cleanup) stopped = error;
            reject(error);
          }, remaining);
        }),
      ]);
      // Another lane may have timed out while this read was in flight.
      assertCurrent();
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { read, assertOpen };
}
