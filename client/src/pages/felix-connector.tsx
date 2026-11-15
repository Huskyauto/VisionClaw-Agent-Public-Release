import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Clock3, Copy, LockKeyhole, MessageSquareText, ShieldCheck, Users, Wrench, X } from "lucide-react";
import LoginPage from "@/pages/login";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getAuthIdentityVersion, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

type FelixClient = {
  clientId: string;
  conversationId: number;
  createdAt: string;
  activeTokens: number;
  allowWork: boolean;
};

type ConnectorStatus = {
  enabled: boolean;
  clients: FelixClient[];
  connectorUrl: string;
};

type ConsentRequest = {
  clientId: string;
  clientName: string;
  scopes: string[];
  redirectOrigin: string;
};

type ConsentResponse = { redirectUrl: string };

const statusKey = ["/api/admin/felix-connector"] as const;
const SAFE_ERROR = "That request could not be completed. Please try again.";

function responseError() {
  return new Error(SAFE_ERROR);
}

function isConsentRequest(value: unknown): value is ConsentRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ConsentRequest>;
  return typeof item.clientId === "string"
    && typeof item.clientName === "string"
    && Array.isArray(item.scopes)
    && item.scopes.every((scope) => typeof scope === "string")
    && typeof item.redirectOrigin === "string";
}

function isConnectorStatus(value: unknown): value is ConnectorStatus {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ConnectorStatus>;
  return typeof item.enabled === "boolean"
    && Array.isArray(item.clients)
    && typeof item.connectorUrl === "string"
    && item.clients.every((client) => client && typeof client.clientId === "string"
      && typeof client.conversationId === "number"
      && typeof client.createdAt === "string"
      && typeof client.activeTokens === "number"
      && typeof client.allowWork === "boolean");
}

function safeRedirectTarget(raw: string): string | null {
  try {
    const target = new URL(raw);
    const host = target.hostname.toLowerCase();
    const claudeHost = host === "claude.ai" || host === "claude.com";
    const localHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const safeClaude = target.protocol === "https:" && claudeHost && !target.port;
    const safeLocal = import.meta.env.DEV && localHost
      && (target.protocol === "http:" || target.protocol === "https:");
    if ((!safeClaude && !safeLocal) || target.username || target.password || target.hash) return null;
    return target.href;
  } catch {
    return null;
  }
}

function readableScope(scope: string): string {
  if (scope.endsWith(":read")) return "Read Felix messages";
  if (scope.endsWith(":write")) return "Send messages to Felix";
  return scope;
}

export default function FelixConnectorPage() {
  const { token, isChecking, isReplitAuth, tenant } = useAuth();
  const [location] = useLocation();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [consentError, setConsentError] = useState("");
  const [allowWork, setAllowWork] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const authenticated = !!token || isReplitAuth;
  const owner = tenant?.id === 1 && tenant.isAdmin === true;
  const [request, setRequest] = useState(() => new URLSearchParams(window.location.search).get("request") || "");
  const requestRef = useRef(request);
  requestRef.current = request;
  const identityVersion = getAuthIdentityVersion();
  const identityKey = `${identityVersion}:${tenant?.id ?? "none"}:${isReplitAuth ? "replit" : "session"}`;
  const consentKey = ["/api/admin/felix-connector/consent", request, identityKey] as const;
  useEffect(() => setAllowWork(false),[request,identityKey]);

  useEffect(() => {
    const syncRequest = () => setRequest(new URLSearchParams(window.location.search).get("request") || "");
    window.addEventListener("popstate", syncRequest);
    syncRequest();
    return () => window.removeEventListener("popstate", syncRequest);
  }, [location]);

  useEffect(() => {
    setAllowWork(false);
    setConsentError("");
  }, [request]);

  useEffect(() => {
    if (!authenticated && request) {
      try {
        sessionStorage.setItem("felix_connector_login_return", request);
      } catch {
        // Sign-in still works; the current browser URL retains the request.
      }
    } else if (authenticated && request) {
      try { sessionStorage.removeItem("felix_connector_login_return"); } catch { /* URL still retains the request. */ }
    }
  }, [authenticated, request]);

  const statusQuery = useQuery<ConnectorStatus>({
    queryKey: [...statusKey, identityKey],
    enabled: authenticated && owner,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", statusKey[0]);
      if (signal.aborted) throw new Error(SAFE_ERROR);
      const result: unknown = await response.json();
      if (!isConnectorStatus(result)) throw responseError();
      return result;
    },
  });

  const consentQuery = useQuery<ConsentRequest>({
    queryKey: consentKey,
    enabled: authenticated && owner && !!request,
    queryFn: async ({ signal }) => {
      const response = await apiRequest(
        "GET",
        `/api/admin/felix-connector/consent?request=${encodeURIComponent(request)}`,
      );
      if (signal.aborted) throw new Error(SAFE_ERROR);
      const result: unknown = await response.json();
      if (!isConsentRequest(result)) throw responseError();
      return result;
    },
  });

  const consentMutation = useMutation({
    mutationFn: async (input: { allow: boolean; allowWork: boolean; request: string; identityVersion: number }) => {
      const response = await apiRequest("POST", "/api/admin/felix-connector/consent", {
        request: input.request,
        allow: input.allow,
        allowWork: input.allow && input.allowWork,
      });
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || typeof (result as ConsentResponse).redirectUrl !== "string") {
        throw responseError();
      }
      return { response: result as ConsentResponse, input };
    },
    onSuccess: ({ response, input }) => {
      if (input.request !== requestRef.current || input.identityVersion !== getAuthIdentityVersion()) return;
      const destination = safeRedirectTarget(response.redirectUrl);
      if (!destination) {
        setConsentError("The return address could not be verified. No redirect was made.");
        return;
      }
      window.location.assign(destination);
    },
    onError: () => setConsentError(SAFE_ERROR),
  });

  const revokeMutation = useMutation({
    mutationFn: async (input: { clientId: string; identityVersion: number }) => {
      const response = await apiRequest("DELETE", `/api/admin/felix-connector/clients/${encodeURIComponent(input.clientId)}`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
        throw responseError();
      }
      return input;
    },
    onSuccess: ({ clientId, identityVersion: mutationIdentity }) => {
      if (mutationIdentity !== getAuthIdentityVersion()) return;
      setRowErrors((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: statusKey });
    },
    onError: (_error, input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: SAFE_ERROR }));
    },
  });

  const permissionMutation = useMutation({
    mutationFn: async (input: { clientId: string; allowWork: boolean; identityVersion: number }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/admin/felix-connector/clients/${encodeURIComponent(input.clientId)}/permissions`,
        { allowWork: input.allowWork },
      );
      const result: unknown = await response.json();
      if (!result || typeof result !== "object"
        || (result as { ok?: unknown }).ok !== true
        || (result as { allowWork?: unknown }).allowWork !== input.allowWork) throw responseError();
      return input;
    },
    onSuccess: (input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: "" }));
      queryClient.setQueryData<ConnectorStatus>([...statusKey, identityKey], (old) => old && ({
        ...old,
        clients: old.clients.map((client) => client.clientId === input.clientId
          ? { ...client, allowWork: input.allowWork }
          : client),
      }));
      queryClient.invalidateQueries({queryKey:statusKey});
    },
    onError: (_error, input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: SAFE_ERROR }));
    },
  });

  if (isChecking) {
    return (
      <main className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto max-w-4xl space-y-6 px-5 py-12">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
          <div className="mb-5 flex items-center justify-between">
            <Link href="/felix-connector" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Felix connector
            </Link>
            <Badge variant="outline" className="gap-1.5 font-normal">
              <LockKeyhole className="h-3.5 w-3.5" /> Owner sign-in required
            </Badge>
          </div>
          <div className="mb-5 rounded-xl border border-border/80 bg-muted/40 px-5 py-4">
            <p className="text-sm font-medium">Sign in to review this one-time request.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The request stays in this browser and will not be shown or copied into chat.
            </p>
          </div>
          <LoginPage />
        </div>
      </main>
    );
  }

  if (!owner) {
    return <main className="min-h-screen bg-background p-8"><h1 className="text-2xl font-semibold">Owner access required</h1>
      <p className="mt-3 text-muted-foreground">Only the VisionClaw owner can connect Claude to Felix.</p>
      <Link href="/" className="mt-6 inline-block underline">Return to VisionClaw</Link></main>;
  }
  const consent = consentQuery.data;
  const status = statusQuery.data;
  const requestedRead = consent?.scopes.some((scope) => scope.endsWith(":read")) ?? false;
  const requestedWrite = consent?.scopes.some((scope) => scope.endsWith(":write")) ?? false;

  return (
    <main className="min-h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-12">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Owner controls</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Claude ↔ Felix</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Give Claude a direct, bounded connection to Felix. Credentials stay out of chat; you can revoke any connection here.
            </p>
          </div>
          <Link href="/settings#security" className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            <ArrowLeft className="h-4 w-4" /> Security settings
          </Link>
        </header>

        <Card className="mb-7 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Set up Claude in three steps</CardTitle>
            <CardDescription>No API key or connector secret is needed. Authorization happens in VisionClaw.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="grid gap-3 sm:grid-cols-3">
              <li className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">01 · Add it in Claude</p>
                <p className="mt-2 text-sm leading-5">Choose Add a remote custom connector in Claude and paste this exact URL:</p>
                <div className="mt-3 flex gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md bg-background p-2 text-xs leading-5">{status?.connectorUrl || (statusQuery.isLoading ? "Loading connector URL…" : "Connector URL unavailable")}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy connector URL"
                    title="Copy connector URL"
                    disabled={!status?.connectorUrl}
                    onClick={async () => {
                      if (!status?.connectorUrl) return;
                      try {
                        await navigator.clipboard.writeText(status.connectorUrl);
                        setCopiedUrl(true);
                        window.setTimeout(() => setCopiedUrl(false), 1800);
                      } catch {
                        setCopiedUrl(false);
                      }
                    }}
                  >
                    {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                {copiedUrl && <p className="mt-1 text-xs text-primary">Connector URL copied.</p>}
              </li>
              <li className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">02 · Owner sign-in</p>
                <p className="mt-2 text-sm leading-5">Claude opens VisionClaw. Sign in as the owner, then review the named client and requested message scopes.</p>
              </li>
              <li className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">03 · One-time consent</p>
                <p className="mt-2 text-sm leading-5">Choose messages-only by default, or explicitly allow ordinary Felix work. Manage or disconnect access here later.</p>
              </li>
            </ol>
            <p className="flex items-start gap-2 border-t pt-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              The connector URL is public configuration, not a credential. Work uses ordinary guarded Felix tools. Each tool keeps its existing approval, spending and owner-only restrictions; Claude cannot impersonate Bob’s approval.
            </p>
          </CardContent>
        </Card>

        {request ? (
          <Card className="mb-7 overflow-hidden border-primary/20 shadow-sm">
            <div className="h-1 bg-primary/70" />
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl">Review Claude’s request</CardTitle>
                  <CardDescription className="mt-1">One-time authorization · owner approval</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {consentQuery.isLoading ? (
                <div className="space-y-3" aria-label="Loading access request">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : consentQuery.isError ? (
                <div className="flex gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="flex-1">
                    <p className="font-medium">This request is unavailable.</p>
                    <p className="mt-1 text-muted-foreground">It may have expired. Return to Claude and start again.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => consentQuery.refetch()}>Retry</Button>
                </div>
              ) : consent ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Claude connection</p>
                    <p className="mt-1 text-lg font-medium">{consent.clientName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Return destination: {consent.redirectOrigin}</p>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="mb-3 text-sm font-semibold">Access requested</p>
                    {consent.scopes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No Felix permissions requested.</p>
                    ) : (
                      <ul className="space-y-2">
                        {consent.scopes.map((scope, index) => (
                          <li key={`${scope}-${index}`} className="flex items-start gap-2 text-sm">
                            {scope.endsWith(":write")
                              ? <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              : <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                            <span>{readableScope(scope)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {requestedRead && !requestedWrite && (
                      <p className="mt-3 border-t border-border pt-3 text-sm leading-5 text-muted-foreground">
                        Read-only access: Claude can read its own Felix thread and outbox, but cannot send messages.
                      </p>
                    )}
                    {requestedRead && requestedWrite && (
                      <p className="mt-3 border-t border-border pt-3 text-sm leading-5 text-muted-foreground">
                        Claude can read only its own Felix thread and outbox. It cannot access other conversations.
                      </p>
                    )}
                    {requestedWrite && (
                      <p className="mt-3 border-t border-border pt-3 text-sm leading-5 text-muted-foreground">
                        Claude can ask Felix questions and send messages in the connected conversation. Routine sends do not require per-message approval and remain subject to Felix’s normal limits.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-border/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
                    Read access, when requested, is limited to Claude’s own Felix thread and recipient-specific outbox.
                    New grants are messages-only unless you explicitly enable Felix work. Work means ordinary guarded Felix tools;
                    each tool retains its existing approval and spending rules. This permission cannot substitute for a required action approval
                    or bypass owner-only restrictions. Changes apply to new sends, not work already running.
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.035] p-4">
                    <input
                      type="checkbox"
                      checked={allowWork}
                      onChange={(event) => setAllowWork(event.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold"><Wrench className="h-4 w-4 text-primary" /> Allow Claude to have Felix perform ordinary work</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Felix can carry out routine work through its existing guarded tools without asking for approval on every task. Leave unchecked for messages-only access. Existing protections for sensitive actions remain in force.
                      </span>
                    </span>
                  </label>

                  {consentError && (
                    <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4" /> {consentError}
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => { setConsentError(""); consentMutation.mutate({ allow: false, allowWork: false, request, identityVersion }); }} disabled={consentMutation.isPending}>
                      <X className="mr-2 h-4 w-4" /> Deny
                    </Button>
                    <Button onClick={() => { setConsentError(""); consentMutation.mutate({ allow: true, allowWork, request, identityVersion }); }} disabled={consentMutation.isPending || consent.scopes.length === 0}>
                      <Check className="mr-2 h-4 w-4" />
                      {consentMutation.isPending ? "Sending response…" : "Allow this connection"}
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-7 border-border/80">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">No request to review</p>
                <p className="mt-1 text-sm text-muted-foreground">This page also shows active Claude connections and lets you revoke them.</p>
              </div>
              <Link href="/settings#security" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Security settings <ArrowUpRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        )}

        <section aria-labelledby="connections-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Access management</p>
              <h2 id="connections-heading" className="text-xl font-semibold">Connected Claude clients</h2>
            </div>
            {status && <Badge variant={status.enabled ? "secondary" : "outline"}>{status.enabled ? "Connector on" : "Connector paused"}</Badge>}
          </div>

          {statusQuery.isLoading ? (
            <Card><CardContent className="space-y-3 py-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent></Card>
          ) : statusQuery.isError ? (
            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-5">
                <div className="flex items-start gap-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div><p className="font-medium">Connections could not be loaded.</p><p className="mt-1 text-muted-foreground">Your access settings have not been changed.</p></div>
                </div>
                <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()}>Retry</Button>
              </CardContent>
            </Card>
          ) : status?.clients.length ? (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {status.clients.map((client) => (
                  <div key={client.clientId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-all font-medium">{client.clientId}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Connected {new Date(client.createdAt).toLocaleDateString()}</span>
                        <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {client.activeTokens} active {client.activeTokens === 1 ? "token" : "tokens"}</span>
                        <span className="inline-flex items-center gap-1">{client.allowWork ? <Wrench className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}{client.allowWork ? "Felix work enabled" : "Messages only"}</span>
                      </div>
                      {rowErrors[client.clientId] && <p role="alert" className="mt-2 text-xs text-destructive">{rowErrors[client.clientId]}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={client.allowWork}
                          disabled={permissionMutation.isPending && permissionMutation.variables?.clientId === client.clientId}
                          onChange={(event) => {
                            setRowErrors((current) => ({ ...current, [client.clientId]: "" }));
                            permissionMutation.mutate({ clientId: client.clientId, allowWork: event.target.checked, identityVersion });
                          }}
                          className="h-4 w-4 accent-primary"
                        />
                        <Wrench className="h-3.5 w-3.5" /> Allow Felix work
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                        disabled={revokeMutation.isPending && revokeMutation.variables?.clientId === client.clientId}
                        onClick={() => {
                          if (window.confirm("Disconnect this Claude client and revoke its access to Felix?")) {
                            setRowErrors((current) => ({ ...current, [client.clientId]: "" }));
                            revokeMutation.mutate({ clientId: client.clientId, identityVersion });
                          }
                        }}
                      >
                        {revokeMutation.isPending && revokeMutation.variables?.clientId === client.clientId ? "Disconnecting…" : "Disconnect"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-start gap-4 py-7">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">No Claude clients connected</p>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                    When Claude requests access, you’ll review its permissions here before anything is connected.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {status?.connectorUrl && (
          <p className="mt-5 text-xs text-muted-foreground">
            Connector endpoint is configured. <span className="sr-only">It is not a credential.</span>
          </p>
        )}
      </div>
    </main>
  );
}
