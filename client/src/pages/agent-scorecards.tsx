import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, CheckCircle2, Gauge, ThumbsUp } from "lucide-react";

interface Scorecard {
  id: number;
  name: string;
  role: string;
  emoji: string;
  costTier: string;
  isActive: boolean;
  activityCount: number;
  conversationCount: number;
  completedCount: number;
  failedCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  gradedSteps: number;
  llmCallCount: number;
  totalCostUsd: number;
  avgCostPerTaskUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  lastActiveAt: string | null;
}

interface ScorecardsResponse {
  tenantId: number;
  windowDays: number;
  computedAt: string;
  approvals: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    expired: number;
    approvalRate: number | null;
  };
  scorecards: Scorecard[];
}

const TIER_COLORS: Record<string, string> = {
  powerful: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-300/40",
  balanced: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40",
  fast: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-300/40",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

export default function AgentScorecardsPage() {
  const [windowDays, setWindowDays] = useState(30);
  const { data, isLoading, error } = useQuery<ScorecardsResponse>({
    queryKey: ["/api/agent-insights/scorecards", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/agent-insights/scorecards?windowDays=${windowDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="text-scorecards-error">
        Failed to load agent scorecards.
      </div>
    );
  }

  const active = data.scorecards
    .filter(s => s.isActive)
    .sort((a, b) => b.activityCount - a.activityCount || b.totalCostUsd - a.totalCostUsd);
  const totals = active.reduce(
    (acc, s) => {
      acc.tasks += s.completedCount;
      acc.cost += s.totalCostUsd;
      return acc;
    },
    { tasks: 0, cost: 0 },
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6 space-y-6 max-w-7xl">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-scorecards-title">Agent Scorecards</h1>
            <p className="text-muted-foreground mt-1">
              Real track record per agent — tasks, quality, and actual recorded cost. Last {data.windowDays} days.
            </p>
          </div>
          <div className="flex gap-2" data-testid="scorecards-window-selector">
            {[7, 30, 90].map(d => (
              <Button key={d} size="sm" variant={windowDays === d ? "default" : "outline"} onClick={() => setWindowDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <Stat label="Tasks completed" value={totals.tasks.toLocaleString()} sub="all agents" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-amber-600 shrink-0" />
              <Stat label="Recorded spend" value={`$${totals.cost.toFixed(2)}`} sub="from the cost ledger" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <ThumbsUp className="w-5 h-5 text-blue-600 shrink-0" />
              <Stat
                label="Human approval rate"
                value={data.approvals.approvalRate != null ? `${data.approvals.approvalRate}%` : "—"}
                sub={`${data.approvals.approved}/${data.approvals.approved + data.approvals.rejected} decided`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Gauge className="w-5 h-5 text-purple-600 shrink-0" />
              <Stat label="Active agents" value={String(active.length)} sub={`window: ${data.windowDays}d`} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {active.map(s => (
            <Card key={s.id} data-testid={`card-scorecard-${s.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="text-xl">{s.emoji}</span>
                  <span className="truncate">{s.name}</span>
                  <Badge variant="outline" className={`ml-auto shrink-0 ${TIER_COLORS[s.costTier] || ""}`}>
                    {s.costTier || "balanced"}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground truncate">{s.role}</p>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-x-3 gap-y-3">
                <Stat label="Tasks done" value={s.completedCount.toLocaleString()} sub={`${s.activityCount} activities`} />
                <Stat label="Success" value={s.successRate != null ? `${s.successRate}%` : "—"} sub={s.failedCount ? `${s.failedCount} failed` : "no failures"} />
                <Stat
                  label="Quality"
                  value={s.avgQualityScore != null ? `${s.avgQualityScore}/100` : "—"}
                  sub={s.gradedSteps ? `${s.gradedSteps} graded steps` : "not yet graded"}
                />
                <Stat label="Cost" value={`$${s.totalCostUsd.toFixed(2)}`} sub={`${s.llmCallCount} model calls`} />
                <Stat label="Cost / task" value={s.avgCostPerTaskUsd != null ? `$${s.avgCostPerTaskUsd.toFixed(3)}` : "—"} />
                <Stat
                  label="Last active"
                  value={s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleDateString() : "idle"}
                />
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Cost comes from the per-call cost ledger (not estimates). Quality is the average grader score on plan steps
          attributed to each agent. Approval rate covers all human approval requests in this workspace for the window.
        </p>
      </div>
    </div>
  );
}
