import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { invalidateAuthRequestIdentity, queryClient, setAuthToken } from "./queryClient";

interface ReplitUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface TenantInfo {
  id: number;
  name: string;
  email: string;
  plan: string;
  trialConversationsUsed: number;
  trialMaxConversations: number;
  isAdmin: boolean;
}

interface AuthContextType {
  token: string | null;
  authRequired: boolean;
  isChecking: boolean;
  tenant: TenantInfo | null;
  replitUser: ReplitUser | null;
  isReplitAuth: boolean;
  login: (pin: string) => Promise<void>;
  loginTenant: (email: string, password: string) => Promise<void>;
  registerTenant: (email: string, password: string, name: string) => Promise<any>;
  loginWithReplit: () => void;
  logout: () => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  authRequired: false,
  isChecking: true,
  tenant: null,
  replitUser: null,
  isReplitAuth: false,
  login: async () => {},
  loginTenant: async () => {},
  registerTenant: async () => {},
  loginWithReplit: () => {},
  logout: async () => {},
  refreshTenant: async () => {},
});

let authIdentityGeneration = 0;
const activeAuthIdentityRequests = new Set<AbortController>();

export interface AuthIdentityRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
  dispose: () => void;
}

export function beginAuthIdentityRequest(): AuthIdentityRequest {
  const controller = new AbortController();
  const generation = authIdentityGeneration;
  activeAuthIdentityRequests.add(controller);
  return {
    signal: controller.signal,
    isCurrent: () => generation === authIdentityGeneration && !controller.signal.aborted,
    dispose: () => activeAuthIdentityRequests.delete(controller),
  };
}

export function isCurrentAuthIdentityGeneration(generation: number): boolean {
  return generation === authIdentityGeneration;
}

function invalidateAuthIdentityRequests(): number {
  authIdentityGeneration++;
  for (const controller of activeAuthIdentityRequests) controller.abort();
  activeAuthIdentityRequests.clear();
  return authIdentityGeneration;
}

function currentAuthIdentityGeneration(): number {
  return authIdentityGeneration;
}

function isExpectedIdentityRequestAbort(request: AuthIdentityRequest, error: unknown): boolean {
  return !request.isCurrent()
    || request.signal.aborted
    || (error instanceof DOMException && error.name === "AbortError");
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Prevents stale data or credentials from crossing an account boundary.
 * Cancelling first aborts any React Query request that was issued for the
 * previous identity; the new token is installed before React exposes the next
 * tenant state to query observers.
 */
export async function transitionTenantIdentity(nextToken: string | null) {
  const generation = invalidateAuthIdentityRequests();
  invalidateAuthRequestIdentity();
  await queryClient.cancelQueries();
  queryClient.clear();
  setAuthToken(nextToken);
  return generation;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("vc_token"));
  const [authRequired, setAuthRequired] = useState(true);
  const [isChecking, setIsChecking] = useState(true);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [replitUser, setReplitUser] = useState<ReplitUser | null>(null);
  const [isReplitAuth, setIsReplitAuth] = useState(false);

  const fetchTenantInfo = useCallback(async (t: string, expectedGeneration = currentAuthIdentityGeneration()) => {
    if (!isCurrentAuthIdentityGeneration(expectedGeneration)) return;
    const request = beginAuthIdentityRequest();
    try {
      const res = await fetch("/api/tenants/me", {
        headers: { Authorization: `Bearer ${t}` },
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      if (res.ok) {
        const data = await res.json();
        if (!request.isCurrent()) return;
        setTenant(data);
      }
    } catch (error) {
      if (!isExpectedIdentityRequestAbort(request, error)) {
        console.warn("[auth] tenant identity lookup failed", error);
      }
    } finally {
      request.dispose();
    }
  }, []);

  const checkReplitAuth = useCallback(async (): Promise<boolean> => {
    const request = beginAuthIdentityRequest();
    try {
      const res = await fetch("/api/auth/user", { credentials: "include", signal: request.signal });
      if (!request.isCurrent()) return false;
      if (res.ok) {
        const data = await res.json();
        if (!request.isCurrent()) return false;
        if (data && data.id) {
          const generation = await transitionTenantIdentity(null);
          if (!isCurrentAuthIdentityGeneration(generation)) return false;
          setReplitUser({
            id: data.id,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            profileImageUrl: data.profileImageUrl,
          });
          if (data.tenant) {
            setTenant(data.tenant);
          }
          setIsReplitAuth(true);
          localStorage.removeItem("vc_token");
          setToken(null);
          return true;
        }
      }
    } catch (error) {
      if (!isExpectedIdentityRequestAbort(request, error)) {
        console.warn("[auth] Replit identity bootstrap failed", error);
      }
    } finally {
      request.dispose();
    }
    return false;
  }, []);

  const checkAuth = useCallback(async () => {
    const bootstrapGeneration = currentAuthIdentityGeneration();
    try {
      const hasReplitAuth = await checkReplitAuth();
      if (hasReplitAuth) {
        setIsChecking(false);
        return;
      }
      if (!isCurrentAuthIdentityGeneration(bootstrapGeneration)) return;

      const statusRequest = beginAuthIdentityRequest();
      let data: { authRequired: boolean };
      try {
        const res = await fetch("/api/auth/status", { signal: statusRequest.signal });
        if (!statusRequest.isCurrent() || !isCurrentAuthIdentityGeneration(bootstrapGeneration)) return;
        data = await res.json();
        if (!statusRequest.isCurrent() || !isCurrentAuthIdentityGeneration(bootstrapGeneration)) return;
      } finally {
        statusRequest.dispose();
      }
      setAuthRequired(data.authRequired);

      if (token) {
        if (!isCurrentAuthIdentityGeneration(bootstrapGeneration)) return;
        const request = beginAuthIdentityRequest();
        try {
          const verify = await fetch("/api/settings", {
            headers: { Authorization: `Bearer ${token}` },
            signal: request.signal,
          });
          if (!request.isCurrent() || !isCurrentAuthIdentityGeneration(bootstrapGeneration)) return;
          if (verify.status === 401) {
            const generation = await transitionTenantIdentity(null);
            if (!isCurrentAuthIdentityGeneration(generation)) return;
            setToken(null);
            setTenant(null);
            localStorage.removeItem("vc_token");
          } else {
            await fetchTenantInfo(token, bootstrapGeneration);
          }
        } finally {
          request.dispose();
        }
      }
    } catch (error) {
      if (isCurrentAuthIdentityGeneration(bootstrapGeneration)) {
        console.error("[auth] bootstrap failed; retaining the authentication gate", error);
        setAuthRequired(true);
      }
    } finally {
      if (isCurrentAuthIdentityGeneration(bootstrapGeneration)) {
        setIsChecking(false);
      }
    }
  }, [token, fetchTenantInfo, checkReplitAuth]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (pin: string) => {
    const request = beginAuthIdentityRequest();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: request.signal,
    });
    if (!request.isCurrent()) return;
    if (!res.ok) {
      const data = await res.json();
      request.dispose();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
    if (!request.isCurrent()) return;
    request.dispose();
    const generation = await transitionTenantIdentity(data.token);
    if (!isCurrentAuthIdentityGeneration(generation)) return;
    setToken(data.token);
    localStorage.setItem("vc_token", data.token);
    setTenant({
      id: data.tenantId || 1,
      name: "Admin",
      email: "admin@platform.local",
      plan: "enterprise",
      trialConversationsUsed: 0,
      trialMaxConversations: 5,
      isAdmin: true,
    });
  }, []);

  const loginTenant = useCallback(async (email: string, password: string) => {
    const request = beginAuthIdentityRequest();
    const res = await fetch("/api/tenants/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: request.signal,
    });
    if (!request.isCurrent()) return;
    if (!res.ok) {
      const data = await res.json();
      request.dispose();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
    if (!request.isCurrent()) return;
    request.dispose();
    const generation = await transitionTenantIdentity(data.token);
    if (!isCurrentAuthIdentityGeneration(generation)) return;
    setToken(data.token);
    localStorage.setItem("vc_token", data.token);
    setTenant({
      id: data.tenantId,
      name: data.name || email,
      email,
      plan: data.plan,
      trialConversationsUsed: data.trialConversationsUsed,
      trialMaxConversations: data.trialMaxConversations,
      isAdmin: !!data.isAdmin,
    });
    if (data.onboardingSeen) {
      localStorage.setItem("vc_onboarding_seen", "1");
    }
  }, []);

  const registerTenant = useCallback(async (email: string, password: string, name: string) => {
    const request = beginAuthIdentityRequest();
    const res = await fetch("/api/tenants/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
      signal: request.signal,
    });
    if (!request.isCurrent()) return;
    if (!res.ok) {
      const data = await res.json();
      request.dispose();
      throw new Error(data.error || "Registration failed");
    }
    const data = await res.json();
    if (!request.isCurrent()) return;
    request.dispose();
    const generation = await transitionTenantIdentity(data.token);
    if (!isCurrentAuthIdentityGeneration(generation)) return;
    setToken(data.token);
    localStorage.setItem("vc_token", data.token);
    setTenant({
      id: data.tenantId,
      name,
      email,
      plan: "trial",
      trialConversationsUsed: 0,
      trialMaxConversations: 5,
      isAdmin: false,
    });
    return data;
  }, []);

  const loginWithReplit = useCallback(() => {
    window.location.href = "/api/login";
  }, []);

  const logout = useCallback(async () => {
    const generation = await transitionTenantIdentity(null);
    if (!isCurrentAuthIdentityGeneration(generation)) return;
    if (isReplitAuth) {
      window.location.href = "/api/logout";
      return;
    }
    setToken(null);
    setTenant(null);
    setReplitUser(null);
    setIsReplitAuth(false);
    localStorage.removeItem("vc_token");
  }, [isReplitAuth]);

  const refreshTenant = useCallback(async () => {
    const refreshGeneration = currentAuthIdentityGeneration();
    if (isReplitAuth) {
      await checkReplitAuth();
    } else if (token) {
      await fetchTenantInfo(token, refreshGeneration);
    }
  }, [token, isReplitAuth, fetchTenantInfo, checkReplitAuth]);

  return (
    <AuthContext.Provider value={{ token, authRequired, isChecking, tenant, replitUser, isReplitAuth, login, loginTenant, registerTenant, loginWithReplit, logout, refreshTenant }}>
      {children}
    </AuthContext.Provider>
  );
}
