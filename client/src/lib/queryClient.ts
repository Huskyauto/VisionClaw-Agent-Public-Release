import { QueryClient, QueryFunction } from "@tanstack/react-query";

let authToken: string | null = null;
let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  csrfToken = null;
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
  csrfFetchPromise = fetch("/api/auth/csrf-token", {
    credentials: "include",
    headers: getAuthHeaders(),
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => { csrfToken = data?.csrfToken || null; csrfFetchPromise = null; return csrfToken; })
    .catch(() => { csrfFetchPromise = null; return null; });
  return csrfFetchPromise;
}

function isMutatingMethod(method?: string): boolean {
  if (!method) return false;
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS";
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const auth = getAuthHeaders();
  if (auth.Authorization) {
    headers.set("Authorization", auth.Authorization);
  }
  if (isMutatingMethod(init?.method)) {
    const token = await ensureCsrfToken();
    if (token) {
      headers.set("x-csrf-token", token);
    }
  }
  return fetch(url, { ...init, headers, credentials: "include" });
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
): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (isTransientPlatformStatus(res)) {
      await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
      try {
        return await fetch(url, init);
      } catch {
        return res;
      }
    }
    return res;
  } catch (err) {
    // Thrown fetch == network failure or aborted before any response. We
    // cannot tell whether the request reached the server, so for non-idempotent
    // methods we surface the error rather than risk double-execution. Idempotent
    // reads are always safe to retry.
    if (!isIdempotentMethod(init.method)) {
      throw err;
    }
    await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
    return await fetch(url, init);
  }
}

async function handleCsrfRetry(
  res: Response,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response | null> {
  if (res.status !== 403) return null;
  const clone = res.clone();
  try {
    const errorBody = await clone.json();
    if (errorBody?.error?.includes("CSRF")) {
      csrfToken = null;
      const newToken = await ensureCsrfToken();
      if (newToken) {
        headers["x-csrf-token"] = newToken;
        // R74.3 — route the CSRF replay through fetchWithTransientRetry so a
        // cold-start 5xx during the replay is still recovered (consistent
        // with the rest of apiRequest). Idempotency rules apply identically:
        // mutating methods only retry on platform-originated 5xx, not on
        // thrown-fetch network failures.
        return await fetchWithTransientRetry(url, {
          method,
          headers,
          body,
          credentials: "include",
        });
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
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  if (isMutatingMethod(method)) {
    const token = await ensureCsrfToken();
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
  });

  const retried = await handleCsrfRetry(res, method, url, headers, bodyStr);
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
  async ({ queryKey }) => {
    const res = await fetchWithTransientRetry(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

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
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
