import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Laptop, LockKeyhole, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type MaintenanceTask = "both" | "lenovo" | "surface";

interface MaintenanceSource {
  id: string;
  title: string;
}

interface MaintenanceNode {
  id: string;
  label: string;
  model: string;
  assignment: string;
  configured: boolean;
  busy: boolean;
}

interface MaintenanceJob {
  id: number;
  kind: string;
  status: string;
  priority: string;
  sourceId: string;
  model: string | null;
  createdAt: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface LocalMaintenanceData {
  enabled: boolean;
  nightlyEnabled: boolean;
  surfaceEnabled: boolean;
  hostedFallbackEnabled: boolean;
  environment: string;
  sources: MaintenanceSource[];
  nodes: MaintenanceNode[];
  jobs: MaintenanceJob[];
}

interface QueueResponse {
  jobIds: number[];
}

const MAINTENANCE_URL = "/api/admin/local-maintenance";

function isForbidden(error: unknown): boolean {
  return error instanceof Error && /^403\b/.test(error.message);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sourceTitle(sources: MaintenanceSource[], sourceId: string): string {
  return sources.find((source) => source.id === sourceId)?.title ?? sourceId;
}

function assignmentNote(node: MaintenanceNode): string | null {
  const identity = `${node.id} ${node.label}`.toLowerCase();
  if (identity.includes("lenovo")) return "Multi-concept work";
  if (identity.includes("surface")) return "7B · one exact reference";
  return null;
}

function statusTone(status: string): string {
  if (status === "running") return "border-primary/30 bg-primary/10 text-primary";
  if (status === "succeeded") return "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300";
  if (status === "failed" || status === "failed_terminal") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-muted text-muted-foreground";
}

export function LocalMaintenancePanel() {
  const { tenant } = useAuth();
  const owner = tenant?.id === 1 && tenant?.isAdmin === true;
  const [sourceId, setSourceId] = useState("zoom-out");
  const [task, setTask] = useState<MaintenanceTask>("both");
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [successIds, setSuccessIds] = useState<number[] | null>(null);

  const maintenanceQuery = useQuery<LocalMaintenanceData>({
    queryKey: [MAINTENANCE_URL],
    queryFn: async () => {
      const response = await apiRequest("GET", MAINTENANCE_URL);
      return response.json();
    },
    retry: false,
    enabled: owner,
    refetchInterval: owner ? 15_000 : false,
  });

  const queueMutation = useMutation({
    mutationFn: async () => {
      if (!owner) throw Error("Owner session required");
      const response = await apiRequest("POST", MAINTENANCE_URL, { sourceId, task });
      return response.json() as Promise<QueueResponse>;
    },
    onSuccess: (result) => {
      setSuccessIds(result.jobIds);
      queryClient.invalidateQueries({ queryKey: [MAINTENANCE_URL] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-jobs"] });
    },
  });

  const data = maintenanceQuery.data;
  const sortedJobs = data?.jobs
    ? [...data.jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6)
    : [];

  if (!owner) return null;

  return (
    <Card className="overflow-hidden border-primary/20" data-testid="card-local-maintenance">
      <CardHeader className="border-b border-border/70 bg-primary/[0.035] pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-md border border-primary/20 bg-primary/10 p-2 text-primary">
              <Laptop className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base">Local laptop maintenance</CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Owner-only controls for Bob’s two local machines. This is queue and configuration metadata—not a live connection monitor.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 border-primary/25 bg-background/70 text-muted-foreground">
            <LockKeyhole className="h-3 w-3" />
            Internal sources only
          </Badge>
        </div>
      </CardHeader>

      {maintenanceQuery.isLoading ? (
        <CardContent className="space-y-4 p-5" data-testid="maintenance-loading">
          <Skeleton className="h-16 w-full" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      ) : maintenanceQuery.error ? (
        <CardContent className="p-5" data-testid="maintenance-error">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-destructive/25 bg-destructive/[0.045] p-4">
            <div className="flex gap-2.5 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium" data-testid="maintenance-error-title">
                  {isForbidden(maintenanceQuery.error) ? "Local maintenance unavailable" : "Could not load local maintenance"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {isForbidden(maintenanceQuery.error)
                    ? "This owner-only panel is not available for this account."
                    : maintenanceQuery.error.message || "The status request failed. No cached maintenance details are shown."}
                </p>
              </div>
            </div>
            {!isForbidden(maintenanceQuery.error) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => maintenanceQuery.refetch()}
                disabled={maintenanceQuery.isFetching}
                data-testid="button-retry-maintenance"
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${maintenanceQuery.isFetching ? "animate-spin" : ""}`} />
                Retry
              </Button>
            )}
          </div>
        </CardContent>
      ) : data ? (
        <CardContent className="space-y-5 p-4 sm:p-5" data-testid="maintenance-content">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="rounded-md border border-border/80 bg-background/70 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Queue behavior</span>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {data.enabled ? "Queue enabled" : "Queue disabled"}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                One job per laptop at a time. Daytime work is next after that laptop’s current running job; an idle inference slot does not mean the laptop is online.
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Hosted recovery may use paid services and can spend, subject to the configured budget.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-md border border-border/80 bg-background/70 px-3.5 py-3 text-xs sm:min-w-56">
              <span className="text-muted-foreground">Environment</span>
              <span className="text-right font-medium" data-testid="text-maintenance-environment">{data.environment}</span>
              <span className="text-muted-foreground">Nightly</span>
              <span className="text-right font-medium">{data.nightlyEnabled ? "Enabled" : "Disabled"}</span>
              <span className="text-muted-foreground">Surface</span>
              <span className="text-right font-medium">{data.surfaceEnabled ? "Enabled" : "Disabled"}</span>
              <span className="text-muted-foreground">Hosted recovery</span>
              <span className="text-right font-medium">{data.hostedFallbackEnabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>

          <section aria-label="Configured laptops" className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Machines & assignments</h3>
              <span className="text-xs text-muted-foreground">Configured does not mean online</span>
            </div>
            {data.nodes.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {data.nodes.map((node) => (
                  <article
                    key={node.id}
                    className="rounded-md border border-border/80 bg-card p-3.5 transition-colors hover:border-primary/25"
                    data-testid={`maintenance-node-${node.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium leading-tight">{node.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{node.model}</p>
                      </div>
                      <Badge variant="outline" className={node.configured ? "shrink-0 border-border text-muted-foreground" : "shrink-0 border-amber-600/25 bg-amber-600/10 text-amber-800 dark:text-amber-300"}>
                        {node.configured ? "Configured" : "Not configured"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed">{node.assignment}</p>
                    {assignmentNote(node) && <p className="mt-1 text-xs font-medium text-primary">{assignmentNote(node)}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {node.busy ? "Inference slot held" : "No inference slot held"}
                      <span className="sr-only">; this does not indicate online status</span>
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="maintenance-nodes-empty">
                No laptop metadata is available.
              </div>
            )}
          </section>

          <section className="grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Queue daytime work</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose a runbook and which laptop should work on it. Example: caller inspection on both laptops.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="maintenance-source" className="text-xs">Source</Label>
                  <select
                    id="maintenance-source"
                    disabled={queueMutation.isPending}
                    value={sourceId}
                    onChange={(event) => setSourceId(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-maintenance-source"
                  >
                    {data.sources.map((source) => (
                      <option key={source.id} value={source.id}>{source.title}</option>
                    ))}
                    {!data.sources.some((source) => source.id === sourceId) && (
                      <option value={sourceId}>{sourceId}</option>
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maintenance-task" className="text-xs">Laptop scope</Label>
                  <select
                    id="maintenance-task"
                    disabled={queueMutation.isPending}
                    value={task}
                    onChange={(event) => setTask(event.target.value as MaintenanceTask)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-maintenance-task"
                  >
                    <option value="both">Both laptops</option>
                    <option value="lenovo">Lenovo · multi-concept</option>
                    <option value="surface">Surface · 7B exact reference</option>
                  </select>
                </div>
              </div>
              <Button
                onClick={() => {
                  setSuccessIds(null);
                  queueMutation.mutate();
                }}
                disabled={!data.enabled || queueMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-queue-maintenance"
              >
                {queueMutation.isPending ? "Queueing…" : "Queue daytime work"}
              </Button>
              {!data.enabled && (
                <p className="text-xs text-muted-foreground" data-testid="maintenance-disabled-note">
                  Queueing is disabled by the current local-maintenance configuration.
                </p>
              )}
              {queueMutation.error && (
                <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.045] px-3 py-2 text-sm text-destructive" data-testid="maintenance-request-error">
                  Request not confirmed: {queueMutation.error.message || "the server returned an error."}
                </p>
              )}
              {successIds !== null && (
                <p role="status" className="rounded-md border border-primary/20 bg-primary/[0.045] px-3 py-2 text-sm" data-testid="maintenance-request-success">
                  {successIds.length
                    ? <>Request accepted · job IDs {successIds.map((id) => `#${id}`).join(", ")}</>
                    : "Request accepted; the server returned no job IDs."}
                </p>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold">Recent local jobs</h3>
                <span className="text-xs text-muted-foreground">Latest {sortedJobs.length}</span>
              </div>
              {sortedJobs.length ? (
                <div className="space-y-2" data-testid="maintenance-recent-jobs">
                  {sortedJobs.map((job) => {
                    const expanded = expandedJob === job.id;
                    return (
                      <article key={job.id} className="rounded-md border border-border/80 bg-background/70" data-testid={`maintenance-job-${job.id}`}>
                        <button
                          type="button"
                          onClick={() => setExpandedJob(expanded ? null : job.id)}
                          className="flex w-full items-start justify-between gap-3 p-3 text-left"
                          aria-expanded={expanded}
                          data-testid={`button-expand-maintenance-job-${job.id}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">#{job.id} · {job.kind}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {sourceTitle(data.sources, job.sourceId)} · {formatTime(job.createdAt)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className={statusTone(job.status)}>{job.status}</Badge>
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </span>
                        </button>
                        {expanded && (
                          <div className="space-y-2 border-t border-border/70 px-3 py-2.5 text-xs" data-testid={`maintenance-job-details-${job.id}`}>
                            <p><span className="text-muted-foreground">Priority:</span> {job.priority}</p>
                            <p><span className="text-muted-foreground">Model:</span> {job.model ?? "Not specified"}</p>
                            {job.result && (
                              <div>
                                <p className="mb-1 text-muted-foreground">Result</p>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[11px]" data-testid={`maintenance-job-result-${job.id}`}>
                                  {JSON.stringify(job.result, null, 2)}
                                </pre>
                              </div>
                            )}
                            {job.error && (
                              <p className="break-words text-destructive" data-testid={`maintenance-job-error-${job.id}`}>{job.error}</p>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="maintenance-jobs-empty">
                  No recent local jobs in the returned metadata.
                </div>
              )}
            </div>
          </section>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default LocalMaintenancePanel;
