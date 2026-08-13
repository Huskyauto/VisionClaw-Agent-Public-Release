const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export async function retryFetch(
  url: string,
  opts?: RequestInit & { retries?: number; delayMs?: number; timeoutMs?: number },
): Promise<Response> {
  const { retries = 2, delayMs = 1000, timeoutMs = 30000, ...fetchOpts } = opts || {};

  if (!fetchOpts.signal && timeoutMs > 0) {
    fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  }

  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, fetchOpts);
      if (RETRYABLE_STATUS.has(resp.status) && i < retries) {
        const retryAfter = resp.headers.get("retry-after");
        const wait = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30000) : delayMs * Math.pow(2, i);
        console.warn(`[retryFetch] ${resp.status} on ${url}, retrying in ${wait}ms (attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return resp;
    } catch (err: any) {
      lastErr = err;
      if (i < retries) {
        const wait = delayMs * Math.pow(2, i);
        console.warn(`[retryFetch] Network error on ${url}: ${err.message}, retrying in ${wait}ms (attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}
