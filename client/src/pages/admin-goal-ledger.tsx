import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, ListTodo, GitCommit, Activity, RefreshCw } from "lucide-react";

interface GoalLedger {
  generatedAt: string;
  sessionPlan: { content: string; mtime: string | null; ageMinutes: number | null } | null;
  tasks: Array<{ file: string; title: string; summary: string; mtime: string | null; sizeBytes: number }>;
  recentRounds: Array<{ round: string; date: string | null; oneLiner: string }>;
  activeJobs: Array<{
    id: number;
    kind: string;
    status: string;
    tenant_id: number;
    tenant_name: string | null;
    started_at: string | null;
    next_run_at: string | null;
    lease_until: string | null;
    created_at: string;
  }>;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function AdminGoalLedgerPage() {
  const { data, isLoading, error, isFetching, refetch } = useQuery<GoalLedger>({
    queryKey: ["/api/admin/goal-ledger"],
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center" data-testid="state-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load goal ledger.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-goal-ledger">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Goal Ledger</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-description">
            Live view across session plan, active tasks, in-flight jobs, and recent ship log. Refreshes every 15s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-generated-at">
            {isFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            updated {relTime(data.generatedAt)}
          </Badge>
          <button
            onClick={() => refetch()}
            className="text-xs underline text-muted-foreground hover:text-foreground"
            data-testid="button-refresh"
          >
            refresh now
          </button>
        </div>
      </div>

      <Card data-testid="card-session-plan">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle>Session Plan</CardTitle>
            </div>
            {data.sessionPlan ? (
              <Badge
                variant={data.sessionPlan.ageMinutes !== null && data.sessionPlan.ageMinutes > 120 ? "destructive" : "secondary"}
                data-testid="badge-session-plan-age"
              >
                {data.sessionPlan.ageMinutes !== null && data.sessionPlan.ageMinutes > 120
                  ? `stale (${data.sessionPlan.ageMinutes}m)`
                  : `updated ${relTime(data.sessionPlan.mtime)}`}
              </Badge>
            ) : (
              <Badge variant="outline" data-testid="badge-session-plan-empty">none</Badge>
            )}
          </div>
          <CardDescription>
            {data.sessionPlan
              ? "Current intra-session plan (.local/session_plan.md). Must be deleted at session end."
              : "No active session plan."}
          </CardDescription>
        </CardHeader>
        {data.sessionPlan && (
          <CardContent>
            <pre
              className="text-xs whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded border max-h-96 overflow-auto"
              data-testid="text-session-plan-content"
            >
              {data.sessionPlan.content}
            </pre>
          </CardContent>
        )}
      </Card>

      <Card data-testid="card-active-jobs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle>In-Flight Agent Jobs</CardTitle>
            <Badge variant="secondary" data-testid="badge-active-jobs-count">{data.activeJobs.length}</Badge>
          </div>
          <CardDescription>Pending or running rows in agent_jobs (top 20 newest).</CardDescription>
        </CardHeader>
        <CardContent>
          {data.activeJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-active-jobs">No active jobs.</p>
          ) : (
            <div className="space-y-2">
              {data.activeJobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between p-2 rounded border text-sm"
                  data-testid={`row-job-${j.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge
                      variant={j.status === "running" ? "default" : "outline"}
                      data-testid={`badge-job-status-${j.id}`}
                    >
                      {j.status}
                    </Badge>
                    <span className="font-mono text-xs truncate" data-testid={`text-job-kind-${j.id}`}>{j.kind}</span>
                    <span className="text-xs text-muted-foreground" data-testid={`text-job-tenant-${j.id}`}>
                      {j.tenant_name ?? `tenant ${j.tenant_id}`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground" data-testid={`text-job-age-${j.id}`}>
                    started {relTime(j.started_at ?? j.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-tasks">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" />
            <CardTitle>Project Tasks</CardTitle>
            <Badge variant="secondary" data-testid="badge-tasks-count">{data.tasks.length}</Badge>
          </div>
          <CardDescription>Files in .local/tasks/ — persistent multi-session work briefs.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-tasks">No persistent tasks.</p>
          ) : (
            <div className="space-y-3">
              {data.tasks.map((t) => (
                <div key={t.file} className="border-l-2 border-primary/40 pl-3" data-testid={`row-task-${t.file}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm" data-testid={`text-task-title-${t.file}`}>{t.title}</span>
                    <span className="text-xs text-muted-foreground" data-testid={`text-task-age-${t.file}`}>
                      {relTime(t.mtime)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1" data-testid={`text-task-summary-${t.file}`}>
                    {t.summary}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">{t.file}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-recent-rounds">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitCommit className="h-5 w-5 text-primary" />
            <CardTitle>Recent R-Rounds</CardTitle>
          </div>
          <CardDescription>Last 5 release-log entries from replit.md.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentRounds.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-rounds">No rounds parsed.</p>
          ) : (
            <div className="space-y-3">
              {data.recentRounds.map((r) => (
                <div key={r.round} className="border-l-2 border-green-500/40 pl-3" data-testid={`row-round-${r.round}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid={`badge-round-${r.round}`}>{r.round}</Badge>
                    {r.date && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-round-date-${r.round}`}>{r.date}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1" data-testid={`text-round-summary-${r.round}`}>
                    {r.oneLiner}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
