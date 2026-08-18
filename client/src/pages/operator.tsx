import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Activity, RefreshCw, RotateCcw, Ban, ChevronRight, AlertTriangle,
  CheckCircle2, Clock, PlayCircle, XCircle, Inbox, Loader2,
} from "lucide-react";

type JobStatus =
  | "pending" | "running" | "succeeded" | "failed" | "failed_terminal" | "cancelled";

interface AgentJob {
  id: number;
  kind: string;
  payload: Record<string, any>;
  tenantId: number | null;
  personaId: number | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  leaseUntil: string | null;
  nextRunAt: string;
  parentJobId: number | null;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface JobStats {
  stats: Partial<Record<JobStatus, number>> & { total?: number };
  registeredKinds: string[];
}

const STATUS_META: Record<JobStatus, { label: string; icon: any; cls: string }> = {
  pending:         { label: "Pending",         icon: Clock,        cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  running:         { label: "Running",         icon: PlayCircle,   cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  succeeded:       { label: "Succeeded",       icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  failed:          { label: "Failed",          icon: AlertTriangle,cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  failed_terminal: { label: "Failed (final)",  icon: XCircle,      cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  cancelled:       { label: "Cancelled",       icon: Ban,          cls: "bg-muted text-muted-foreground border-border" },
};

const ALL_STATUSES: JobStatus[] = [
  "pending", "running", "succeeded", "failed", "failed_terminal", "cancelled",
];

function StatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`${meta.cls} gap-1`} data-testid={`badge-status-${status}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleString();
}

function StatsCards({ stats, total }: { stats: JobStats["stats"]; total: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
      <Card data-testid="card-stat-total">
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total (7d)</div>
          <div className="text-2xl font-semibold mt-1" data-testid="text-stat-total">{total}</div>
        </CardContent>
      </Card>
      {ALL_STATUSES.map((s) => {
        const Icon = STATUS_META[s].icon;
        return (
          <Card key={s} data-testid={`card-stat-${s}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3 w-3" />
                {STATUS_META[s].label}
              </div>
              <div className="text-2xl font-semibold mt-1" data-testid={`text-stat-${s}`}>
                {stats[s] ?? 0}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function JobRow({ job }: { job: AgentJob }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const retry = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/agent-jobs/${job.id}/retry`),
    onSuccess: () => {
      toast({ title: "Job re-queued", description: `Job #${job.id} reset to pending.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-jobs/stats"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e?.message || "Unknown error", variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/agent-jobs/${job.id}/cancel`),
    onSuccess: () => {
      toast({ title: "Job cancelled", description: `Job #${job.id} marked cancelled.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-jobs/stats"] });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e?.message || "Unknown error", variant: "destructive" }),
  });

  const canRetry = job.status === "failed" || job.status === "failed_terminal" || job.status === "cancelled";
  const canCancel = job.status === "pending" || job.status === "running";

  return (
    <>
        <TableRow data-testid={`row-job-${job.id}`} className="hover:bg-muted/40">
          <TableCell className="w-8">
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? `Collapse job ${job.id}` : `Expand job ${job.id}`}
              aria-expanded={open}
              data-testid={`button-expand-${job.id}`}
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
            </Button>
          </TableCell>
          <TableCell className="font-mono text-xs" data-testid={`text-job-id-${job.id}`}>#{job.id}</TableCell>
          <TableCell className="font-medium" data-testid={`text-job-kind-${job.id}`}>{job.kind}</TableCell>
          <TableCell><StatusBadge status={job.status} /></TableCell>
          <TableCell className="text-sm text-muted-foreground" data-testid={`text-job-attempts-${job.id}`}>
            {job.attempts}/{job.maxAttempts}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground" data-testid={`text-job-tenant-${job.id}`}>
            {job.tenantId ?? "—"}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground" data-testid={`text-job-created-${job.id}`}>
            {fmtTime(job.createdAt)}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              {canRetry && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => retry.mutate()}
                  disabled={retry.isPending}
                  aria-label={`Retry job ${job.id}`}
                  data-testid={`button-retry-${job.id}`}
                >
                  {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  <span className="ml-1 hidden sm:inline">Retry</span>
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  aria-label={`Cancel job ${job.id}`}
                  data-testid={`button-cancel-${job.id}`}
                >
                  {cancel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                  <span className="ml-1 hidden sm:inline">Cancel</span>
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
        {open && (
          <TableRow data-testid={`row-detail-${job.id}`}>
            <TableCell colSpan={8} className="bg-muted/30 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-muted-foreground mb-1 font-medium uppercase tracking-wide">Timing</div>
                  <div className="space-y-0.5 font-mono">
                    <div>Created: {new Date(job.createdAt).toLocaleString()}</div>
                    <div>Next run: {new Date(job.nextRunAt).toLocaleString()}</div>
                    {job.startedAt && <div>Started: {new Date(job.startedAt).toLocaleString()}</div>}
                    {job.completedAt && <div>Completed: {new Date(job.completedAt).toLocaleString()}</div>}
                    {job.leaseUntil && <div>Lease until: {new Date(job.leaseUntil).toLocaleString()}</div>}
                    {job.parentJobId && <div>Parent: #{job.parentJobId}</div>}
                    {job.personaId && <div>Persona: {job.personaId}</div>}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1 font-medium uppercase tracking-wide">Payload</div>
                  <pre className="bg-background border rounded p-2 overflow-x-auto max-h-40 text-[11px]" data-testid={`pre-payload-${job.id}`}>
                    {JSON.stringify(job.payload, null, 2)}
                  </pre>
                </div>
                {job.result && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground mb-1 font-medium uppercase tracking-wide">Result</div>
                    <pre className="bg-background border rounded p-2 overflow-x-auto max-h-40 text-[11px]" data-testid={`pre-result-${job.id}`}>
                      {JSON.stringify(job.result, null, 2)}
                    </pre>
                  </div>
                )}
                {job.error && (
                  <div className="md:col-span-2">
                    <div className="text-orange-600 dark:text-orange-400 mb-1 font-medium uppercase tracking-wide">Error</div>
                    <pre className="bg-orange-500/5 border border-orange-500/30 rounded p-2 overflow-x-auto max-h-40 text-[11px] text-orange-700 dark:text-orange-300" data-testid={`pre-error-${job.id}`}>
                      {job.error}
                    </pre>
                  </div>
                )}
              </div>
            </TableCell>
          </TableRow>
        )}
      </>
  );
}

export default function OperatorInboxPage() {
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [limit, setLimit] = useState<number>(100);

  const statsQuery = useQuery<JobStats>({
    queryKey: ["/api/admin/agent-jobs/stats"],
    refetchInterval: 10_000,
  });

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (kindFilter !== "all") params.set("kind", kindFilter);
  params.set("limit", String(limit));
  const qs = params.toString();

  // R74.3-followup — Use apiRequest so JWT bearer tokens are injected for
  // token-only sessions. Raw fetch() bypassed getAuthHeaders() and 401'd in
  // those flows (same fix as H4/H5 on admin-service-orders + code-proposals).
  const jobsQuery = useQuery<{ jobs: AgentJob[]; count: number }>({
    queryKey: ["/api/admin/agent-jobs", statusFilter, kindFilter, limit],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/admin/agent-jobs?${qs}`);
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const stats = statsQuery.data?.stats ?? {};
  const total = (stats as any).total ?? Object.values(stats).reduce((a: number, b: any) => a + (b ?? 0), 0);
  const kinds = statsQuery.data?.registeredKinds ?? [];

  const handleRefresh = () => {
    statsQuery.refetch();
    jobsQuery.refetch();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
              <Inbox className="h-6 w-6 text-primary" />
              Operator Inbox
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Durable agent job queue. Watch what the system is doing, retry failures, cancel stuck work.
            </p>
          </div>
          <Button
            variant="outline" size="sm" onClick={handleRefresh}
            disabled={statsQuery.isFetching || jobsQuery.isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(statsQuery.isFetching || jobsQuery.isFetching) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        {statsQuery.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : statsQuery.error ? (
          <Card className="border-destructive/40 bg-destructive/5" data-testid="card-stats-error">
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-destructive" data-testid="text-stats-error">
                    Stats failed to load
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {(statsQuery.error as any)?.message || "Unknown error"}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => statsQuery.refetch()} data-testid="button-retry-stats">
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <StatsCards stats={stats} total={Number(total) || 0} />
        )}

        {/* Filters */}
        <Card data-testid="card-filters">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Filters
            </CardTitle>
            <CardDescription>{kinds.length} handler kinds registered</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                  <SelectTrigger className="mt-1" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Kind</Label>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="mt-1" data-testid="select-kind-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    {kinds.map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Limit (max 500)</Label>
                <Input
                  type="number" min={1} max={500} value={limit}
                  onChange={(e) => setLimit(Math.min(500, Math.max(1, parseInt(e.target.value) || 100)))}
                  className="mt-1"
                  data-testid="input-limit"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Jobs table */}
        <Card data-testid="card-jobs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Jobs {jobsQuery.data && (
                <span className="text-muted-foreground font-normal text-sm ml-2">
                  ({jobsQuery.data.count} shown)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {jobsQuery.isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : jobsQuery.error ? (
              <div className="p-6 text-sm text-destructive" data-testid="text-jobs-error">
                Failed to load jobs: {(jobsQuery.error as any)?.message || "Unknown error"}
              </div>
            ) : !jobsQuery.data?.jobs.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground" data-testid="text-empty">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No jobs match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="table-jobs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-20">ID</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobsQuery.data.jobs.map((j) => <JobRow key={j.id} job={j} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
