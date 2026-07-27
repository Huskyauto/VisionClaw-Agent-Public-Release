import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

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
  logout: () => void;
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
  logout: () => {},
  refreshTenant: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("vc_token"));
  const [authRequired, setAuthRequired] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [replitUser, setReplitUser] = useState<ReplitUser | null>(null);
  const [isReplitAuth, setIsReplitAuth] = useState(false);

  const fetchTenantInfo = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/tenants/me", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTenant(data);
      }
    } catch {}
  }, []);

  const checkReplitAuth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.id) {
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
    } catch {}
    return false;
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const hasReplitAuth = await checkReplitAuth();
      if (hasReplitAuth) {
        setIsChecking(false);
        return;
      }

      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setAuthRequired(data.authRequired);

      if (token) {
        const verify = await fetch("/api/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (verify.status === 401) {
          setToken(null);
          setTenant(null);
          localStorage.removeItem("vc_token");
        } else {
          await fetchTenantInfo(token);
        }
      }
    } catch {
      setAuthRequired(false);
    } finally {
      setIsChecking(false);
    }
  }, [token, fetchTenantInfo, checkReplitAuth]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (pin: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
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
    const res = await fetch("/api/tenants/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
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
    const res = await fetch("/api/tenants/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Registration failed");
    }
    const data = await res.json();
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

  const logout = useCallback(() => {
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
    if (isReplitAuth) {
      await checkReplitAuth();
    } else if (token) {
      await fetchTenantInfo(token);
    }
  }, [token, isReplitAuth, fetchTenantInfo, checkReplitAuth]);

  return (
    <AuthContext.Provider value={{ token, authRequired, isChecking, tenant, replitUser, isReplitAuth, login, loginTenant, registerTenant, loginWithReplit, logout, refreshTenant }}>
      {children}
    </AuthContext.Provider>
  );
}
