import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, Activity, ShieldAlert, Clock, GitBranch, BarChart3, Wrench, Inbox, PackageCheck, TrendingUp, Lightbulb, Minimize2, Gauge } from "lucide-react";

interface EcosystemHealth {
  tenantId: number;
  computedAt: string;
  diversity: {
    perCategory: Array<{ category: string; distinctFamilies: number; rowCount: number }>;
    averageFamilies: number;
    threshold: number;
    breached: boolean;
  };
  coverage: { totalCategories: number; matureCategories: number; coverageRatio: number; threshold: number; breached: boolean };
  contradiction: { sampleSize: number; lowConcordanceCount: number; contradictionRatio: number; threshold: number; breached: boolean };
  freshness: { sampleSize: number; medianAgeDays: number; threshold: number; breached: boolean };
  efficiency: {
    sampleSize: number;
    predictedMedianMs: number;
    actualMedianMs: number;
    predictionGapRatio: number;
    predictedMedianCostUsd: number;
    actualMedianCostUsd: number;
    heavyLoopCount: number;
    skipAdvisedCount: number;
    upRouteCount: number;
    threshold: number;
    breached: boolean;
  };
  selfImprovement: {
    sampleSize: number;
    autoResolved: number;
    escalated: number;
    safetyHeld: number;
    autoResolveRate: number;
    escalationRate: number;
    byClassification: Array<{ classification: string; total: number; resolved: number; resolveRate: number }>;
    recentResolveRate: number;
    priorResolveRate: number;
    trendDelta: number;
    threshold: number;
    breached: boolean;
  };
  feedbackLoop: {
    surfaced: number;
    actedOn: number;
    actedRatio: number;
    staleCount: number;
    oldestStaleDays: number;
    gaps: { open: number; resolved: number; stale: number };
    followups: { pending: number; completed: number; overdue: number };
    threshold: number;
    breached: boolean;
  };
  deliveryFunnel: {
    produced: number;
    shipped: number;
    adopted: number;
    shipRatio: number;
    adoptRatio: number;
    windowDays: number;
    shipThreshold: number;
    adoptThreshold: number;
    breached: boolean;
    degraded: boolean;
  };
  climbTracker: {
    windowWeeks: number;
    weekly: Array<{ weekStart: string; proposalsShipped: number; findingsClosed: number; total: number }>;
    thisWeekTotal: number;
    priorAvgTotal: number;
    trendDelta: number;
    totalOutput: number;
    recentWeeks: number;
    threshold: number;
    breached: boolean;
    degraded: boolean;
  };
  juryExperiences: {
    total: number;
    shadow: number;
    validated: number;
    rejected: number;
    byClass: Array<{ requestClass: string; count: number }>;
    recent: Array<{ id: number; requestClass: string; lesson: string; concordance: number | null; status: string; createdAt: string }>;
    injectionLive: boolean;
    degraded: boolean;
    threshold: number;
    breached: boolean;
  };
  toolCompression: {
    windowDays: number;
    calls: number;
    compressedCalls: number;
    tokensSavedVsBaseline: number;
    tokensSavedVsRaw: number;
    savingsRatio: number;
    estCostSavedUsd: number;
    inputUsdPerMTok: number;
    degraded: boolean;
  };
  harnessHealth: {
    windowDays: number;
    attempts: number;
    incidents: number;
    landed: number;
    rolledBack: number;
    noFix: number;
    blocked: number;
    ranAttempts: number;
    landRate: number;
    firstPassYield: number;
    avgReworkDepth: number;
    threshold: number;
    breached: boolean;
    degraded: boolean;
  };
  tokenEfficiency: {
    cacheHit: {
      windowDays: number;
      largePromptTokenThreshold: number;
      largePromptSample: number;
      hitRatePct: number;
      starvedCount: number;
      starvedPct: number;
      threshold: number;
      breached: boolean;
    };
    fixedOverhead: {
      instructionTokens: number;
      instructionMeasured: boolean;
      toolCount: number;
      toolCatalogTokens: number;
      fixedTokens: number;
      medianActualTokensIn: number;
      sharePct: number;
      usdPerRequest: number;
      usdPerMTok: number;
      threshold: number;
      breached: boolean;
    };
    degraded: boolean;
  };
  probesDegraded: string[];
  anyBreached: boolean;
}

interface DeclineEvent {
  id: number;
  persona_id: number | null;
  conversation_id: number | null;
  source: string;
  reason: string;
  detail: string | null;
  tool_name: string | null;
  flagged_categories: string[] | null;
  created_at: string;
}

function MetricCard({ title, icon: Icon, breached, children, description }: { title: string; icon: any; breached: boolean; description: string; children: React.ReactNode }) {
  return (
    <Card data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, "-")}`} className={breached ? "border-destructive" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${breached ? "text-destructive" : "text-primary"}`} />
            <CardTitle>{title}</CardTitle>
          </div>
          {breached ? (
            <Badge variant="destructive" data-testid={`badge-breach-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              <AlertTriangle className="h-3 w-3 mr-1" /> threshold breached
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid={`badge-ok-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> within threshold
            </Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function AdminEcosystemHealthPage() {
  const { data, isLoading, error } = useQuery<EcosystemHealth>({
    queryKey: ["/api/admin/ecosystem-health"],
    refetchInterval: 60_000,
  });
  const { data: declines } = useQuery<{ events: DeclineEvent[]; count: number }>({
    queryKey: ["/api/admin/decline-events"],
    refetchInterval: 60_000,
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
            Failed to load ecosystem health. Please try again.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ecosystem-health">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Ecosystem Health</h1>
          <p className="text-muted-foreground text-sm" data-testid="text-page-subtitle">
            MNEMA Nugget 6 — diversity, coverage, contradiction density, freshness + orchestration efficiency. Last computed {new Date(data.computedAt).toLocaleString()}.
          </p>
        </div>
        {data.anyBreached ? (
          <Badge variant="destructive" data-testid="badge-overall-breach">
            <AlertTriangle className="h-4 w-4 mr-1" /> 1+ thresholds breached
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid="badge-overall-ok">
            <CheckCircle2 className="h-4 w-4 mr-1" /> all thresholds OK
          </Badge>
        )}
      </div>
      {data.probesDegraded?.length > 0 && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          data-testid="status-probes-degraded"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Telemetry unavailable for: {data.probesDegraded.join(", ")}. These cards show fallback
            values, not healthy zeros — a query or import failed when this snapshot was computed.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetricCard
          title="Diversity"
          icon={GitBranch}
          breached={data.diversity.breached}
          description={`Distinct extractor families per memory category. Threshold: ≥ ${data.diversity.threshold} per mature category.`}
        >
          <div className="space-y-2">
            <div className="text-2xl font-bold" data-testid="text-diversity-avg">{data.diversity.averageFamilies}</div>
            <div className="text-sm text-muted-foreground">avg families/category across {data.diversity.perCategory.length} categories</div>
            {data.diversity.perCategory.slice(0, 6).map((c) => (
              <div key={c.category} className="flex items-center justify-between text-xs border-t pt-1" data-testid={`row-diversity-${c.category}`}>
                <span className="truncate max-w-[60%]">{c.category}</span>
                <span className={c.distinctFamilies < data.diversity.threshold && c.rowCount >= 5 ? "text-destructive font-medium" : ""}>
                  {c.distinctFamilies} fam · {c.rowCount} rows
                </span>
              </div>
            ))}
          </div>
        </MetricCard>

        <MetricCard
          title="Coverage"
          icon={Activity}
          breached={data.coverage.breached}
          description={`Fraction of categories with ≥ 5 active rows. Threshold: ≥ ${Math.round(data.coverage.threshold * 100)}%.`}
        >
          <div className="text-2xl font-bold" data-testid="text-coverage-ratio">{Math.round(data.coverage.coverageRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground">
            {data.coverage.matureCategories} of {data.coverage.totalCategories} categories mature
          </div>
        </MetricCard>

        <MetricCard
          title="Contradiction Density"
          icon={ShieldAlert}
          breached={data.contradiction.breached}
          description={`Fraction of recent ensemble votes with κ<0.5. Threshold: ≤ ${Math.round(data.contradiction.threshold * 100)}%.`}
        >
          <div className="text-2xl font-bold" data-testid="text-contradiction-ratio">{Math.round(data.contradiction.contradictionRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground">
            {data.contradiction.lowConcordanceCount} of {data.contradiction.sampleSize} recent ensemble runs (last 100)
          </div>
        </MetricCard>

        <MetricCard
          title="Freshness"
          icon={Clock}
          breached={data.freshness.breached}
          description={`Median age of recent active memory rows. Threshold: ≤ ${data.freshness.threshold} days.`}
        >
          <div className="text-2xl font-bold" data-testid="text-freshness-median">{data.freshness.medianAgeDays} days</div>
          <div className="text-sm text-muted-foreground">
            median age across last {data.freshness.sampleSize} active rows
          </div>
        </MetricCard>

        <MetricCard
          title="Orchestration Efficiency"
          icon={BarChart3}
          breached={data.efficiency.breached}
          description={`Predicted-vs-actual time per orchestration + heavy-loop guard (arXiv:2605.22687). Threshold: median gap ≤ ${Math.round(data.efficiency.threshold * 100)}%.`}
        >
          <div className="text-2xl font-bold" data-testid="text-efficiency-gap">{Math.round(data.efficiency.predictionGapRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground mb-2">
            median prediction gap across {data.efficiency.sampleSize} orchestrations
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-efficiency-predicted">
              <span className="text-muted-foreground">predicted median</span>
              <span>{(data.efficiency.predictedMedianMs / 1000).toFixed(1)}s</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-efficiency-actual">
              <span className="text-muted-foreground">actual median</span>
              <span>{(data.efficiency.actualMedianMs / 1000).toFixed(1)}s</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-efficiency-heavy">
              <span className="text-muted-foreground">heavy loops run</span>
              <span>{data.efficiency.heavyLoopCount}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-efficiency-skips">
              <span className="text-muted-foreground">guard advised direct path</span>
              <span>{data.efficiency.skipAdvisedCount}×</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-efficiency-uproutes">
              <span className="text-muted-foreground">up-routed to hard model</span>
              <span>{data.efficiency.upRouteCount}×</span>
            </div>
          </div>
        </MetricCard>

        <MetricCard
          title="Self-Improvement Loop"
          icon={Wrench}
          breached={data.selfImprovement.breached}
          description={`Self-repair catch-rate: incidents auto-closed by the CI self-healer + architect/jury loop (Anthropic Institute 2026). Threshold: ≥ ${Math.round(data.selfImprovement.threshold * 100)}% auto-resolved.`}
        >
          <div className="text-2xl font-bold" data-testid="text-selfimprovement-rate">{Math.round(data.selfImprovement.autoResolveRate * 100)}%</div>
          <div className="text-sm text-muted-foreground mb-2">
            {data.selfImprovement.autoResolved} of {data.selfImprovement.sampleSize} incidents auto-resolved
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-selfimprovement-escalated">
              <span className="text-muted-foreground">escalated to owner</span>
              <span>{data.selfImprovement.escalated} ({Math.round(data.selfImprovement.escalationRate * 100)}%)</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-selfimprovement-safety">
              <span className="text-muted-foreground">held by safety guard</span>
              <span>{data.selfImprovement.safetyHeld}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-selfimprovement-trend">
              <span className="text-muted-foreground">30d resolve-rate trend</span>
              <span className={data.selfImprovement.trendDelta >= 0 ? "text-primary" : "text-destructive"}>
                {data.selfImprovement.trendDelta >= 0 ? "+" : ""}{Math.round(data.selfImprovement.trendDelta * 100)} pts
              </span>
            </div>
            {data.selfImprovement.byClassification.slice(0, 3).map((c) => (
              <div key={c.classification} className="flex items-center justify-between border-t pt-1" data-testid={`row-selfimprovement-class-${c.classification}`}>
                <span className="truncate max-w-[60%] text-muted-foreground">{c.classification}</span>
                <span>{Math.round(c.resolveRate * 100)}% · {c.total}</span>
              </div>
            ))}
          </div>
        </MetricCard>

        <MetricCard
          title="Feedback-Loop Accountability"
          icon={Inbox}
          breached={data.feedbackLoop.breached}
          description={`Of the work the platform surfaced (capability gaps + scheduled follow-ups), how much got acted on vs is sitting in the graveyard. Threshold: ≥ ${Math.round(data.feedbackLoop.threshold * 100)}% acted on.`}
        >
          <div className="text-2xl font-bold" data-testid="text-feedbackloop-ratio">{Math.round(data.feedbackLoop.actedRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground mb-2">
            {data.feedbackLoop.actedOn} of {data.feedbackLoop.surfaced} surfaced items acted on
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-feedbackloop-stale">
              <span className="text-muted-foreground">stale / ignored (graveyard)</span>
              <span className={data.feedbackLoop.staleCount > 0 ? "text-destructive font-medium" : ""}>{data.feedbackLoop.staleCount}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-feedbackloop-oldest">
              <span className="text-muted-foreground">oldest stale item</span>
              <span>{data.feedbackLoop.oldestStaleDays > 0 ? `${data.feedbackLoop.oldestStaleDays}d` : "—"}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-1" data-testid="row-feedbackloop-gaps">
              <span className="text-muted-foreground">capability gaps (open / resolved)</span>
              <span>{data.feedbackLoop.gaps.open} / {data.feedbackLoop.gaps.resolved}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-feedbackloop-followups">
              <span className="text-muted-foreground">follow-ups (overdue / done)</span>
              <span>{data.feedbackLoop.followups.overdue} / {data.feedbackLoop.followups.completed}</span>
            </div>
          </div>
        </MetricCard>

        <MetricCard
          title="Delivery Funnel"
          icon={PackageCheck}
          breached={data.deliveryFunnel.breached}
          description={`Produce → ship → adopt (SSRN 6859839, MIT 2026). Output volume is a vanity metric; this tracks how much of what's produced ships, and how much of what ships actually gets fetched by a recipient. Window: ${data.deliveryFunnel.windowDays}d.`}
        >
          {data.deliveryFunnel.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-funnel-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — these numbers are a fallback, not a measurement.</span>
            </div>
          ) : (
          <>
          <div className="text-2xl font-bold" data-testid="text-funnel-adopt">{Math.round(data.deliveryFunnel.adoptRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground mb-2">
            of {data.deliveryFunnel.shipped} shipped deliverables were fetched by a recipient
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-funnel-produced">
              <span className="text-muted-foreground">produced</span>
              <span>{data.deliveryFunnel.produced}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-funnel-shipped">
              <span className="text-muted-foreground">shipped (ship rate)</span>
              <span>{data.deliveryFunnel.shipped} ({Math.round(data.deliveryFunnel.shipRatio * 100)}%)</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-funnel-adopted">
              <span className="text-muted-foreground">adopted (fetched ≥1×)</span>
              <span>{data.deliveryFunnel.adopted}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-1" data-testid="row-funnel-note">
              <span className="text-muted-foreground">instant-play video views</span>
              <span className="text-muted-foreground">not yet linked</span>
            </div>
          </div>
          </>
          )}
        </MetricCard>

        <MetricCard
          title="Climb Tracker"
          icon={TrendingUp}
          breached={data.climbTracker.breached}
          description={`Self-improvement OUTPUT over time: proposals shipped + findings closed per week across the last ${data.climbTracker.windowWeeks}w. A stalled climb (prior output, recent zero) breaches; zero-everywhere is "no data", not a breach.`}
        >
          {data.climbTracker.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-climb-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — these numbers are a fallback, not a measurement.</span>
            </div>
          ) : (
          <>
          <div className="text-2xl font-bold" data-testid="text-climb-thisweek">{data.climbTracker.thisWeekTotal}</div>
          <div className="text-sm text-muted-foreground mb-2">
            self-improvement outputs this week ({data.climbTracker.trendDelta >= 0 ? "+" : ""}{data.climbTracker.trendDelta} vs prior-week avg)
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-climb-total">
              <span className="text-muted-foreground">total output ({data.climbTracker.windowWeeks}w)</span>
              <span>{data.climbTracker.totalOutput}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-climb-prioravg">
              <span className="text-muted-foreground">prior-week avg</span>
              <span>{data.climbTracker.priorAvgTotal}</span>
            </div>
            <div className="flex items-end gap-1 pt-2" data-testid="row-climb-spark">
              {data.climbTracker.weekly.map((w, i) => (
                <div
                  key={i}
                  title={`${w.weekStart}: ${w.total} (${w.proposalsShipped} proposals, ${w.findingsClosed} findings)`}
                  className="flex-1 bg-primary/30 rounded-sm"
                  style={{ height: `${Math.max(4, w.total * 8)}px` }}
                  data-testid={`bar-climb-${i}`}
                />
              ))}
            </div>
          </div>
          </>
          )}
        </MetricCard>

        <MetricCard
          title="Jury Experiences"
          icon={Lightbulb}
          breached={false}
          description="Training-Free GRPO (arXiv:2510.08191) — comparative 'semantic advantage' lessons distilled from divergent jury rollouts (κ<0.92). Collected for inspection only."
        >
          {data.juryExperiences.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-jury-exp-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — table may not exist yet.</span>
            </div>
          ) : (
          <>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-2xl font-bold" data-testid="text-jury-exp-total">{data.juryExperiences.total}</div>
            <Badge
              variant={data.juryExperiences.injectionLive ? "default" : "secondary"}
              data-testid="badge-jury-exp-injection"
            >
              {data.juryExperiences.injectionLive ? "INJECTION LIVE" : "SHADOW — not injected"}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground mb-2">
            lessons collected · {data.juryExperiences.shadow} shadow · {data.juryExperiences.validated} validated · {data.juryExperiences.rejected} rejected
          </div>
          {data.juryExperiences.recent.length === 0 ? (
            <div className="text-xs text-muted-foreground border-t pt-2" data-testid="text-jury-exp-empty">
              No lessons yet — accrue from divergent ensemble votes over time.
            </div>
          ) : (
            <div className="space-y-1 text-xs border-t pt-2">
              {data.juryExperiences.recent.slice(0, 5).map((e) => (
                <div key={e.id} className="border-l-2 pl-2 py-1" data-testid={`row-jury-exp-${e.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{e.requestClass}</Badge>
                    {e.concordance !== null && <span className="text-muted-foreground">κ={e.concordance.toFixed(2)}</span>}
                  </div>
                  <div className="mt-0.5 line-clamp-2">{e.lesson}</div>
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </MetricCard>

        <MetricCard
          title="Tool Compression"
          icon={Minimize2}
          breached={false}
          description={`Input tokens saved by the type-aware tool-output compressor on REAL traffic vs the old head-slice it replaced (both cap at the same size). Window: ${data.toolCompression.windowDays}d.`}
        >
          {data.toolCompression.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-tool-compression-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — table may not exist yet.</span>
            </div>
          ) : data.toolCompression.calls === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-tool-compression-empty">
              No tool calls recorded yet — savings accrue as the agent runs tools.
            </div>
          ) : (
          <>
          <div className="text-2xl font-bold" data-testid="text-tool-compression-saved">
            {data.toolCompression.tokensSavedVsBaseline.toLocaleString()} tok
          </div>
          <div className="text-sm text-muted-foreground mb-2">
            input tokens saved vs the old head-slice · ≈ ${data.toolCompression.estCostSavedUsd.toLocaleString()} at ${data.toolCompression.inputUsdPerMTok}/M
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-tool-compression-calls">
              <span className="text-muted-foreground">tool calls (compressed / total)</span>
              <span>{data.toolCompression.compressedCalls.toLocaleString()} / {data.toolCompression.calls.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-tool-compression-ratio">
              <span className="text-muted-foreground">size reduction on compressed calls</span>
              <span>{Math.round(data.toolCompression.savingsRatio * 100)}%</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-tool-compression-vsraw">
              <span className="text-muted-foreground">gross vs raw payload (context only)</span>
              <span>{data.toolCompression.tokensSavedVsRaw.toLocaleString()} tok</span>
            </div>
          </div>
          </>
          )}
        </MetricCard>

        <MetricCard
          title="Harness Health"
          icon={Gauge}
          breached={data.harnessHealth.breached}
          description={`Process quality of the execute-verify-repair loop ("Code as Agent Harness", arXiv:2605.18747 — evaluation beyond final task success). Of the fixes the harness proposed AND tested, how many passed the verifier and stuck. Threshold: land-rate ≥ ${Math.round(data.harnessHealth.threshold * 100)}%. Window: ${data.harnessHealth.windowDays}d.`}
        >
          {data.harnessHealth.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-harness-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — these numbers are a fallback, not a measurement.</span>
            </div>
          ) : data.harnessHealth.ranAttempts === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-harness-empty">
              No fixes proposed-and-tested yet — convergence accrues as the repair loop runs.
              {(data.harnessHealth.noFix > 0 || data.harnessHealth.blocked > 0) && (
                <div className="mt-2 text-xs">
                  {data.harnessHealth.noFix} no-fix-proposed · {data.harnessHealth.blocked} rate-limited / awaiting-HITL
                </div>
              )}
            </div>
          ) : (
          <>
          <div className="text-2xl font-bold" data-testid="text-harness-landrate">{Math.round(data.harnessHealth.landRate * 100)}%</div>
          <div className="text-sm text-muted-foreground mb-2">
            verifier land-rate · {data.harnessHealth.landed} landed of {data.harnessHealth.ranAttempts} proposed-and-tested fixes
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-harness-firstpass">
              <span className="text-muted-foreground">first-pass yield (landed on attempt #1)</span>
              <span>{Math.round(data.harnessHealth.firstPassYield * 100)}%</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-harness-rework">
              <span className="text-muted-foreground">avg rework depth (attempts to converge)</span>
              <span>{data.harnessHealth.avgReworkDepth.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-harness-rolledback">
              <span className="text-muted-foreground">rolled back by verifier</span>
              <span className={data.harnessHealth.rolledBack > 0 ? "text-destructive font-medium" : ""}>{data.harnessHealth.rolledBack}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-1" data-testid="row-harness-excluded">
              <span className="text-muted-foreground">no-fix / blocked (excluded from rate)</span>
              <span>{data.harnessHealth.noFix} / {data.harnessHealth.blocked}</span>
            </div>
          </div>
          </>
          )}
        </MetricCard>

        <MetricCard
          title="Token Efficiency"
          icon={Lightbulb}
          breached={data.tokenEfficiency.cacheHit.breached || data.tokenEfficiency.fixedOverhead.breached}
          description={`Per-request token-cost overhead (microsoft/AI-Engineering-Coach, validation). Cache-hit on large (≥${data.tokenEfficiency.cacheHit.largePromptTokenThreshold.toLocaleString()} tok) prompts over ${data.tokenEfficiency.cacheHit.windowDays}d + fixed instruction/tool-catalog tax. Thresholds: cache-hit ≥ ${data.tokenEfficiency.cacheHit.threshold}%, fixed share ≤ ${data.tokenEfficiency.fixedOverhead.threshold}%.`}
        >
          {data.tokenEfficiency.degraded ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="status-token-efficiency-degraded">
              <AlertTriangle className="h-4 w-4" />
              <span>Telemetry unavailable — these numbers are a fallback, not a measurement.</span>
            </div>
          ) : (
          <>
          <div className="text-2xl font-bold" data-testid="text-token-cachehit">
            {data.tokenEfficiency.cacheHit.largePromptSample === 0 ? "—" : `${data.tokenEfficiency.cacheHit.hitRatePct}%`}
          </div>
          <div className="text-sm text-muted-foreground mb-2">
            {data.tokenEfficiency.cacheHit.largePromptSample === 0
              ? "no large-prompt requests in window yet"
              : `cache-hit on ${data.tokenEfficiency.cacheHit.largePromptSample.toLocaleString()} large-prompt requests · ${data.tokenEfficiency.cacheHit.starvedCount.toLocaleString()} starved (${data.tokenEfficiency.cacheHit.starvedPct}%)`}
          </div>
          <div className="space-y-1 text-xs border-t pt-2">
            <div className="flex items-center justify-between" data-testid="row-token-instruction">
              <span className="text-muted-foreground">instruction tax (system prompt)</span>
              <span>
                {data.tokenEfficiency.fixedOverhead.instructionMeasured
                  ? `${data.tokenEfficiency.fixedOverhead.instructionTokens.toLocaleString()} tok`
                  : "unmeasured"}
              </span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-token-catalog">
              <span className="text-muted-foreground">tool-catalog tax ({data.tokenEfficiency.fixedOverhead.toolCount} tools)</span>
              <span>{data.tokenEfficiency.fixedOverhead.toolCatalogTokens.toLocaleString()} tok</span>
            </div>
            <div className="flex items-center justify-between border-t pt-1" data-testid="row-token-fixed-share">
              <span className="text-muted-foreground">fixed overhead / median request</span>
              <span className={data.tokenEfficiency.fixedOverhead.breached ? "text-destructive font-medium" : ""}>
                {data.tokenEfficiency.fixedOverhead.medianActualTokensIn > 0 && data.tokenEfficiency.fixedOverhead.instructionMeasured
                  ? `${data.tokenEfficiency.fixedOverhead.sharePct}% (${data.tokenEfficiency.fixedOverhead.fixedTokens.toLocaleString()} / ${data.tokenEfficiency.fixedOverhead.medianActualTokensIn.toLocaleString()} tok)`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between" data-testid="row-token-fixed-usd">
              <span className="text-muted-foreground">fixed cost / request</span>
              <span>≈ ${data.tokenEfficiency.fixedOverhead.usdPerRequest.toFixed(4)} at ${data.tokenEfficiency.fixedOverhead.usdPerMTok}/M</span>
            </div>
          </div>
          </>
          )}
        </MetricCard>
      </div>

      <Card data-testid="card-recent-declines">
        <CardHeader>
          <CardTitle>Recent Decline Events</CardTitle>
          <CardDescription>
            Typed refusal stream (MNEMA Nugget 5). Feeds Nugget 2's restraint-precision counter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!declines || declines.events.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-declines">No declines recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {declines.events.slice(0, 25).map((d) => (
                <div key={d.id} className="text-xs border-l-2 pl-2 py-1" data-testid={`row-decline-${d.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.source}</Badge>
                    <Badge variant="secondary">{d.reason}</Badge>
                    {d.tool_name && <Badge variant="outline">{d.tool_name}</Badge>}
                    <span className="text-muted-foreground ml-auto">{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  {d.detail && <div className="mt-1 text-muted-foreground line-clamp-2">{d.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
