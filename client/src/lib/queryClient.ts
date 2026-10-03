import { QueryClient, QueryFunction } from "@tanstack/react-query";

let authToken: string | null = null;
let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;
let authIdentityVersion = 0;

export function setAuthToken(token: string | null) {
  if (authToken === token) return;
  authToken = token;
  invalidateAuthRequestIdentity();
}

export function invalidateAuthRequestIdentity() {
  csrfToken = null;
  csrfFetchPromise = null;
  authIdentityVersion++;
}

export function getAuthHeaders(): Record<string, string> {
  if (authToken) {
    return { Authorization: `Bearer ${authToken}` };
  }
  return {};
}

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (csrfFetchPromise) return csrfFetchPromise;
  const requestIdentityVersion = authIdentityVersion;
  let pending: Promise<string | null>;
  pending = fetch("/api/auth/csrf-token", {
    credentials: "include",
    headers: getAuthHeaders(),
    cache: "no-store",
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (requestIdentityVersion !== authIdentityVersion) return null;
      csrfToken = data?.csrfToken || null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      if (csrfFetchPromise === pending) csrfFetchPromise = null;
    });
  csrfFetchPromise = pending;
  return pending;
}

function assertCurrentIdentity(requestIdentityVersion: number) {
  if (requestIdentityVersion !== authIdentityVersion) {
    throw new Error("Authentication identity changed while the request was pending");
  }
}

function isMutatingMethod(method?: string): boolean {
  if (!method) return false;
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS";
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const requestIdentityVersion = authIdentityVersion;
  const headers = new Headers(init?.headers);
  const auth = getAuthHeaders();
  if (auth.Authorization) {
    headers.set("Authorization", auth.Authorization);
  }
  if (isMutatingMethod(init?.method)) {
    const token = await ensureCsrfToken();
    assertCurrentIdentity(requestIdentityVersion);
    if (token) {
      headers.set("x-csrf-token", token);
    }
  }
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  assertCurrentIdentity(requestIdentityVersion);
  return response;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

const TRANSIENT_RETRY_DELAY_MS = 600;

// R74.2 — Cold-start hiccups on Replit autoscale return 5xx from the edge proxy
// before the upstream container is warm. Express stamps every response with
// `x-app-origin: express` (see server/index.ts middleware). When the response
// header is absent the response did NOT come from our app, so it's safe to
// retry once regardless of HTTP method — the request demonstrably never
// reached application code, so there is no side effect to duplicate.
function isPlatformOriginated(res: Response): boolean {
  return res.headers.get("x-app-origin") !== "express";
}

function isTransientPlatformStatus(res: Response): boolean {
  if (res.status < 500) return false;
  return isPlatformOriginated(res);
}

function isIdempotentMethod(method?: string): boolean {
  if (!method) return true;
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD" || upper === "OPTIONS";
}

async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  assertIdentityCurrent?: () => void,
): Promise<Response> {
  try {
    assertIdentityCurrent?.();
    const res = await fetch(url, init);
    assertIdentityCurrent?.();
    if (isTransientPlatformStatus(res)) {
      await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
      try {
        assertIdentityCurrent?.();
        const retried = await fetch(url, init);
        assertIdentityCurrent?.();
        return retried;
      } catch {
        assertIdentityCurrent?.();
        return res;
      }
    }
    return res;
  } catch (err) {
    // Thrown fetch == network failure or aborted before any response. We
    // cannot tell whether the request reached the server, so for non-idempotent
    // methods we surface the error rather than risk double-execution. Idempotent
    // reads are always safe to retry.
    assertIdentityCurrent?.();
    if (init.signal?.aborted || !isIdempotentMethod(init.method)) {
      throw err;
    }
    await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
    assertIdentityCurrent?.();
    const retried = await fetch(url, init);
    assertIdentityCurrent?.();
    return retried;
  }
}

async function handleCsrfRetry(
  res: Response,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  requestIdentityVersion?: number,
): Promise<Response | null> {
  if (res.status !== 403) return null;
  const clone = res.clone();
  try {
    const errorBody = await clone.json();
    if (errorBody?.error?.includes("CSRF")) {
      csrfToken = null;
      const newToken = await ensureCsrfToken();
      if (requestIdentityVersion !== undefined) {
        assertCurrentIdentity(requestIdentityVersion);
      }
      if (newToken) {
        headers["x-csrf-token"] = newToken;
        // R74.3 — route the CSRF replay through fetchWithTransientRetry so a
        // cold-start 5xx during the replay is still recovered (consistent
        // with the rest of apiRequest). Idempotency rules apply identically:
        // mutating methods only retry on platform-originated 5xx, not on
        // thrown-fetch network failures.
        const retried = await fetchWithTransientRetry(url, {
          method,
          headers,
          body,
          credentials: "include",
        }, requestIdentityVersion === undefined ? undefined : () => assertCurrentIdentity(requestIdentityVersion));
        if (requestIdentityVersion !== undefined) {
          assertCurrentIdentity(requestIdentityVersion);
        }
        return retried;
      }
    }
  } catch {}
  return null;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const requestIdentityVersion = authIdentityVersion;
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  if (isMutatingMethod(method)) {
    const token = await ensureCsrfToken();
    assertCurrentIdentity(requestIdentityVersion);
    if (token) {
      headers["x-csrf-token"] = token;
    }
  }

  const bodyStr = data ? JSON.stringify(data) : undefined;

  const res = await fetchWithTransientRetry(url, {
    method,
    headers,
    body: bodyStr,
    credentials: "include",
  }, () => assertCurrentIdentity(requestIdentityVersion));
  assertCurrentIdentity(requestIdentityVersion);

  const retried = await handleCsrfRetry(res, method, url, headers, bodyStr, requestIdentityVersion);
  if (retried) {
    await throwIfResNotOk(retried);
    return retried;
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const requestIdentityVersion = authIdentityVersion;
    const res = await fetchWithTransientRetry(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
      signal,
    }, () => assertCurrentIdentity(requestIdentityVersion));

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
