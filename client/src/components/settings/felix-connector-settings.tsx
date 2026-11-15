import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, ExternalLink, LockKeyhole, MessageSquareText, ShieldCheck, Wrench } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, getAuthIdentityVersion, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type FelixConnectorClient = {
  clientId: string;
  conversationId: number;
  createdAt: string;
  activeTokens: number;
  allowWork: boolean;
};

type FelixConnectorStatus = {
  enabled: boolean;
  connectorUrl: string;
  clients: FelixConnectorClient[];
};

const endpoint = "/api/admin/felix-connector";
const safeError = "That request could not be completed. Please try again.";

function isStatus(value: unknown): value is FelixConnectorStatus {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FelixConnectorStatus>;
  return typeof item.enabled === "boolean"
    && typeof item.connectorUrl === "string"
    && Array.isArray(item.clients)
    && item.clients.every((client) => client
      && typeof client.clientId === "string"
      && typeof client.conversationId === "number"
      && typeof client.createdAt === "string"
      && typeof client.activeTokens === "number"
      && typeof client.allowWork === "boolean");
}

export function FelixConnectorSettings() {
  const { token, isReplitAuth, tenant } = useAuth();
  const owner = tenant?.id === 1 && tenant.isAdmin === true;
  const authenticated = !!token || isReplitAuth;
  const identityVersion = getAuthIdentityVersion();
  const identityKey = `${identityVersion}:${tenant?.id ?? "none"}:${isReplitAuth ? "replit" : "session"}`;
  const queryKey = [...[endpoint, "security-settings"], identityKey] as const;
  const [copied, setCopied] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const statusQuery = useQuery<FelixConnectorStatus>({
    queryKey,
    enabled: authenticated && owner,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", endpoint);
      if (signal.aborted || identityVersion !== getAuthIdentityVersion()) throw new Error(safeError);
      const result: unknown = await response.json();
      if (!isStatus(result)) throw new Error(safeError);
      return result;
    },
  });

  const permissionMutation = useMutation({
    mutationFn: async (input: { clientId: string; allowWork: boolean; identityVersion: number }) => {
      const response = await apiRequest(
        "PATCH",
        `${endpoint}/clients/${encodeURIComponent(input.clientId)}/permissions`,
        { allowWork: input.allowWork },
      );
      const result: unknown = await response.json();
      if (!result || typeof result !== "object"
        || (result as { ok?: unknown }).ok !== true
        || (result as { allowWork?: unknown }).allowWork !== input.allowWork) throw new Error(safeError);
      return input;
    },
    onSuccess: (input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: "" }));
      queryClient.setQueryData<FelixConnectorStatus>(queryKey, (old) => old && ({
        ...old,
        clients: old.clients.map((client) => client.clientId === input.clientId
          ? { ...client, allowWork: input.allowWork }
          : client),
      }));
      queryClient.invalidateQueries({queryKey:[endpoint]});
    },
    onError: (_error, input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: safeError }));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (input: { clientId: string; identityVersion: number }) => {
      const response = await apiRequest("DELETE", `${endpoint}/clients/${encodeURIComponent(input.clientId)}`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) throw new Error(safeError);
      return input;
    },
    onSuccess: (input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: "" }));
      queryClient.invalidateQueries({ queryKey:[endpoint] });
    },
    onError: (_error, input) => {
      if (input.identityVersion !== getAuthIdentityVersion()) return;
      setRowErrors((current) => ({ ...current, [input.clientId]: safeError }));
    },
  });

  if (!authenticated || !owner) return null;

  const copyUrl = async () => {
    const url = statusQuery.data?.connectorUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="h-1 bg-primary/70" />
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="h-4 w-4 text-primary" /> Claude ↔ Felix connector
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Connect Claude to your Felix work platform. Setup and permissions live here beside API access.
            </CardDescription>
          </div>
          <Badge variant={statusQuery.data?.enabled ? "secondary" : "outline"}>
            {statusQuery.data?.enabled ? "Available" : "Owner controlled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/25 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Add connector</p>
            <p className="mt-2 text-sm leading-5">In Claude, add a remote custom connector and paste the URL below. No API key or secret is needed.</p>
          </div>
          <div className="rounded-lg border bg-muted/25 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Sign in as owner</p>
            <p className="mt-2 text-sm leading-5">When Claude redirects here, sign in to VisionClaw and review its one-time access request.</p>
          </div>
          <div className="rounded-lg border bg-muted/25 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Choose work access</p>
            <p className="mt-2 text-sm leading-5">Approve messages-only access or explicitly enable ordinary Felix work. You can change it any time.</p>
          </div>
        </div>

        {statusQuery.isLoading ? (
          <div className="space-y-2" aria-label="Loading connector settings">
            <Skeleton className="h-5 w-40" /><Skeleton className="h-10 w-full" />
          </div>
        ) : statusQuery.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-destructive" /> Connector settings could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()}>Retry</Button>
          </div>
        ) : statusQuery.data ? (
          <>
            <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Connector URL <span className="font-normal text-muted-foreground">(not a credential)</span></p>
                <Button variant="outline" size="sm" className="shrink-0" onClick={copyUrl} disabled={!statusQuery.data.connectorUrl}>
                  {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copied ? "Copied" : "Copy URL"}
                </Button>
              </div>
              <code className="block break-all rounded-md bg-background px-3 py-2 text-xs leading-5">{statusQuery.data.connectorUrl || "Connector URL is not available."}</code>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Claude will open a VisionClaw owner sign-in and authorization page when you connect.</p>
            </div>

            <section aria-labelledby="felix-setup-access">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Access management</p>
                  <h3 id="felix-setup-access" className="mt-1 text-sm font-semibold">Connected Claude clients</h3>
                </div>
                <Link href="/felix-connector" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open full connector settings <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
              {statusQuery.data.clients.length ? (
                <div className="divide-y rounded-lg border">
                  {statusQuery.data.clients.map((client) => (
                    <div key={client.clientId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-medium">{client.clientId}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Connected {new Date(client.createdAt).toLocaleDateString()} · {client.activeTokens} active {client.activeTokens === 1 ? "token" : "tokens"}
                        </p>
                        {rowErrors[client.clientId] && <p role="alert" className="mt-1 text-xs text-destructive">{rowErrors[client.clientId]}</p>}
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
                          className="border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                          disabled={disconnectMutation.isPending && disconnectMutation.variables?.clientId === client.clientId}
                          onClick={() => {
                            if (window.confirm("Disconnect this Claude client and revoke its access to Felix?")) {
                              disconnectMutation.mutate({ clientId: client.clientId, identityVersion });
                            }
                          }}
                        >
                          <LockKeyhole className="mr-1.5 h-3.5 w-3.5" />
                          {disconnectMutation.isPending && disconnectMutation.variables?.clientId === client.clientId ? "Disconnecting…" : "Disconnect"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-5 text-sm">
                  <p className="font-medium">No Claude clients connected</p>
                  <p className="mt-1 text-muted-foreground">Add the remote connector in Claude. Your first connection appears after owner sign-in and consent.</p>
                </div>
              )}
            </section>

            <div className="flex gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>New grants start messages-only. “Allow Felix work” lets Claude use ordinary guarded Felix tools without asking you to approve each routine task. Each tool keeps its existing approval and spending rules; this permission cannot stand in for a required action approval or bypass owner-only restrictions. Changes apply to new sends, not work already running.</p>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
