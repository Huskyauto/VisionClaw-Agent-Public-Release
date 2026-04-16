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
        return await fetch(url, {
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

  const res = await fetch(url, {
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
    const res = await fetch(queryKey.join("/") as string, {
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
